import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from app.core.logging import logger
from app.providers.base import RawProviderResultItem
from app.services.sector_service import sector_service


@dataclass
class ExtractedProjectCandidate:
    """Structured project details extracted from a single source snippet."""
    canonical_name: str
    category: str
    status: str
    developer: Optional[str] = None
    location_city: Optional[str] = None
    location_state: Optional[str] = None
    location_country: Optional[str] = None
    investment_value: Optional[float] = None
    investment_currency: Optional[str] = None
    capacity_value: Optional[float] = None
    capacity_unit: Optional[str] = None
    announced_date: Optional[datetime] = None
    estimated_completion_date: Optional[datetime] = None
    description: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    # Provenance
    source_url: str = ""
    source_title: str = ""
    provider: str = ""
    publication_date: Optional[datetime] = None
    raw_snippet: str = ""


class ProjectExtractor:
    """Extracts factual, non-hallucinated project data worldwide from raw provider items."""

    DEVELOPER_PATTERNS = [
        # Hyperscale & Cloud Data Centers
        r"\b(Microsoft(?:\s+Azure)?)\b",
        r"\b(Amazon\s+Web\s+Services|AWS|Amazon)\b",
        r"\b(Google(?:\s+Cloud)?)\b",
        r"\b(Meta(?:\s+Platforms)?)\b",
        r"\b(Apple)\b",
        r"\b(Oracle(?:\s+Cloud)?)\b",
        r"\b(Equinix)\b",
        r"\b(Digital\s+Realty)\b",
        r"\b(CyrusOne)\b",
        r"\b(Vantage\s+Data\s+Centers|Vantage)\b",
        r"\b(NTT\s+Data|NTT\s+Global\s+Data\s+Centers|NTT)\b",
        r"\b(AirTrunk)\b",
        r"\b(QTS\s+Data\s+Centers|QTS)\b",
        r"\b(Stack\s+Infrastructure)\b",
        r"\b(CtrlS(?:\s+Datacenters)?)\b",
        r"\b(Yotta\s+Data\s+Services|Yotta)\b",
        r"\b(STT\s+GDC|STT\s+Global\s+Data\s+Centres)\b",
        r"\b(Sify\s+Technologies|Sify)\b",

        # Semiconductor & Microelectronics
        r"\b(TSMC|Taiwan\s+Semiconductor(?:\s+Manufacturing\s+Co)?)\b",
        r"\b(Intel(?:\s+Foundry)?)\b",
        r"\b(Samsung(?:\s+Electronics)?)\b",
        r"\b(Micron(?:\s+Technology)?)\b",
        r"\b(Texas\s+Instruments)\b",
        r"\b(ASML)\b",
        r"\b(SK\s+Hynix)\b",
        r"\b(GlobalFoundries)\b",
        r"\b(Qualcomm)\b",
        r"\b(Broadcom)\b",
        r"\b(Foxconn)\b",
        r"\b(Tata\s+Electronics)\b",

        # Renewable Energy & Utilities
        r"\b(NextEra(?:\s+Energy)?)\b",
        r"\b(Iberdrola)\b",
        r"\b(Ørsted|Orsted)\b",
        r"\b(TotalEnergies)\b",
        r"\b(Enel(?:\s+Green\s+Power)?)\b",
        r"\b(EDF(?:\s+Renewables)?)\b",
        r"\b(Vestas)\b",
        r"\b(Brookfield\s+Renewable|Brookfield)\b",
        r"\b(RWE)\b",
        r"\b(ACWA\s+Power)\b",
        r"\b(Masdar)\b",
        r"\b(Adani(?:\s+Green|\s+Enterprises|\s+Power)?)\b",
        r"\b(Tata(?:\s+Power)?)\b",
        r"\b(NTPC(?:\s+Renewable|\s+Ltd)?)\b",
        r"\b(Reliance(?:\s+Industries|\s+New\s+Energy)?)\b",
        r"\b(ReNew(?:\s+Power)?)\b",
        r"\b(Avaada(?:\s+Energy)?)\b",
        r"\b(JSW(?:\s+Energy)?)\b",

        # Infrastructure & Construction
        r"\b(Bechtel)\b",
        r"\b(Vinci)\b",
        r"\b(Hochtief)\b",
        r"\b(Bouygues)\b",
        r"\b(Balfour\s+Beatty)\b",
        r"\b(Skanska)\b",
        r"\b(Larsen\s+&\s+Toubro|L&T)\b",

        # EV & Battery
        r"\b(Tesla)\b",
        r"\b(CATL)\b",
        r"\b(BYD)\b",
        r"\b(LG\s+Energy\s+Solution|LG\s+Chem)\b",
        r"\b(Panasonic)\b",
        r"\b(Northvolt)\b"
    ]

    CAPACITY_REGEX = re.compile(
        r"(?i)\b(\d{1,5}(?:\.\d+)?)\s*(GW|MW|KW|MWp|MWdc|GWh|MWh|sq(?:\.|\s*)ft|acres?|wafers?/month)\b"
    )

    INVESTMENT_REGEX = re.compile(
        r"(?i)(?:(?:investment|capex|cost|worth|valued\s*at)\s*(?:of\s*)?)?(€|eur|£|gbp|\$|usd|a\$|aud|c\$|cad|s\$|sgd|aed|sar|¥|jpy|₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(trillion|billion|crores?|million|cr|bn|b|m)?\b"
    )

    STATUS_PATTERNS = {
        "Operational": [
            r"\b(?:commissioned|operational|commercial\s*operation|inaugurated|online|live)\b"
        ],
        "Under Construction": [
            r"\b(?:under\s*construction|groundbreaking|break(?:s|ing)?\s*ground|broke\s*ground|broken\s*ground|begins?\s*construction|civil\s*works|building|underway)\b"
        ],
        "Under Development": [
            r"\b(?:under\s*development|land\s*acquisition|approvals?|eoi|tender|permits?|permitted|zoned)\b"
        ],
        "Announced": [
            r"\b(?:announced|plans?\s*to|proposed|unveils?|pledges?|commits?\s*to)\b"
        ]
    }

    # Global Location Registry: mapping key -> (City, State/Region, Country)
    GLOBAL_LOCATION_MAP = {
        # North America - USA
        "Ashburn": ("Ashburn", "Virginia", "United States"),
        "Loudoun": ("Loudoun County", "Virginia", "United States"),
        "Northern Virginia": (None, "Virginia", "United States"),
        "Phoenix": ("Phoenix", "Arizona", "United States"),
        "Chandler": ("Chandler", "Arizona", "United States"),
        "Dallas": ("Dallas", "Texas", "United States"),
        "Fort Worth": ("Fort Worth", "Texas", "United States"),
        "Austin": ("Austin", "Texas", "United States"),
        "Houston": ("Houston", "Texas", "United States"),
        "San Jose": ("San Jose", "California", "United States"),
        "Santa Clara": ("Santa Clara", "California", "United States"),
        "Silicon Valley": ("Silicon Valley", "California", "United States"),
        "Columbus": ("Columbus", "Ohio", "United States"),
        "New Albany": ("New Albany", "Ohio", "United States"),
        "Atlanta": ("Atlanta", "Georgia", "United States"),
        "Chicago": ("Chicago", "Illinois", "United States"),
        "Quincy": ("Quincy", "Washington", "United States"),
        "Reno": ("Reno", "Nevada", "United States"),
        "United States": (None, None, "United States"),
        "USA": (None, None, "United States"),

        # North America - Canada & Mexico
        "Toronto": ("Toronto", "Ontario", "Canada"),
        "Montreal": ("Montreal", "Quebec", "Canada"),
        "Vancouver": ("Vancouver", "British Columbia", "Canada"),
        "Canada": (None, None, "Canada"),
        "Querétaro": ("Querétaro", "Querétaro", "Mexico"),
        "Queretaro": ("Querétaro", "Querétaro", "Mexico"),
        "Monterrey": ("Monterrey", "Nuevo León", "Mexico"),
        "Mexico": (None, None, "Mexico"),

        # Europe
        "London": ("London", "Greater London", "United Kingdom"),
        "Slough": ("Slough", "Berkshire", "United Kingdom"),
        "United Kingdom": (None, None, "United Kingdom"),
        "UK": (None, None, "United Kingdom"),
        "Frankfurt": ("Frankfurt", "Hesse", "Germany"),
        "Berlin": ("Berlin", "Berlin", "Germany"),
        "Dresden": ("Dresden", "Saxony", "Germany"),
        "Munich": ("Munich", "Bavaria", "Germany"),
        "Germany": (None, None, "Germany"),
        "Amsterdam": ("Amsterdam", "North Holland", "Netherlands"),
        "Eindhoven": ("Eindhoven", "North Brabant", "Netherlands"),
        "Netherlands": (None, None, "Netherlands"),
        "Paris": ("Paris", "Île-de-France", "France"),
        "Marseille": ("Marseille", "Provence", "France"),
        "France": (None, None, "France"),
        "Dublin": ("Dublin", "Leinster", "Ireland"),
        "Ireland": (None, None, "Ireland"),
        "Madrid": ("Madrid", "Community of Madrid", "Spain"),
        "Barcelona": ("Barcelona", "Catalonia", "Spain"),
        "Aragon": ("Zaragoza", "Aragon", "Spain"),
        "Spain": (None, None, "Spain"),
        "Milan": ("Milan", "Lombardy", "Italy"),
        "Italy": (None, None, "Italy"),
        "Stockholm": ("Stockholm", "Stockholm", "Sweden"),
        "Luleå": ("Luleå", "Norrbotten", "Sweden"),
        "Lulea": ("Luleå", "Norrbotten", "Sweden"),
        "Sweden": (None, None, "Sweden"),
        "Oslo": ("Oslo", "Oslo", "Norway"),
        "Norway": (None, None, "Norway"),
        "Copenhagen": ("Copenhagen", "Capital Region", "Denmark"),
        "Denmark": (None, None, "Denmark"),
        "Helsinki": ("Helsinki", "Uusimaa", "Finland"),
        "Finland": (None, None, "Finland"),
        "Warsaw": ("Warsaw", "Masovia", "Poland"),
        "Poland": (None, None, "Poland"),

        # Asia-Pacific
        "Tokyo": ("Tokyo", "Kanto", "Japan"),
        "Osaka": ("Osaka", "Kansai", "Japan"),
        "Kumamoto": ("Kumamoto", "Kyushu", "Japan"),
        "Japan": (None, None, "Japan"),
        "Seoul": ("Seoul", "Gyeonggi", "South Korea"),
        "Yongin": ("Yongin", "Gyeonggi", "South Korea"),
        "Pyeongtaek": ("Pyeongtaek", "Gyeonggi", "South Korea"),
        "South Korea": (None, None, "South Korea"),
        "Taipei": ("Taipei", "Northern Taiwan", "Taiwan"),
        "Hsinchu": ("Hsinchu", "Hsinchu", "Taiwan"),
        "Tainan": ("Tainan", "Southern Taiwan", "Taiwan"),
        "Taiwan": (None, None, "Taiwan"),
        "Singapore": ("Singapore", None, "Singapore"),
        "Johor": ("Johor Bahru", "Johor", "Malaysia"),
        "Johor Bahru": ("Johor Bahru", "Johor", "Malaysia"),
        "Cyberjaya": ("Cyberjaya", "Selangor", "Malaysia"),
        "Kuala Lumpur": ("Kuala Lumpur", "Federal Territory", "Malaysia"),
        "Malaysia": (None, None, "Malaysia"),
        "Jakarta": ("Jakarta", "Java", "Indonesia"),
        "Batam": ("Batam", "Riau Islands", "Indonesia"),
        "Indonesia": (None, None, "Indonesia"),
        "Sydney": ("Sydney", "New South Wales", "Australia"),
        "Melbourne": ("Melbourne", "Victoria", "Australia"),
        "Brisbane": ("Brisbane", "Queensland", "Australia"),
        "Perth": ("Perth", "Western Australia", "Australia"),
        "Australia": (None, None, "Australia"),
        "Hanoi": ("Hanoi", "Red River Delta", "Vietnam"),
        "Ho Chi Minh": ("Ho Chi Minh City", "Southeastern", "Vietnam"),
        "Vietnam": (None, None, "Vietnam"),

        # India
        "Hyderabad": ("Hyderabad", "Telangana", "India"),
        "Secunderabad": ("Hyderabad", "Telangana", "India"),
        "Bengaluru": ("Bengaluru", "Karnataka", "India"),
        "Bangalore": ("Bengaluru", "Karnataka", "India"),
        "Mumbai": ("Mumbai", "Maharashtra", "India"),
        "Navi Mumbai": ("Navi Mumbai", "Maharashtra", "India"),
        "Pune": ("Pune", "Maharashtra", "India"),
        "Chennai": ("Chennai", "Tamil Nadu", "India"),
        "Ahmedabad": ("Ahmedabad", "Gujarat", "India"),
        "Sanand": ("Sanand", "Gujarat", "India"),
        "Dholera": ("Dholera", "Gujarat", "India"),
        "Noida": ("Noida", "Uttar Pradesh", "India"),
        "Ramagundam": ("Ramagundam", "Telangana", "India"),
        "Khavda": ("Khavda", "Gujarat", "India"),
        "Bhadla": ("Bhadla", "Rajasthan", "India"),
        "Telangana": (None, "Telangana", "India"),
        "Gujarat": (None, "Gujarat", "India"),
        "Karnataka": (None, "Karnataka", "India"),
        "Maharashtra": (None, "Maharashtra", "India"),
        "Tamil Nadu": (None, "Tamil Nadu", "India"),
        "Rajasthan": (None, "Rajasthan", "India"),
        "India": (None, None, "India"),

        # Middle East
        "Dubai": ("Dubai", "Dubai", "United Arab Emirates"),
        "Abu Dhabi": ("Abu Dhabi", "Abu Dhabi", "United Arab Emirates"),
        "UAE": (None, None, "United Arab Emirates"),
        "United Arab Emirates": (None, None, "United Arab Emirates"),
        "Riyadh": ("Riyadh", "Riyadh Province", "Saudi Arabia"),
        "NEOM": ("NEOM", "Tabuk Province", "Saudi Arabia"),
        "Dammam": ("Dammam", "Eastern Province", "Saudi Arabia"),
        "Jeddah": ("Jeddah", "Makkah Province", "Saudi Arabia"),
        "Saudi Arabia": (None, None, "Saudi Arabia"),
        "Doha": ("Doha", "Ad-Dawhah", "Qatar"),
        "Qatar": (None, None, "Qatar"),
        "Muscat": ("Muscat", "Muscat", "Oman"),
        "Oman": (None, None, "Oman"),

        # Latin America
        "São Paulo": ("São Paulo", "São Paulo", "Brazil"),
        "Sao Paulo": ("São Paulo", "São Paulo", "Brazil"),
        "Rio de Janeiro": ("Rio de Janeiro", "Rio de Janeiro", "Brazil"),
        "Brazil": (None, None, "Brazil"),
        "Santiago": ("Santiago", "Santiago Metropolitan", "Chile"),
        "Chile": (None, None, "Chile"),

        # Africa
        "Johannesburg": ("Johannesburg", "Gauteng", "South Africa"),
        "Cape Town": ("Cape Town", "Western Cape", "South Africa"),
        "South Africa": (None, None, "South Africa"),
        "Cairo": ("Cairo", "Cairo Governorate", "Egypt"),
        "Egypt": (None, None, "Egypt"),
        "Nairobi": ("Nairobi", "Nairobi County", "Kenya"),
        "Kenya": (None, None, "Kenya"),
    }

    CURRENCY_MAP = {
        "$": "USD", "usd": "USD",
        "€": "EUR", "eur": "EUR",
        "£": "GBP", "gbp": "GBP",
        "¥": "JPY", "jpy": "JPY",
        "a$": "AUD", "aud": "AUD",
        "c$": "CAD", "cad": "CAD",
        "s$": "SGD", "sgd": "SGD",
        "aed": "AED", "sar": "SAR",
        "₹": "INR", "rs": "INR", "rs.": "INR", "inr": "INR"
    }

    def extract_candidate(
        self,
        item: RawProviderResultItem,
        provider_name: str,
        default_category: str = "Capital Projects"
    ) -> Optional[ExtractedProjectCandidate]:
        text = f"{item.title}. {item.snippet}"
        if item.raw_content:
            text += f" {item.raw_content[:1000]}"

        # 1. Developer detection
        detected_developer = None
        for pattern in self.DEVELOPER_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                detected_developer = match.group(1).strip()
                break

        # 2. Location detection (Worldwide)
        detected_city = None
        detected_state = None
        detected_country = None

        for loc_key, (c, s, country) in self.GLOBAL_LOCATION_MAP.items():
            if re.search(rf"\b{re.escape(loc_key)}\b", text, re.IGNORECASE):
                if c and not detected_city:
                    detected_city = c
                if s and not detected_state:
                    detected_state = s
                if country and not detected_country:
                    detected_country = country
                if detected_city and detected_state and detected_country:
                    break

        # 3. Status detection
        detected_status = "Announced"
        for st_name, patterns in self.STATUS_PATTERNS.items():
            if any(re.search(pat, text, re.IGNORECASE) for pat in patterns):
                detected_status = st_name
                break

        # 4. Capacity extraction
        cap_val = None
        cap_unit = None
        cap_match = self.CAPACITY_REGEX.search(text)
        if cap_match:
            try:
                cap_val = float(cap_match.group(1))
                cap_unit = cap_match.group(2).upper()
            except ValueError:
                pass

        # 5. Investment extraction (Multi-currency worldwide)
        inv_val = None
        inv_curr = None
        inv_match = self.INVESTMENT_REGEX.search(text)
        if inv_match:
            symbol, num_str, unit = inv_match.groups()
            if num_str:
                clean_num = num_str.replace(",", "")
                try:
                    val = float(clean_num)
                    if symbol:
                        inv_curr = self.CURRENCY_MAP.get(symbol.lower(), "USD")
                    else:
                        inv_curr = "USD" if (detected_country and detected_country != "India") else "INR"

                    if unit:
                        unit_lower = unit.lower()
                        if unit_lower in ("trillion",):
                            inv_val = val * 1_000_000_000_000.0
                        elif unit_lower in ("billion", "bn", "b"):
                            inv_val = val * 1_000_000_000.0
                        elif unit_lower in ("million", "m"):
                            inv_val = val * 1_000_000.0
                        elif "crore" in unit_lower or unit_lower == "cr":
                            inv_val = val * 10_000_000.0  # 1 Crore = 10M INR
                            inv_curr = "INR"
                        elif "lakh" in unit_lower:
                            inv_val = val * 100_000.0
                            inv_curr = "INR"
                        else:
                            inv_val = val
                    elif val > 1000:
                        inv_val = val
                except ValueError:
                    pass

        # 6. Primary Sector Classification & Metadata Enrichment
        detected_category = default_category
        meta_dict: Dict[str, Any] = {"extracted_at": datetime.now(timezone.utc).isoformat()}

        # Match on title first (highest precision); only search full text if default_category is generic
        matched_sector = sector_service.match_sector(item.title)
        if not matched_sector and default_category in (None, "", "Capital Projects"):
            matched_sector = sector_service.match_sector(text)

        if matched_sector and (default_category in (None, "", "Capital Projects") or matched_sector["sector"].lower() in item.title.lower()):
            detected_category = matched_sector["sector"]
            meta_dict["primary_sector"] = matched_sector["sector"]
            meta_dict["primary_sector_definition"] = matched_sector["definition"]
            meta_dict["primary_sector_group"] = matched_sector.get("group")
        elif default_category and default_category != "Capital Projects":
            fallback_match = sector_service.get_by_name(default_category)
            if fallback_match:
                detected_category = fallback_match["sector"]
                meta_dict["primary_sector"] = fallback_match["sector"]
                meta_dict["primary_sector_definition"] = fallback_match["definition"]
                meta_dict["primary_sector_group"] = fallback_match.get("group")

        # 7. Canonical Project Name Formulation
        clean_title = re.sub(r"\s*-\s*[^-]+$", "", item.title)  # Remove news publisher suffix e.g. " - Reuters"
        clean_title = re.sub(r"^(?:Exclusive|Breaking|Update|Report|Special):\s*", "", clean_title, flags=re.IGNORECASE)

        canonical_name = clean_title.strip()
        if len(canonical_name) < 10 and detected_developer:
            loc_label = detected_city or detected_state or detected_country or "Global"
            canonical_name = f"{detected_developer} {detected_category} Project {loc_label}".strip()

        # Parse publication date if valid
        pub_dt = None
        if item.published_date:
            try:
                clean_date = item.published_date.replace("Z", "+00:00")
                pub_dt = datetime.fromisoformat(clean_date)
            except Exception:
                pub_dt = None

        return ExtractedProjectCandidate(
            canonical_name=canonical_name,
            category=detected_category,
            status=detected_status,
            developer=detected_developer,
            location_city=detected_city,
            location_state=detected_state,
            location_country=detected_country or "Global",
            investment_value=inv_val,
            investment_currency=inv_curr if inv_val else None,
            capacity_value=cap_val,
            capacity_unit=cap_unit,
            description=item.snippet[:500] if item.snippet else None,
            source_url=item.url,
            source_title=item.title,
            provider=provider_name,
            publication_date=pub_dt,
            raw_snippet=item.snippet,
            metadata=meta_dict
        )

    def evaluate_and_extract(
        self,
        item: RawProviderResultItem,
        provider_name: str,
        default_category: str = "Capital Projects"
    ) -> tuple[Optional[ExtractedProjectCandidate], str, bool]:
        """Evaluates whether candidate URL contains confirmed capital project parameters, returning transparent reason."""
        url = item.url or ""
        url_lower = url.lower()

        # 1. Non-article / legal / authentication / dictionary page rejection
        if not url:
            return None, "Source item contains no valid target URL", False

        blocked_domains = [
            "dictionary.cambridge.org", "merriam-webster.com", "wikipedia.org",
            "wiktionary.org", "investopedia.com", "statista.com", "dictionary.com",
            "britannica.com", "computerhope.com", "techtarget.com", "coursera.org",
            "quora.com", "reddit.com"
        ]
        if any(d in url_lower for d in blocked_domains):
            return None, "Source URL belongs to educational, dictionary, or glossary domain", False

        blocked_path_signals = [
            "/privacy-policy", "/terms-of-service", "/terms-of-use", "/terms",
            "/legal", "/login", "/signup", "/auth", "/signin", "/cookie-policy",
            "/cart", "/checkout", "/wp-login.php", "/dictionary/", "/definition/",
            "/jargon/", "/glossary/", "/what-is/", "/what-is-a-", "/explainers/"
        ]
        if any(sig in url_lower for sig in blocked_path_signals):
            return None, "Source URL points to definition, glossary, or non-project page", False

        # Reject non-project title starters (encyclopedia/glossary/explainer articles)
        title_lower = (item.title or "").lower().strip()
        non_project_title_starters = (
            "what is a ", "what is an ", "what is ", "what are ",
            "meaning of ", "definition of ", "how to ", "why is ",
            "dictionary", "difference between ", "statistics & facts"
        )
        if any(title_lower.startswith(prefix) for prefix in non_project_title_starters):
            return None, f"Title indicates informational or definition article ('{item.title[:60]}')", False

        # 2. Text substance check
        text = f"{item.title or ''}. {item.snippet or ''}".strip()
        if len(text) < 25:
            return None, "Insufficient descriptive text in source snippet (< 25 characters)", False

        # Extract structured candidate from raw text
        cand = self.extract_candidate(item, provider_name, default_category)
        if not cand:
            return None, "Unable to parse structured project entities from source text", False

        # 3. Capital project parameters check:
        has_developer = bool(cand.developer)
        has_capacity = cand.capacity_value is not None
        has_investment = cand.investment_value is not None
        has_specific_location = bool(cand.location_city or cand.location_state)

        # Require genuine project indicators
        project_keywords = ("project", "investment", "construct", "facility", "campus", "plant", "expansion", "announced", "develop", "groundbreak", "fab", "foundry")
        has_project_intent = any(kw in text.lower() for kw in project_keywords)

        if not has_project_intent:
            return None, "Lacks capital project context (no construction, investment, campus, or facility terms detected)", False

        if not (has_investment or has_capacity or (has_developer and has_specific_location)):
            return None, "Lacks concrete project parameters (no investment value, capacity, or verified developer + location pair)", False

        return cand, "Confirmed project with identified industrial parameters", True



project_extractor = ProjectExtractor()
