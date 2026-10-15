from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.discussion import (
    DEFAULT_DISCUSSION_HISTORY_LIMIT,
    MAX_DISCUSSION_HISTORY_LIMIT,
    VALID_REACTION_SET,
)
from app.models.community import Community
from app.models.discussion_message import DiscussionMessage
from app.models.discussion_reaction import DiscussionReaction
from app.models.membership import Membership, MembershipStatus
from app.models.sticker_asset import StickerAsset
from app.models.user import User
from app.schemas.discussion import (
    DiscussionHistoryResponse,
    DiscussionMessageCreate,
    DiscussionMessageResponse,
    ReactionSummary,
)


def _get_community(db: Session, community_slug: str) -> Community:
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found",
        )
    return community


def list_discussion_messages(
    db: Session,
    community_slug: str,
    caller_user_id: UUID,
    limit: int = DEFAULT_DISCUSSION_HISTORY_LIMIT,
    before: UUID | None = None,
    after: UUID | None = None,
    community_id: UUID | None = None,
) -> DiscussionHistoryResponse:
    if community_id is None:
        community = _get_community(db, community_slug)
        comm_id = community.id
    else:
        comm_id = community_id

    bounded_limit = min(max(1, limit), MAX_DISCUSSION_HISTORY_LIMIT)

    base_query = (
        db.query(DiscussionMessage)
        .options(joinedload(DiscussionMessage.author))
        .filter(DiscussionMessage.community_id == comm_id, DiscussionMessage.removed_at.is_(None))
    )

    has_more_older = False
    has_more_newer = False
    older_cursor: UUID | None = None
    newer_cursor: UUID | None = None

    if before is not None and after is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot specify both 'before' and 'after' cursors",
        )

    if before is not None:
        cursor_msg = (
            db.query(DiscussionMessage.created_at, DiscussionMessage.id)
            .filter(
                DiscussionMessage.id == before,
                DiscussionMessage.community_id == comm_id,
            )
            .first()
        )
        if not cursor_msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Cursor message not found in this community",
            )

        # Retrieve older messages (before cursor)
        rows = (
            base_query.filter(
                (DiscussionMessage.created_at < cursor_msg.created_at)
                | (
                    (DiscussionMessage.created_at == cursor_msg.created_at)
                    & (DiscussionMessage.id < cursor_msg.id)
                )
            )
            .order_by(
                DiscussionMessage.created_at.desc(),
                DiscussionMessage.id.desc(),
            )
            .limit(bounded_limit + 1)
            .all()
        )

        if len(rows) > bounded_limit:
            has_more_older = True
            items = rows[:bounded_limit]
            older_cursor = items[-1].id
        else:
            items = rows
            older_cursor = None

        # Reverse to chronological order (oldest first)
        items.reverse()
        if items:
            newer_cursor = items[-1].id

    elif after is not None:
        cursor_msg = (
            db.query(DiscussionMessage.created_at, DiscussionMessage.id)
            .filter(
                DiscussionMessage.id == after,
                DiscussionMessage.community_id == comm_id,
            )
            .first()
        )
        if not cursor_msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Cursor message not found in this community",
            )

        # Retrieve newer messages (after cursor - for reconnect catch-up)
        rows = (
            base_query.filter(
                (DiscussionMessage.created_at > cursor_msg.created_at)
                | (
                    (DiscussionMessage.created_at == cursor_msg.created_at)
                    & (DiscussionMessage.id > cursor_msg.id)
                )
            )
            .order_by(
                DiscussionMessage.created_at.asc(),
                DiscussionMessage.id.asc(),
            )
            .limit(bounded_limit + 1)
            .all()
        )

        if len(rows) > bounded_limit:
            has_more_newer = True
            items = rows[:bounded_limit]
            newer_cursor = items[-1].id
        else:
            items = rows
            newer_cursor = None

        if items:
            older_cursor = items[0].id

    else:
        # Default: latest N messages
        rows = (
            base_query.order_by(
                DiscussionMessage.created_at.desc(),
                DiscussionMessage.id.desc(),
            )
            .limit(bounded_limit + 1)
            .all()
        )

        if len(rows) > bounded_limit:
            has_more_older = True
            items = rows[:bounded_limit]
            older_cursor = items[-1].id
        else:
            items = rows
            older_cursor = None

        # Reverse to chronological order (oldest first)
        items.reverse()
        if items:
            newer_cursor = items[-1].id

    message_ids = [m.id for m in items]
    reactions_by_msg: dict[UUID, list[ReactionSummary]] = {m_id: [] for m_id in message_ids}
    caller_rx_by_msg: dict[UUID, str | None] = {m_id: None for m_id in message_ids}

    if message_ids:
        # 1 single query for reaction counts across all messages in page
        rx_counts = (
            db.query(
                DiscussionReaction.message_id,
                DiscussionReaction.emoji,
                func.count(DiscussionReaction.id).label("cnt"),
            )
            .filter(DiscussionReaction.message_id.in_(message_ids))
            .group_by(DiscussionReaction.message_id, DiscussionReaction.emoji)
            .all()
        )
        for msg_id, emoji, cnt in rx_counts:
            reactions_by_msg[msg_id].append(ReactionSummary(emoji=emoji, count=cnt))

        # 1 single query for caller reactions
        caller_rxs = (
            db.query(DiscussionReaction.message_id, DiscussionReaction.emoji)
            .filter(
                DiscussionReaction.message_id.in_(message_ids),
                DiscussionReaction.user_id == caller_user_id,
            )
            .all()
        )
        for msg_id, emoji in caller_rxs:
            caller_rx_by_msg[msg_id] = emoji

    response_items: list[DiscussionMessageResponse] = []
    for m in items:
        response_items.append(
            DiscussionMessageResponse(
                id=m.id,
                kind=m.kind,
                content=m.content,
                sticker_id=m.sticker_id,
                custom_sticker_id=m.custom_sticker_id,
                author_id=m.author_id,
                author_username=m.author_username or "",
                created_at=m.created_at,
                reactions=reactions_by_msg[m.id],
                caller_reaction=caller_rx_by_msg[m.id],
            )
        )

    return DiscussionHistoryResponse(
        items=response_items,
        older_cursor=older_cursor,
        newer_cursor=newer_cursor,
        has_more_older=has_more_older,
        has_more_newer=has_more_newer,
    )


