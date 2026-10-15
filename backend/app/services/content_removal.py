"""Delegate-authorized callers only; state and audit event commit together."""

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.announcement import Announcement
from app.models.announcement_reply import AnnouncementReply
from app.models.community_post import CommunityPost
from app.models.community_post_reply import CommunityPostReply
from app.models.discussion_message import DiscussionMessage
from app.models.management_event import ManagementEvent

TargetType = Literal["announcement", "announcement_reply", "community_post",
                     "community_post_reply", "discussion_message"]


def remove_content(db: Session, community_id: UUID, actor_id: UUID,
                   target_type: TargetType, target_id: UUID,
                   parent_id: UUID | None = None) -> bool:
    """Return True only for the first removal. Never read/copy original bodies.

    The conditional UPDATE serializes same-target races in the database. Only
    its winner inserts an event. Reply mutations lock the visible parent first,
    in the same order used by reply creation, to serialize parent removal.
    """
    models = {
        "announcement": Announcement, "announcement_reply": AnnouncementReply,
        "community_post": CommunityPost, "community_post_reply": CommunityPostReply,
        "discussion_message": DiscussionMessage,
    }
    model = models[target_type]
    try:
        if target_type in ("announcement_reply", "community_post_reply"):
            parent, foreign_key = ((Announcement, AnnouncementReply.announcement_id)
                                   if target_type == "announcement_reply"
                                   else (CommunityPost, CommunityPostReply.post_id))
            visible_parent = (db.query(parent.id).filter(
                parent.id == parent_id, parent.community_id == community_id,
                parent.removed_at.is_(None),
            ).with_for_update().first())
            if not visible_parent:
                raise HTTPException(404, "Content not found")
            scope = (model.id == target_id, foreign_key == parent_id)
        else:
            scope = (model.id == target_id, model.community_id == community_id)

        timestamp = datetime.now(timezone.utc)
        changed = db.execute(update(model).where(*scope, model.removed_at.is_(None))
                             .values(removed_at=timestamp, removed_by_id=actor_id)
                             .execution_options(synchronize_session=False)).rowcount
        if not changed:
            if not db.query(model.id).filter(*scope).first():
                raise HTTPException(404, "Content not found")
            db.commit()
            return False
        db.add(ManagementEvent(community_id=community_id, actor_id=actor_id,
                               action="remove", target_type=target_type,
                               target_id=target_id, created_at=timestamp))
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise
