import asyncio
import logging
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    Path,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from anyio import to_thread
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.api.content_route import PrivateContentRoute, PrivateStickerMediaRoute
from app.api.deps import get_current_active_membership, get_db, require_community_delegate
from app.core.broadcaster import Connection, broadcaster
from app.core.config import settings
from app.core.discussion import (
    DEFAULT_DISCUSSION_HISTORY_LIMIT,
    MAX_DISCUSSION_HISTORY_LIMIT,
    VALID_STICKERS,
    WS_REVALIDATION_INTERVAL_SECONDS,
)
from app.core.sessions import validate_session
from app.core.stickers import (
    MAX_STORED_STICKER_BYTES,
    StickerImageError,
    sticker_storage_owner_id,
    validate_canonical_sticker_bytes,
)
from app.core.storage.exceptions import ObjectNotFoundError, StickerStorageError
from app.core.storage.local import LocalFileSystemStorage
from app.database.session import SessionLocal
from app.models.community import Community
from app.models.discussion_message import DiscussionMessage
from app.models.membership import Membership, MembershipStatus
from app.models.sticker_asset import StickerAsset
from app.schemas.discussion import (
    DiscussionHistoryResponse,
    DiscussionMessageCreate,
    DiscussionMessageResponse,
    DiscussionReactionCreate,
    DiscussionReactionSummaryResponse,
    StickerItemResponse,
)
from app.services.discussion import (
    create_discussion_message,
    list_discussion_messages,
    remove_discussion_reaction,
    set_discussion_reaction,
    require_visible_message,
)
from app.services.content_removal import remove_content

logger = logging.getLogger(__name__)
WS_AUTH_CHECK_TIMEOUT_SECONDS = 10

router = APIRouter(route_class=PrivateContentRoute)
sticker_media_router = APIRouter(route_class=PrivateStickerMediaRoute)


@router.delete("/{community_slug}/discussion/messages/{message_id}", status_code=204)
async def remove_message(
    community_slug: str, message_id: UUID,
    membership: Membership = Depends(require_community_delegate), db: Session = Depends(get_db),
) -> Response:
    first_removal = await run_in_threadpool(
        remove_content, db, membership.community_id, membership.user_id, "discussion_message", message_id,
    )
    if first_removal:
        try:
            await broadcaster.broadcast(community_slug, {
                "type": "message_removed", "community_slug": community_slug, "message_id": str(message_id),
            })
        except Exception:
            logger.warning("Broadcast failed for message_removed")
    return Response(status_code=204, headers={"Cache-Control": "private, no-store"})


def check_message_visible(community_slug: str, message_id: UUID) -> bool:
    """Fresh, short-lived read before sending queued content; fail closed."""
    with SessionLocal() as db:
        return db.query(DiscussionMessage.id).join(Community).filter(
            Community.slug == community_slug, DiscussionMessage.id == message_id,
            DiscussionMessage.removed_at.is_(None),
        ).first() is not None


def check_ws_auth(raw_token: str | None, community_slug: str) -> tuple[bool, UUID | None, str | None]:
    """
    Synchronous database validation executed in threadpool for WebSocket connections.
    Opens and closes a dedicated short-lived database session.
    """
    if not raw_token:
        return False, None, "Missing session cookie"

    db = SessionLocal()
    try:
        session_model = validate_session(db, raw_token)
        if not session_model:
            return False, None, "Invalid or expired session"

        community = db.query(Community).filter(Community.slug == community_slug).first()
        if not community:
            return False, None, "Community not found"

        membership = (
            db.query(Membership)
            .filter(
                Membership.user_id == session_model.user_id,
                Membership.community_id == community.id,
            )
            .first()
        )
        if not membership or membership.status != MembershipStatus.ACTIVE:
            return False, None, "Inactive or absent membership"

        return True, session_model.user_id, None
    finally:
        db.close()


