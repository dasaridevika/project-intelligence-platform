import assert from "node:assert";

// 1. Sector words
const SECTOR_WORDS = new Set([
  // Solar & Renewables
  "solar", "photovoltaic", "pv", "csp", "concentrated", "heliostat", "heliostats", 
  "inverter", "inverters", "panel", "panels", "module", "modules", "array", "arrays", 
  "wind", "windfarm", "windfarms", "offshore", "onshore", "turbine", "turbines", 
  "hydro", "hydroelectric", "hydropower", "geothermal", "biomass", "biogas", "biofuel", "biofuels",
  "renewable", "renewables", "clean", "green", "cleantech", "cleanenergy", "decarbonization",

  // Energy Storage & Batteries
  "storage", "battery", "batteries", "bess", "cell", "cells", "pack", "packs", "megapack", "megapacks",

  // Hydrogen & Carbon Management
  "hydrogen", "electrolyzer", "electrolyser", "electrolyzers", "electrolysers", "ammonia", "methanol",
  "carbon", "capture", "sequestration", "ccs", "ccus",

  // Power, Electric, Transmission & Grid
  "power", "energy", "generation", "electric", "electrical", "electricity", "utility", "utilities",
  "transmission", "grid", "microgrid", "substation", "switchyard", "interconnection",
  "megawatt", "mw", "gigawatt", "gw", "kilowatt", "kw", "kwh", "mwh", "gwh",
  "voltage", "highvoltage", "hv", "hvdc",

  // Oil, Gas & Petrochemicals
  "oil", "gas", "lng", "lpg", "petroleum", "petrochemical", "petrochemicals", "refinery", "refineries",
  "pipeline", "pipelines", "drilling", "crude", "ethane", "cracker", "feedstock", "chemical", "chemicals",
  "fertilizer", "fertilizers",

  // Data Centers, Cloud & IT Infrastructure
  "data", "center", "centre", "centers", "centres", "datacenter", "datacentre", "datacenters", "datacentres",
  "hyperscale", "hyperscaler", "hyperscalers", "colocation", "colo", "cloud", "compute", "server", "servers",
  "ai", "gpu", "gpus", "cluster", "clusters", "hpc", "supercomputer", "supercomputing", "telecom", "telecommunications",

  // Semiconductors & Electronics
  "semiconductor", "semiconductors", "chip", "chips", "wafer", "wafers", "fab", "fabs", "megafab", "megafabs",
  "foundry", "foundries", "cleanroom", "cleanrooms", "dram", "nand", "silicon",

  // Manufacturing & Industrial Facilities
  "manufacturing", "gigafactory", "gigafactories", "factory", "factories", "plant", "plants",
  "facility", "facilities", "mill", "mills", "smelter", "smelters", "assembly", "production", "industrial",

  // Metals & Mining
  "mining", "mine", "mines", "metal", "metals", "steel", "iron", "aluminum", "aluminium", "copper",
  "lithium", "nickel", "cobalt", "gold", "smelting", "ore",

  // Real Estate, Logistics & Infrastructure
  "logistics", "warehouse", "warehouses", "distribution", "fulfillment", "terminal", "terminals",
  "port", "ports", "harbor", "airport", "rail", "railway", "freight", "park", "parks", "campus", "campuses",
  "hub", "hubs", "site", "sites", "complex", "complexes", "zone", "estate", "corridor",

  // Project, Engineering & Contracting Generic Words
  "project", "projects", "development", "developments", "phase", "stage", "unit", "units", "block", "blocks",
  "expansion", "initiative", "program", "scheme", "build", "building", "buildings", "construction",
  "erection", "commissioning", "epc", "engineering", "procurement", "contracting", "contractor", "contractors",
  "consulting", "consultancy", "developer", "developers", "operator", "operators", "operation", "operations",
  "station", "stations", "system", "systems", "solutions", "services", "infrastructure"
]);

// 2. Stopwords
const PROJECT_MATCH_STOPWORDS = new Set([
  "and", "the", "for", "with", "from", "into", "over", "under", "new", "all",
  "first", "second", "third", "fourth", "announced", "planning", "construction",
  "group", "holdings", "corp", "corporation", "inc", "incorporated", "ltd", "limited", 
  "llc", "gmbh", "co", "company", "asset", "assets", "management", "investment", "investments", 
  "capital", "partners", "partnership", "platform", "platforms", "global", "national", 
  "international", "state", "rules", "capacity", "mega", "strategic", "announces", "plans", 
  "joint", "venture", "market", "markets", "north", "south", "east", "west"
]);

