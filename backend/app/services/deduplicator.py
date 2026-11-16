from dataclasses import dataclass, field
from typing import Dict, List, Optional
from app.services.extractor import ExtractedProjectCandidate
from app.services.normalizer import project_normalizer


@dataclass
class CanonicalProjectRecord:
    """Canonical project record consolidating multiple source candidates."""
    canonical_name: str
    normalized_name: str
    category: str
    status: str
    developer: Optional[str] = None
    location_city: Optional[str] = None
    location_state: Optional[str] = None
    location_country: Optional[str] = "Global"
    investment_value: Optional[float] = None
    investment_currency: Optional[str] = None
    capacity_value: Optional[float] = None
    capacity_unit: Optional[str] = None
    description: Optional[str] = None
    sources: List[ExtractedProjectCandidate] = field(default_factory=list)


class ProjectDeduplicator:
    """Detects duplicate project candidates across search providers and unifies their provenance."""

    def __init__(self, similarity_threshold: float = 0.75):
        self.similarity_threshold = similarity_threshold

    STOP_TOKENS = {
        "announces", "announced", "reveals", "revealed", "unveils", "unveiled",
        "breaks", "ground", "plans", "planned", "to", "in", "at", "for", "the",
        "new", "facility", "campus", "plant", "project", "projects", "unit"
    }

    def _token_jaccard_similarity(self, s1: str, s2: str) -> float:
        tokens1 = set(w for w in s1.split() if w not in self.STOP_TOKENS)
        tokens2 = set(w for w in s2.split() if w not in self.STOP_TOKENS)
        if not tokens1 or not tokens2:
            return 0.0
        intersection = len(tokens1.intersection(tokens2))
        union = len(tokens1.union(tokens2))
        return intersection / union

    def _is_same_project(self, p1: CanonicalProjectRecord, candidate: ExtractedProjectCandidate) -> bool:
        norm_candidate = project_normalizer.normalize_name(candidate.canonical_name)

        # Exact normalized match
        if p1.normalized_name == norm_candidate:
            return True

        # Developer match + Location match
        dev_match = (
            p1.developer and candidate.developer and
            project_normalizer.normalize_developer(p1.developer) == project_normalizer.normalize_developer(candidate.developer)
        )

        loc_match = False
        if p1.location_city and candidate.location_city and p1.location_city.lower() == candidate.location_city.lower():
            loc_match = True
        elif p1.location_state and candidate.location_state and p1.location_state.lower() == candidate.location_state.lower():
            loc_match = True

        # If same developer and same location
        if dev_match and loc_match:
            # If same capacity value (e.g. both 60MW) -> Same project!
            if p1.capacity_value and candidate.capacity_value and p1.capacity_value == candidate.capacity_value:
                return True
            # Or token similarity >= 0.30
            sim = self._token_jaccard_similarity(p1.normalized_name, norm_candidate)
            if sim >= 0.30:
                return True

        # Pure high token similarity without conflicting developer or location
        sim = self._token_jaccard_similarity(p1.normalized_name, norm_candidate)
        if sim >= self.similarity_threshold:
            # Check there is no conflicting developer
            if p1.developer and candidate.developer and p1.developer.lower() != candidate.developer.lower():
                return False
            return True

        return False

    def deduplicate(self, candidates: List[ExtractedProjectCandidate]) -> List[CanonicalProjectRecord]:
        canonical_projects: List[CanonicalProjectRecord] = []

        for candidate in candidates:
            # Check source URL uniqueness across already added projects
            url_already_seen = False
            for proj in canonical_projects:
                if any(s.source_url == candidate.source_url for s in proj.sources):
                    url_already_seen = True
                    break
            if url_already_seen:
                continue

            matched_project = None
            for proj in canonical_projects:
                if self._is_same_project(proj, candidate):
                    matched_project = proj
                    break

            if matched_project:
                # Merge candidate into existing canonical project
                matched_project.sources.append(candidate)

                # Backfill missing fields if candidate possesses them
                if not matched_project.developer and candidate.developer:
                    matched_project.developer = candidate.developer
                if not matched_project.location_city and candidate.location_city:
                    matched_project.location_city = candidate.location_city
                if not matched_project.location_state and candidate.location_state:
                    matched_project.location_state = candidate.location_state
                if (not matched_project.location_country or matched_project.location_country == "Global") and candidate.location_country and candidate.location_country != "Global":
                    matched_project.location_country = candidate.location_country
                if not matched_project.capacity_value and candidate.capacity_value:
                    matched_project.capacity_value = candidate.capacity_value
                    matched_project.capacity_unit = candidate.capacity_unit
                if not matched_project.investment_value and candidate.investment_value:
                    matched_project.investment_value = candidate.investment_value
                    matched_project.investment_currency = candidate.investment_currency
            else:
                # Create new canonical record
                norm_name = project_normalizer.normalize_name(candidate.canonical_name)
                canonical_projects.append(
                    CanonicalProjectRecord(
                        canonical_name=candidate.canonical_name,
                        normalized_name=norm_name,
                        category=candidate.category,
                        status=candidate.status,
                        developer=candidate.developer,
                        location_city=candidate.location_city,
                        location_state=candidate.location_state,
                        location_country=candidate.location_country,
                        investment_value=candidate.investment_value,
                        investment_currency=candidate.investment_currency,
                        capacity_value=candidate.capacity_value,
                        capacity_unit=candidate.capacity_unit,
                        description=candidate.description,
                        sources=[candidate]
                    )
                )

        return canonical_projects


project_deduplicator = ProjectDeduplicator()
