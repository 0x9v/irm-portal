"""create_discussion_messages_and_reactions_tables

Revision ID: f8c2b3d4e5f6
Revises: e7b1a2c3d4e5
Create Date: 2026-10-07 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f8c2b3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'e7b1a2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. create discussion_messages table
    op.create_table(
        'discussion_messages',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('community_id', sa.Uuid(), nullable=False),
        sa.Column('author_id', sa.Uuid(), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('sticker_id', sa.String(length=50), nullable=True),
        sa.Column('client_message_id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(kind = 'TEXT' AND content IS NOT NULL AND trim(content, ' \t\r\n') != '' AND sticker_id IS NULL) OR "
            "(kind = 'STICKER' AND sticker_id IS NOT NULL AND content IS NULL)",
            name='ck_discussion_messages_kind_fields'
        ),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['community_id'], ['communities.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'community_id', 'author_id', 'client_message_id',
            name='uq_discussion_messages_community_author_client'
        )
    )
    op.create_index(op.f('ix_discussion_messages_author_id'), 'discussion_messages', ['author_id'], unique=False)
    op.create_index(op.f('ix_discussion_messages_community_id'), 'discussion_messages', ['community_id'], unique=False)
    op.create_index(
        'ix_discussion_messages_community_id_created_at_id',
        'discussion_messages',
        ['community_id', 'created_at', 'id'],
        unique=False
    )

    # 2. create discussion_reactions table
    op.create_table(
        'discussion_reactions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('message_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('emoji', sa.String(length=30), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "emoji IN ('thumbs_up', 'heart', 'laugh', 'surprised', 'sad', 'thanks')",
            name='ck_discussion_reactions_emoji'
        ),
        sa.ForeignKeyConstraint(['message_id'], ['discussion_messages.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('message_id', 'user_id', name='uq_discussion_reactions_message_user')
    )
    op.create_index(op.f('ix_discussion_reactions_message_id'), 'discussion_reactions', ['message_id'], unique=False)
    op.create_index(op.f('ix_discussion_reactions_user_id'), 'discussion_reactions', ['user_id'], unique=False)
    op.create_index(
        'ix_discussion_reactions_message_id_emoji',
        'discussion_reactions',
        ['message_id', 'emoji'],
        unique=False
    )


def downgrade() -> None:
    # Drop in reverse order
    op.drop_index('ix_discussion_reactions_message_id_emoji', table_name='discussion_reactions')
    op.drop_index(op.f('ix_discussion_reactions_user_id'), table_name='discussion_reactions')
    op.drop_index(op.f('ix_discussion_reactions_message_id'), table_name='discussion_reactions')
    op.drop_table('discussion_reactions')

    op.drop_index('ix_discussion_messages_community_id_created_at_id', table_name='discussion_messages')
    op.drop_index(op.f('ix_discussion_messages_community_id'), table_name='discussion_messages')
    op.drop_index(op.f('ix_discussion_messages_author_id'), table_name='discussion_messages')
    op.drop_table('discussion_messages')