def create_discussion_message(
    db: Session,
    community_slug: str,
    author: User,
    payload: DiscussionMessageCreate,
    community_id: UUID | None = None,
    raw_token: str | None = None,
) -> tuple[DiscussionMessage, bool]:
    """
    Creates a discussion message with retry identity protection.
    Returns (message, is_replay).
    """
    if community_id is None:
        community = _get_community(db, community_slug)
        comm_id = community.id
    else:
        comm_id = community_id

    # 1. Fast-path check for existing retry with same client_message_id
    existing = (
        db.query(DiscussionMessage)
        .options(joinedload(DiscussionMessage.author))
        .filter(
            DiscussionMessage.community_id == comm_id,
            DiscussionMessage.author_id == author.id,
            DiscussionMessage.client_message_id == payload.client_message_id,
        )
        .populate_existing()
        .with_for_update(of=DiscussionMessage)
        .first()
    )
    if existing:
        if existing.removed_at is not None:
            raise HTTPException(409, "This client_message_id belongs to a removed message")
        if (
            existing.kind == payload.kind
            and existing.content == payload.content
            and existing.sticker_id == payload.sticker_id
            and existing.custom_sticker_id == payload.custom_sticker_id
        ):
            return existing, True
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A message with this client_message_id already exists with different content",
        )

    # Library removal locks User -> Session -> StickerAsset. New custom sends
    # take the same order, so whichever obtains the User lock first determines
    # whether the asset is still available for a new reference.
    if payload.kind == "CUSTOM_STICKER":
        from app.core.sessions import validate_session

        if not raw_token:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
        locked_author = (db.query(User).filter(User.id == author.id).populate_existing()
                         .with_for_update().one_or_none())
        auth_session = validate_session(db, raw_token, refresh=True, lock=True)
        if locked_author is None or auth_session is None or auth_session.user_id != author.id:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
        active_membership = db.query(Membership.id).filter(
            Membership.user_id == author.id,
            Membership.community_id == comm_id,
            Membership.status == MembershipStatus.ACTIVE,
        ).first()
        if active_membership is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not enough permissions")

        # A concurrent identical send may have committed while this request
        # waited for the User lock. Resolve it before requiring library access.
        existing = (
            db.query(DiscussionMessage)
            .options(joinedload(DiscussionMessage.author))
            .filter(
                DiscussionMessage.community_id == comm_id,
                DiscussionMessage.author_id == author.id,
                DiscussionMessage.client_message_id == payload.client_message_id,
            )
            .populate_existing()
            .with_for_update(of=DiscussionMessage)
            .first()
        )
        if existing:
            if existing.removed_at is not None:
                raise HTTPException(409, "This client_message_id belongs to a removed message")
            if _same_message_payload(existing, payload):
                return existing, True
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A message with this client_message_id already exists with different content",
            )

        asset = (db.query(StickerAsset).filter(
            StickerAsset.id == payload.custom_sticker_id,
            StickerAsset.owner_id == author.id,
            StickerAsset.removed_at.is_(None),
        ).populate_existing().with_for_update().one_or_none())
        if asset is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Sticker not found")

    # 2. Attempt insert
    msg = DiscussionMessage(
        community_id=comm_id,
        author_id=author.id,
        kind=payload.kind,
        content=payload.content,
        sticker_id=payload.sticker_id,
        custom_sticker_id=payload.custom_sticker_id,
        client_message_id=payload.client_message_id,
    )
    db.add(msg)
    try:
        db.commit()
        db.refresh(msg)
        if msg.removed_at is not None:
            raise HTTPException(409, "This client_message_id belongs to a removed message")
        return msg, False
    except IntegrityError:
        db.rollback()
        # Handle concurrent submission race condition
        winning_msg = (
            db.query(DiscussionMessage)
            .options(joinedload(DiscussionMessage.author))
            .filter(
                DiscussionMessage.community_id == comm_id,
                DiscussionMessage.author_id == author.id,
                DiscussionMessage.client_message_id == payload.client_message_id,
            )
            .populate_existing()
            .with_for_update(of=DiscussionMessage)
            .first()
        )
        if winning_msg:
            if winning_msg.removed_at is not None:
                raise HTTPException(409, "This client_message_id belongs to a removed message")
            if (
                winning_msg.kind == payload.kind
                and winning_msg.content == payload.content
                and winning_msg.sticker_id == payload.sticker_id
                and winning_msg.custom_sticker_id == payload.custom_sticker_id
            ):
                return winning_msg, True
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A message with this client_message_id already exists with different content",
            )
        raise


