"""add document voting thresholds

Revision ID: 589ce55cec37
Revises: 2b032f8c674b
Create Date: 2026-10-03 15:55:00.801464

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '589ce55cec37'
down_revision: Union[str, Sequence[str], None] = '2b032f8c674b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. Add columns
    op.add_column('communities', sa.Column('document_vote_threshold', sa.Integer(), server_default='10', nullable=False))
    op.add_column('documents', sa.Column('vote_threshold_snapshot', sa.Integer(), nullable=True))
    
    # 2. Backfill: Set snapshot to 10 for all existing PENDING STUDENT documents
    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE documents
        SET vote_threshold_snapshot = 10
        WHERE source = 'STUDENT' AND status = 'PENDING'
    """))
    
    # 3. Evaluate existing documents
    # Find all PENDING STUDENT docs that now have >= 10 votes
    # Use standard SQL grouping
    updates = conn.execute(sa.text("""
        WITH vote_counts AS (
            SELECT 
                document_id,
                SUM(CASE WHEN vote = 'YES' THEN 1 ELSE 0 END) as yes_count,
                SUM(CASE WHEN vote = 'NO' THEN 1 ELSE 0 END) as no_count
            FROM document_votes
            GROUP BY document_id
        ),
        eval_docs AS (
            SELECT 
                d.id,
                d.vote_threshold_snapshot,
                COALESCE(v.yes_count, 0) as yes_count,
                COALESCE(v.no_count, 0) as no_count,
                COALESCE(v.yes_count, 0) + COALESCE(v.no_count, 0) as total
            FROM documents d
            LEFT JOIN vote_counts v ON d.id = v.document_id
            WHERE d.source = 'STUDENT' AND d.status = 'PENDING'
        )
        SELECT id, yes_count, no_count, total, vote_threshold_snapshot 
        FROM eval_docs 
        WHERE total >= vote_threshold_snapshot
    """)).fetchall()
    
    for row in updates:
        doc_id = row[0]
        yes_count = row[1]
        no_count = row[2]
        if yes_count > no_count:
            new_status = 'APPROVED'
        elif no_count > yes_count:
            new_status = 'REJECTED'
        else:
            continue
            
        conn.execute(sa.text("""
            UPDATE documents
            SET status = :new_status
            WHERE id = :id
        """), {"new_status": new_status, "id": doc_id})

    # 4. Add constraints
    # Note: SQLite has limited ALTER TABLE support. We bypass constraint creation on SQLite
    # to avoid complex table recreation, or we can use batch mode if needed. 
    # Since Alembic context provides it, we can create constraints on postgres safely.
    if conn.dialect.name == 'postgresql':
        op.create_check_constraint('ck_community_vote_threshold', 'communities', 'document_vote_threshold >= 1')
        op.create_check_constraint('ck_document_vote_snapshot', 'documents', 'vote_threshold_snapshot >= 1')
        op.create_check_constraint('ck_doc_pending_student_snapshot', 'documents', "source != 'STUDENT' OR status != 'PENDING' OR vote_threshold_snapshot IS NOT NULL")


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    if conn.dialect.name == 'postgresql':
        op.drop_constraint('ck_doc_pending_student_snapshot', 'documents', type_='check')
        op.drop_constraint('ck_document_vote_snapshot', 'documents', type_='check')
        op.drop_constraint('ck_community_vote_threshold', 'communities', type_='check')

    op.drop_column('documents', 'vote_threshold_snapshot')
    op.drop_column('communities', 'document_vote_threshold')
    
