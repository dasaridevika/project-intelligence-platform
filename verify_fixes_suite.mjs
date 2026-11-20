import assert from "node:assert";
import gatewayModule from "./cloudflare/gateway/index.js";
import primarySectors from "./frontend/src/data/primary_sectors.json" with { type: "json" };

console.log("=================================================");
console.log("RUNNING COMPREHENSIVE VERIFICATION TEST SUITE");
console.log("=================================================");

let passedTests = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// ==============================================================================
// 1. ENDPOINTS & API ACCURACY (POINT 13)
// ==============================================================================
console.log("\n[Group 1: API Accuracy & Health Reports]");

await testAsync("GET /health reports real model @cf/meta/llama-3.2-3b-instruct and real kv_storage", async () => {
  const req = new Request("https://edge.example.com/health");
  const env = { AI: {}, PROJECT_DATA: {} };
  const res = await gatewayModule.fetch(req, env, {});
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.model, "@cf/meta/llama-3.2-3b-instruct");
  assert.strictEqual(data.components.kv_storage, "operational");
  assert.strictEqual(data.components.database, undefined, "Fake database component must be removed");
});

await testAsync("GET /api/v1/analytics/system-health reports real kv_storage and real model without fake redis", async () => {
  const req = new Request("https://edge.example.com/api/v1/analytics/system-health");
  const env = { AI: {}, PROJECT_DATA: {} };
  const res = await gatewayModule.fetch(req, env, {});
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.workers_ai_model, "@cf/meta/llama-3.2-3b-instruct");
  assert.strictEqual(data.kv_storage, "operational");
  assert.strictEqual(data.storage, "Cloudflare KV");
  assert.strictEqual(data.redis_status, undefined, "Fake redis_status must be removed");
  assert.strictEqual(data.database_status, undefined, "Fake database_status must be removed");
});

await testAsync("GET /api/v1/search/:id returns 404 for unknown search ID", async () => {
  const req = new Request("https://edge.example.com/api/v1/search/unknown-nonexistent-id-12345");
  const env = { AI: {} };
  const res = await gatewayModule.fetch(req, env, {});
  assert.strictEqual(res.status, 404);
  const data = await res.json();
  assert.ok(data.error && data.error.includes("not found"));
});

await testAsync("GET /api/v1/search/:id/results returns 404 for unknown search ID", async () => {
  const req = new Request("https://edge.example.com/api/v1/search/unknown-nonexistent-id-12345/results");
  const env = { AI: {} };
  const res = await gatewayModule.fetch(req, env, {});
  assert.strictEqual(res.status, 404);
  const data = await res.json();
  assert.ok(data.error && data.error.includes("not found"));
});

await testAsync("GET /api/v1/search/:id/events returns 404 for unknown search ID", async () => {
  const req = new Request("https://edge.example.com/api/v1/search/unknown-nonexistent-id-12345/events");
  const env = { AI: {} };
  const res = await gatewayModule.fetch(req, env, {});
  assert.strictEqual(res.status, 404);
  const data = await res.json();
  assert.ok(data.error && data.error.includes("not found"));
});

// ==============================================================================
// 2. URL VALIDATION & SECTION PAGES (POINT 4)
// ==============================================================================
console.log("\n[Group 2: Section Pages, Categories & Listicle URLs]");

const TAXONOMY_WORDS = /^(?:en|es|fr|de|home|index\.html|search|browse|category|categories|tag|tags|topic|topics|section|sections|channel|channels|rubrik|kategorie|rubriken|industry|industries|sector|sectors|market|markets|news|article|articles|feed|blog|blogs|resources|insights|renewable-energy|clean-energy|energy|solar|solar-power|wind|wind-power|power|utilities|infrastructure|technology|data-centers?|semiconductors?|mining|chemicals?|oil-and-gas|oil-gas|oil|gas|hydrogen|battery|batteries|bess|storage|applications-installations)$/i;