async def _bounded_ws_auth_check(raw_token: str, community_slug: str) -> tuple[bool, UUID | None, str | None]:
    """Bound the async wait without pretending to stop a synchronous DB worker."""
    # Each worker owns the SessionLocal opened by check_ws_auth. AnyIO's
    # abandon_on_cancel lets the socket close on deadline while that worker
    # retains the session and closes it in check_ws_auth's finally block.
    return await asyncio.wait_for(
        to_thread.run_sync(
            check_ws_auth, raw_token, community_slug, abandon_on_cancel=True
        ),
        timeout=WS_AUTH_CHECK_TIMEOUT_SECONDS,
    )


async def revalidate_ws_connection(conn: Connection, raw_token: str, community_slug: str) -> None:
    """Periodically recheck authority, failing closed on operational errors."""
    try:
        while not conn.closed:
            await asyncio.sleep(WS_REVALIDATION_INTERVAL_SECONDS)
            if conn.closed:
                return
            try:
                valid, _, _ = await _bounded_ws_auth_check(raw_token, community_slug)
            except asyncio.CancelledError:
                raise
            except Exception:
                # Never expose database details or leave an unchecked live socket.
                logger.warning("Discussion WebSocket authorization revalidation failed; closing connection")
                await conn.close_and_cleanup(
                    reason="Authorization check unavailable",
                    close_code=status.WS_1011_INTERNAL_ERROR,
                )
                return
            if not valid:
                logger.info("Discussion WebSocket authorization expired for user %s", conn.user_id)
                await conn.close_and_cleanup(reason="Session expired or membership revoked")
                return
    except asyncio.CancelledError:
        # Cancellation is normal during disconnect/shutdown and is not an auth failure.
        raise


# ==============================================================================
# REST ENDPOINTS
# ==============================================================================

@router.get(
    "/{community_slug}/discussion/messages",
    response_model=DiscussionHistoryResponse,
    status_code=status.HTTP_200_OK,
    summary="List community discussion history",
)
def list_messages(
    community_slug: str,
    response: Response,
    limit: int = Query(DEFAULT_DISCUSSION_HISTORY_LIMIT, ge=1, le=MAX_DISCUSSION_HISTORY_LIMIT),
    before: UUID | None = Query(None, description="Cursor to fetch older messages before"),
    after: UUID | None = Query(None, description="Cursor to fetch newer messages after"),
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
) -> DiscussionHistoryResponse:
    response.headers["Cache-Control"] = "private, no-store"
    return list_discussion_messages(
        db=db,
        community_slug=community_slug,
        caller_user_id=membership.user_id,
        limit=limit,
        before=before,
        after=after,
        community_id=membership.community_id,
    )


@router.post(
    "/{community_slug}/discussion/messages",
    response_model=DiscussionMessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create discussion message or replay idempotent submission",
)
async def create_message(
    community_slug: str,
    payload: DiscussionMessageCreate,
    request: Request,
    response: Response,
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
) -> DiscussionMessageResponse:
    response.headers["Cache-Control"] = "private, no-store"

    msg, is_replay = await run_in_threadpool(
        create_discussion_message,
        db=db,
        community_slug=community_slug,
        author=membership.user,
        payload=payload,
        community_id=membership.community_id,
        raw_token=request.cookies.get(settings.session_cookie_name),
    )

    if is_replay:
        response.status_code = status.HTTP_200_OK
    else:
        await run_in_threadpool(require_visible_message, db, membership.community_id, msg.id, replay=True)
        # Broadcast message_created event strictly after commit
        event = {
            "type": "message_created",
            "community_slug": community_slug,
            "message": {
                "id": str(msg.id),
                "kind": msg.kind,
                "content": msg.content,
                "sticker_id": msg.sticker_id,
                "custom_sticker_id": str(msg.custom_sticker_id) if msg.custom_sticker_id else None,
                "author_id": str(msg.author_id),
                "author_username": msg.author_username or "",
                "created_at": msg.created_at.isoformat(),
                "reactions": [],
            },
        }
        try:
            await broadcaster.broadcast(community_slug, event)
        except Exception as e:
            logger.warning("Broadcast failed for message_created: %s", e)

    await run_in_threadpool(require_visible_message, db, membership.community_id, msg.id, replay=True)
    return DiscussionMessageResponse(
        id=msg.id,
        kind=msg.kind,
        content=msg.content,
        sticker_id=msg.sticker_id,
        custom_sticker_id=msg.custom_sticker_id,
        author_id=msg.author_id,
        author_username=msg.author_username or "",
        created_at=msg.created_at,
        reactions=[],
        caller_reaction=None,
    )


