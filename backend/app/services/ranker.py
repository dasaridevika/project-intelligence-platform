from dataclasses import dataclass
from typing import Any, Dict, List
from app.services.deduplicator import CanonicalProjectRecord


@dataclass
class RankedProject:
    """Project with transparent relevance score and ranking factor breakdown."""
    project: CanonicalProjectRecord
    relevance_score: float
    ranking_factors: Dict[str, Any]


class ProjectRanker:
    """Computes transparent, explainable heuristic relevance scores for discovered projects."""

    WEIGHTS = {
        "query_keyword_match": 0.30,
        "location_match": 0.25,
        "category_match": 0.20,
        "completeness": 0.15,
        "multi_source_bonus": 0.10,
    }

    def score_project(self, project: CanonicalProjectRecord, parsed_query: Dict[str, Any]) -> RankedProject:
        query_category = parsed_query.get("category", "")
        query_location = parsed_query.get("location", "")
        query_keywords = parsed_query.get("keywords", [])

        # 1. Query Keyword Match
        searchable_text = f"{project.canonical_name} {project.developer or ''} {project.description or ''}".lower()
        if query_keywords:
            matched_keywords = [kw for kw in query_keywords if kw in searchable_text]
            keyword_score = min(1.0, len(matched_keywords) / max(1, len(query_keywords)))
        else:
            keyword_score = 0.5

        # 2. Location Match
        location_score = 0.0
        if query_location:
            q_loc_lower = query_location.lower()
            if q_loc_lower == "global":
                location_score = 0.90
            elif project.location_city and q_loc_lower in project.location_city.lower():
                location_score = 1.0
            elif project.location_state and q_loc_lower in project.location_state.lower():
                location_score = 0.90
            elif project.location_country and (q_loc_lower in project.location_country.lower() or project.location_country.lower() in q_loc_lower):
                location_score = 0.85
            elif q_loc_lower in searchable_text:
                location_score = 0.60
        else:
            location_score = 0.70

        # 3. Category Match
        category_score = 0.0
        if query_category and project.category:
            if query_category.lower() == project.category.lower():
                category_score = 1.0
            elif query_category.lower() in project.category.lower() or project.category.lower() in query_category.lower():
                category_score = 0.80
            else:
                category_score = 0.40
        else:
            category_score = 0.50

        # 4. Information Completeness (has developer, capacity, investment, dates)
        completeness_points = 0
        if project.developer:
            completeness_points += 1
        if project.capacity_value:
            completeness_points += 1
        if project.investment_value:
            completeness_points += 1
        if project.location_city:
            completeness_points += 1
        completeness_score = completeness_points / 4.0

        # 5. Multi-Source Bonus (verified by multiple providers/URLs)
        source_count = len(project.sources)
        multi_source_score = min(1.0, source_count / 3.0)

        # Weighted calculation
        total_score = (
            keyword_score * self.WEIGHTS["query_keyword_match"] +
            location_score * self.WEIGHTS["location_match"] +
            category_score * self.WEIGHTS["category_match"] +
            completeness_score * self.WEIGHTS["completeness"] +
            multi_source_score * self.WEIGHTS["multi_source_bonus"]
        )

        factors = {
            "query_keyword_match": round(keyword_score, 2),
            "location_match": round(location_score, 2),
            "category_match": round(category_score, 2),
            "information_completeness": round(completeness_score, 2),
            "source_verification": round(multi_source_score, 2),
            "source_count": source_count
        }

        return RankedProject(
            project=project,
            relevance_score=round(min(1.0, max(0.0, total_score)), 4),
            ranking_factors=factors
        )

    def rank(self, projects: List[CanonicalProjectRecord], parsed_query: Dict[str, Any]) -> List[RankedProject]:
        scored = [self.score_project(p, parsed_query) for p in projects]
        # Sort descending by relevance_score
        return sorted(scored, key=lambda rp: rp.relevance_score, reverse=True)


project_ranker = ProjectRanker()