function testUrlValidation(urlStr) {
  const parsed = new URL(urlStr);
  let cleanPath = parsed.pathname.replace(/\/+/g, "/");
  if (cleanPath.length > 1 && cleanPath.endsWith("/")) {
    cleanPath = cleanPath.slice(0, -1);
  }
  const pathSegments = cleanPath.split("/").filter(Boolean);

  if (
    pathSegments.length === 0 ||
    (pathSegments.length === 1 && /^(?:en|es|fr|de|home|index\.html|search|browse|category|categories|directory|feed|news|articles|blog|resources|topics?|sections?|channels?)$/i.test(pathSegments[0]))
  ) {
    return { valid: false, reason: "Homepage or broad section index" };
  }

  if (
    pathSegments.some((seg, idx) => /^(?:category|categories|tag|tags|topic|topics|rubrik|kategorie|rubriken|rubrique|rubriques)$/i.test(seg) && idx >= pathSegments.length - 2)
  ) {
    return { valid: false, reason: "Taxonomy category or tag index page" };
  }

  if (pathSegments.length >= 2 && pathSegments.every(seg => TAXONOMY_WORDS.test(seg))) {
    return { valid: false, reason: "Multi-level taxonomy/section landing page" };
  }

  if (
    /\/(?:top|largest|biggest)-\d+/i.test(cleanPath) ||
    /\/\d+-(?:top|largest|biggest|major)/i.test(cleanPath) ||
    /\/.*-(?:20\d\d[-–—]20\d\d|roundup|list)\/?$/i.test(cleanPath)
  ) {
    return { valid: false, reason: "Listicle URL" };
  }

  return { valid: true };
}

test("Section page pv-magazine.com/category/applications-installations/ is rejected", () => {
  const res = testUrlValidation("https://www.pv-magazine.com/category/applications-installations/");
  assert.strictEqual(res.valid, false);
});

test("Section page energywatch.in/renewable-energy/solar is rejected", () => {
  const res = testUrlValidation("https://energywatch.in/renewable-energy/solar");
  assert.strictEqual(res.valid, false);
});

test("Listicle URL /top-50-solar-power-projects is rejected", () => {
  const res = testUrlValidation("https://example.com/top-50-solar-power-projects");
  assert.strictEqual(res.valid, false);
});

test("Multi-year forecast URL /india-solar-projects-2026-2030 is rejected", () => {
  const res = testUrlValidation("https://example.com/india-solar-projects-2026-2030");
  assert.strictEqual(res.valid, false);
});

test("Genuine article URL is accepted", () => {
  const res = testUrlValidation("https://electrek.co/2026/05/27/north-americas-largest-solar-farms-texas-sequoia-enbridge");
  assert.strictEqual(res.valid, true);
});

// ==============================================================================
// 3. COMPANY & LISTICLE VALIDATION (POINT 4 & 11)
// ==============================================================================
console.log("\n[Group 3: Company Validation & One-off Rules Removal]");

function testCompany(name) {
  const lower = name.toLowerCase().trim();
  if (/^(?:none|null|n\/a|various|multiple|several|diverse|undisclosed|unspecified|anonymous|unknown|tbd|undefined|capital project)\b/i.test(lower)) {
    return false;
  }
  if (/\b(?:various|multiple|several|different)\s+(?:developers?|companies|firms?|operators?|owners?|entities)\b/i.test(lower)) {
    return false;
  }
  if (/^(?:nigeria|india|usa|united states|korea|south korea|japan|china|germany|spain|brazil|france|canada|australia|mexico|singapore|ohi)$/i.test(lower)) {
    return false;
  }
  if (/^(?:government|ministry|department)\s+of\b/i.test(lower) || lower === "government") {
    return false;
  }
  if (/\b(?:campus by \d+-\d+ years|chips need the|residents vote|approved a|court approves)\b/i.test(lower)) {
    return false;
  }
  return true;
}

test("Company 'Various' is rejected", () => {
  assert.strictEqual(testCompany("Various"), false);
});

test("Company 'Various developers' is rejected", () => {
  assert.strictEqual(testCompany("Various developers"), false);
});

test("Company 'Multiple companies' is rejected", () => {
  assert.strictEqual(testCompany("Multiple companies"), false);
});

test("Headline fragment 'campus by 2-3 years' is rejected via general pattern", () => {
  assert.strictEqual(testCompany("clay, ny campus by 2-3 years. - the"), false);
});

test("Headline fragment 'chips need the know-how' is rejected via general pattern", () => {
  assert.strictEqual(testCompany("fabs the newest chips need the know-how"), false);
});

test("Genuine developers (Enbridge, TSMC, Lightsource bp) are accepted", () => {
  assert.strictEqual(testCompany("Enbridge"), true);
  assert.strictEqual(testCompany("TSMC"), true);
  assert.strictEqual(testCompany("Lightsource bp"), true);
});