def get_discussion_sticker_storage() -> LocalFileSystemStorage:
    return LocalFileSystemStorage(settings.storage_root)


@sticker_media_router.get(
    "/{community_slug}/discussion/messages/{message_id}/sticker",
    summary="Read a sticker attached to a visible community message",
)
def read_discussion_sticker(
    community_slug: str,
    message_id: UUID,
    response: Response,
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
    storage: LocalFileSystemStorage = Depends(get_discussion_sticker_storage),
) -> Response:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Cookie"
    response.headers["X-Content-Type-Options"] = "nosniff"
    target = (
        db.query(DiscussionMessage.id, DiscussionMessage.custom_sticker_id,
                 StickerAsset.storage_key, StickerAsset.owner_id)
        .join(StickerAsset, StickerAsset.id == DiscussionMessage.custom_sticker_id)
        .filter(
            DiscussionMessage.id == message_id,
            DiscussionMessage.community_id == membership.community_id,
            DiscussionMessage.removed_at.is_(None),
            DiscussionMessage.kind == "CUSTOM_STICKER",
        )
        .first()
    )
    if target is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Sticker not found")

    try:
        key_owner_id = sticker_storage_owner_id(target.storage_key)
        if target.owner_id is not None and target.owner_id != key_owner_id:
            raise ValueError("Invalid stored reference")
        content = storage.read_sticker_bounded(
            target.storage_key, key_owner_id, MAX_STORED_STICKER_BYTES
        )
        validate_canonical_sticker_bytes(content)
    except (ObjectNotFoundError, StickerStorageError, StickerImageError, ValueError):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Sticker not found") from None
    except Exception:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="Sticker unavailable") from None

    # Recheck visibility after disk I/O so a moderation removal that won while
    # bytes were being read is concealed. Bytes already delivered in an
    # in-flight response cannot be recalled.
    db.expire_all()
    still_visible = db.query(DiscussionMessage.id).filter(
        DiscussionMessage.id == message_id,
        DiscussionMessage.community_id == membership.community_id,
        DiscussionMessage.custom_sticker_id == target.custom_sticker_id,
        DiscussionMessage.kind == "CUSTOM_STICKER",
        DiscussionMessage.removed_at.is_(None),
    ).first()
    if still_visible is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Sticker not found")
    return Response(
        content=content,
        media_type="image/webp",
        headers={
            "Content-Disposition": "inline",
            "Cache-Control": "private, no-store",
            "Vary": "Cookie",
            "X-Content-Type-Options": "nosniff",
        },
    )


router.include_router(sticker_media_router)


@router.put(
    "/{community_slug}/discussion/messages/{message_id}/reaction",
    response_model=DiscussionReactionSummaryResponse,
    status_code=status.HTTP_200_OK,
    summary="Add or update emoji reaction on a message",
)
async def update_reaction(
    community_slug: str,
    message_id: UUID,
    payload: DiscussionReactionCreate,
    response: Response,
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
) -> DiscussionReactionSummaryResponse:
    response.headers["Cache-Control"] = "private, no-store"

    msg_id, summaries, caller_emoji = await run_in_threadpool(
        set_discussion_reaction,
        db=db,
        community_slug=community_slug,
        message_id=message_id,
        user=membership.user,
        emoji=payload.emoji,
        community_id=membership.community_id,
    )

    # Broadcast reaction_changed event strictly after commit
    await run_in_threadpool(require_visible_message, db, membership.community_id, msg_id)
    event = {
        "type": "reaction_changed",
        "community_slug": community_slug,
        "message_id": str(msg_id),
        "reactions": [{"emoji": r.emoji, "count": r.count} for r in summaries],
    }
    try:
        await broadcaster.broadcast(community_slug, event)
    except Exception as e:
        logger.warning("Broadcast failed for reaction_changed: %s", e)

    return DiscussionReactionSummaryResponse(
        message_id=msg_id,
        reactions=summaries,
        caller_reaction=caller_emoji,
    )