function isNewsPublisher(name) {
  if (!name || typeof name !== "string") return false;
  const n = name.toLowerCase().trim();
  const publisherPattern = /\b(?:reuters|bloomberg|constructconnect|datacenterdynamics|dcn|associated press|prnewswire|businesswire|globenewswire|cnbc|forbes|financial times|marketwatch|canary media|pv magazine|solar power world|recharge news|mckinsey|gartner|idc|accenture|deloitte|kpmg|ey|ernst\s*&\s*young|ernst\s+and\s+young|pwc|pricewaterhousecoopers|bcg|boston consulting|bain|oxford economics|globaldata|statista|eia|u\.s\.\s*eia|energy information administration|enerdatics|dmc education|wood mackenzie|woodmac|rystad energy|rystad|s&p global|sp global|spglobal|ferc|iea|clean energy associates|levelten|findepcm|find epcm|electrek|industrial info|industrialinfo|power systems technology|powersystems|channel newsasia|channelnewsasia|renewables now|renewablesnow|energy storage news|techtimes|chosun|korea herald|koreaherald|asia business daily|the asia business daily|semiwiki|cleantechnica)\b/i;
  if (publisherPattern.test(n)) return true;
  if (/\b(?:press release|staff writer|news agency|market research|data platform|data tracker|statistics agency|statistical agency)\b/i.test(n)) return true;
  if (/^(?:news|times|post|journal|herald|tribune|insight|insights|blog|blogs|article|articles|update|updates|overview|report|reports|tracker|editorial|education|statistics|database)$/i.test(n)) return true;
  return false;
}

function isValidCompanyEntity(name) {
  if (!name || typeof name !== "string") return false;
  const n = name.trim();
  if (n.length < 2 || n.length > 50) return false;
  const lower = n.toLowerCase();
  if (/^(?:none|null|n\/a|various|unknown|tbd|undefined|capital project|project developer|leading developer)$/i.test(lower)) return false;
  if (/^(?:nigeria|india|usa|united states|korea|south korea|japan|china|germany|spain|brazil|france|canada|australia|mexico|singapore|ohi)$/i.test(lower)) return false;
  if (isNewsPublisher(lower)) return false;
  return true;
}

function isWebsiteOwnName(companyName, candidateUrl, candidateTitle) {
  if (!companyName || !candidateUrl) return false;
  if (isNewsPublisher(companyName)) return true;

  let host = "";
  try {
    const parsed = new URL(candidateUrl);
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }

  const cleanHost = host.replace(/^(?:www\d*|m|amp|news|blog|press|media|articles)\./i, "");
  const hostParts = cleanHost.split('.');
  const rootDomain = hostParts[0] || "";

  const compClean = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const rootClean = rootDomain.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (!compClean || !rootClean) return false;

  const isMediaOrDirHost = /(?:news|times|post|journal|daily|tribune|media|press|wire|info|report|research|stat|data|consult|herald|magazine|digest|network|review|tracker|bulletin|monitor|insight|insights|epcm|directory|portal|technology)\b/i.test(cleanHost) || isNewsPublisher(cleanHost);

  if (isMediaOrDirHost) {
    if (compClean === rootClean || rootClean.includes(compClean) || (compClean.length >= 4 && compClean.includes(rootClean))) {
      return true;
    }
  }

  if (candidateTitle) {
    const escapedComp = companyName.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const brandSuffixRegex = new RegExp(`(?:[-–—|/•]\\s*${escapedComp}\\s*$|^${escapedComp}\\s*[-–—|/•])`, 'i');
    if (brandSuffixRegex.test(candidateTitle) && isMediaOrDirHost) {
      return true;
    }
  }

  return false;
}

