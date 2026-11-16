from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from app.services.sector_service import sector_service

router = APIRouter(prefix="/sectors", tags=["Primary Sectors Taxonomy"])


class SectorItem(BaseModel):
    id: str
    sector: str
    group: str
    definition: str
    keywords: List[str] = []


class SectorGroupItem(BaseModel):
    group: str
    count: int


class SectorListResponse(BaseModel):
    total: int
    groups: List[str]
    sectors: List[SectorItem]


@router.get("", response_model=SectorListResponse)
async def list_sectors(
    q: Optional[str] = Query(None, description="Search keyword matching sector name, definition, or keywords"),
    group: Optional[str] = Query(None, description="Filter by macro industry group"),
    limit: int = Query(500, ge=1, le=1000, description="Max sectors to return")
) -> SectorListResponse:
    """Lists primary sectors from the global 462-sector capital project taxonomy."""
    sectors_data = sector_service.search(query=q or "", group=group, limit=limit)
    return SectorListResponse(
        total=len(sectors_data),
        groups=sector_service.get_groups(),
        sectors=[
            SectorItem(
                id=s["id"],
                sector=s["sector"],
                group=s["group"],
                definition=s["definition"],
                keywords=s.get("keywords", [])
            )
            for s in sectors_data
        ]
    )


@router.get("/groups", response_model=List[SectorGroupItem])
async def list_sector_groups() -> List[SectorGroupItem]:
    """Returns macro-industry taxonomy groups with sector counts."""
    all_sectors = sector_service.get_all()
    group_counts: Dict[str, int] = {}
    for s in all_sectors:
        g = s.get("group", "Other")
        group_counts[g] = group_counts.get(g, 0) + 1

    return [
        SectorGroupItem(group=g, count=count)
        for g, count in sorted(group_counts.items(), key=lambda x: -x[1])
    ]


@router.get("/{sector_id}", response_model=SectorItem)
async def get_sector_detail(sector_id: str) -> SectorItem:
    """Retrieves full definition and details for a specific primary sector."""
    s = sector_service.get_by_id(sector_id) or sector_service.get_by_name(sector_id)
    if not s:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sector with identifier '{sector_id}' not found in taxonomy."
        )
    return SectorItem(
        id=s["id"],
        sector=s["sector"],
        group=s["group"],
        definition=s["definition"],
        keywords=s.get("keywords", [])
    )
