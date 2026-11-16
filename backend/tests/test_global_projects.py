import pytest
from app.providers.base import RawProviderResultItem
from app.services.deduplicator import project_deduplicator
from app.services.extractor import project_extractor
from app.services.query_processor import query_processor
from app.services.ranker import project_ranker


def test_query_processor_global_locations():
    # North America
    q_us = query_processor.process("Upcoming hyperscale data center projects in Northern Virginia")
    assert q_us["category"] == "Data Center"
    assert q_us["location"] == "Northern Virginia"

    # Europe
    q_eu = query_processor.process("Offshore wind farm projects in United Kingdom")
    assert q_eu["category"] == "Renewable Energy"
    assert q_eu["location"] == "United Kingdom"

    # Germany / Semiconductor
    q_de = query_processor.process("Semiconductor fab construction in Dresden, Germany")
    assert q_de["category"] == "Semiconductor"
    assert q_de["location"] == "Germany"

    # Middle East
    q_sa = query_processor.process("Solar power mega projects in Saudi Arabia")
    assert q_sa["category"] == "Solar Power"
    assert q_sa["location"] == "Saudi Arabia"

    # Asia-Pacific
    q_my = query_processor.process("Data center developments in Johor, Malaysia")
    assert q_my["category"] == "Data Center"
    assert q_my["location"] in ("Johor", "Malaysia")

    # General Global query
    q_global = query_processor.process("Global electric vehicle battery gigafactory projects")
    assert q_global["category"] == "EV & Battery"
    assert q_global["location"] == "Global"


def test_extract_usa_hyperscale_data_center():
    item = RawProviderResultItem(
        title="Microsoft announces $3.3 Billion AI Datacenter Campus in Mount Pleasant",
        url="https://news.microsoft.example.com/ai-datacenter",
        snippet="Microsoft has officially broken ground on a new $3.3 Billion hyperscale data center campus in Northern Virginia with over 300MW total capacity to power generative AI workloads.",
        published_date="2026-05-15T12:00:00Z"
    )
    cand = project_extractor.extract_candidate(item, provider_name="exa", default_category="Data Center")
    assert cand is not None
    assert "Microsoft" in cand.canonical_name
    assert cand.developer == "Microsoft"
    assert cand.location_country == "United States"
    assert cand.location_state == "Virginia"
    assert cand.investment_currency == "USD"
    assert cand.investment_value == 3_300_000_000.0
    assert cand.capacity_value == 300.0
    assert cand.capacity_unit == "MW"
    assert cand.status == "Under Construction"


def test_extract_europe_semiconductor_fab():
    item = RawProviderResultItem(
        title="TSMC breaks ground on €10 Billion Dresden Semiconductor Fab (ESMC)",
        url="https://eetimes.example.com/tsmc-dresden",
        snippet="TSMC in joint venture with Bosch, Infineon and NXP begins construction of a €10 Billion wafer fab in Dresden, Germany. The facility is expected to produce 40,000 300mm wafers per month.",
        published_date="2026-08-20T09:00:00Z"
    )
    cand = project_extractor.extract_candidate(item, provider_name="brave", default_category="Semiconductor")
    assert cand is not None
    assert "TSMC" in cand.canonical_name
    assert cand.developer == "TSMC"
    assert cand.location_city == "Dresden"
    assert cand.location_country == "Germany"
    assert cand.investment_currency == "EUR"
    assert cand.investment_value == 10_000_000_000.0
    assert cand.status == "Under Construction"


def test_extract_middle_east_solar_plant():
    item = RawProviderResultItem(
        title="ACWA Power unveils 1500MW Sudair Solar PV Plant in Riyadh",
        url="https://arabnews.example.com/acwa-sudair-solar",
        snippet="ACWA Power and the Public Investment Fund announced commercial operation of the 1,500 MW Sudair Solar project in Riyadh, Saudi Arabia, representing an investment of $924 Million.",
        published_date="2026-06-01T14:30:00Z"
    )
    cand = project_extractor.extract_candidate(item, provider_name="exa", default_category="Solar Power")
    assert cand is not None
    assert "ACWA Power" in cand.canonical_name
    assert cand.developer == "ACWA Power"
    assert cand.location_city == "Riyadh"
    assert cand.location_country == "Saudi Arabia"
    assert cand.capacity_value == 1500.0
    assert cand.capacity_unit == "MW"
    assert cand.investment_currency == "USD"
    assert cand.investment_value == 924_000_000.0
    assert cand.status == "Operational"


def test_global_ranking_and_relevance():
    item1 = RawProviderResultItem(
        title="Vantage Data Centers opens 100MW campus in Frankfurt, Germany",
        url="https://datacenterdynamics.example.com/vantage-frankfurt",
        snippet="Vantage Data Centers announced 100MW campus in Frankfurt, Germany."
    )
    item2 = RawProviderResultItem(
        title="NextEra Energy 250MW Solar Project in Florida",
        url="https://solar.example.com/nextera-florida",
        snippet="NextEra Energy 250MW solar plant in United States."
    )

    c1 = project_extractor.extract_candidate(item1, "exa", "Data Center")
    c2 = project_extractor.extract_candidate(item2, "brave", "Solar Power")

    deduped = project_deduplicator.deduplicate([c1, c2])
    assert len(deduped) == 2

    # Query for Frankfurt data centers
    parsed_q = {
        "category": "Data Center",
        "location": "Germany",
        "keywords": ["data", "center", "frankfurt", "germany"]
    }
    ranked = project_ranker.rank(deduped, parsed_q)

    # First result must be the Frankfurt data center with high score
    assert ranked[0].project.location_city == "Frankfurt"
    assert ranked[0].project.location_country == "Germany"
    assert ranked[0].relevance_score > ranked[1].relevance_score