function matchesCompanyName(comp, fullContent) {
  if (!comp || !fullContent) return false;
  const cleanComp = comp.toLowerCase().trim();
  const escaped = cleanComp.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  if (new RegExp(`\\b${escaped}\\b`, 'i').test(fullContent)) {
    return true;
  }
  const compTokens = cleanComp
    .split(/[\s\-–—/]+/)
    .map(t => t.replace(/[^a-z0-9]/g, ""))
    .filter(t => t.length >= 3 && !SECTOR_WORDS.has(t) && !PROJECT_MATCH_STOPWORDS.has(t));
  
  for (const cTok of compTokens) {
    if (cTok.length >= 4 && new RegExp(`\\b${cTok}\\b`, 'i').test(fullContent)) {
      return true;
    }
  }
  return false;
}

function getSpecificProjectWords(canonicalName, companyName, location) {
  const specificWords = [];
  const compTokens = new Set(
    (companyName || "")
      .toLowerCase()
      .split(/[\s\-–—/]+/)
      .map(t => t.replace(/[^a-z0-9]/g, ""))
      .filter(t => t.length >= 2)
  );

  const rawTokens = (canonicalName || "")
    .toLowerCase()
    .split(/[\s\-–—/_:;.,()]+/)
    .map(t => t.replace(/[^a-z0-9]/g, ""))
    .filter(t => t.length >= 3 && !/^\d+$/.test(t));

  for (const tok of rawTokens) {
    if (SECTOR_WORDS.has(tok)) continue;
    if (PROJECT_MATCH_STOPWORDS.has(tok)) continue;
    if (compTokens.has(tok)) continue;
    specificWords.push(tok);
  }

  if (specificWords.length === 0 && location) {
    const BROAD_LOCATIONS = new Set([
      "usa", "united", "states", "america", "india", "japan", "korea", "south", "germany",
      "spain", "france", "canada", "australia", "china", "uk", "kingdom", "texas"
    ]);
    const locTokens = location
      .toLowerCase()
      .split(/[\s\-–—/_:;.,()]+/)
      .map(t => t.replace(/[^a-z0-9]/g, ""))
      .filter(t => t.length >= 4 && !/^\d+$/.test(t) && !BROAD_LOCATIONS.has(t) && !SECTOR_WORDS.has(t) && !PROJECT_MATCH_STOPWORDS.has(t));
    for (const lTok of locTokens) {
      if (!compTokens.has(lTok)) {
        specificWords.push(lTok);
      }
    }
  }

  return specificWords;
}

function candidateMentionsProject(candidate, aiP) {
  if (!candidate || !aiP) return false;
  const cUrl = (candidate.cleanUrl || "").toLowerCase();
  const cTitle = (candidate.title || "").toLowerCase();
  const cText = (candidate.text || candidate.snippet || "").toLowerCase();
  const fullContent = `${cUrl} ${cTitle} ${cText}`;

  const comp = (aiP.company || "").trim();
  const name = (aiP.canonical_name || "").trim();

  // Condition 1: Require the company name (not the website's own name)
  if (!comp || comp.length < 2) return false;
  if (!isValidCompanyEntity(comp)) return false;
  if (isNewsPublisher(comp)) return false;
  if (isWebsiteOwnName(comp, cUrl, cTitle)) return false;
  if (!matchesCompanyName(comp, fullContent)) return false;

  // Condition 2: Require a specific project word that isn't a sector word
  const specificWords = getSpecificProjectWords(name, comp, aiP.location);
  if (specificWords.length === 0) {
    return false;
  }

  let specificWordMatched = false;
  for (const word of specificWords) {
    const wordRegex = new RegExp(`\\b${word}\\b`, 'i');
    if (wordRegex.test(fullContent)) {
      specificWordMatched = true;
      break;
    }
  }

  if (!specificWordMatched) {
    return false;
  }

  return true;
}

console.log("Running corroboration test suite...");

// Test Case 1: "Desert Pine Solar and Storage" tested against findepcm.com (contains "solar", "storage", but not company or Desert Pine)
const candFindEPCM = {
  cleanUrl: "https://www.findepcm.com/articles/renewable-energy-tenders-india",
  title: "Latest Solar and Energy Storage EPC Contracts in India | Find EPCM",
  text: "India announces new utility-scale solar and battery storage projects across Gujarat and Rajasthan for clean energy grid expansion."
};

const aiDesertPine = {
  canonical_name: "Desert Pine Solar and Storage",
  company: "Lightsource bp",
  location: "El Paso County, Texas, USA"
};

