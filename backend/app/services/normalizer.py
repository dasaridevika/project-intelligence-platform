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

    INVALID_FILE_EXTENSIONS = {
        ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico",
        ".mp4", ".mp3", ".avi", ".mov", ".wmv", ".webm", ".mkv",
        ".zip", ".tar", ".gz", ".7z", ".rar", ".exe", ".dmg", ".apk", ".bin",
        ".csv", ".xlsx", ".xls", ".doc", ".docx", ".ppt", ".pptx", ".xml", ".rss", ".json"
    }

    BLOCKED_DOMAINS = {
        # Dictionaries, glossaries, general reference
        "wikipedia.org", "wiktionary.org", "dictionary.cambridge.org", "merriam-webster.com",
        "dictionary.com", "investopedia.com", "britannica.com", "techtarget.com",
        "computerhope.com", "coursera.org", "statista.com", "wordreference.com",
        # Social media, forums, video streaming
        "youtube.com", "youtu.be", "vimeo.com", "facebook.com", "fb.com", "twitter.com",
        "x.com", "instagram.com", "tiktok.com", "pinterest.com", "reddit.com", "quora.com",
        "linkedin.com", "medium.com",
        # Login & Auth
        "accounts.google.com", "login.microsoftonline.com", "appleid.apple.com"
    }

    TRACKING_QUERY_PARAMS = {
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
        "gclid", "fbclid", "ref", "source", "mc_cid", "mc_eid"
    }

    def validate_and_normalize_url(self, raw_url: str) -> tuple[bool, Optional[str], str]:
        """Validates URL structure, blocks invalid domains/file types, and normalizes canonical URL."""
        if not raw_url or not isinstance(raw_url, str):
            return False, None, "Missing or empty URL string"

        url_str = raw_url.strip()
        try:
            from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
            parsed = urlparse(url_str)
        except Exception as e:
            return False, None, f"Malformed URL: {e}"

        # 1. Scheme check: only HTTP or HTTPS allowed
        scheme = parsed.scheme.lower()
        if scheme not in ("http", "https"):
            return False, None, f"Invalid protocol '{parsed.scheme}'. Only HTTP and HTTPS are permitted."

        # 2. Hostname check
        netloc = parsed.netloc.lower()
        host = netloc.split(":")[0]
        if not host or "." not in host:
            return False, None, f"Invalid domain host '{parsed.netloc}'"

        # 3. Block private / local addresses (SSRF prevention)
        if host in ("localhost", "127.0.0.1", "0.0.0.0", "[::1]") or host.startswith(("10.", "192.168.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.")):
            return False, None, "Access to private or localhost addresses is blocked"

        # 4. Domain blacklist check (dictionaries, social media, spam)
        for blocked in self.BLOCKED_DOMAINS:
            if host == blocked or host.endswith(f".{blocked}"):
                return False, None, f"Domain '{host}' is on blocked reference or social media list"

        # 5. File extension check (only HTML/text pages allowed, no binary or documents)
        path = parsed.path.lower()
        for ext in self.INVALID_FILE_EXTENSIONS:
            if path.endswith(ext):
                return False, None, f"URL references non-HTML file type ('{ext}')"

        # 6. Canonicalize URL: strip tracking parameters, fragments, and trailing slashes
        query_params = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k.lower() not in self.TRACKING_QUERY_PARAMS]
        clean_query = urlencode(query_params)
        clean_path = parsed.path.rstrip("/") or "/"

        canonical_url = urlunparse((
            scheme,
            netloc,
            clean_path,
            "",
            clean_query,
            ""
        ))

        return True, canonical_url, "Valid project URL"

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

    def normalize_sector(self, sector: Optional[str]) -> Optional[str]:
        if not sector:
            return None
        from app.services.sector_service import sector_service
        match = sector_service.get_by_name(sector) or sector_service.match_sector(sector)
        if match:
            return match["sector"]
        return sector.strip()


project_normalizer = ProjectNormalizer()
