import csv
import json
import os
import re
from typing import Dict, List, Any

SOURCE_CSV = r"C:\Users\Telan\.gemini\antigravity\brain\24a637f3-393a-47b2-97fa-4e8a5e90a24a\.user_uploaded\media_1794820818482_aa7ef6b3.csv"
BACKEND_JSON = r"C:\Users\Telan\.gemini\antigravity\scratch\project-intelligence-platform\backend\app\data\primary_sectors.json"
BACKEND_CSV = r"C:\Users\Telan\.gemini\antigravity\scratch\project-intelligence-platform\backend\app\data\primary_sectors.csv"
FRONTEND_JSON = r"C:\Users\Telan\.gemini\antigravity\scratch\project-intelligence-platform\frontend\src\data\primary_sectors.json"

STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "in", "for", "on", "with", "at", "by", "from",
    "up", "about", "into", "through", "during", "before", "after", "above", "below",
    "to", "facility", "plant", "plants", "system", "systems", "producing", "produces",
    "production", "manufactures", "manufacturing", "used", "widely", "including",
    "key", "materials", "material", "industrial", "process", "processes", "unit", "units"
}

def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text).strip("-")
    return text

def classify_group(sector: str, definition: str) -> str:
    s = sector.lower()
    d = definition.lower()

    # Carbon Capture & Decarbonization
    if any(k in s for k in ["carbon - capture", "carbon - storage", "carbon - full chain", "carbon capture", "ccu", "ccus"]) or "carbon capture" in d:
        return "Carbon Capture & Clean Tech"

    # Batteries & Energy Storage
    if any(k in s for k in [
        "battery", "bess", "anode", "cathode", "electrolyte", "separator",
        "ultracapacitor", "zinc-based battery", "energy storage", "caes", "flywheel", "thermal energy storage"
    ]):
        return "Batteries & Energy Storage"

    # Technology & Data Infrastructure
    if any(k in s for k in [
        "data center", "semiconductor", "chip", "wafer", "telecom", "cable",
        "computing", "electronics", "antenna", "communication", "optical"
    ]):
        return "Technology & Data Infrastructure"

    # Power & Renewable Energy
    if any(k in s for k in [
        "solar", "wind", "photovoltaic", "hydro", "biomass", "biogas", "renewable",
        "geothermal", "nuclear", "power plant", "substation", "transmission", "grid",
        "transformer", "power barge"
    ]):
        return "Power & Renewable Energy"

    # Chemicals & Petrochemicals
    if any(k in s for k in [
        "hydrogen", "ammonia", "urea", "chemical", "acid", "resin", "polymer",
        "petro", "ethylene", "benzene", "plastic", "methanol", "chlorine",
        "toluene", "xylene", "acetone", "syngas", "nitrogen", "fertilizer",
        "steam cracker", "sulfur"
    ]):
        return "Chemicals & Petrochemicals"

    # Oil & Gas
    if any(k in s for k in [
        "oil", "gas", "upstream", "downstream", "midstream", "lng", "refinery",
        "pipeline", "crude", "petroleum", "fuel", "shale"
    ]):
        return "Oil & Gas"

    # Transportation & Logistics Infrastructure
    if any(k in s for k in [
        "rail", "road", "highway", "bridge", "tunnel", "airport", "port", "berth",
        "wharf", "runway", "terminal", "subway", "tram", "cargo", "freight",
        "underpass", "flyover", "transit", "metro", "streetcar", "hyperloop",
        "apron", "causeway", "channel", "harbor", "jetty", "pier", "quay", "sea walls"
    ]):
        return "Transportation & Logistics"

    # Water & Environmental Management
    if any(k in s for k in [
        "waste", "water", "sewage", "effluent", "wwtp", "desalination", "recycling",
        "sludge", "dam", "drainage", "flood control", "dredging", "composting", "storm sewer", "reservoir"
    ]):
        return "Water & Environmental Management"

    # Pharmaceuticals & Life Sciences
    if any(k in s for k in [
        "pharma", "active pharmaceutical", "drug", "biological", "biotech", "vaccine", "medic"
    ]):
        return "Pharmaceuticals & Life Sciences"

    # Metals & Mining
    if any(k in s for k in [
        "steel", "aluminium", "aluminum", "metal", "copper", "smelt", "mine", "mining",
        "iron", "ore", "foundry", "ferrous", "non-ferrous", "zinc", "nickel"
    ]):
        return "Metals & Mining"

    # Public & Institutional Infrastructure
    if any(k in s for k in [
        "college", "university", "school", "library", "museum", "civic center", "fire station",
        "laboratory", "research facility", "administrative", "armoury", "barrack", "missile", "penitentiary",
        "church", "mosque", "temple", "animal shelter", "launching pad"
    ]):
        return "Public & Institutional"

    # Hospitality, Leisure & Sports
    if any(k in s for k in [
        "amusement", "cinema", "casino", "golf", "resort", "motel", "hotel", "athletic", "track",
        "ice rink", "park", "playground", "leisure", "recreation", "ski tow", "drive-in"
    ]):
        return "Hospitality & Leisure"

    # Real Estate & Commercial Facilities
    if any(k in s for k in [
        "building", "residential", "commercial", "office", "warehouse", "townhouse",
        "villa", "housing", "mall", "shopping center", "apartment", "bungalow", "condominium",
        "cottage", "dormitory", "duplex", "high-rise", "low-rise", "parking facility",
        "self storage", "special economic zone", "storage tank"
    ]):
        return "Real Estate & Commercial"

    # Industrial Manufacturing & Machinery
    if any(k in s for k in [
        "manufactur", "plant", "factory", "assembly", "mill", "unit", "production",
        "glass", "garages", "pumping", "overhead", "overpass", "land reclamation"
    ]):
        return "Industrial Manufacturing"

    return "Specialized Industrial Facilities"