assert.strictEqual(
  candidateMentionsProject(candFindEPCM, aiDesertPine),
  false,
  "Desert Pine must NOT corroborate against findepcm.com!"
);
console.log("✓ Test 1 Passed: Desert Pine rejected against findepcm.com");

// Test Case 2: findepcm claiming company is "Find EPCM"
const aiHallucinatedFindEPCM = {
  canonical_name: "Desert Pine Solar and Storage",
  company: "Find EPCM",
  location: "India"
};
assert.strictEqual(
  candidateMentionsProject(candFindEPCM, aiHallucinatedFindEPCM),
  false,
  "Find EPCM website's own name must NOT count as developer company!"
);
console.log("✓ Test 2 Passed: Website's own name rejected as company");

// Test Case 3: Desert Pine tested against official / valid Lightsource bp page
const candDesertPineOfficial = {
  cleanUrl: "https://lightsourcebp.com/us/project/desert-pine-solar-and-storage",
  title: "Desert Pine Solar and Storage Project in Texas | Lightsource bp",
  text: "Lightsource bp is developing the Desert Pine solar and energy storage project in El Paso County, Texas, generating clean power."
};
assert.strictEqual(
  candidateMentionsProject(candDesertPineOfficial, aiDesertPine),
  true,
  "Desert Pine must corroborate against its official Lightsource bp page!"
);
console.log("✓ Test 3 Passed: Desert Pine verified against authentic source");

// Test Case 4: Sequoia Solar project by Enbridge on Electrek news article
const candElectrek = {
  cleanUrl: "https://electrek.co/2026/05/27/north-americas-largest-solar-farms-texas-sequoia-enbridge",
  title: "One of North America's largest solar farms just came online in Texas - Electrek",
  text: "Enbridge has commenced construction of the massive Sequoia solar project in Callahan County, Texas."
};
const aiSequoia = {
  canonical_name: "Sequoia Solar project",
  company: "Enbridge",
  location: "Callahan County, Texas, USA"
};
assert.strictEqual(
  candidateMentionsProject(candElectrek, aiSequoia),
  true,
  "Sequoia Solar by Enbridge must corroborate against Electrek article mentioning both!"
);
console.log("✓ Test 4 Passed: Sequoia Solar corroborated against news article");

// Test Case 5: Electrek claiming company is "Electrek"
const aiElectrekCompany = {
  canonical_name: "Sequoia Solar project",
  company: "Electrek",
  location: "Texas, USA"
};
assert.strictEqual(
  candidateMentionsProject(candElectrek, aiElectrekCompany),
  false,
  "News site Electrek must not count as developer company!"
);
console.log("✓ Test 5 Passed: News site rejected as company");

// Test Case 6: Generic sector words only (e.g. 2 generic words "solar" and "storage" out of 4) without company
const candGenericSolar = {
  cleanUrl: "https://www.pv-magazine.com/2026/11/global-solar-and-storage-overview",
  title: "Global Solar and Storage Market Growth",
  text: "Worldwide solar installations and energy storage capacities are surging according to industry analysts."
};
assert.strictEqual(
  candidateMentionsProject(candGenericSolar, aiDesertPine),
  false,
  "Generic article with solar and storage must NOT corroborate Desert Pine!"
);
console.log("✓ Test 6 Passed: Generic solar and storage words rejected");

// Test Case 7: Texas project "Big Rooter Power" by Panamint Capital tested against Indian news article
const candIndiaArticle = {
  cleanUrl: "https://economictimes.indiatimes.com/industry/renewables/solar-auction-india",
  title: "India Bids for 1000MW Solar Projects Across Rajasthan",
  text: "The Ministry of New and Renewable Energy has concluded tenders for mega solar power parks."
};
const aiBigRooter = {
  canonical_name: "Big Rooter Power",
  company: "Panamint Capital",
  location: "central Texas, USA"
};
assert.strictEqual(
  candidateMentionsProject(candIndiaArticle, aiBigRooter),
  false,
  "Texas project Big Rooter must NOT match Indian news article!"
);
console.log("✓ Test 7 Passed: Texas project Big Rooter rejected against Indian article");

console.log("All corroboration tests PASSED successfully!");