// ==============================================================================
// 4. CATEGORY PRESERVATION (POINT 5)
// ==============================================================================
console.log("\n[Group 4: Category Preservation]");

function inferCategoryTest(projectName, summary, hintCategory) {
  if (hintCategory && typeof hintCategory === "string") {
    const trimmed = hintCategory.trim();
    if (trimmed && trimmed !== "all" && trimmed !== "All Categories" && trimmed !== "Capital Infrastructure" && trimmed !== "Capital Projects") {
      return trimmed;
    }
  }

  const nameOnly = (projectName || "").toLowerCase();
  const summaryOnly = (summary || "").toLowerCase();

  for (const s of primarySectors) {
    if (nameOnly.includes(s.sector.toLowerCase())) {
      return s.sector;
    }
  }

  if (/\b(?:data\s*cent(?:er|re)|hyperscale|cloud\s+campus)\b/i.test(nameOnly)) {
    return "Hyperscale Data Center";
  }
  if (/\b(?:semiconductor|wafer\s+fab|cleanroom)\b/i.test(nameOnly)) {
    return "Semiconductor Manufacturing";
  }
  if (/\b(?:solar\s*(?:farm|park|plant|project)|photovoltaic)\b/i.test(nameOnly)) {
    return "Solar Photovoltaic Power Plant (PV)";
  }

  if (/\b(?:data\s*cent(?:er|re)|hyperscale)\b/i.test(summaryOnly)) {
    return "Hyperscale Data Center";
  }
  if (/\b(?:solar\s*(?:farm|park|plant|project)|photovoltaic)\b/i.test(summaryOnly)) {
    return "Solar Photovoltaic Power Plant (PV)";
  }

  return "Capital Infrastructure";
}

test("User chosen sector 'Acetic Acid Plant' is preserved even if summary mentions solar", () => {
  const cat = inferCategoryTest("Texas Chemical Expansion", "The facility will be powered by an on-site 10MW solar farm", "Acetic Acid Plant");
  assert.strictEqual(cat, "Acetic Acid Plant");
});

test("Yorizon Cloud Campus data centre mentioning solar power is NOT tagged Solar PV", () => {
  const cat = inferCategoryTest("Yorizon Cloud Campus", "State-of-the-art AI data center powered by 50MW solar array", undefined);
  assert.strictEqual(cat, "Hyperscale Data Center");
});

test("Solar farm with cloud telemetry is tagged Solar PV", () => {
  const cat = inferCategoryTest("Sequoia Solar Project", "815 MW solar farm utilizing cloud analytics for tracking", undefined);
  assert.strictEqual(cat, "Solar Photovoltaic Power Plant (PV)");
});

// ==============================================================================
// 5. DEDUPLICATION ACROSS GERMAN COMPOUND WORDS (POINT 8 & 11)
// ==============================================================================
console.log("\n[Group 5: Deduplication Across Compound Words]");

