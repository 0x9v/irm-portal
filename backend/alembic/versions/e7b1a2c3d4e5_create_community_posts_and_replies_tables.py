"""create_community_posts_and_replies_tables

Revision ID: e7b1a2c3d4e5
Revises: 86fd7c69425d
Create Date: 2026-10-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7b1a2c3d4e5'
down_revision: Union[str, Sequence[str], None] = '86fd7c69425d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. create community_posts table
    op.create_table(
        'community_posts',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('community_id', sa.Uuid(), nullable=False),
        sa.Column('author_id', sa.Uuid(), nullable=False),
        sa.Column('title', sa.String(length=150), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['community_id'], ['communities.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_community_posts_author_id'), 'community_posts', ['author_id'], unique=False)
    op.create_index(op.f('ix_community_posts_community_id'), 'community_posts', ['community_id'], unique=False)
    op.create_index(
        'ix_community_posts_community_id_created_at_id',
        'community_posts',
        ['community_id', 'created_at', 'id'],
        unique=False
    )

    # 2. create post_modules association table
    op.create_table(
        'post_modules',
        sa.Column('post_id', sa.Uuid(), nullable=False),
        sa.Column('module_id', sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(['module_id'], ['modules.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['post_id'], ['community_posts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('post_id', 'module_id')
    )
    op.create_index(op.f('ix_post_modules_module_id'), 'post_modules', ['module_id'], unique=False)

    # 3. create community_post_replies table
    op.create_table(
        'community_post_replies',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('post_id', sa.Uuid(), nullable=False),
        sa.Column('author_id', sa.Uuid(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['post_id'], ['community_posts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_community_post_replies_author_id'), 'community_post_replies', ['author_id'], unique=False)
    op.create_index(op.f('ix_community_post_replies_post_id'), 'community_post_replies', ['post_id'], unique=False)
    op.create_index(
        'ix_community_post_replies_post_id_created_at_id',
        'community_post_replies',
        ['post_id', 'created_at', 'id'],
        unique=False
    )


def downgrade() -> None:
    # Drop in reverse order
    op.drop_index('ix_community_post_replies_post_id_created_at_id', table_name='community_post_replies')
    op.drop_index(op.f('ix_community_post_replies_post_id'), table_name='community_post_replies')
    op.drop_index(op.f('ix_community_post_replies_author_id'), table_name='community_post_replies')
    op.drop_table('community_post_replies')

    op.drop_index(op.f('ix_post_modules_module_id'), table_name='post_modules')
    op.drop_table('post_modules')

    op.drop_index('ix_community_posts_community_id_created_at_id', table_name='community_posts')
    op.drop_index(op.f('ix_community_posts_community_id'), table_name='community_posts')
    op.drop_index(op.f('ix_community_posts_author_id'), table_name='community_posts')
    op.drop_table('community_posts')
