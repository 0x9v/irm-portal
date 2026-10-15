"""Guarded migration, legacy preservation and FK/check contracts."""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import MetaData, Table, insert, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from acceptance.isolation import disposable_database, migrate
from app.models.community import Community
from app.models.discussion_message import DiscussionMessage
from app.models.sticker_asset import StickerAsset
from app.models.user import User


PREVIOUS_HEAD = "c96b4731ea20"
NEW_HEAD = "d1e2f3a4b5c6"


def _message_columns(engine):
    return {column["name"] for column in inspect(engine).get_columns(
        "discussion_messages"
    )}


def _legacy_message_values(engine, message_ids):
    """Read only columns that exist at the pre-sticker migration revision."""
    with engine.connect() as connection:
        historical_messages = Table(
            "discussion_messages", MetaData(), autoload_with=connection
        )
        return connection.execute(
            select(historical_messages.c.id,
                   historical_messages.c.content,
                   historical_messages.c.sticker_id)
            .where(historical_messages.c.id.in_(message_ids))
        ).all()


def test_sticker_migration_preserves_legacy_and_guards_data_downgrade():
    with disposable_database(upgrade=False) as resource:
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD)
        assert "custom_sticker_id" not in _message_columns(resource.engine)
        owner = User(username="sticker_owner", email="sticker-owner@example.invalid",
                     password_hash="opaque", first_name="Owner", family_name="Test")
        author = User(username="sticker_author", email="sticker-author@example.invalid",
                      password_hash="opaque", first_name="Author", family_name="Test")
        community = Community(name="Sticker Test", slug="sticker-test")
        with Session(resource.engine) as session:
            session.add_all([owner, author, community])
            session.flush()
            # Capture scalar identifiers before commit expires these objects
            # and session exit detaches them.
            owner_id = owner.id
            author_id = author.id
            community_id = community.id
            session.commit()
            original = (uuid4(), uuid4())

        # The predecessor schema intentionally has no custom_sticker_id. Use
        # its reflected columns so legacy data is seeded before the upgrade.
        with resource.engine.connect() as connection:
            historical_messages = Table(
                "discussion_messages", MetaData(), autoload_with=connection
            )
        assert "custom_sticker_id" not in historical_messages.c
        with resource.engine.begin() as connection:
            connection.execute(insert(historical_messages), [
                {
                    "id": original[0], "community_id": community_id,
                    "author_id": author_id, "kind": "TEXT",
                    "content": "legacy text", "sticker_id": None,
                    "client_message_id": uuid4(),
                    "created_at": datetime.now(timezone.utc),
                },
                {
                    "id": original[1], "community_id": community_id,
                    "author_id": author_id, "kind": "STICKER",
                    "content": None, "sticker_id": "pepe_thumbs_up",
                    "client_message_id": uuid4(),
                    "created_at": datetime.now(timezone.utc),
                },
            ])

        migrate(resource.engine, resource.lease, NEW_HEAD)
        assert "custom_sticker_id" in _message_columns(resource.engine)
        with Session(resource.engine) as session:
            asset = StickerAsset(owner_id=owner_id,
                                 storage_key=f"stickers/{owner_id}/{uuid4()}/{uuid4()}.webp",
                                 media_type="image/webp", width=256, height=256, byte_size=10)
            session.add(asset)
            session.flush()
            asset_id = asset.id
            custom = DiscussionMessage(
                community_id=community_id, author_id=author_id, kind="CUSTOM_STICKER",
                custom_sticker_id=asset_id, client_message_id=uuid4(), created_at=datetime.now(timezone.utc),
            )
            session.add(custom)
            session.flush()
            custom_message_id = custom.id
            session.commit()

            with pytest.raises(IntegrityError):
                session.delete(asset)
                session.commit()
            session.rollback()
            session.execute(text("DELETE FROM users WHERE id=:id"), {"id": owner_id})
            session.commit()
            assert session.get(StickerAsset, asset_id).owner_id is None
            with pytest.raises(IntegrityError):
                session.execute(text("INSERT INTO discussion_messages "
                                     "(id,community_id,author_id,kind,content,sticker_id,custom_sticker_id,client_message_id,created_at) "
                                     "VALUES (:id,:community,:author,'TEXT','bad',NULL,:asset,:client,:created)"), {
                    "id": uuid4(), "community": community_id, "author": author_id, "asset": asset_id,
                    "client": uuid4(), "created": datetime.now(timezone.utc),
                })
                session.commit()
            session.rollback()
            with pytest.raises(RuntimeError, match="Cannot remove custom sticker foundation"):
                migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
            assert "custom_sticker_id" in _message_columns(resource.engine)
            assert "sticker_assets" in inspect(resource.engine).get_table_names()
            assert session.get(DiscussionMessage, original[0]).content == "legacy text"
            assert session.get(DiscussionMessage, original[1]).sticker_id == "pepe_thumbs_up"
            session.execute(text("DELETE FROM discussion_messages WHERE id=:id"), {"id": custom_message_id})
            session.execute(text("DELETE FROM sticker_assets WHERE id=:id"), {"id": asset_id})
            session.commit()

        migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        assert "custom_sticker_id" not in _message_columns(resource.engine)
        assert "sticker_assets" not in inspect(resource.engine).get_table_names()
        restored = {row.id: row for row in _legacy_message_values(resource.engine, original)}
        assert restored[original[0]].content == "legacy text"
        assert restored[original[1]].sticker_id == "pepe_thumbs_up"
        migrate(resource.engine, resource.lease, NEW_HEAD)
        assert "custom_sticker_id" in _message_columns(resource.engine)
        assert "sticker_assets" in inspect(resource.engine).get_table_names()
        with Session(resource.engine) as session:
            assert session.get(DiscussionMessage, original[0]).content == "legacy text"
            assert session.get(DiscussionMessage, original[1]).sticker_id == "pepe_thumbs_up"
