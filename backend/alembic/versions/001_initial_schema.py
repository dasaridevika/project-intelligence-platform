"""Initial schema migration: 10 core tables

Revision ID: 001_initial_schema
Revises: 
Create Date: 2026-11-13 16:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. users
    op.create_table(
        'users',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('email', sa.String(255), nullable=False, unique=True),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('full_name', sa.String(255), nullable=False),
        sa.Column('role', sa.String(50), nullable=False, server_default='user'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    )
    op.create_index('idx_users_email', 'users', ['email'], unique=True)

    # 2. search_runs
    op.create_table(
        'search_runs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('query', sa.Text(), nullable=False),
        sa.Column('parsed_query', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(50), nullable=False, server_default='queued'),
        sa.Column('results_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('total_duration_seconds', sa.Numeric(10, 3), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    )
    op.create_index('idx_search_runs_status', 'search_runs', ['status'])
    op.create_index('idx_search_runs_created_at', 'search_runs', ['created_at'])

    # 3. projects
    op.create_table(
        'projects',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('canonical_name', sa.String(300), nullable=False, unique=True),
        sa.Column('normalized_name', sa.String(300), nullable=False),
        sa.Column('category', sa.String(100), nullable=False),
        sa.Column('status', sa.String(50), nullable=False),
        sa.Column('developer', sa.String(255), nullable=True),
        sa.Column('location_city', sa.String(100), nullable=True),
        sa.Column('location_state', sa.String(100), nullable=True),
        sa.Column('location_country', sa.String(100), nullable=False, server_default='India'),
        sa.Column('investment_value', sa.Numeric(18, 2), nullable=True),
        sa.Column('investment_currency', sa.String(10), nullable=True, server_default='INR'),
        sa.Column('capacity_value', sa.Numeric(18, 2), nullable=True),
        sa.Column('capacity_unit', sa.String(50), nullable=True),
        sa.Column('announced_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('estimated_completion_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('metadata', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    )
    op.create_index('idx_projects_category', 'projects', ['category'])
    op.create_index('idx_projects_status', 'projects', ['status'])
    op.create_index('idx_projects_state', 'projects', ['location_state'])
    op.create_index('idx_projects_city', 'projects', ['location_city'])
    op.create_index('idx_projects_normalized_name', 'projects', ['normalized_name'])

    # 4. project_sources
    op.create_table(
        'project_sources',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('provider', sa.String(50), nullable=False),
        sa.Column('source_url', sa.Text(), nullable=False, unique=True),
        sa.Column('source_title', sa.Text(), nullable=True),
        sa.Column('publication_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('discovery_timestamp', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('raw_snippet', sa.Text(), nullable=True),
        sa.Column('extracted_data', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    )
    op.create_index('idx_project_sources_project', 'project_sources', ['project_id'])
    op.create_index('idx_project_sources_provider', 'project_sources', ['provider'])

    # 5. search_results
    op.create_table(
        'search_results',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('search_run_id', sa.String(36), sa.ForeignKey('search_runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('relevance_score', sa.Numeric(5, 4), nullable=False, server_default='0.0000'),
        sa.Column('ranking_factors', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('search_run_id', 'project_id', name='uq_search_run_project')
    )
    op.create_index('idx_search_results_run_score', 'search_results', ['search_run_id', 'relevance_score'])

    # 6. api_usage
    op.create_table(
        'api_usage',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('search_run_id', sa.String(36), sa.ForeignKey('search_runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('provider', sa.String(50), nullable=False),
        sa.Column('endpoint', sa.String(255), nullable=False),
        sa.Column('http_status', sa.Integer(), nullable=False),
        sa.Column('latency_ms', sa.Numeric(10, 2), nullable=False),
        sa.Column('retry_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('units_consumed', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('estimated_cost', sa.Numeric(10, 6), nullable=True),
        sa.Column('response_meta', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    )
    op.create_index('idx_api_usage_provider_created', 'api_usage', ['provider', 'created_at'])

    # 7. activity_events
    op.create_table(
        'activity_events',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('search_run_id', sa.String(36), sa.ForeignKey('search_runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('event_type', sa.String(50), nullable=False),
        sa.Column('component', sa.String(50), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('metadata', sa.JSON(), nullable=False),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    )
    op.create_index('idx_activity_search_timestamp', 'activity_events', ['search_run_id', 'timestamp'])

    # 8. outbox_events
    op.create_table(
        'outbox_events',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('search_run_id', sa.String(36), sa.ForeignKey('search_runs.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('event_type', sa.String(100), nullable=False, server_default='project_search_requested'),
        sa.Column('schema_version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(50), nullable=False, server_default='pending'),
        sa.Column('retry_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    )
    op.create_index('idx_outbox_status_created', 'outbox_events', ['status', 'created_at'])

    # 9. processed_messages
    op.create_table(
        'processed_messages',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('event_id', sa.String(36), nullable=False, unique=True),
        sa.Column('search_run_id', sa.String(36), nullable=False),
        sa.Column('consumer_id', sa.String(100), nullable=False),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    )
    op.create_index('idx_processed_messages_event', 'processed_messages', ['event_id'])

    # 10. system_errors
    op.create_table(
        'system_errors',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('search_run_id', sa.String(36), sa.ForeignKey('search_runs.id', ondelete='SET NULL'), nullable=True),
        sa.Column('component', sa.String(100), nullable=False),
        sa.Column('error_code', sa.String(50), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('stack_trace', sa.Text(), nullable=True),
        sa.Column('context', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    )
    op.create_index('idx_system_errors_comp_created', 'system_errors', ['component', 'created_at'])


def downgrade() -> None:
    op.drop_table('system_errors')
    op.drop_table('processed_messages')
    op.drop_table('outbox_events')
    op.drop_table('activity_events')
    op.drop_table('api_usage')
    op.drop_table('search_results')
    op.drop_table('project_sources')
    op.drop_table('projects')
    op.drop_table('search_runs')
    op.drop_table('users')