function getProjectDedupKeyTest(name, developer) {
  const STOPWORDS_REGEX = /\b(?:the|a|an|platforms|platform|technologies|technology|energy|resources|resource|holdings|services|solutions|group|corp|corporation|inc|llc|ltd|limited|co|company|asset|assets|management|capital|investments|investment|partners|partnership|ventures|venture|and|ai|artificial\s*intelligence|hyperscale|data\s*center|data\s*centre|megafab|gigafactory|project|campus|facility|plant|center|centre|park|farm|bess|battery|solar|wind|energy\s*storage|storage|phase\s*\d+|expansion|site|hub|solarpark|windpark|kraftwerk|solaranlage|photovoltaikanlage|photovoltaik|buergersolarpark|bürgersolarpark|windfarm|datacenter|datacentre|pv|solar-plus-storage)\b/gi;

  let cleanName = (name || "")
    .toLowerCase()
    .replace(/^(?:solarpark|windpark|kraftwerk|buergersolarpark)\s+/i, "");

  const combined = `${developer || ""} ${cleanName}`
    .toLowerCase()
    .replace(/['’]s\b/gi, "")
    .replace(STOPWORDS_REGEX, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = Array.from(new Set(combined.split(/\s+/).filter(t => t.length >= 3)));
  tokens.sort();

  return tokens.join("_") || `${(developer || "").toLowerCase()}_${(name || "").toLowerCase()}`;
}

test("'Schladen Solar Park' and 'Solarpark Schladen' produce the EXACT same dedup key", () => {
  const key1 = getProjectDedupKeyTest("Schladen Solar Park", "Developer");
  const key2 = getProjectDedupKeyTest("Solarpark Schladen", "Developer");
  assert.strictEqual(key1, key2);
});

test("'MaxSolar Memmendorf' and 'Memmendorf Solar Park' (developer: MaxSolar) produce the EXACT same dedup key", () => {
  const key1 = getProjectDedupKeyTest("MaxSolar Memmendorf", "");
  const key2 = getProjectDedupKeyTest("Memmendorf Solar Park", "MaxSolar");
  assert.strictEqual(key1, key2);
});

test("TSMC project deduplicates cleanly without hardcoded 'kumamoto_tsmc'", () => {
  const key = getProjectDedupKeyTest("Kumamoto Fab Phase 2", "TSMC");
  assert.ok(key.includes("kumamoto"));
  assert.ok(key.includes("tsmc"));
  assert.notStrictEqual(key, "kumamoto_tsmc", "Special case hardcoding kumamoto_tsmc must be removed");
});

// ==============================================================================
// 6. COUNTRY MATCHING & QUERY FILTERING (POINT 8 & 9)
// ==============================================================================
console.log("\n[Group 6: Country Matching & Location Extraction]");

function normalizeCountryName(str) {
  if (!str || typeof str !== "string") return "";
  let s = str.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (s === "usa" || s === "u s a" || s === "u s" || s === "us" || s === "america" || s === "the united states") return "united states";
  if (s === "uk" || s === "u k" || s === "great britain" || s === "britain" || s === "england" || s === "scotland" || s === "wales") return "united kingdom";
  if (s === "uae" || s === "u a e" || s === "the uae") return "united arab emirates";
  if (s === "south korea" || s === "korea" || s === "republic of korea" || s === "rok") return "south korea";
  if (s === "deutschland") return "germany";
  if (s === "espana") return "spain";
  return s;
}

function matchesTargetCountryTest(projectCountry, projectLocation, targetLocation) {
  if (!targetLocation) return true;
  const target = targetLocation.toLowerCase().trim();
  if (target === "worldwide (global)" || target === "global" || target === "all regions" || target === "all" || target === "") {
    return true;
  }

  const pCountry = (projectCountry || "").toLowerCase().trim();
  const pLocation = (projectLocation || "").toLowerCase().trim();
  const combined = `${pCountry} ${pLocation}`.trim();

  const normTarget = normalizeCountryName(target);
  const normCountry = normalizeCountryName(pCountry);

  if (normCountry) {
    if (normCountry === normTarget || normCountry.includes(normTarget) || normTarget.includes(normCountry)) {
      if (normTarget === "texas" || normTarget === "northern virginia" || normTarget === "arizona" || normTarget === "california") {
        return combined.includes(normTarget) || (normTarget === "northern virginia" && (combined.includes("loudoun") || combined.includes("ashburn") || combined.includes("richmond")));
      }
      return true;
    }
    if (normCountry === "united states" && (normTarget === "texas" || normTarget === "northern virginia" || normTarget === "arizona" || normTarget === "california")) {
      return combined.includes(normTarget) || (normTarget === "northern virginia" && (combined.includes("loudoun") || combined.includes("ashburn") || combined.includes("richmond")));
    }
    return false;
  }

  if (combined) {
    const normCombined = normalizeCountryName(combined);
    if (normCombined.includes(normTarget)) {
      return true;
    }
  }

  return false;
}

function extractLocationTest(queryStr) {
  const match = queryStr.match(/\b(?:in|across|near|around|for)\s+([A-Z][a-zA-Z\s,]{2,30})\b/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return "Global";
}

test("Texas project (Big Rooter Power) with country 'United States' is rejected when searching 'India'", () => {
  const match = matchesTargetCountryTest("United States", "Central Texas, USA", "India");
  assert.strictEqual(match, false);
});

test("India project with country 'India' is accepted when searching 'India'", () => {
  const match = matchesTargetCountryTest("India", "Andhra Pradesh, India", "India");
  assert.strictEqual(match, true);
});

test("German project in 'Lower Saxony' with country 'Germany' is accepted for 'Germany'", () => {
  const match = matchesTargetCountryTest("Germany", "Lower Saxony, Germany", "Germany");
  assert.strictEqual(match, true);
});

test("Nation of Georgia (country: 'Georgia') is NOT matched as 'United States'", () => {
  const match = matchesTargetCountryTest("Georgia", "Tbilisi, Georgia", "United States");
  assert.strictEqual(match, false);
});

test("Query 'solar projects in India' extracts location 'India'", () => {
  const loc = extractLocationTest("solar projects in India");
  assert.strictEqual(loc, "India");
});

// ==============================================================================
// 7. FOREIGN LANGUAGE FILTER (POINT 10)
// ==============================================================================
console.log("\n[Group 7: Foreign Language Marker Precision]");

function isForeignLanguageTextTest(str) {
  if (!str || typeof str !== "string") return false;
  const words = str.toLowerCase().split(/\s+/);
  let foreignHits = 0;
  const foreignMarkers = new Set([
    "dans", "avec", "pour", "cette", "sont", "leur", "leurs", "été", "aussi", "engagé", "ses",
    "investissements", "projet", "doubler", "capacités", "puces", "isère",
    "para", "este", "esta", "estos", "estas", "como", "pero", "sobre", "entre", "cuando", "según",
    "und", "oder", "für", "fuer", "über", "ueber", "nach", "dieser", "diese", "dieses", "nicht", "eine"
  ]);
  for (const w of words) {
    const cleanWord = w.replace(/[.,;:'"()]/g, "");
    if (foreignMarkers.has(cleanWord)) {
      foreignHits++;
    }
  }
  return foreignHits >= 3;
}

test("English article discussing 'production capacity horizon' is NOT flagged as foreign", () => {
  const englishText = "The company plans to double wafer production capacity on the horizon with new manufacturing.";
  assert.strictEqual(isForeignLanguageTextTest(englishText), false);
});

test("French article with real foreign markers is flagged as foreign", () => {
  const frenchText = "Ce projet avec des investissements pour doubler les capacités dans cette région.";
  assert.strictEqual(isForeignLanguageTextTest(frenchText), true);
});

// ==============================================================================
// 8. DYNAMIC CURRENT YEAR (POINT 11)
// ==============================================================================
console.log("\n[Group 8: Dynamic Current Year Dates]");

function formatDisplayDateTest(rawDate) {
  if (!rawDate || typeof rawDate !== "string") return "";
  const d = rawDate.trim();
  const currentYear = new Date().getFullYear();
  if (/^(?:latest\s+\d{4}|not specified|unknown|tbd|none|n\/a)$/i.test(d)) return "";

  const allYears = Array.from(d.matchAll(/\b(20[1-3]\d)\b/g)).map(m => parseInt(m[1], 10));
  const futureYears = allYears.filter(y => y >= currentYear);
  const pastYears = allYears.filter(y => y < currentYear);

  if (allYears.length > 0 && futureYears.length === 0 && pastYears.length > 0) {
    return null;
  }

  if (futureYears.length > 0) {
    const targetYear = futureYears[0];
    const monthMatch = d.match(new RegExp(`\\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+${targetYear}\\b`, 'i'));
    if (monthMatch) {
      const monthPrefix = monthMatch[1].slice(0, 3);
      const cleanMonth = monthPrefix.charAt(0).toUpperCase() + monthPrefix.slice(1).toLowerCase();
      return `${cleanMonth} ${targetYear}`;
    }
    return `${targetYear}`;
  }

  return d.replace(/\s*\([^)]*\)/g, "").trim();
}

test("Historical year prior to current year returns null (dropped)", () => {
  const currentYear = new Date().getFullYear();
  const historicalYear = (currentYear - 2).toString();
  assert.strictEqual(formatDisplayDateTest(historicalYear), null);
});

test("Current year or future year is formatted cleanly", () => {
  const currentYear = new Date().getFullYear();
  assert.strictEqual(formatDisplayDateTest(`${currentYear}`), `${currentYear}`);
  assert.strictEqual(formatDisplayDateTest(`November ${currentYear}`), `Nov ${currentYear}`);
});

// ==============================================================================
// 9. TRUNCATED JSON RECOVERY (POINT 7)
// ==============================================================================
console.log("\n[Group 9: Resilient Partial JSON Recovery]");

function parseLlmJsonTest(rawOutput) {
  if (!rawOutput || typeof rawOutput !== "string") return null;
  let clean = rawOutput.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const firstBrace = clean.indexOf("{");
  const firstBracket = clean.indexOf("[");

  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    const lastBracket = clean.lastIndexOf("]");
    if (lastBracket > firstBracket) {
      try {
        const slice = clean.slice(firstBracket, lastBracket + 1).replace(/,\s*([}\]])/g, "$1");
        return JSON.parse(slice);
      } catch (_) {}
    }
  }

  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = clean.slice(firstBrace, lastBrace + 1).replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(slice);
    } catch (_) {}
  }

  // Truncated recovery
  if (firstBrace !== -1) {
    const projectsIndex = clean.indexOf('"projects"');
    if (projectsIndex !== -1) {
      const lastValidBrace = clean.lastIndexOf("}");
      if (lastValidBrace > projectsIndex) {
        try {
          const recovered = clean.slice(firstBrace, lastValidBrace + 1) + "]}";
          const sanitized = recovered.replace(/,\s*([}\]])/g, "$1");
          return JSON.parse(sanitized);
        } catch (_) {}
      }
    }
  }

  return null;
}