@router.delete(
    "/{community_slug}/discussion/messages/{message_id}/reaction",
    response_model=DiscussionReactionSummaryResponse,
    status_code=status.HTTP_200_OK,
    summary="Remove emoji reaction from a message",
)
async def delete_reaction(
    community_slug: str,
    message_id: UUID,
    response: Response,
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
) -> DiscussionReactionSummaryResponse:
    response.headers["Cache-Control"] = "private, no-store"

    msg_id, summaries, caller_emoji = await run_in_threadpool(
        remove_discussion_reaction,
        db=db,
        community_slug=community_slug,
        message_id=message_id,
        user=membership.user,
        community_id=membership.community_id,
    )

    # Broadcast reaction_changed event strictly after commit
    await run_in_threadpool(require_visible_message, db, membership.community_id, msg_id)
    event = {
        "type": "reaction_changed",
        "community_slug": community_slug,
        "message_id": str(msg_id),
        "reactions": [{"emoji": r.emoji, "count": r.count} for r in summaries],
    }
    try:
        await broadcaster.broadcast(community_slug, event)
    except Exception as e:
        logger.warning("Broadcast failed for reaction_changed: %s", e)

    return DiscussionReactionSummaryResponse(
        message_id=msg_id,
        reactions=summaries,
        caller_reaction=caller_emoji,
    )


@router.get(
    "/{community_slug}/discussion/stickers",
    response_model=list[StickerItemResponse],
    status_code=status.HTTP_200_OK,
    summary="Get built-in sticker catalog",
)
def get_stickers(
    community_slug: str,
    response: Response,
    membership: Membership = Depends(get_current_active_membership),
) -> list[StickerItemResponse]:
    response.headers["Cache-Control"] = "private, no-store"
    return [StickerItemResponse(**s) for s in VALID_STICKERS]


# ==============================================================================
# WEBSOCKET ENDPOINT
# ==============================================================================

@router.websocket("/{community_slug}/discussion/ws")
async def discussion_websocket(
    websocket: WebSocket,
    community_slug: str = Path(...),
) -> None:
    # 1. Validate Origin header (strict browser-only policy)
    origin = websocket.headers.get("origin")
    trusted_origins = settings.get_trusted_websocket_origins()
    if not origin or origin == "null" or origin.rstrip("/") not in trusted_origins:
        logger.warning("Rejected WebSocket connection from untrusted or missing origin")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Untrusted origin")
        return

    # 2. Validate session cookie
    raw_token = websocket.cookies.get(settings.session_cookie_name)
    if not raw_token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Not authenticated")
        return

    # 3. Validate active membership without blocking event loop
    is_valid, user_id, reason = await run_in_threadpool(check_ws_auth, raw_token, community_slug)
    if not is_valid or user_id is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=reason or "Unauthorized")
        return

    # 4. Accept connection and register with broadcaster
    await websocket.accept()
    conn = Connection(websocket=websocket, user_id=user_id, community_slug=community_slug,
                      visibility_check=check_message_visible)
    await broadcaster.connect(conn)
    conn.receiver_task = asyncio.current_task()

    # 5. Periodic access revalidation loop
    conn.revalidation_task = asyncio.create_task(revalidate_ws_connection(conn, raw_token, community_slug))

    try:
        while True:
            # Receive client ping or heartbeat (mutations use REST)
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("Discussion WebSocket receiver terminated")
    finally:
        await broadcaster.disconnect(conn)