def extract_keywords(sector: str, definition: str) -> List[str]:
    # Extract salient tokens
    text = f"{sector} {definition}".lower()
    words = re.findall(r"\b[a-z0-9-]{3,}\b", text)
    filtered = []
    seen = set()
    
    # Priority words from sector name
    sector_words = re.findall(r"\b[a-z0-9-]{3,}\b", sector.lower())
    for w in sector_words:
        if w not in STOPWORDS and w not in seen:
            seen.add(w)
            filtered.append(w)
            
    # Then definition words
    for w in words:
        if w not in STOPWORDS and w not in seen:
            seen.add(w)
            filtered.append(w)
            if len(filtered) >= 12:
                break
    return filtered

def main():
    sectors_list = []
    with open(SOURCE_CSV, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader, 1):
            s = row.get("Primary Sector", "").strip()
            d = row.get("Definition", "").strip()
            if not s:
                continue
            group = classify_group(s, d)
            keywords = extract_keywords(s, d)
            item = {
                "id": slugify(s),
                "sector": s,
                "group": group,
                "definition": d,
                "keywords": keywords,
                "index": i
            }
            sectors_list.append(item)

    print(f"Loaded {len(sectors_list)} primary sectors.")

    # Write Backend JSON
    with open(BACKEND_JSON, mode="w", encoding="utf-8") as f:
        json.dump(sectors_list, f, indent=2, ensure_ascii=False)
    print(f"Wrote {BACKEND_JSON}")

    # Write Frontend JSON
    with open(FRONTEND_JSON, mode="w", encoding="utf-8") as f:
        json.dump(sectors_list, f, indent=2, ensure_ascii=False)
    print(f"Wrote {FRONTEND_JSON}")

    # Write Backend CSV
    with open(BACKEND_CSV, mode="w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "sector", "group", "definition", "keywords"])
        writer.writeheader()
        for s in sectors_list:
            writer.writerow({
                "id": s["id"],
                "sector": s["sector"],
                "group": s["group"],
                "definition": s["definition"],
                "keywords": ", ".join(s["keywords"])
            })
    print(f"Wrote {BACKEND_CSV}")

    # Group counts
    group_counts = {}
    for s in sectors_list:
        group_counts[s["group"]] = group_counts.get(s["group"], 0) + 1

    print("\nTaxonomy Summary by Group:")
    for g, count in sorted(group_counts.items(), key=lambda x: -x[1]):
        print(f"  • {g}: {count} sectors")

if __name__ == "__main__":
    main()
