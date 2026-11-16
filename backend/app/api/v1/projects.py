import csv
import io
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.core.database import get_db
from app.models.project import Project, ProjectSource
from app.schemas.project import (
    ProjectDetailResponse,
    ProjectListItem,
    ProjectListResponse,
    ProjectSourceItem,
)

router = APIRouter(prefix="/projects", tags=["Projects"])


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    category: Optional[str] = Query(None, description="Filter by project category"),
    location: Optional[str] = Query(None, description="Filter by city, state, or country"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by project status"),
    developer: Optional[str] = Query(None, description="Filter by company / developer"),
    search: Optional[str] = Query(None, description="Keyword search in project name or description"),
    sort_by: str = Query("created_at", pattern="^(created_at|canonical_name|investment_value|capacity_value)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """Searchable project repository with multi-field filtering, sorting, and pagination."""
    query = select(Project).options(selectinload(Project.sources))

    if category:
        query = query.where(Project.category.ilike(f"%{category}%"))
    if location:
        query = query.where(
            or_(
                Project.location_city.ilike(f"%{location}%"),
                Project.location_state.ilike(f"%{location}%"),
                Project.location_country.ilike(f"%{location}%")
            )
        )
    if status_filter:
        query = query.where(Project.status.ilike(f"%{status_filter}%"))
    if developer:
        query = query.where(Project.developer.ilike(f"%{developer}%"))
    if search:
        query = query.where(
            or_(
                Project.canonical_name.ilike(f"%{search}%"),
                Project.description.ilike(f"%{search}%"),
                Project.developer.ilike(f"%{search}%")
            )
        )

    # Count total
    count_stmt = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_stmt)).scalar() or 0

    # Sorting
    sort_col = getattr(Project, sort_by)
    if sort_order == "desc":
        query = query.order_by(desc(sort_col))
    else:
        query = query.order_by(sort_col)

    # Pagination
    offset = (page - 1) * page_size
    query = query.limit(page_size).offset(offset)

    result = await db.execute(query)
    projects = result.scalars().all()

    items = [
        ProjectListItem(
            id=p.id,
            canonical_name=p.canonical_name,
            category=p.category,
            status=p.status,
            developer=p.developer,
            location_city=p.location_city,
            location_state=p.location_state,
            location_country=p.location_country,
            investment_value=float(p.investment_value) if p.investment_value is not None else None,
            investment_currency=p.investment_currency,
            capacity_value=float(p.capacity_value) if p.capacity_value is not None else None,
            capacity_unit=p.capacity_unit,
            sources_count=len(p.sources),
            created_at=p.created_at
        )
        for p in projects
    ]

    return ProjectListResponse(
        total=total,
        page=page,
        page_size=page_size,
        projects=items
    )


@router.get("/export")
async def export_projects_csv(
    category: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db)
):
    """Exports discovered projects and source counts to CSV format."""
    query = select(Project).options(selectinload(Project.sources)).order_by(desc(Project.created_at))
    if category:
        query = query.where(Project.category.ilike(f"%{category}%"))
    if status_filter:
        query = query.where(Project.status.ilike(f"%{status_filter}%"))

    result = await db.execute(query)
    projects = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Project ID", "Project Name", "Category", "Status", "Developer",
        "City", "State/Region", "Country", "Capacity Value", "Capacity Unit",
        "Investment Value", "Currency", "Sources Count", "Created At"
    ])

    for p in projects:
        writer.writerow([
            str(p.id),
            p.canonical_name,
            p.category,
            p.status,
            p.developer or "",
            p.location_city or "",
            p.location_state or "",
            p.location_country or "",
            p.capacity_value or "",
            p.capacity_unit or "",
            p.investment_value or "",
            p.investment_currency or "",
            len(p.sources),
            p.created_at.isoformat()
        ])

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=projects_export.csv"}
    )


@router.get("/{project_id}", response_model=ProjectDetailResponse)
async def get_project_detail(project_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Retrieves complete project detail, specifications, and full multi-source provenance."""
    stmt = (
        select(Project)
        .where(Project.id == project_id)
        .options(selectinload(Project.sources))
    )
    project = (await db.execute(stmt)).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    sources_items = [
        ProjectSourceItem(
            id=s.id,
            provider=s.provider,
            source_url=s.source_url,
            source_title=s.source_title,
            publication_date=s.publication_date,
            discovery_timestamp=s.discovery_timestamp,
            raw_snippet=s.raw_snippet
        )
        for s in project.sources
    ]

    return ProjectDetailResponse(
        id=project.id,
        canonical_name=project.canonical_name,
        normalized_name=project.normalized_name,
        category=project.category,
        status=project.status,
        developer=project.developer,
        location_city=project.location_city,
        location_state=project.location_state,
        location_country=project.location_country,
        investment_value=float(project.investment_value) if project.investment_value is not None else None,
        investment_currency=project.investment_currency,
        capacity_value=float(project.capacity_value) if project.capacity_value is not None else None,
        capacity_unit=project.capacity_unit,
        announced_date=project.announced_date,
        estimated_completion_date=project.estimated_completion_date,
        description=project.description,
        metadata=project.metadata_,
        sources=sources_items,
        created_at=project.created_at,
        updated_at=project.updated_at
    )
