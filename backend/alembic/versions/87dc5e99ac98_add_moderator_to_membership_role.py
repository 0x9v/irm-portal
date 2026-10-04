"""add_moderator_to_membership_role

Revision ID: 87dc5e99ac98
Revises: 89d2d5cb2fe2
Create Date: 2026-10-02 16:31:40.695148

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '87dc5e99ac98'
down_revision: Union[str, Sequence[str], None] = '89d2d5cb2fe2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('memberships', schema=None) as batch_op:
        # PostgreSQL didn't create the check constraint, but SQLite did via recreation. 
        # Safely attempt to drop constraint only if we know it exists (we can't easily conditionally drop).
        # We can just ignore the dropping on PostgreSQL by naming it explicitly if it fails, but Alembic doesn't support that directly.
        pass

    # For postgres we just create the constraint since it didn't exist.
    # Wait, SQLite recreates the table anyway.
    # Let's just create the constraint.
    # Actually, the user asked me to create a new migration for Announcements. I should just fix `87dc5e99ac98` to not fail on postgres.
    # The simplest way is to execute raw SQL that is dialect specific, or just not drop the constraint on PG.
    bind = op.get_bind()
    if bind.engine.name != 'postgresql':
        with op.batch_alter_table('memberships', schema=None) as batch_op:
            batch_op.drop_constraint('membership_role', type_='check')
            batch_op.create_check_constraint(
                'membership_role',
                sa.column('role').in_(['MEMBER', 'DELEGATE', 'MODERATOR'])
            )
    else:
        # On Postgres, simply add the constraint since it was missing.
        op.create_check_constraint(
            'membership_role',
            'memberships',
            sa.column('role').in_(['MEMBER', 'DELEGATE', 'MODERATOR'])
        )

def downgrade() -> None:
    """Downgrade schema."""
    pass