def _same_message_payload(message: DiscussionMessage, payload: DiscussionMessageCreate) -> bool:
    return (
        message.kind == payload.kind
        and message.content == payload.content
        and message.sticker_id == payload.sticker_id
        and message.custom_sticker_id == payload.custom_sticker_id
    )


def set_discussion_reaction(
    db: Session,
    community_slug: str,
    message_id: UUID,
    user: User,
    emoji: str,
    community_id: UUID | None = None,
) -> tuple[UUID, list[ReactionSummary], str | None]:
    if emoji not in VALID_REACTION_SET:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid reaction emoji: '{emoji}'",
        )

    if community_id is None:
        community = _get_community(db, community_slug)
        comm_id = community.id
    else:
        comm_id = community_id

    # Validate message belongs to the specified community
    msg = (
        db.query(DiscussionMessage)
        .filter(
            DiscussionMessage.id == message_id,
            DiscussionMessage.community_id == comm_id,
            DiscussionMessage.removed_at.is_(None),
        )
        .populate_existing()
        .with_for_update()
        .first()
    )
    if not msg:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Discussion message not found in this community",
        )

    # Atomically add or update reaction
    existing = (
        db.query(DiscussionReaction)
        .filter(
            DiscussionReaction.message_id == message_id,
            DiscussionReaction.user_id == user.id,
        )
        .first()
    )
    if existing:
        existing.emoji = emoji
    else:
        new_rx = DiscussionReaction(
            message_id=message_id,
            user_id=user.id,
            emoji=emoji,
        )
        db.add(new_rx)

    db.commit()

    # Query updated reaction summary
    rx_counts = (
        db.query(DiscussionReaction.emoji, func.count(DiscussionReaction.id).label("cnt"))
        .join(DiscussionMessage, DiscussionReaction.message_id == DiscussionMessage.id)
        .filter(DiscussionReaction.message_id == message_id,
                DiscussionMessage.community_id == comm_id, DiscussionMessage.removed_at.is_(None))
        .group_by(DiscussionReaction.emoji)
        .all()
    )
    require_visible_message(db, comm_id, message_id)
    summaries = [ReactionSummary(emoji=e, count=c) for e, c in rx_counts]
    return message_id, summaries, emoji


def remove_discussion_reaction(
    db: Session,
    community_slug: str,
    message_id: UUID,
    user: User,
    community_id: UUID | None = None,
) -> tuple[UUID, list[ReactionSummary], str | None]:
    if community_id is None:
        community = _get_community(db, community_slug)
        comm_id = community.id
    else:
        comm_id = community_id

    msg = (
        db.query(DiscussionMessage)
        .filter(
            DiscussionMessage.id == message_id,
            DiscussionMessage.community_id == comm_id,
            DiscussionMessage.removed_at.is_(None),
        )
        .populate_existing()
        .with_for_update()
        .first()
    )
    if not msg:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Discussion message not found in this community",
        )

    existing = (
        db.query(DiscussionReaction)
        .filter(
            DiscussionReaction.message_id == message_id,
            DiscussionReaction.user_id == user.id,
        )
        .first()
    )
    if existing:
        db.delete(existing)
        db.commit()

    # Query updated reaction summary
    rx_counts = (
        db.query(DiscussionReaction.emoji, func.count(DiscussionReaction.id).label("cnt"))
        .join(DiscussionMessage, DiscussionReaction.message_id == DiscussionMessage.id)
        .filter(DiscussionReaction.message_id == message_id,
                DiscussionMessage.community_id == comm_id, DiscussionMessage.removed_at.is_(None))
        .group_by(DiscussionReaction.emoji)
        .all()
    )
    require_visible_message(db, comm_id, message_id)
    summaries = [ReactionSummary(emoji=e, count=c) for e, c in rx_counts]
    return message_id, summaries, None


def require_visible_message(db: Session, community_id: UUID, message_id: UUID, *, replay: bool = False) -> None:
    if not db.query(DiscussionMessage.id).filter(
        DiscussionMessage.id == message_id, DiscussionMessage.community_id == community_id,
        DiscussionMessage.removed_at.is_(None),
    ).first():
        raise HTTPException(409 if replay else 404, "Discussion message is unavailable")
