import re
from typing import Any, Dict, List, Optional
from app.services.sector_service import sector_service


class QueryProcessor:
    """Parses and structures natural-language discovery queries for global capital projects,

    supporting the comprehensive 462 Primary Sector taxonomy and definitions.
    """

    # Legacy broad categories for high-level matching
    CATEGORY_PATTERNS = {
        "Data Center": [
            r"\bdata\s*cent\w*\b", r"\bdatacent\w*\b", r"\bhyperscale\b", r"\bserver\s*farm\b",
            r"\bcolocation\b", r"\bcloud\s*infrastructure\b", r"\bai\s*cluster\b"
        ],
        "Solar Power": [
            r"\bsolar\w*\b", r"\bphotovoltaic\b", r"\bpv\s*plant\b",
            r"\bfloating\s*solar\b", r"\bsolar\s*farm\b"
        ],
        "Renewable Energy": [
            r"\brenewable\s*energy\b", r"\bclean\s*energy\b", r"\bgreen\s*energy\b",
            r"\bwind\s*(?:energy|power|farm|turbine)?\b", r"\boffshore\s*wind\b",
            r"\bonshore\s*wind\b", r"\bgeothermal\b", r"\bhydro(?:electric)?\b"
        ],
        "Semiconductor": [
            r"\bsemicondu\w*\b", r"\bfab(?:rication)?\b", r"\bwafer\b",
            r"\bchip\w*\b",
            r"\batmp\b", r"\bosat\b", r"\bmicroelectronics\b"
        ],
        "Infrastructure": [
            r"\binfrastructure\b", r"\bexpressways?\b", r"\bmetro\s*(?:rail)?\b",
            r"\bairports?\b", r"\bseaports?\b", r"\bhighways?\b", r"\bbridges?\b",
            r"\brail\s*(?:corridor|network)?\b", r"\btunnels?\b", r"\btransmission\s*line\b"
        ],
        "EV & Battery": [
            r"\belectric\s*vehicles?\b", r"\bev\b", r"\bbatter\w*\b",
            r"\bgigafactory\b", r"\benergy\s*storage\b", r"\bbess\b"
        ],
        "Hydrogen": [
            r"\bgreen\s*hydrogen\b", r"\belectrolyzer\b", r"\bhydrogen\s*(?:hub|plant)?\b",
            r"\bammonia\b"
        ]
    }

    LOCATION_PATTERNS = {
        # North America
        "United States": [r"\bunited\s*states\b", r"\busa\b", r"\bu\.s\.\b", r"\bu\.s\b", r"\bamerica\b"],
        "Northern Virginia": [r"\bnorthern\s*virginia\b", r"\bnova\b", r"\bashburn\b", r"\bloudoun\b"],
        "Texas": [r"\btexas\b", r"\bdallas\b", r"\baustin\b", r"\bhouston\b", r"\bfort\s*worth\b"],
        "Arizona": [r"\barizona\b", r"\bphoenix\b", r"\bchandler\b"],
        "California": [r"\bcalifornia\b", r"\bsilicon\s*valley\b", r"\bsan\s*jose\b", r"\bsanta\s*clara\b"],
        "Ohio": [r"\bohio\b", r"\bcolumbus\b", r"\bnew\s*albany\b"],
        "Canada": [r"\bcanada\b", r"\btoronto\b", r"\bmontreal\b", r"\bquebec\b", r"\bontario\b", r"\bvancouver\b"],
        "Mexico": [r"\bmexico\b", r"\bquer[eé]taro\b", r"\bmonterrey\b"],

        # Europe
        "United Kingdom": [r"\bunited\s*kingdom\b", r"\buk\b", r"\bbritain\b", r"\bengland\b", r"\bscotland\b", r"\blondon\b", r"\bslough\b"],
        "Germany": [r"\bgermany\b", r"\bdeutschland\b", r"\bfrankfurt\b", r"\bberlin\b", r"\bdresden\b", r"\bmunich\b"],
        "France": [r"\bfrance\b", r"\bparis\b", r"\bmarseille\b"],
        "Netherlands": [r"\bnetherlands\b", r"\bholland\b", r"\bamsterdam\b", r"\beindhoven\b"],
        "Ireland": [r"\bireland\b", r"\bdublin\b"],
        "Spain": [r"\bspain\b", r"\bespaña\b", r"\bmadrid\b", r"\bbarcelona\b", r"\baragon\b"],
        "Italy": [r"\bitaly\b", r"\bitalia\b", r"\bmilan\b", r"\brome\b"],
        "Nordics": [r"\bnordics?\b", r"\bsweden\b", r"\bstockholm\b", r"\blule[aå]\b", r"\bnorway\b", r"\boslo\b", r"\bdenmark\b", r"\bcopenhagen\b", r"\bfinland\b", r"\bhelsinki\b"],
        "Poland": [r"\bpoland\b", r"\bwarsaw\b", r"\bwroc[lł]aw\b"],

        # Asia-Pacific
        "Tokyo": [r"\btokyo\b"],
        "Osaka": [r"\bosaka\b"],
        "Seoul": [r"\bseoul\b", r"\byongin\b"],
        "Taipei": [r"\btaipei\b", r"\bhsinchu\b"],
        "Singapore": [r"\bsingapore\b"],
        "Johor": [r"\bjohor\b", r"\bjohor\s*bahru\b"],
        "Cyberjaya": [r"\bcyberjaya\b"],
        "Kuala Lumpur": [r"\bkuala\s*lumpur\b"],
        "Jakarta": [r"\bjakarta\b", r"\bbatam\b"],
        "Sydney": [r"\bsydney\b"],
        "Melbourne": [r"\bmelbourne\b"],
        "Hyderabad": [r"\bhyderabad\b", r"\bsecunderabad\b"],
        "Bengaluru": [r"\bbengaluru\b", r"\bbangalore\b"],
        "Mumbai": [r"\bmumbai\b", r"\bnavi\s*mumbai\b"],
        "Delhi NCR": [r"\bdelhi\b", r"\bnoida\b", r"\bgurgaon\b", r"\bgurugram\b"],
        "Telangana": [r"\btelangana\b"],
        "Gujarat": [r"\bgujarat\b", r"\bahmedabad\b", r"\bsanand\b", r"\bdholera\b"],
        "Tamil Nadu": [r"\btamil\s*nadu\b", r"\bchennai\b"],
        "Karnataka": [r"\bkarnataka\b"],
        "Maharashtra": [r"\bmaharashtra\b", r"\bpune\b"],
        "Rajasthan": [r"\brajasthan\b"],
        "Andhra Pradesh": [r"\bandhra\s*pradesh\b", r"\bandhra\b", r"\bap\b"],

        # Countries
        "Japan": [r"\bjapan\b"],
        "South Korea": [r"\bsouth\s*korea\b", r"\bkorea\b"],
        "Taiwan": [r"\btaiwan\b"],
        "Malaysia": [r"\bmalaysia\b"],
        "Indonesia": [r"\bindonesia\b"],
        "Australia": [r"\baustralia\b"],
        "India": [r"\bindia\b"],
        "United Arab Emirates": [r"\buae\b", r"\bunited\s*arab\s*emirates\b", r"\bdubai\b", r"\babu\s*dhabi\b"],
        "Saudi Arabia": [r"\bsaudi\s*arabia\b", r"\bsaudi\b", r"\bksa\b", r"\briyadh\b", r"\bneom\b", r"\bdammam\b", r"\bjeddah\b"],
        "Qatar": [r"\bqatar\b", r"\bdoha\b"],
        "Oman": [r"\boman\b", r"\bmuscat\b"],
        "Brazil": [r"\bbrazil\b", r"\bbrasil\b", r"\bs[aã]o\s*paulo\b", r"\brio\b"],
        "Chile": [r"\bchile\b", r"\bsantiago\b"],
        "South Africa": [r"\bsouth\s*africa\b", r"\bjohannesburg\b", r"\bcape\s*town\b"],
        "Egypt": [r"\begypt\b", r"\bcairo\b", r"\bsuez\b"],
        "Kenya": [r"\bkenya\b", r"\bnairobi\b"],
    }

    STATUS_PATTERNS = {
        "Upcoming": [r"\bupcom(?:ing)?\b", r"\bplanned\b", r"\bproposed\b", r"\bfuture\b", r"\bnew\b", r"\bannounced\b"],
        "Under Development": [r"\bunder\s*development\b", r"\bin\s*pipeline\b", r"\bpermitted\b", r"\btender\b"],
        "Under Construction": [r"\bunder\s*construction\b", r"\bgroundbreaking\b", r"\bbreaking\s*ground\b", r"\bbuilding\b", r"\bcivil\s*works\b"],
        "Operational": [r"\boperational\b", r"\bcommissioned\b", r"\bcompleted\b", r"\bactive\b", r"\bonline\b"]
    }

    def process(
        self,
        query: str,
        explicit_categories: Optional[List[str]] = None,
        explicit_location: Optional[str] = None,
        explicit_sector: Optional[str] = None
    ) -> Dict[str, Any]:
        normalized_q = query.strip()
        lower_q = normalized_q.lower()

        # 1. Primary Sector Matching (462-sector taxonomy)
        matched_sector_obj: Optional[Dict[str, Any]] = None

        if explicit_sector:
            matched_sector_obj = sector_service.get_by_name(explicit_sector) or sector_service.get_by_id(explicit_sector)

        if not matched_sector_obj and explicit_categories and len(explicit_categories) > 0:
            first_cat = explicit_categories[0]
            matched_sector_obj = sector_service.get_by_name(first_cat) or sector_service.get_by_id(first_cat)

        if not matched_sector_obj:
            matched_sector_obj = sector_service.match_sector(normalized_q)

        # 2. Legacy / Broad Category detection
        detected_category = explicit_categories[0] if (explicit_categories and len(explicit_categories) > 0) else None
        if not detected_category:
            for cat, patterns in self.CATEGORY_PATTERNS.items():
                if any(re.search(pat, lower_q) for pat in patterns):
                    detected_category = cat
                    break

        if not detected_category and matched_sector_obj:
            detected_category = matched_sector_obj.get("sector")

        # 3. Location extraction (worldwide)
        detected_location = explicit_location
        if not detected_location:
            for loc, patterns in self.LOCATION_PATTERNS.items():
                if any(re.search(pat, lower_q) for pat in patterns):
                    detected_location = loc
                    break

        # 4. Status extraction
        detected_status = None
        for stat, patterns in self.STATUS_PATTERNS.items():
            if any(re.search(pat, lower_q) for pat in patterns):
                detected_status = stat
                break

        # 5. Salient Keywords & Synonyms Generation
        keywords = set()
        words = re.findall(r"\b[A-Za-z0-9_-]{3,}\b", lower_q)
        stop_words = {
            "the", "and", "for", "with", "all", "find", "show", "search", "list",
            "projects", "project", "near", "global", "international"
        }
        for w in words:
            if w not in stop_words:
                keywords.add(w)

        if detected_category:
            keywords.add(detected_category.lower())
        if detected_location:
            keywords.add(detected_location.lower())
        if detected_status:
            keywords.add(detected_status.lower())

        primary_sector_name = None
        primary_sector_def = None
        primary_sector_group = None

        if matched_sector_obj:
            primary_sector_name = matched_sector_obj["sector"]
            primary_sector_def = matched_sector_obj["definition"]
            primary_sector_group = matched_sector_obj.get("group")
            # Inject high-signal sector keywords
            for kw in matched_sector_obj.get("keywords", [])[:6]:
                keywords.add(kw.lower())

        return {
            "original_query": normalized_q,
            "category": detected_category or primary_sector_name or "Capital Projects",
            "primary_sector": primary_sector_name or detected_category or "Capital Projects",
            "primary_sector_definition": primary_sector_def,
            "primary_sector_group": primary_sector_group,
            "location": detected_location or "Global",
            "status": detected_status or "Upcoming",
            "keywords": sorted(list(keywords)),
            "search_intent": "project_discovery"
        }


query_processor = QueryProcessor()