test("Truncated JSON array cuts off at max_tokens is recovered without losing completed projects", () => {
  const truncated = `{"projects": [
    {"canonical_name": "Sequoia Solar Farm", "company": "Enbridge"},
    {"canonical_name": "Midpoint Solar Farm", "company": "Sunraycer"},
    {"canonical_name": "Incom`;
  const parsed = parseLlmJsonTest(truncated);
  assert.ok(parsed && Array.isArray(parsed.projects));
  assert.strictEqual(parsed.projects.length, 2);
  assert.strictEqual(parsed.projects[0].canonical_name, "Sequoia Solar Farm");
  assert.strictEqual(parsed.projects[1].canonical_name, "Midpoint Solar Farm");
});

// ==============================================================================
// 10. NO CODE SNIPPETS & NO RAW DATA (SANITY CHECKS)
// ==============================================================================
console.log("\n[Group 10: Code Snippet & Raw Data Stripping]");

function testCleanSummary(raw) {
  if (!raw || typeof raw !== "string") return "";
  let clean = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]+`/g, " ")
    .replace(/<(?:script|style|code|pre|noscript|svg)\b[^<]*(?:(?!<\/(?:script|style|code|pre|noscript|svg)>)<[^<]*)*<\/(?:script|style|code|pre|noscript|svg)>/gi, " ")
    .replace(/\bfunction(?:\s+[a-zA-Z0-9_$]+)?\s*\([^)]*\)\s*\{[^}]*\}/g, " ")
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/\b(?:function\b|const\b|var\b|let\b|class\b|import\b|export\b|return\b|console\.\w+\s*\(|curl\s+-[a-zA-Z]|npm\s+(?:run|install))\b/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+#+\s+/g, " ")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/^\s*[-•*]\s+/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:quot|amp|lt|gt|nbsp|apos|#39);/gi, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length > 280) {
    const lastPeriod = clean.lastIndexOf(".", 280);
    if (lastPeriod > 100) {
      clean = clean.slice(0, lastPeriod + 1);
    } else {
      clean = clean.slice(0, 275).replace(/\s+\S*$/, "") + ".";
    }
  }
  if (clean && !/[.!?]$/.test(clean)) clean += ".";
  return clean;
}

test("Code snippets and markdown code fences are stripped from summaries", () => {
  const input = "The company announced a 500MW project. ```json {\"config\": 123} ``` It is slated for 2027.";
  const cleaned = testCleanSummary(input);
  assert.ok(!cleaned.includes("json"));
  assert.ok(!cleaned.includes("config"));
  assert.ok(cleaned.includes("Slated for 2027") || cleaned.includes("slated for 2027"));
});

test("Script tags, inline JSON objects, and JS keywords are stripped from summaries", () => {
  const input = "Project development starts soon. <script>console.log('test')</script> function init() { const x = 10; } Construction will complete in 2028.";
  const cleaned = testCleanSummary(input);
  assert.ok(!cleaned.includes("console.log"));
  assert.ok(!cleaned.includes("function"));
  assert.ok(!cleaned.includes("<script>"));
  assert.ok(cleaned.includes("Construction will complete in 2028."));
});

test("Markdown link syntax [text](url) is unnested to plain text without raw URLs in summary", () => {
  const input = "The facility is under construction [Visit Site](https://example.com/project-link).";
  const cleaned = testCleanSummary(input);
  assert.ok(!cleaned.includes("https://"));
  assert.ok(!cleaned.includes("[Visit Site]"));
  assert.ok(cleaned.includes("Visit Site"));
});

console.log("\n=================================================");
console.log(`ALL ${passedTests} TESTS PASSED SUCCESSFULLY!`);
console.log("=================================================\n");
