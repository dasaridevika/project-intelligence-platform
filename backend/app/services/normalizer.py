import re
from typing import Optional


class ProjectNormalizer:
    """Normalizes entities, locations, units, and company names worldwide for consistent comparisons."""

    COMPANY_ALIASES = {
        # Hyperscalers
        "microsoft azure": "Microsoft",
        "microsoft corp": "Microsoft",
        "amazon web services": "AWS",
        "amazon web services aws": "AWS",
        "aws cloud": "AWS",
        "google cloud": "Google",
        "google llc": "Google",
        "meta platforms": "Meta",
        "facebook": "Meta",
        "oracle cloud": "Oracle",
        "oracle corp": "Oracle",
        "digital realty trust": "Digital Realty",
        "vantage data centers": "Vantage Data Centers",
        "ntt global data centers": "NTT Data",
        "ntt data": "NTT Data",
        "ctrls datacenters ltd": "CtrlS Datacenters",
        "ctrls datacenters": "CtrlS Datacenters",
        "ctrls": "CtrlS Datacenters",

        # Semiconductor
        "taiwan semiconductor manufacturing co": "TSMC",
        "taiwan semiconductor": "TSMC",
        "tsmc ltd": "TSMC",
        "intel foundry": "Intel",
        "intel corp": "Intel",
        "samsung electronics": "Samsung Electronics",
        "samsung": "Samsung Electronics",
        "micron technology": "Micron Technology",
        "micron": "Micron Technology",
        "texas instruments inc": "Texas Instruments",
        "sk hynix inc": "SK Hynix",

        # Renewable Energy & Utilities
        "nextera energy resources": "NextEra Energy",
        "nextera": "NextEra Energy",
        "orsted": "Ørsted",
        "enel green power": "Enel",
        "total energies": "TotalEnergies",
        "tata power company": "Tata Power",
        "tata power ltd": "Tata Power",
        "adani green energy": "Adani Green Energy",
        "adani enterprises": "Adani Enterprises",
        "adani power": "Adani Power",
        "ntpc ltd": "NTPC",
        "ntpc renewable energy": "NTPC Renewable Energy",
        "reliance industries": "Reliance Industries",
        "larsen & toubro": "L&T",
        "larsen and toubro": "L&T",

        # EV & Battery
        "tesla inc": "Tesla",
        "tesla motors": "Tesla",
        "catl contemporary amperex": "CATL",
        "lg energy solution": "LG Energy Solution",
    }

    CAPACITY_UNIT_ALIASES = {
        "mwp": "MW",
        "mwdc": "MW",
        "megawatt": "MW",
        "megawatts": "MW",
        "gigawatt": "GW",
        "gigawatts": "GW",
        "gwh": "GWh",
        "mwh": "MWh",
        "sqft": "Sq Ft",
        "sq.ft": "Sq Ft",
        "sq ft": "Sq Ft",
    }

    STATUS_ALIASES = {
        "planned": "Announced",
        "proposed": "Announced",
        "upcoming": "Announced",
        "under-construction": "Under Construction",
        "under construction": "Under Construction",
        "building": "Under Construction",
        "commissioned": "Operational",
        "active": "Operational",
        "online": "Operational",
    }

    def normalize_name(self, name: str) -> str:
        """Strips punctuation, extraneous whitespaces, and standardizes lower-cased tokens."""
        s = name.lower()
        s = re.sub(r"[^\w\s]", " ", s)
        s = re.sub(r"\s+", " ", s).strip()
        return s

    def normalize_developer(self, developer: Optional[str]) -> Optional[str]:
        if not developer:
            return None
        norm = self.normalize_name(developer)
        return self.COMPANY_ALIASES.get(norm, developer.strip())

    def normalize_capacity_unit(self, unit: Optional[str]) -> Optional[str]:
        if not unit:
            return None
        norm = unit.lower().strip()
        return self.CAPACITY_UNIT_ALIASES.get(norm, unit.strip().upper())

    def normalize_status(self, status: Optional[str]) -> str:
        if not status:
            return "Announced"
        norm = status.lower().strip()
        return self.STATUS_ALIASES.get(norm, status.strip().title())


project_normalizer = ProjectNormalizer()
