import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional
from app.core.logging import logger


class SectorService:
    """Enterprise service providing primary sector taxonomy lookups, categorization, and query expansion."""

    COMMON_SYNONYMS = {
        r"\bhyperscale\b": "Data Center",
        r"\bserver\s*farm\b": "Data Center",
        r"\bcolocation\b": "Data Center",
        r"\bcloud\s*campus\b": "Data Center",
        r"\bai\s*cluster\b": "Data Center",
        r"\bdata\s*cent\w*\b": "Data Center",
        r"\bdatacenter\w*\b": "Data Center",
        r"\bsemicondu\w*\b": "Semiconductor Plant",
        r"\bsemiconductor\w*\b": "Semiconductor Plant",
        r"\bchip\w*\b": "Semiconductor Plant",
        r"\bwafer\s*fab\b": "Semiconductor Plant",
        r"\bchip\s*foundry\b": "Semiconductor Plant",
        r"\bchipmaking\s*plant\b": "Semiconductor Plant",
        r"\bbatter\w*\b": "Battery Energy Storage",
        r"\bbattery\s*cathode\b": "Battery Cathode Material Production Plant",
        r"\bbattery\s*anode\b": "Battery Anode Material Production Plant",
        r"\bbattery\s*electrolyte\b": "Battery Electrolyte Production Plant",
        r"\bbattery\s*separator\b": "Battery Separator Production Plant",
        r"\bgigafactory\b": "Battery Energy Storage",
        r"\bbess\b": "Battery Energy Storage",
        r"\bgreen\s*hydrogen\b": "Hydrogen Production Plants",
        r"\bhydrog\w*\b": "Hydrogen Production Plants",
        r"\belectrolyz\w*\b": "Hydrogen Production Plants",
        r"\bsolar\w*\b": "Solar Photovoltaic Power Plant (PV)",
        r"\bsolar\s*farm\b": "Solar Photovoltaic Power Plant (PV)",
        r"\bsolar\s*park\b": "Solar Photovoltaic Power Plant (PV)",
        r"\bpv\s*plant\b": "Solar Photovoltaic Power Plant (PV)",
        r"\bwind\w*\b": "Wind Turbine Manufacturing Plant",
        r"\bsewage\s*treatment\b": "Waste Water Treatment Plant (WWTP)",
        r"\beffluent\s*treatment\b": "Waste Water Treatment Plant (WWTP)",
        r"\bdesalinat\w*\b": "Desalination Plant",
        r"\blng\s*terminal\b": "Liquefied Natural Gas (LNG) Terminal",
    }

    def __init__(self, data_path: Optional[str] = None):
        if not data_path:
            base_dir = Path(__file__).resolve().parent.parent
            data_path = str(base_dir / "data" / "primary_sectors.json")

        self.data_path = data_path
        self._sectors: List[Dict[str, Any]] = []
        self._by_id: Dict[str, Dict[str, Any]] = {}
        self._by_name: Dict[str, Dict[str, Any]] = {}
        self._by_group: Dict[str, List[Dict[str, Any]]] = {}
        self._patterns: List[tuple[re.Pattern, Dict[str, Any]]] = []
        self._load_sectors()

    def _load_sectors(self) -> None:
        """Loads and pre-indexes the 462 primary sector taxonomy."""
        try:
            with open(self.data_path, "r", encoding="utf-8") as f:
                self._sectors = json.load(f)
        except Exception as exc:
            logger.error(f"Failed to load sectors from {self.data_path}: {exc}")
            self._sectors = []

        # Index by id, name, and group
        for item in self._sectors:
            self._by_id[item["id"]] = item
            self._by_name[item["sector"].lower()] = item
            group = item.get("group", "Other")
            if group not in self._by_group:
                self._by_group[group] = []
            self._by_group[group].append(item)

        # Pre-compile regexes sorted by sector length descending for specificity
        sorted_sectors = sorted(self._sectors, key=lambda s: len(s["sector"]), reverse=True)
        for s in sorted_sectors:
            sec_name = s["sector"]
            # Clean parenthetical aliases like '(PV)', '(ABS)', '(ASU)'
            clean_name = re.sub(r"\s*\([^)]*\)", "", sec_name).strip()
            pat_str = rf"\b{re.escape(clean_name)}\b"
            self._patterns.append((re.compile(pat_str, re.IGNORECASE), s))

            # Also pattern for core name removing trailing 'Plant'/'Facility' if >= 4 chars
            core_name = re.sub(r"\s*(?:Plant|Plants|Facility|Facilities|Production|Unit|Units)\b", "", clean_name, flags=re.IGNORECASE).strip()
            if len(core_name) >= 4 and core_name.lower() != clean_name.lower():
                core_pat = rf"\b{re.escape(core_name)}\b"
                self._patterns.append((re.compile(core_pat, re.IGNORECASE), s))

        logger.info(f"Loaded {len(self._sectors)} primary sectors across {len(self._by_group)} groups.")

    def get_all(self) -> List[Dict[str, Any]]:
        """Returns the full list of primary sectors."""
        return self._sectors

    def get_groups(self) -> List[str]:
        """Returns unique macro industry groups sorted alphabetically."""
        return sorted(list(self._by_group.keys()))

    def get_by_id(self, sector_id: str) -> Optional[Dict[str, Any]]:
        """Lookup sector by unique slug ID."""
        return self._by_id.get(sector_id)

    def get_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Lookup sector by exact name (case-insensitive)."""
        return self._by_name.get(name.strip().lower())

    def get_by_group(self, group: str) -> List[Dict[str, Any]]:
        """Returns all sectors within a specific group."""
        return self._by_group.get(group, [])

    def search(self, query: str = "", group: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """Searches sectors by keyword, substring, or group with relevance scoring."""
        results = self._sectors
        if group and group != "all":
            results = [s for s in results if s.get("group", "").lower() == group.lower()]

        if not query or not query.strip():
            return results[:limit]

        q = query.strip().lower()
        scored: List[tuple[float, Dict[str, Any]]] = []
        for s in results:
            score = 0.0
            name_lower = s["sector"].lower()
            def_lower = s.get("definition", "").lower()
            keywords = [k.lower() for k in s.get("keywords", [])]

            if name_lower == q:
                score += 10.0
            elif name_lower.startswith(q):
                score += 5.0
            elif q in name_lower:
                score += 3.0

            if any(q == k or k in q for k in keywords):
                score += 2.0

            if q in def_lower:
                score += 1.0

            if score > 0.0:
                scored.append((score, s))

        scored.sort(key=lambda x: -x[0])
        return [item for _, item in scored[:limit]]

    def match_sector(self, text: str) -> Optional[Dict[str, Any]]:
        """Identifies the best matching primary sector from natural language query or snippet."""
        if not text:
            return None

        # 1. Check industry synonyms first (e.g. 'hyperscale' -> 'Data Center', 'gigafactory' -> 'Battery Energy Storage')
        for syn_pat, canonical_name in self.COMMON_SYNONYMS.items():
            if re.search(syn_pat, text, re.IGNORECASE):
                direct = self.get_by_name(canonical_name)
                if direct:
                    return direct

        # 2. Check pre-compiled sector name patterns (longer/more specific matches first)
        for pattern, sector_obj in self._patterns:
            if pattern.search(text):
                return sector_obj

        # 3. Check for partial token match
        text_lower = text.lower()
        for s in self._sectors:
            if s["sector"].lower() in text_lower:
                return s

        return None


# Global singleton instance
sector_service = SectorService()
