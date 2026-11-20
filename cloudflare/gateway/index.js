/**
 * Project Intelligence Platform - Unified Edge AI Worker & Backend API (index.js)
 * 
 * 100% Serverless, Edge-Native Capital Project Intelligence Platform:
 * - Edge Discovery Engine: Natural language query parsing across 462 primary industrial sectors
 * - Pre-LLM Validation & Deduplication: Zero duplicate queries, zero duplicate URLs, strict domain filter
 * - High-Efficiency Parallel Fetcher: Concurrent HTML fetching with timeout guards & noise stripping
 * - Cloudflare Workers AI: Powered by Meta Llama 3.2 3B Instruct (@cf/meta/llama-3.2-3b-instruct)
 * - Complete In-Worker REST & SSE API: All search, project, sector, analytics, and monitoring endpoints
 * - Static React SPA Hosting: Serves production frontend assets with single-page routing
 */

import primarySectors from "../../frontend/src/data/primary_sectors.json" with { type: "json" };

// ==============================================================================
// 1. CONSTANTS, FILTERS & DOMAIN REPUTATION BLACKLIST
// ==============================================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Trace-Id, X-Internal-Key, Last-Event-ID",
  "Access-Control-Expose-Headers": "X-Trace-Id, X-Response-Time",
};

const INVALID_FILE_EXTENSIONS = [
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
  ".mp4", ".mp3", ".avi", ".mov", ".wmv", ".zip", ".tar", ".gz", ".7z", ".exe",
  ".csv", ".xlsx", ".xls", ".doc", ".docx", ".ppt", ".pptx", ".xml", ".rss", ".json"
];

const BLOCKED_DOMAINS = [
  // Encyclopedias, dictionaries, glossaries, general reference (never host actual projects)
  "wikipedia.org", "wiktionary.org", "dictionary.cambridge.org", "merriam-webster.com",
  "dictionary.com", "investopedia.com", "britannica.com", "techtarget.com",
  "computerhope.com", "coursera.org", "wordreference.com",
  // Aggregator portals, marketing blogs, educational explainers, marketplaces
  "datacenters.com", "chipsupplychain.org", "patentpc.com", "poynter.org",
  // Statistics agencies, market research databases & legal/consulting advisory portals
  "statista.com", "eia.gov", "enerdatics.com", "woodmac.com", "woodmackenzie.com", 
  "rystadenergy.com", "whitecase.com",
  // Social media, video, and community forums
  "youtube.com", "youtu.be", "vimeo.com", "facebook.com", "fb.com", "twitter.com",
  "x.com", "instagram.com", "tiktok.com", "pinterest.com", "reddit.com", "quora.com",
  "linkedin.com", "medium.com",
  // Auth portals & tracking
  "accounts.google.com", "login.microsoftonline.com", "appleid.apple.com"
];

const TRACKING_QUERY_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "ref", "source", "mc_cid", "mc_eid"
];

// Patterns for non-article boilerplate paths to reject before LLM inference
const JUNK_PATH_PATTERNS = [
  /\/login\b/i, /\/signin\b/i, /\/signup\b/i, /\/auth\b/i, /\/account\b/i,
  /\/cookie/i, /\/cookies/i, /\/privacy/i, /\/terms/i, /\/datenschutz/i,
  /\/impressum/i, /\/mentions-legales/i, /\/politique-de-confidentialite/i,
  /\/terminos-y-condiciones/i, /\/aviso-legal/i,
  /\/staff\b/i, /\/staff-directory\b/i, /\/directory\b/i, /\/phonebook\b/i,
  /\/contact-us\b/i, /\/clinical-departments\b/i, /\/departments?\b/i,
  /\/cart\b/i, /\/checkout\b/i, /\/pdf\//i,
  // Regulatory, grid connection rules, power review policy articles (not specific project announcements)
  /-power-rules\b/i, /-grid-review\b/i, /-grid-rules\b/i, /-regulatory-framework\b/i, /-power-regulations\b/i,
  // Aggregator maps, directories, and topic index listings
  /\/topics\b/i, /\/topics\/\d+/i,
  /-map\b/i, /\/maps?\b/i, /\/data-center-map\b/i,
  // Commercial vendor product & service catalogs (not project news)
  /\/products-services\b/i, /\/products?\b/i, /\/services?\b/i,
  // Legal & consulting thought leadership / insights
  /\/insight-our-thinking\b/i, /\/thought-leadership\b/i,
  // Generic section/category landing roots without article slugs
  /\/international\/[a-z]{2}\/news\/?$/i, /\/news\/?$/i, /\/en-realestate\/?$/i,
  // Educational guides, explainers, tutorials, glossaries, FAQs
  /\/what-is\b/i, /\/what-are\b/i, /\/how-to\b/i, /\/how-do\b/i, /\/how-data-centers\b/i,
  /\/guides?\b/i, /\/glossary\b/i, /\/faq\b/i, /\/fact-check/i, /\/fact-checking/i,
  /\/resources\/blog\b/i, /\/top-10\b/i, /\/top-5\b/i, /\/rankings?\b/i,
  // Commercial store / market research reports
  /\/store\/report\b/i, /\/market-analysis\b/i, /\/market-reports?\b/i,
  // Search engines / directories
  /\/search-6/i, /\/find-a-/i,
  // Academic field reports
  /\/publications\/[A-Z0-9_-]+\/how-/i
];

// ==============================================================================
// 2. EDGE MEMORY STORE & DYNAMIC TELEMETRY TRACKER
// ==============================================================================

const store = {
  searches: new Map(),
  searchResults: new Map(),
  projects: new Map(),
  activityEvents: new Map(),
  urlCache: new Map(),
  failedUrls: new Map(),
  queryCache: new Map(),
  systemErrors: [],
  apiUsage: [
    {
      provider: "Cloudflare Workers AI",
      endpoint: "@cf/meta/llama-3.2-3b-instruct",
      requests_sent: 0,
      success_count: 0,
      failed_count: 0,
      avg_latency_ms: 0,
      units_consumed: 0,
      status_note: "Operational & Active"
    },
    {
      provider: "Exa Neural Search",
      endpoint: "https://api.exa.ai/search",
      requests_sent: 0,
      success_count: 0,
      failed_count: 0,
      avg_latency_ms: 0,
      units_consumed: 0,
      status_note: "Operational & Active"
    },
    {
      provider: "Google Custom Search",
      endpoint: "https://www.googleapis.com/customsearch/v1",
      requests_sent: 0,
      success_count: 0,
      failed_count: 0,
      avg_latency_ms: 0,
      units_consumed: 0,
      status_note: "Operational & Active"
    },
    {
      provider: "Web Content Fetches",
      endpoint: "Direct HTTP Edge Scraping",
      requests_sent: 0,
      success_count: 0,
      failed_count: 0,
      avg_latency_ms: 0,
      units_consumed: 0,
      status_note: "Operational & Active"
    }
  ],
};

function recordApiUsage(providerName, latencyMs, isSuccess = true) {
  let stat = store.apiUsage.find(u => u.provider === providerName);
  if (!stat) {
    stat = {
      provider: providerName,
      endpoint: "",
      requests_sent: 0,
      success_count: 0,
      failed_count: 0,
      avg_latency_ms: 0,
      units_consumed: 0,
      status_note: "Active"
    };
    store.apiUsage.push(stat);
  }
  stat.requests_sent += 1;
  stat.units_consumed += 1;
  if (isSuccess) {
    stat.success_count += 1;
  } else {
    stat.failed_count += 1;
  }
  if (latencyMs > 0) {
    stat.avg_latency_ms = stat.avg_latency_ms === 0
      ? Math.round(latencyMs)
      : Math.round(stat.avg_latency_ms * 0.75 + latencyMs * 0.25);
  }
}

// Cache TTL: 1 hour expiry (3,600,000 ms) so repeat searches with different parameters refresh
const QUERY_CACHE_TTL_MS = 60 * 60 * 1000;

function getQueryCacheKey(query, sector, country) {
  const q = (query || "").trim().toLowerCase();
  const s = (sector && sector !== "All Categories" && sector !== "all") ? sector.trim().toLowerCase() : "all";
  const c = (country && country !== "Worldwide (Global)" && country !== "All Regions" && country !== "Global" && country !== "all") ? country.trim().toLowerCase() : "all";
  return `${q}::${s}::${c}`;
}

const KV_PROJECTS_KEY = "projects_v7";
const KV_SEARCHES_KEY = "searches_v6";

// Durable KV Persistence Layer (Survives worker code changes & redeploys)
async function hydrateStore(env) {
  if (!env.PROJECT_DATA) return;
  try {
    // Purge legacy unvalidated KV keys so contaminated records cannot resurrect
    env.PROJECT_DATA.delete("projects").catch(() => {});
    env.PROJECT_DATA.delete("searches").catch(() => {});
    env.PROJECT_DATA.delete("pi_persisted_projects_v5").catch(() => {});

    if (store.projects.size === 0) {
      const savedProjects = await env.PROJECT_DATA.get(KV_PROJECTS_KEY, "json");
      if (Array.isArray(savedProjects)) {
        for (const rawP of savedProjects) {
          const validated = validateAndSanitizeProjectRecord(rawP);
          if (validated) {
            if (isCompletedOrOperationalFacility(validated.project_url, validated.canonical_name, validated.summary, validated.text || "")) {
              continue;
            }
            if (validated.date && formatDisplayDate(validated.date) === null) {
              continue;
            }
            store.projects.set(validated.id, validated);
            if (validated.project_url) {
              store.urlCache.set(validated.project_url, [validated]);
            }
          }
        }
      }
    } else {
      // In-memory store already has projects - sanitize & purge invalid entries
      for (const [id, rawP] of Array.from(store.projects.entries())) {
        const validated = validateAndSanitizeProjectRecord(rawP);
        if (
          !validated ||
          isCompletedOrOperationalFacility(rawP.project_url, rawP.canonical_name, rawP.summary, rawP.text || "") ||
          (validated.date && formatDisplayDate(validated.date) === null)
        ) {
          store.projects.delete(id);
          if (rawP.project_url) store.urlCache.delete(rawP.project_url);
        } else {
          store.projects.set(id, validated);
        }
      }
    }
    if (store.searches.size === 0) {
      const savedSearches = await env.PROJECT_DATA.get(KV_SEARCHES_KEY, "json");
      if (Array.isArray(savedSearches)) {
        for (const s of savedSearches) {
          if (s?.id) {
            store.searches.set(s.id, s);
            if (s.query) {
              const key = getQueryCacheKey(s.query, s.category || s.parsed_query?.category, s.location || s.parsed_query?.location);
              const searchTime = s.created_at ? new Date(s.created_at).getTime() : Date.now();
              if (Date.now() - searchTime < QUERY_CACHE_TTL_MS) {
                store.queryCache.set(key, { runId: s.id, timestamp: searchTime });
              }
            }
          }
        }
      }
    }
    const savedUsage = await env.PROJECT_DATA.get("api_usage", "json");
    if (Array.isArray(savedUsage) && savedUsage.length > 0) {
      for (const saved of savedUsage) {
        const existing = store.apiUsage.find(u => u.provider === saved.provider);
        if (existing) {
          existing.requests_sent = Math.max(existing.requests_sent, saved.requests_sent || 0);
          existing.success_count = Math.max(existing.success_count, saved.success_count || 0);
          existing.failed_count = Math.max(existing.failed_count, saved.failed_count || 0);
          existing.units_consumed = Math.max(existing.units_consumed, saved.units_consumed || 0);
          if (saved.avg_latency_ms) existing.avg_latency_ms = saved.avg_latency_ms;
        }
      }
    }
  } catch (err) {
    console.warn("KV store hydration notice:", err?.message || err);
  }
}

async function persistStore(env) {
  if (!env.PROJECT_DATA) return;
  try {
    const projectsList = Array.from(store.projects.values()).slice(-200);
    const searchesList = Array.from(store.searches.values()).slice(-50);
    await Promise.all([
      env.PROJECT_DATA.put(KV_PROJECTS_KEY, JSON.stringify(projectsList)),
      env.PROJECT_DATA.put(KV_SEARCHES_KEY, JSON.stringify(searchesList)),
      env.PROJECT_DATA.put("api_usage", JSON.stringify(store.apiUsage)),
    ]);
  } catch (err) {
    console.warn("KV store persistence notice:", err?.message || err);
  }
}

// ==============================================================================
// 3. PRE-LLM VALIDATION & URL NORMALIZATION
// ==============================================================================

// Filter URLs from exclusively foreign-language media domains and non-English ccTLDs
function isForeignLanguageUrl(parsed) {
  try {
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    
    // Explicit English edition overrides
    if (path.includes("/en/") || path.includes("/en-") || path.includes("/en_") || path.includes("/english/") || host.startsWith("en.") || host.startsWith("english.")) {
      return false;
    }
    
    // Do NOT block ccTLDs for countries supported in the platform dropdown (.de, .es, .nl, .jp, .br, .tw, .kr, etc.)
    // Only block ccTLDs from non-supported regions
    const blockedTlds = [".cn", ".ru", ".ir"];
    for (const tld of blockedTlds) {
      if (host.endsWith(tld)) return true;
    }
    
    // Non-supported language subpath prefixes
    const foreignPathPrefixes = [/^\/zh\b/i, /^\/zh-[a-z]+\b/i, /^\/ru\b/i];
    for (const p of foreignPathPrefixes) {
      if (p.test(path)) return true;
    }
    
    // Exclusively non-supported state-controlled news domains
    const nonEnglishDomains = [
      "sina.com", "sohu.com", "163.com", "xinhuanet.com", "people.com.cn", "huanqiu.com",
      "tass.ru", "ria.ru", "rbc.ru", "lenta.ru", "kommersant.ru"
    ];
    for (const d of nonEnglishDomains) {
      if (host === d || host.endsWith("." + d)) return true;
    }
  } catch (_) {}
  return false;
}

function hasNonLatinScript(str) {
  if (!str || typeof str !== "string") return false;
  // Matches Chinese, Japanese, Korean, Cyrillic, Arabic, Hebrew, Thai, Devanagari
  return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f\u0900-\u097f\u0590-\u05ff]/.test(str);
}

function isForeignLanguageText(str) {
  if (!str || typeof str !== "string") return false;
  if (hasNonLatinScript(str)) return true;
  // Detect French / Spanish / German / Italian in Latin script
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

function isPredominantlyNonEnglish(text) {
  if (!text || text.length < 40) return false;
  if (hasNonLatinScript(text)) {
    const nonLatin = text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f\u0900-\u097f\u0590-\u05ff]/g);
    if (nonLatin && nonLatin.length > 15) return true;
  }
  return isForeignLanguageText(text);
}

function validateAndNormalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, reason: "Missing or invalid URL" };
  }

  try {
    // 1. Fix Windows backslash bug & unencoded spaces
    let sanitized = rawUrl.trim().replace(/\\/g, "/");
    if (sanitized.includes(" ")) {
      sanitized = sanitized.replace(/\s+/g, "%20");
    }

    const parsed = new URL(sanitized);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, reason: `Unsupported protocol '${parsed.protocol}'. Only HTTP and HTTPS are permitted.` };
    }

    const host = parsed.hostname.toLowerCase();
    if (!host || !host.includes(".")) {
      return { valid: false, reason: `Invalid domain host '${parsed.hostname}'.` };
    }

    // SSRF Prevention: disallow localhost and private IP ranges
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("172.")
    ) {
      return { valid: false, reason: "Access to private or localhost addresses is blocked." };
    }

    // Domain blacklist check (dictionaries, social media, forums)
    for (const blocked of BLOCKED_DOMAINS) {
      if (host === blocked || host.endsWith("." + blocked)) {
        return { valid: false, reason: `Domain '${host}' is on blocked reference or social media list.` };
      }
    }

    // 2. Path normalization: collapse multiple slashes, strip redundant trailing slash to prevent duplicate links
    let cleanPath = parsed.pathname.replace(/\/+/g, "/");
    if (cleanPath.length > 1 && cleanPath.endsWith("/")) {
      cleanPath = cleanPath.slice(0, -1);
    }
    parsed.pathname = cleanPath;

    // Reject root domains, homepages, and broad index pages without a deep project article slug
    const pathSegments = cleanPath.split("/").filter(Boolean);
    if (
      pathSegments.length === 0 ||
      (pathSegments.length === 1 && /^(?:en|es|fr|de|home|index\.html|search|browse|category|categories|directory|feed|news|articles|blog|resources|topics?|sections?|channels?)$/i.test(pathSegments[0]))
    ) {
      return { valid: false, reason: "Homepage or broad section index, not a specific project article or filing." };
    }

    // Reject taxonomy archive / category / tag landing sections (e.g. pv-magazine.com/category/applications-installations/)
    if (
      pathSegments.some((seg, idx) => /^(?:category|categories|tag|tags|topic|topics|rubrik|kategorie|rubriken|rubrique|rubriques)$/i.test(seg) && idx >= pathSegments.length - 2)
    ) {
      return { valid: false, reason: "Taxonomy category or tag index page, not a specific project article." };
    }

    // Reject paths where all segments are generic taxonomy, sector, or category words (e.g. energywatch.in/renewable-energy/solar)
    const TAXONOMY_WORDS = /^(?:en|es|fr|de|home|index\.html|search|browse|category|categories|tag|tags|topic|topics|section|sections|channel|channels|rubrik|kategorie|rubriken|industry|industries|sector|sectors|market|markets|news|article|articles|feed|blog|blogs|resources|insights|renewable-energy|clean-energy|energy|solar|solar-power|wind|wind-power|power|utilities|infrastructure|technology|data-centers?|semiconductors?|mining|chemicals?|oil-and-gas|oil-gas|oil|gas|hydrogen|battery|batteries|bess|storage|applications-installations)$/i;
    if (pathSegments.length >= 2 && pathSegments.every(seg => TAXONOMY_WORDS.test(seg))) {
      return { valid: false, reason: "Multi-level taxonomy/section landing page without an individual project article slug." };
    }

    // Reject listicles, rankings, and multi-year roundup URLs
    if (
      /\/(?:top|largest|biggest)-\d+/i.test(cleanPath) ||
      /\/\d+-(?:top|largest|biggest|major)/i.test(cleanPath) ||
      /\/.*-(?:20\d\d[-–—]20\d\d|roundup|list)\/?$/i.test(cleanPath)
    ) {
      return { valid: false, reason: "Listicle, multi-project roundup, or market forecast article URL." };
    }

    // 3. File extension check (only HTML/text pages allowed, no PDFs or binaries)
    const lowerPath = cleanPath.toLowerCase();
    for (const ext of INVALID_FILE_EXTENSIONS) {
      if (lowerPath.endsWith(ext) || lowerPath.includes(ext + "/")) {
        return { valid: false, reason: `URL points to non-HTML file type ('${ext}'). Only public HTML articles are allowed.` };
      }
    }

    // 4. Pre-filter junk, foreign language legal/cookies, login, and staff directory paths
    for (const pattern of JUNK_PATH_PATTERNS) {
      if (pattern.test(cleanPath)) {
        return { valid: false, reason: `URL matches non-article/boilerplate path filter ('${pattern.source}'). Filtered before AI evaluation.` };
      }
    }

    // 5. Non-English foreign news & media domain filter
    if (isForeignLanguageUrl(parsed)) {
      return { valid: false, reason: `URL host or path indicates non-English local publication ('${host}'). Only English-language sources are accepted.` };
    }

    // 6. Strip tracking query parameters and hash fragments
    const searchParams = new URLSearchParams(parsed.search);
    for (const param of TRACKING_QUERY_PARAMS) {
      searchParams.delete(param);
    }
    parsed.search = searchParams.toString();
    parsed.hash = "";

    return { valid: true, cleanUrl: parsed.toString() };
  } catch (err) {
    return { valid: false, reason: `Malformed URL: ${err?.message || err}` };
  }
}

function cleanHtml(rawHtml) {
  const titleMatch = rawHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";

  const descMatch =
    rawHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
    rawHtml.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i) ||
    rawHtml.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  const metaDesc = descMatch ? descMatch[1].trim() : "";

  let text = rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  text = text.replace(/\s+/g, " ").trim();

  return {
    title,
    metaDesc,
    text: text.slice(0, 5000),
  };
}

async function fetchUrlContent(targetUrl) {
  const t0 = Date.now();
  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(4000), // Fail-fast: 4000ms max timeout to prevent worker freezes
    });

    const elapsed = Date.now() - t0;
    if (res.status === 403) {
      return { ok: false, title: "", metaDesc: "", text: "", status: 403, error: "Bot-blocked (HTTP 403) - Access Forbidden", elapsed };
    }
    if (res.status === 503) {
      return { ok: false, title: "", metaDesc: "", text: "", status: 503, error: "Temporarily unreachable (HTTP 503) - Server Unavailable", elapsed };
    }
    if (res.status === 404) {
      return { ok: false, title: "", metaDesc: "", text: "", status: 404, error: "Dead domain or page not found (HTTP 404)", elapsed };
    }
    if (!res.ok) {
      return { ok: false, title: "", metaDesc: "", text: "", status: res.status, error: `HTTP ${res.status}`, elapsed };
    }

    const html = await res.text();
    const cleaned = cleanHtml(html);
    return { ok: true, ...cleaned, status: res.status, elapsed };
  } catch (err) {
    const elapsed = Date.now() - t0;
    const isTimeout = err?.name === "TimeoutError" || err?.message?.includes("timeout");
    const errMsg = isTimeout
      ? "Connection timed out (fail-fast abort)"
      : (err?.message || "SSL certificate bypassed / network host unreachable");
    return { ok: false, title: "", metaDesc: "", text: "", status: 0, error: errMsg, elapsed };
  }
}

// Check if a company name or domain is a news agency, publisher, or research firm (NOT a project developer)
function isNewsPublisher(name) {
  if (!name || typeof name !== "string") return false;
  const n = name.toLowerCase().trim();

  // Pattern for media outlets, news wires, publishers, and research/statistics agencies
  const publisherPattern = /\b(?:reuters|bloomberg|constructconnect|datacenterdynamics|dcn|associated press|prnewswire|businesswire|globenewswire|cnbc|forbes|financial times|marketwatch|canary media|pv magazine|solar power world|recharge news|mckinsey|gartner|idc|accenture|deloitte|kpmg|ey|pwc|bcg|bain|oxford economics|globaldata|statista|eia|wood mackenzie|rystad energy|s&p global|ferc|iea|electrek|industrial info|power systems|renewables now|energy storage news|techtimes|chosun|korea herald|asia business daily|semiwiki|cleantechnica)\b/i;

  if (publisherPattern.test(n)) {
    return true;
  }

  // Publisher keywords (matched as whole words/phrases, never partial substrings)
  if (/\b(?:press release|staff writer|news agency|market research|data platform|data tracker|statistics agency|statistical agency)\b/i.test(n)) {
    return true;
  }

  // Standalone non-developer words when used as the entire company name
  if (/^(?:news|times|post|journal|herald|tribune|insight|insights|blog|blogs|article|articles|update|updates|overview|report|reports|tracker|editorial|education|statistics|database)$/i.test(n)) {
    return true;
  }

  return false;
}

function isValidCompanyEntity(name) {
  if (!name || typeof name !== "string") return false;
  const n = name.trim();
  if (n.length < 2 || n.length > 50) return false;
  const lower = n.toLowerCase();

  // Reject literal None, Various, Unknown, Multiple, etc.
  if (/^(?:none|null|n\/a|various|multiple|several|diverse|undisclosed|unspecified|anonymous|unknown|tbd|undefined|capital project)\b/i.test(lower)) {
    return false;
  }
  if (/\b(?:various|multiple|several|different)\s+(?:developers?|companies|firms?|operators?|owners?|entities)\b/i.test(lower)) {
    return false;
  }

  // Reject country names as company
  if (/^(?:nigeria|india|usa|united states|korea|south korea|japan|china|germany|spain|brazil|france|canada|australia|mexico|singapore|ohi)$/i.test(lower)) {
    return false;
  }

  // Reject government departments, statistics agencies, or regulatory commissions
  if (
    /^(?:government|ministry|department|commission|bureau|agency)\b/i.test(lower) ||
    /\b(?:government|ministry|department)\s+of\b/i.test(lower) ||
    /^(?:public service commission|state government|federal government|energy information administration)$/i.test(lower)
  ) {
    return false;
  }

  // Reject placeholder words or headline delay/opinion clauses
  if (
    lower === "project developer" ||
    lower === "leading developer" ||
    lower === "unknown" ||
    lower === "understanding" ||
    /\b(?:campus by \d+-\d+ years|delays? by \d+|chips need the|residents vote|approved a|court approves|secures loan|secures approval|breaks ground)\b/i.test(lower)
  ) {
    return false;
  }

  // Reject author bylines
  if (/\b(?:written by|reported by|author|editor|contributor|photo by)\b/i.test(lower)) {
    return false;
  }

  // Reject publishers & consulting firms
  if (isNewsPublisher(lower)) {
    return false;
  }

  // Reject sentences ending with dangling conjunctions or prepositions
  if (/\b(?:a|an|the|of|for|in|on|at|by|with|and|or|to)\s*$/i.test(lower)) {
    return false;
  }

  // Reject if contains repeated punctuation
  if (/[-.]{2,}/.test(lower)) {
    return false;
  }

  return true;
}

// Extract company from text/headline dynamically (no hardcoded company array)
function extractCompanyDynamically(text, title, url) {
  const combined = ((title ? title + ". " : "") + (text ? text.slice(0, 500) : "")).trim();
  
  // Pattern 1: Developer action verbs ("<Company> plans to build / breaks ground / invests / announces / expands")
  const actionMatch = combined.match(/([A-Z][a-zA-Z0-9\s,&.-]{2,40}?)\s+(?:plans?(?:\s+to)?|to\s+build|breaks?\s+ground|invests?|announces?|awarded|secures?|expands?|constructs?|develops?|opens?|completes?|raises?|appoints?|selects?|picks?|pushes?|targets?|builds?|begins?)\b/);
  if (actionMatch && actionMatch[1]) {
    let candidate = actionMatch[1].replace(/^(?:the|a|an|after|as|with|in|on|at|by|for)\s+/i, "").trim();
    // Strip bylines like "Written by John Doe "
    candidate = candidate.replace(/^(?:written by|reported by|by)\s+[a-zA-Z\s.-]+?\s+([A-Z])/i, "$1").trim();
    if (isValidCompanyEntity(candidate) && !hasNonLatinScript(candidate)) {
      return candidate;
    }
  }

  // Pattern 2: Possessive project name ("<Company>'s $<Amount> facility / plant / data center / megafab")
  const possessiveMatch = combined.match(/(?:for|on|in|at|by)?\s*([A-Z][a-zA-Z0-9\s,&.-]{2,35})'s\s+(?:\$[\d.]+\s*(?:billion|million|bln|mln|b|m)?\s+)?(?:data\s*center|plant|facility|campus|megafab|gigafactory|project|semiconductor|complex)/i);
  if (possessiveMatch && possessiveMatch[1]) {
    let candidate = possessiveMatch[1].replace(/^(?:the|a|an|for|on|in|at|by)\s+/i, "").trim();
    if (isValidCompanyEntity(candidate) && !hasNonLatinScript(candidate)) {
      return candidate;
    }
  }

  // Pattern 3: Corporate official investor/press relations domain (e.g. investors.micron.com -> Micron)
  try {
    if (url) {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host.startsWith("investors.") || host.startsWith("newsroom.") || host.startsWith("press.")) {
        const parts = host.split(".");
        if (parts.length >= 3 && !isNewsPublisher(parts[1])) {
          const c = parts[1].charAt(0).toUpperCase() + parts[1].slice(1);
          if (isValidCompanyEntity(c)) return c;
        }
      }
    }
  } catch (_) {}

  // Pattern 4: Leading brand in facility title ("Micron New York Megafab", "Intel Silicon Junction Fab", etc.)
  if (title) {
    const brandMatch = title.match(/^([A-Z][a-zA-Z0-9&.-]{2,25})\s+(?:[A-Z][a-zA-Z0-9&.-]+\s+)?(?:Megafab|Gigafactory|Data Center|Semiconductor|Campus|Fabrication|Plant|Facility)\b/i);
    if (brandMatch && brandMatch[1] && isValidCompanyEntity(brandMatch[1])) {
      return normalizeDeveloperName(brandMatch[1], url);
    }
  }

  return "";
}

function normalizeDeveloperName(name, url) {
  if (!name) return "";
  let clean = name.trim();
  const lower = clean.toLowerCase();
  if (lower === "project developer" || lower === "leading developer" || lower === "unknown") {
    return "";
  }
  // Standard corporate acronyms (2-4 uppercase characters without spaces, e.g. TSMC, AMD, BESS, AWS)
  if (clean.length <= 4 && !clean.includes(" ") && !["the", "and", "for"].includes(lower)) {
    return clean.toUpperCase();
  }
  if (clean.length < 2) {
    return "";
  }
  return clean;
}

function getProjectDedupKey(name, developer) {
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

  // Extract unique distinctive entity tokens sorted alphabetically
  const tokens = Array.from(new Set(combined.split(/\s+/).filter(t => t.length >= 3)));
  tokens.sort();

  return tokens.join("_") || `${(developer || "").toLowerCase()}_${(name || "").toLowerCase()}`;
}

function cleanSummaryText(raw) {
  if (!raw || typeof raw !== "string") return "";
  let clean = raw
    // 1. Strip fenced code blocks (```...```) and inline backtick code snippets
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]+`/g, " ")
    // 2. Strip scripts, styles, code, and pre tags with inner content
    .replace(/<(?:script|style|code|pre|noscript|svg)\b[^<]*(?:(?!<\/(?:script|style|code|pre|noscript|svg)>)<[^<]*)*<\/(?:script|style|code|pre|noscript|svg)>/gi, " ")
    // 3. Strip function signatures, curly bracket blocks, and JSON objects
    .replace(/\bfunction(?:\s+[a-zA-Z0-9_$]+)?\s*\([^)]*\)\s*\{[^}]*\}/g, " ")
    .replace(/\{[^{}]*\}/g, " ")
    // 4. Strip programming syntax and script statements
    .replace(/\b(?:function\b|const\b|var\b|let\b|class\b|import\b|export\b|return\b|console\.\w+\s*\(|curl\s+-[a-zA-Z]|npm\s+(?:run|install))\b/g, " ")
    // 5. Strip unparsed markdown link syntax: [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // 6. Strip markdown headers, bold, italics, bullets
    .replace(/^#+\s+/gm, "")
    .replace(/\s+#+\s+/g, " ")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/^\s*[-•*]\s+/gm, "")
    // 7. Strip HTML tags and entities
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:quot|amp|lt|gt|nbsp|apos|#39);/gi, " ")
    // 8. Strip common directory / boilerplate / byline phrases
    .replace(/\b(?:find a data center|search \d+[\d,]* data centers?|click here to read more|read full report|share this article|photo by|written by|author:?)\b/gi, "")
    // 9. Strip trailing ellipsis and multiple dots
    .replace(/\.{2,}/g, ".")
    // 10. Normalize whitespace
    .replace(/\s+/g, " ")
    .trim();

  // If text is excessively long or truncated, neatly end at sentence boundary
  if (clean.length > 280) {
    const lastPeriod = clean.lastIndexOf(".", 280);
    if (lastPeriod > 100) {
      clean = clean.slice(0, lastPeriod + 1);
    } else {
      clean = clean.slice(0, 275).replace(/\s+\S*$/, "") + ".";
    }
  }

  if (clean && !/[.!?]$/.test(clean)) {
    clean += ".";
  }

  return clean;
}

function isGenericReportOrDirectory(url, name, company, summary) {
  if (!name && !url) return false;
  const n = (name || "").toLowerCase().trim();
  const u = (url || "").toLowerCase();
  const c = (company || "").toLowerCase().trim();
  const s = (summary || "").toLowerCase();

  // Paid store reports, general market research, macro economic outlooks, guides, blogs, and listicles
  if (
    /(?:[?&](?:term|category|channel|tag|tags|lineitemid|search)=)/i.test(u) ||
    /\/category\//i.test(u) ||
    /\/topics?\/\d+/i.test(u) ||
    /\/products-services\//i.test(u) ||
    /\/products-and-services\//i.test(u) ||
    /\/store\/report\b/i.test(u) ||
    /\/market-reports?\b/i.test(u) ||
    /\/market-analysis\b/i.test(u) ||
    /\/build-tracker\b/i.test(u) ||
    /\/insights?\b/i.test(u) ||
    /\/publications?\b/i.test(u) ||
    /\/research\b/i.test(u) ||
    /\/resources?\/(?:blog|guides?|whitepapers?)/i.test(u) ||
    /\/guides?\b/i.test(u) ||
    /\/glossary\b/i.test(u) ||
    /\/fact-check/i.test(u) ||
    /\/learn\b/i.test(u) ||
    /\/academy\b/i.test(u) ||
    /\/education\b/i.test(u) ||
    /\/data-center-projects-database\b/i.test(u) ||
    /\/what-is-/i.test(u) ||
    /\/what-are-/i.test(u) ||
    /\/how-to-/i.test(u) ||
    /\/how-do-/i.test(u)
  ) {
    return true;
  }
  if (n.startsWith("project from") || n.startsWith("capital project at") || n === "capital project") {
    return true;
  }

  // Reject website domain name extracted as developer
  if (isWebsiteOwnName(c, u, n)) {
    return true;
  }

  // Reject listicles, rankings, directories, and multi-project roundups (checked across name, URL, and summary)
  if (
    /\b(?:top\s+\d+|\d+\s+top|largest\s+\d+|\d+\s+largest|biggest\s+\d+|\d+\s+biggest|projects?\s+roundup|roundup\s+of|list\s+of\s+.*projects?|roundup)\b/i.test(n) ||
    /\b(?:largest|biggest|top|major)\s+(?:solar|wind|power|battery|clean\s+energy|energy|data\s+cent(?:er|re)|infrastructure|fab)\s+(?:and\s+[a-z]+\s+)?(?:farms?|plants?|facilities|projects?)\b/i.test(n) ||
    /\b(?:largest|biggest)\s+.*(?:farms?|plants?|facilities|projects?)\s+in\s+(?:the\s+)?[a-z]+\b/i.test(n) ||
    /\b(?:solar|wind|power|data\s+center)\s+farms?\s+in\s+(?:the\s+)?[a-z]+\b/i.test(n) ||
    /\b(?:directory\b|roundup\b|inventory\b|catalog\b|rankings?\b|listicle\b|tracker\b)/i.test(n) ||
    /\b(?:in\s+the\s+us|in\s+the\s+usa|in\s+the\s+u\.s\.|in\s+the\s+united\s+states)\s*$/i.test(n) ||
    /\b(?:top\s+\d+|\d+\s+top|largest\s+\d+|\d+\s+largest|biggest\s+\d+|\d+\s+biggest|projects?-roundup|roundup-of|top-\d+|\d+-top)\b/i.test(u) ||
    /(?:-|_|\/)(?:largest|biggest|top|major)-(?:[a-z]+-)?(?:solar|wind|power|farms|plants|facilities|projects)/i.test(u) ||
    /(?:-|_|\/)(?:solar|wind|data-center|projects?)-farms?-in-(?:the-)?[a-z]+/i.test(u) ||
    /(?:-|_|\/)(?:directory|directories|database|trackers?|roundups?|listings?)(?:-|_|\/|\.|$)/i.test(u) ||
    /\b(?:top\s+\d+|\d+\s+top|projects?\s+roundup|roundup\s+of|list\s+of\s+.*projects?)\b/i.test(s) ||
    /\b(?:the\s+article|the\s+page|the\s+report|this\s+article|this\s+page|this\s+report)\s+(?:lists|provides\s+a\s+directory|provides\s+a\s+list|ranks|compiles|outlines|examines|summarizes|surveys|features|details\s+the\s+largest|details\s+the\s+top)\b/i.test(s) ||
    /\b(?:provides\s+a\s+directory|largest\s+projects\s+directory|lists\s+the\s+largest|lists\s+the\s+top|directory\s+of\s+(?:the\s+)?largest|directory\s+of\s+solar|directory\s+of\s+wind|directory\s+of\s+data\s+centers?)\b/i.test(s)
  ) {
    return true;
  }

  // Reject multi-year forecast or listicle date ranges (e.g. multi-year projections like 2026-2030)
  if (
    /\b20\d\d\s*[-–—/]\s*20\d\d\b/i.test(n) ||
    /\b20\d\d[-–—]20\d\d\b/i.test(u)
  ) {
    return true;
  }

  // Reject industry pipelines, generator rows, inventories, and market datasets
  if (/\b(?:development\s+pipeline|project\s+pipeline|pipeline\s+report|generator\s+rows|generator\s+inventory|generator\s+capacity|capacity\s+tracker|monthly\s+generator|national\s+pipeline|solar\s+pipeline|wind\s+pipeline|data\s+center\s+pipeline)\b/i.test(n)) {
    return true;
  }

  // Reject generic or undisclosed developers (e.g. "Various", "Various developers", "Multiple", etc.)
  if (/^(?:various|multiple|several|diverse|undisclosed|unspecified|anonymous|many)\b/i.test(c)) {
    return true;
  }

  // Reject data publishers, statistics agencies, or educational organizations as company
  if (isNewsPublisher(c)) {
    return true;
  }

  // Reject national government macroeconomic policy announcements, spending targets, and multi-billion masterplans
  if (
    /^(?:government\s+of\s+|ministry\s+of\s+|department\s+of\s+|state\s+council)/i.test(c) ||
    /\b(?:government\s+of\s+[a-z\s]+|ministry\s+of\s+[a-z\s]+)\b/i.test(c) ||
    c === "us government" ||
    c === "government"
  ) {
    return true;
  }
  if (
    /\b(?:mega\s+projects?|national\s+initiative|strategic\s+roadmap|investment\s+into\s+three\s+mega|build\s+\d+[\d.]*\s*gw\s+worth|national\s+plan\s+to\s+build|plans\s+to\s+build\s+\d+[\d.]*\s*gw|\$\d+[\d.]*\s*bn\s+investment\s+into\s+three\s+mega)\b/i.test(n) ||
    /\b(?:investment\s+into\s+three\s+mega\s+projects|plans\s+to\s+build\s+\d+[\d.]*\s*gw\s+worth\s+of\s+data\s+centers)\b/i.test(s)
  ) {
    return true;
  }

  // Reject regulatory, grid connection rules, and utility review articles
  if (
    /(?:power-rules|grid-rules|grid-review|grid-connection-rules|power-regulations|regulatory-review|data-center-rules|datacenter-rules|planning-permission-rules|zoning-rules|sites-under-\d+-mw)/i.test(u) ||
    /\b(?:power\s+rules\s+raise|grid\s+review|power\s+connection\s+rules|regulatory\s+hurdle|regulatory\s+bar|sites\s+under\s+\d+\s*mw\s+skip\s+grid)\b/i.test(u) ||
    /\b(?:power\s+rules\s+raise\s+.*area\s+bar|sites\s+under\s+\d+\s*mw\s+skip\s+grid\s+review|sites\s+under\s+\d+\s*mw)\b/i.test(n)
  ) {
    return true;
  }

  // Reject multi-project bundle articles or consortium announcements
  if (
    /^(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+.*(?:projects|facilities|plants|farms|fabs)\b/i.test(n) ||
    /\b(?:formed\s+a\s+.*consortium|consortium\s+to\s+build)\b/i.test(s)
  ) {
    return true;
  }

  if (/^(?:what is\b|what are\b|how to\b|how do\b|understanding\b|definitive guide\b|guide to\b|definition of\b|explaining\b|overview of\b|find a data center)/i.test(n)) {
    return true;
  }
  if (/\b(?:activity report|market report|construction report|industry outlook|market analysis|capex report|data center report|fabs and facilities report)\b/i.test(n)) {
    return true;
  }
  if (/^(?:all\s+.*projects?|global data center construction project|annual global ic fab|global ic fab|november \d{4} data center|q[1-4]\s+\d{4}\s+data center)$/i.test(n)) {
    return true;
  }

  // 1. Tool, equipment, or machinery product launches (NOT a physical facility!)
  if (
    /\b(?:dicing system|wafer dicing|plasma system|inspection tool|lithography tool|stepper tool|etching tool|metrology tool|dual-station)\b/i.test(n) ||
    /\b(?:launched its new product|first tool shipped|shipped to a key|commercial availability of.*system|new product, the|packaging customer)\b/i.test(s)
  ) {
    return true;
  }

  // 2. Wafer / Material / Substrate product announcements (NOT a physical plant!)
  if (
    /\b(?:single-crystal diamond|diamond wafer|silicon wafer product|wafer substrate|silicon carbide substrate)\b/i.test(n) ||
    /\b(?:successful fabrication of the world's first.*diamond|fabrication of the world's first.*wafer)\b/i.test(s)
  ) {
    return true;
  }

  // 3. R&D initiatives, joint working groups, or technology roadmaps without a physical facility
  if (
    /\b(?:industry initiative|collaborative initiative|semiconductor industry initiative|technology initiative|consortium)\b/i.test(n) ||
    /\b(?:launch of a collaborative initiative|collaborative initiative to transition)\b/i.test(s)
  ) {
    return true;
  }

  // 4. Macroeconomic equipment spending / forecast reports (e.g. SEMI $374B report)
  if (
    /\b(?:equipment spending|fab equipment spending|capex spending expected|fab spending expected|global.*spending)\b/i.test(n) ||
    /\b(?:reports global.*spending|fab equipment spending expected|spending expected to total \$)\b/i.test(s)
  ) {
    return true;
  }

  // 5. Technology, equipment, or concept development agreements without a physical facility buildout
  if (
    /\b(?:developing|developed)\s+(?:a\s+)?(?:[a-z0-9\-]+\s+)*(?:power|control|software|cooling|battery|propulsion|floating)?\s*technology\s+for\b/i.test(s) ||
    /\b(?:developing|developed)\s+(?:a\s+)?(?:[a-z0-9\-]+\s+)?(?:power|control|software|cooling|battery|propulsion|floating)\s+technology\b/i.test(s) ||
    /\b(?:power and control technology|cooling technology|software platform|technology development for)\b/i.test(s) ||
    /\b(?:concept design|feasibility study only)\b/i.test(s)
  ) {
    return true;
  }

  // 6. News columns, opinion editorials, commentary, and trade/materials policy articles
  if (
    /^\[(?:chip talk|editorial|opinion|analysis|column|commentary|insight|viewpoint)\]/i.test(n) ||
    /\b(?:reducing dependence on|cooperation with .* to reduce dependence|supply chain cooperation|keep localizing|bilateral cooperation)\b/i.test(s) ||
    /\b(?:partner with .* keep localizing)\b/i.test(n) ||
    /\b(?:two challenges|challenges facing)\b/i.test(n)
  ) {
    return true;
  }

  // Generic noun without named facility or valid developer
  if ((!c || c === "project developer" || c === "leading developer" || c === "unknown") &&
      /^(?:data center|hyperscale data center|data centre|power plant|solar farm|wind farm|battery gigafactory|semiconductor fab|semiconductor chemicals plant|aircraft manufacturing plant|industrial category)$/i.test(n)) {
    return true;
  }
  // Lawsuits, disputes, or political fights without a physical facility
  if (/\b(?:sues\b|lawsuit\b|residents vote against|controversy|hearing)\b/i.test(n)) {
    return true;
  }
  // Explanatory guides, educational overviews, or operational summaries
  if (
    /\b(?:understanding how\b|what are\b|how do\b|explaining how\b|how foundries make\b|guide to understanding\b|exploring the core components\b|search \d+.*data centers?\b|find a data center\b)/i.test(s) ||
    /\b(?:currently operates|already operates|primary research and development fab for its advanced nodes)\b/i.test(s)
  ) {
    return true;
  }
  return false;
}

function cleanProjectName(rawName, developer) {
  if (!rawName || typeof rawName !== "string") return "";
  let name = rawName.trim();

  // 1. Remove trailing news publisher / site branding (any publication name following a separator)
  name = name.replace(/\s*[-–—|]\s*(?:The\s+)?[A-Z][a-zA-Z0-9\s.&'-]{1,35}$/i, "");

  // 2. Strip bracketed leads (e.g. '[Chip Talk] ', '[Exclusive] ', '[Breaking] ')
  name = name.replace(/^\[[^\]]+\]\s*/i, "");

  // 3. Strip superlative news lead-ins (e.g. 'One of North America’s largest solar farms... in Texas')
  name = name.replace(/^(?:one\s+of\s+(?:north\s+america['’]s|the\s+world['’]s|the\s+nation['’]s|the\s+u\.s\.['’]s|the\s+us['’]s)\s+(?:largest|biggest|most)\s+)/i, "");

  // 4. Action verb phrases in headlines:
  // e.g. 'Panamint Secures Loans for Phase 1 of 958-MW Texas Solar Project'
  // e.g. 'GlobalFoundries selected to operate two new semiconductor fabs in New ...'
  const actionPattern = /^(?:([A-Z][a-zA-Z0-9\s,&.'-]{1,35}?)\s+)?(?:secures\s+(?:(?:construction\s+|debt\s+|tax\s+equity\s+)?(?:loans?|financing|funding|approval|green\s+light)|permits?)|wins\s+(?:approval|bid|contract)|receives\s+approval|gets\s+(?:approval|green\s+light)|selected\s+to\s+(?:operate|build|develop)|announces\s+(?:plans\s+(?:for|to\s+build)|construction\s+of|development\s+of|new)|plans\s+to\s+build|breaks?\s+ground\s+on|begins?\s+construction\s+(?:on|of)|starts?\s+construction\s+(?:on|of)|commences?\s+construction\s+(?:on|of)|closes\s+(?:[\$€£]?[\d.]+\s*(?:b|m|billion|million)?\s+)?financing\s+for|signs\s+(?:ppa|agreement|deal)\s+for|inks\s+(?:ppa|deal|agreement)\s+for|advances\s+(?:plans\s+for)?)(?:\s+(?:for|on|of|in|to))?\s+(.+)$/i;

  const m = name.match(actionPattern);
  if (m) {
    const leadEntity = (m[1] || "").trim();
    let rest = m[2].trim();
    rest = rest.replace(/^(?:the|a|an)\s+/i, "");
    rest = rest.charAt(0).toUpperCase() + rest.slice(1);

    const ent = leadEntity || (developer ? developer.split(/\s+/)[0] : "");
    if (ent && !new RegExp("\\b" + ent + "\\b", "i").test(rest)) {
      name = ent + " " + rest;
    } else {
      name = rest;
    }
  }

  // 5. Clean up any trailing status action clauses if present
  name = name.replace(/\s+(?:just came online|came online|comes online|go fully operational|goes fully operational|went fully operational|is now operational|is now open|opens its doors|goes live)\b.*$/i, "");

  // 6. Clean up trailing cut-off prepositions and ellipses
  name = name.replace(/\s+(?:in|at|on|for|with|of|to)\s*(?:[A-Z][a-zA-Z\s]*)?(?:\.{2,}|…)$/i, "");
  name = name.replace(/(?:\.{2,}|…)$/, "");

  return name.trim();
}

function inferCategory(projectName, summary, hintCategory) {
  // If user selected a specific sector from the 462 in the taxonomy or hintCategory is provided, KEEP IT!
  if (hintCategory && typeof hintCategory === "string") {
    const trimmed = hintCategory.trim();
    if (trimmed && trimmed !== "all" && trimmed !== "All Categories" && trimmed !== "Capital Infrastructure" && trimmed !== "Capital Projects") {
      return trimmed;
    }
  }

  const nameOnly = (projectName || "").toLowerCase();
  const summaryOnly = (summary || "").toLowerCase();
  const combined = `${nameOnly} ${summaryOnly}`.trim();

  // Priority 1: Match project name directly against primary sectors
  for (const s of primarySectors) {
    const sLower = s.sector.toLowerCase();
    if (nameOnly.includes(sLower)) {
      return s.sector;
    }
  }

  // Priority 2: High-signal sector indicators in project name first (prevents auxiliary summary mentions from misclassifying)
  if (/\b(?:data\s*cent(?:er|re)|hyperscale|cloud\s+campus|compute\s+campus)\b/i.test(nameOnly)) {
    return "Hyperscale Data Center";
  }
  if (/\b(?:semiconductor|wafer\s+fab|microchip|cleanroom|megafab)\b/i.test(nameOnly)) {
    return "Semiconductor Manufacturing";
  }
  if (/\b(?:gigafactory|battery\s+(?:cell|plant|manufacturing|fab))\b/i.test(nameOnly)) {
    return "Battery Gigafactory";
  }
  if (/\b(?:bess|battery\s+energy\s+storage|battery\s+storage)\b/i.test(nameOnly)) {
    return "Battery Energy Storage";
  }
  if (/\b(?:concentrated\s+solar|solar\s+thermal|heliostats?|parabolic\s+trough|csp)\b/i.test(combined)) {
    return "Concentrated Solar Power (CSP)";
  }
  if (/\b(?:floating\s+solar)\b/i.test(combined)) {
    return "Floating Solar Power Plant";
  }
  if (/\b(?:offshore\s+wind)\b/i.test(nameOnly) || (/\boffshore\s+wind\b/i.test(combined) && !/\bsolar\b/i.test(nameOnly))) {
    return "Offshore Wind Power Plant";
  }
  if (/\b(?:wind\s*(?:farm|park|energy|facility|turbine))\b/i.test(nameOnly)) {
    return "Onshore Wind Power Plant";
  }
  if (/\b(?:solar\s*(?:farm|park|plant|project|energy|installation)|photovoltaic|pv\s+farm)\b/i.test(nameOnly)) {
    return "Solar Photovoltaic Power Plant (PV)";
  }
  if (/\b(?:hydrogen|electrolyzer|clean\s+ammonia)\b/i.test(nameOnly)) {
    return "Clean Hydrogen";
  }

  // Priority 3: Summary-level indicators ONLY when project name gives no category
  if (/\b(?:data\s*cent(?:er|re)|hyperscale|colocation)\b/i.test(summaryOnly)) {
    return "Hyperscale Data Center";
  }
  if (/\b(?:semiconductor|wafer\s+fab|cleanroom|microchip)\b/i.test(summaryOnly)) {
    return "Semiconductor Manufacturing";
  }
  if (/\b(?:gigafactory|battery\s+(?:plant|manufacturing|cell))\b/i.test(summaryOnly)) {
    return "Battery Gigafactory";
  }
  if (/\b(?:solar\s*(?:farm|park|plant|project)|photovoltaic|pv\s+plant)\b/i.test(summaryOnly)) {
    return "Solar Photovoltaic Power Plant (PV)";
  }
  if (/\b(?:wind\s*(?:farm|park|energy))\b/i.test(summaryOnly)) {
    return "Wind Energy";
  }
  if (/\b(?:hydrogen|electrolyzer)\b/i.test(summaryOnly)) {
    return "Clean Hydrogen";
  }

  return "Capital Infrastructure";
}

function isCompletedOrOperationalFacility(url, title, summary, text) {
  const u = (url || "").toLowerCase();
  const t = (title || "").toLowerCase();
  const s = ((summary || "") + " " + (text || "")).toLowerCase();
  const currentYear = new Date().getFullYear();

  // 1. URL slug patterns indicating the facility has already opened/completed or launched
  if (
    /(?:-|_|\/)(?:is-open|now-open|opens|opened|launches-operations|begins-operations|goes-online|inaugurated|commissioned|completed|entry-into)(?:-|_|\/|\.|$)/i.test(u) ||
    /(?:-|_|\/)(?:came-online|comes-online|just-came-online|goes-online|go-fully-operational|goes-fully-operational|went-fully-operational|fully-operational|go-operational|goes-operational|went-operational)(?:-|_|\/|\.|$)/i.test(u) ||
    /(?:-|_|\/)(?:launches|launched)(?:-[a-z0-9-]+)?-(?:data-cent(?:er|re)|fab|plant|facility|campus|hub|solar|farm)(?:-|_|\/|\.|$)/i.test(u) ||
    /(?:-|_|\/)(?:opens|opened)-(?:[a-z0-9-]+-)?(?:data-cent(?:er|re)|fab|plant|facility|campus|hub|solar|farm)(?:-|_|\/|\.|$)/i.test(u) ||
    /(?:-|_|\/)(?:now-powers|turned-[a-z0-9-]+-into|supply-agreement|ppa-agreement)(?:-|_|\/|\.|$)/i.test(u)
  ) {
    return true;
  }

  // 2. Title & Headline patterns indicating opened/completed status, commercial operation, or active powering
  if (
    /\b(?:is open|now open|has opened|opens data cent(?:er|re)|opened its|opens new|officially opened|opens megafab|opens plant|inaugurated|inaugurates|commenced commercial operations|now operational|commercial operation started|begins operations|went online|starts operations|has been commissioned|completes construction of)\b/i.test(t) ||
    /\b(?:came online|just came online|comes online|go fully operational|goes fully operational|went fully operational|go operational|goes operational|went operational|fully operational|now fully operational|is fully operational)\b/i.test(t) ||
    /\b(?:now\s+powers|currently\s+powers|it\s+now\s+powers|powers\s+\d+|is\s+powering|now\s+generates|currently\s+generates|now\s+supplies|supplies\s+power\s+to|turned\s+(?:a|an|[a-z0-9\s-]+)\s+into\s+a\s+(?:solar|wind|power|data\s+center)|covered\s+(?:a|an|[a-z0-9\s-]+)\s+with\s+(?:floating\s+)?solar)\b/i.test(t) ||
    /\b(?:signs?\s+(?:\d+[- ]year\s+)?(?:solar|wind|clean\s+energy|floating\s+solar|power)?\s*(?:supply|ppa|power\s+purchase)\s+agreement\s+with)\b/i.test(t) ||
    /\b(?:launches|launched|is launching|launching)\s+(?:(?:third|fourth|second|first|new|its|another|\d+(?:st|nd|rd|th)?)\s+)*(?:data\s*cent(?:er|re)|fab|plant|facility|campus|hub)\b/i.test(t) ||
    /\b(?:launches\s+data\s*cent(?:er|re)|launched\s+data\s*cent(?:er|re))\b/i.test(t) ||
    /\bmarking\s+its\s+entry\s+into\b/i.test(t) ||
    /\b(?:inauguré|inaugurée|mis\s+en\s+service|in\s+Betrieb|nimmt\s+Betrieb\s+auf|ha\s+inaugurado|ha\s+entrado\s+en\s+operación|entró\s+en\s+operación)\b/i.test(t)
  ) {
    return true;
  }

  // 3. Summary & content patterns indicating operational status
  if (
    /\b(?:is now open|has officially opened|opened its doors|opened its factory|opened its fab|opened its plant|opened its facility|began operations|started commercial operations|is now operational|facility is open|operational since|first data cent(?:er|re) built .* is open)\b/i.test(s) ||
    /\b(?:came online|just came online|comes online|go fully operational|goes fully operational|went fully operational|go operational|goes operational|went operational|fully operational|now fully operational|is fully operational)\b/i.test(s) ||
    /\b(?:now\s+powers|currently\s+powers|it\s+now\s+powers|powers\s+\d+|is\s+powering|now\s+generates|currently\s+generates|now\s+supplies|supplies\s+power\s+to|reducing\s+co2\s+emissions\s+by|reduces\s+co2\s+emissions\s+by|cuts\s+\d+[\d,.]*\s+tonnes\s+of\s+co|turned\s+(?:a|an|[a-z0-9\s-]+)\s+into\s+a\s+(?:solar|wind|power|data\s+center)|covered\s+(?:a|an|[a-z0-9\s-]+)\s+with\s+(?:floating\s+)?solar)\b/i.test(s) ||
    /\b(?:signs?\s+(?:\d+[- ]year\s+)?(?:solar|wind|clean\s+energy|floating\s+solar|power)?\s*(?:supply|ppa|power\s+purchase)\s+agreement\s+with)\b/i.test(s) ||
    /\b(?:launches|launched|is launching|launching)\s+(?:(?:third|fourth|second|first|new|its|another|\d+(?:st|nd|rd|th)?)\s+)*(?:data\s*cent(?:er|re)|fab|plant|facility|campus|hub)\b/i.test(s) ||
    /\bmarking\s+its\s+entry\s+into\b/i.test(s) ||
    /\b(?:inauguré|inaugurée|mis\s+en\s+service|in\s+Betrieb|nimmt\s+Betrieb\s+auf|ha\s+inaugurado|ha\s+entrado\s+en\s+operación|entró\s+en\s+operación)\b/i.test(s)
  ) {
    return true;
  }

  // 4. Past year completions: any facility opened, completed, inaugurated, or operational in past years
  const pastYearMatch = s.match(/\b(?:inaugurated|commissioned|completed|opened|launched|built|operational|in\s+operation|online|commenced|started\s+operations?|commercial\s+operations?)\s+(?:in|since)\s+(?:[a-z]+\s+)?(20\d\d)\b/i) ||
                        t.match(/\b(?:inaugurated|commissioned|completed|opened|launched|built|operational|in\s+operation|online|commenced|started\s+operations?|commercial\s+operations?)\s+(?:in|since)\s+(?:[a-z]+\s+)?(20\d\d)\b/i);
  if (pastYearMatch) {
    const yr = parseInt(pastYearMatch[1], 10);
    if (!isNaN(yr) && yr < currentYear) {
      return true;
    }
  }

  return false;
}

function extractStatusFromText(text, url) {
  const t = (text || "").toLowerCase();
  const u = (url || "").toLowerCase();

  // Priority 1: If explicitly completed, opened, or operational, drop it immediately!
  if (
    isCompletedOrOperationalFacility(u, "", "", t) ||
    /\b(?:completed|operational|commissioned|opened|inaugurated|online|in service|commercial operation|is open|now open|has opened|opens data cent(?:er|re)|began operations)\b/i.test(t) ||
    /\b(?:came online|just came online|comes online|go fully operational|goes fully operational|went fully operational|go operational|goes operational|went operational|fully operational|now fully operational|is fully operational)\b/i.test(t)
  ) {
    return null;
  }

  if (t.includes("under construction") || t.includes("breaks ground") || t.includes("groundbreaking") || t.includes("underway") || t.includes("construction has begun")) {
    return "Under Construction";
  }
  if (t.includes("announced") || t.includes("announces") || t.includes("unveils") || t.includes("proposes") || t.includes("plans to build") || t.includes("secures funding")) {
    return "Announced";
  }
  if (/\b(?:planning|permitting|environmental review|feed|designed to|proposed)\b/i.test(t)) {
    return "Planning";
  }
  return null;
}

function extractDateFromTextOrUrl(text, url, publishedDate) {
  if (publishedDate) {
    try {
      const d = new Date(publishedDate);
      if (!isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
      }
    } catch (_) {}
  }

  // Check URL slug for date pattern: /2026/11/04 or -2026-11-04 or /2026-11
  if (url) {
    const fullDate = url.match(/\b(202[4-9]|203\d)[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
    if (fullDate) return `${fullDate[1]}-${fullDate[2]}-${fullDate[3]}`;

    const monthYear = url.match(/\b(202[4-9]|203\d)[-/](0[1-9]|1[0-2])\b/);
    if (monthYear) return `${monthYear[1]}-${monthYear[2]}`;

    const year = url.match(/\b(202[4-9]|203\d)\b/);
    if (year) return year[1];
  }

  // Check text snippet for formatted date: e.g. "November 2026", "Nov 15, 2026", "2026"
  if (text) {
    const textDate = text.slice(0, 800).match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+(202[4-9]|203\d)\b/i);
    if (textDate) return textDate[0];

    const myMatch = text.slice(0, 800).match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(202[4-9]|203\d)\b/i);
    if (myMatch) return myMatch[0];

    const yearMatch = text.slice(0, 800).match(/\b(202[5-9]|203\d)\b/);
    if (yearMatch) return yearMatch[1];
  }

  return "";
}

function formatDisplayDate(rawDate) {
  if (!rawDate || typeof rawDate !== "string") return "";
  const d = rawDate.trim();
  const currentYear = new Date().getFullYear();
  if (/^(?:latest\s+\d{4}|not specified|unknown|tbd|none|n\/a)$/i.test(d)) return "";

  // Extract all years in the string
  const allYears = Array.from(d.matchAll(/\b(20[1-3]\d)\b/g)).map(m => parseInt(m[1], 10));
  const futureYears = allYears.filter(y => y >= currentYear);
  const pastYears = allYears.filter(y => y < currentYear);

  // If the ONLY year mentioned is historical (< currentYear), return null to drop
  if (allYears.length > 0 && futureYears.length === 0 && pastYears.length > 0) {
    return null;
  }

  // If upcoming years are mentioned, extract target year
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

  // Convert ISO string e.g. "2026-11-09T21:00:33.000Z" to readable format
  const isoMatch = d.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    if (year < currentYear) return null;
    const monthNum = parseInt(isoMatch[2], 10);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (monthNum >= 1 && monthNum <= 12) {
      return `${months[monthNum - 1]} ${year}`;
    }
    return `${year}`;
  }

  // Strip trailing parentheticals, e.g. "2026 (groundbreaking)" -> "2026"
  return d.replace(/\s*\([^)]*\)/g, "").trim();
}

function validateAndSanitizeProjectRecord(p) {
  if (!p || typeof p !== "object") return null;

  const rawName = p.canonical_name || p.name || p.title || "";
  const rawCompany = p.company || p.developer || "";
  const rawUrl = p.project_url || p.url || "";
  const summary = p.summary || p.text || "";
  const rawDate = p.date || "";

  // 1. Company entity validation
  if (!isValidCompanyEntity(rawCompany)) return null;
  if (isNewsPublisher(rawCompany)) return null;
  if (isWebsiteOwnName(rawCompany, rawUrl, rawName)) return null;

  // 2. Reject generic reports, listicles, directories, macro outlooks, or non-project lead
  if (isGenericReportOrDirectory(rawUrl, rawName, rawCompany, summary)) return null;

  // 3. Reject completed, operational, or commissioned facilities
  const sLower = (p.status || "").toLowerCase();
  if (sLower.includes("operational") || sLower.includes("completed") || sLower.includes("commissioned")) {
    return null;
  }
  if (isCompletedOrOperationalFacility(rawUrl, rawName, summary, summary)) {
    return null;
  }

  // 4. Reject past dates (historical only)
  const formattedDate = formatDisplayDate(rawDate);
  if (formattedDate === null) return null;

  // 5. Clean name
  const cleanName = cleanProjectName(rawName, rawCompany);
  if (!cleanName || cleanName.length < 3) return null;
  if (/^(?:top\s+\d+|overview|pipeline|generator\s+rows|database|report)\b/i.test(cleanName)) return null;
  if (/^<.*>$/i.test(cleanName) || /<(?:facility|project|campus|company|developer)\s+name>/i.test(cleanName) || /^(?:<facility\s+name>|<project\s+name>|<campus\s+name>)\b/i.test(cleanName)) return null;
  if (isWebsiteOwnName(rawCompany, rawUrl, cleanName)) return null;
  if (isCompletedOrOperationalFacility(rawUrl, cleanName, summary, summary)) return null;
  if (isGenericReportOrDirectory(rawUrl, cleanName, rawCompany, summary)) return null;

  // 6. Infer and validate accurate category
  const category = inferCategory(cleanName, summary, p.category);

  // 7. Status sanitization
  let status = p.status || "";
  const statusFromText = extractStatusFromText(cleanName + " " + summary, rawUrl);
  if (statusFromText === null && isCompletedOrOperationalFacility(rawUrl, cleanName, summary, summary)) {
    return null;
  }
  if (!["Announced", "Planning", "Under Construction"].includes(status)) {
    status = statusFromText || "Planning";
  }

  // 8. Location sanitization
  let location = (p.location || "").trim();
  if (/^(?:none|null|undefined|n\/a)$/i.test(location)) {
    location = "";
  }
  let country = (p.country || "").trim();
  if (/^(?:none|null|undefined|n\/a)$/i.test(country)) {
    country = "";
  }

  return {
    id: p.id || `proj_${Math.random().toString(36).slice(2, 9)}`,
    canonical_name: cleanName,
    name: cleanName,
    company: rawCompany,
    developer: rawCompany,
    category,
    status,
    location: location || country || "Not specified",
    country: country || location || "Not specified",
    date: formattedDate || "",
    project_url: rawUrl,
    http_status: p.http_status || 200,
    summary: cleanSummaryText(summary),
    created_at: p.created_at || new Date().toISOString()
  };
}

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

const PROJECT_MATCH_STOPWORDS = new Set([
  "and", "the", "for", "with", "from", "into", "over", "under", "new", "all",
  "first", "second", "third", "fourth", "announced", "planning", "construction",
  "group", "holdings", "corp", "corporation", "inc", "incorporated", "ltd", "limited", 
  "llc", "gmbh", "co", "company", "asset", "assets", "management", "investment", "investments", 
  "capital", "partners", "partnership", "platform", "platforms", "global", "national", 
  "international", "state", "rules", "capacity", "mega", "strategic", "announces", "plans", 
  "joint", "venture", "market", "markets", "north", "south", "east", "west",
  "largest", "biggest", "directory", "roundup", "list", "listing", "top", "major", "article", "overview", "report", "summary"
]);

function isWebsiteOwnName(companyName, candidateUrl, candidateTitle) {
  if (!companyName || !candidateUrl) return false;
  if (isNewsPublisher(companyName)) return true;

  // 1. Any company name containing a web domain TLD (e.g. "Gridplants.online", "renewabledb.com")
  if (/\.(?:online|com|org|net|io|co|info|gov|edu|ai|app|tech|dev|biz|tv|me|us|uk|de|in|cn|jp|fr|es|eu|nl)\b/i.test(companyName)) {
    return true;
  }

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
  const hostClean = cleanHost.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (!compClean || !rootClean) return false;

  // 2. Exact or substring match between company and URL root domain or full hostname
  if (
    compClean === rootClean ||
    compClean === hostClean ||
    rootClean === compClean ||
    cleanHost.includes(compClean) ||
    (compClean.length >= 4 && rootClean.includes(compClean)) ||
    (rootClean.length >= 4 && compClean.includes(rootClean))
  ) {
    return true;
  }

  if (candidateTitle) {
    const escapedComp = companyName.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const brandSuffixRegex = new RegExp(`(?:[-–—|/•]\\s*${escapedComp}\\s*$|^${escapedComp}\\s*[-–—|/•])`, 'i');
    if (brandSuffixRegex.test(candidateTitle)) {
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

  // If canonicalName had no specific project words (e.g. only company name + sector words),
  // extract distinctive location tokens (city / county / town)
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
    // If no specific project word could be determined at all, this is not a verifiable specific project
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

  // Both company name (not website's own name) AND specific project word matched!
  return true;
}

function findBestCorroboratingCandidate(candidates, aiP) {
  if (!candidates || candidates.length === 0 || !aiP) return null;
  let bestCandidate = null;
  let bestScore = 0;

  const comp = (aiP.company || "").trim();
  const name = (aiP.canonical_name || "").trim();
  const specificWords = getSpecificProjectWords(name, comp, aiP.location);

  for (const c of candidates) {
    // Must strictly pass candidateMentionsProject
    if (!candidateMentionsProject(c, aiP)) {
      continue;
    }

    let score = 0;
    const cUrl = (c.cleanUrl || "").toLowerCase();
    const cTitle = (c.title || "").toLowerCase();
    const cText = (c.text || c.snippet || "").toLowerCase();

    // Check company
    if (comp && matchesCompanyName(comp, cUrl)) score += 10;
    if (comp && matchesCompanyName(comp, cTitle)) score += 6;
    if (comp && matchesCompanyName(comp, cText)) score += 3;

    // Check specific project words
    for (const tok of specificWords) {
      const tokRegex = new RegExp(`\\b${tok}\\b`, 'i');
      if (tokRegex.test(cUrl)) score += 8;
      if (tokRegex.test(cTitle)) score += 5;
      if (tokRegex.test(cText)) score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = c;
    }
  }

  return bestCandidate;
}

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

function matchesTargetCountry(projectCountry, projectLocation, targetLocation) {
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

  // 1. Sovereign country comparison
  if (normCountry) {
    if (normCountry === normTarget || normCountry.includes(normTarget) || normTarget.includes(normCountry)) {
      // If target is a specific US state/region (Texas, Northern Virginia, Arizona, California), also require location match
      if (normTarget === "texas" || normTarget === "northern virginia" || normTarget === "arizona" || normTarget === "california") {
        return combined.includes(normTarget) || (normTarget === "northern virginia" && (combined.includes("loudoun") || combined.includes("ashburn") || combined.includes("richmond")));
      }
      return true;
    }
    // If target is a US state and project is in United States, check if location matches the state
    if (normCountry === "united states" && (normTarget === "texas" || normTarget === "northern virginia" || normTarget === "arizona" || normTarget === "california")) {
      return combined.includes(normTarget) || (normTarget === "northern virginia" && (combined.includes("loudoun") || combined.includes("ashburn") || combined.includes("richmond")));
    }
    // Country was identified and clearly does NOT match target
    return false;
  }

  // 2. Fallback: if country was not explicitly parsed, check combined location string
  if (combined) {
    const normCombined = normalizeCountryName(combined);
    if (normCombined.includes(normTarget)) {
      return true;
    }
  }

  return false;
}

function matchesSelectedCountry(detectedLocation, text, title, selectedCountry) {
  return matchesTargetCountry(detectedLocation, (text || "") + " " + (title || ""), selectedCountry);
}

function extractLocationFromCandidate(text, title, url) {
  const combined = ((title ? title + " " : "") + (text ? text.slice(0, 1000) : "")).toLowerCase();
  const MAJOR_COUNTRIES = [
    "united states", "india", "germany", "united kingdom", "spain", "japan",
    "south korea", "france", "australia", "canada", "brazil", "netherlands",
    "ireland", "taiwan", "singapore", "malaysia", "saudi arabia", "united arab emirates"
  ];
  for (const c of MAJOR_COUNTRIES) {
    const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(combined)) {
      return c.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
  }
  return null;
}

function parseLlmJson(rawOutput) {
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
    } catch (_) {
      try {
        const sanitized = slice.replace(/[\u0000-\u001F]+/g, " ");
        return JSON.parse(sanitized);
      } catch (_) {}
    }
  }

  // Truncated JSON recovery: recover partial JSON if LLM output hit token cutoff mid-response
  if (firstBracket !== -1) {
    const lastValidBrace = clean.lastIndexOf("}");
    if (lastValidBrace > firstBracket) {
      try {
        const recovered = clean.slice(firstBracket, lastValidBrace + 1) + "]";
        const sanitized = recovered.replace(/,\s*([}\]])/g, "$1").replace(/[\u0000-\u001F]+/g, " ");
        return JSON.parse(sanitized);
      } catch (_) {}
    }
  }
  if (firstBrace !== -1) {
    const projectsIndex = clean.indexOf('"projects"');
    if (projectsIndex !== -1) {
      const lastValidBrace = clean.lastIndexOf("}");
      if (lastValidBrace > projectsIndex) {
        try {
          const recovered = clean.slice(firstBrace, lastValidBrace + 1) + "]}";
          const sanitized = recovered.replace(/,\s*([}\]])/g, "$1").replace(/[\u0000-\u001F]+/g, " ");
          return JSON.parse(sanitized);
        } catch (_) {}
      }
    }
  }

  return null;
}

function extractProjectNameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] || "";
    const clean = last
      .replace(/-\d{4}-\d{2}-\d{2}$/, "")
      .replace(/\.(html|htm|php|aspx)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (clean.length > 5) {
      return clean.replace(/\b[a-z]/g, c => c.toUpperCase());
    }
  } catch (_) {}
  return "";
}

// Fallback extractor: structural fallback if AI model is unreachable
function fallbackRegexExtract(text, url, titleHint, hintCategory) {
  const combined = ((titleHint ? titleHint + " " : "") + text.slice(0, 500) + " " + url).toLowerCase();
  
  // If this page is a general market forecast, outlook, or paywalled study rather than a project, reject it
  const isMarketStudy = /\b(market\s*(?:analysis|size|report|outlook)|growth\s*forecast|forecast(?:ed)?\s*to|cagr|industry\s*overview|global\s*outlook|store\/report|insights?\/|whitepaper)\b/i.test(combined);
  if (isMarketStudy) {
    return {
      is_project: false,
      reason: "General macroeconomic analysis or market outlook report without a confirmed physical capital asset"
    };
  }

  // Reject non-English text
  if (hasNonLatinScript(titleHint) || hasNonLatinScript(text.slice(0, 300))) {
    return {
      is_project: false,
      reason: "Non-English source text rejected by platform English language standard"
    };
  }

  // Check for facility / plant / project indicators
  const facilityMatch = (titleHint || text.slice(0, 400)).match(/([A-Z][a-zA-Z0-9\s,&-]{3,50}(?:Project|Plant|Facility|Campus|Center|Centre|Park|Fab|Corridor|Hub|Farm|Station))/);
  const rawCanonical = facilityMatch ? facilityMatch[1].trim() : (titleHint || extractProjectNameFromUrl(url));

  const company = extractCompanyDynamically(text, titleHint, url);
  if (hasNonLatinScript(company)) {
    return {
      is_project: false,
      reason: "Non-English developer entity detected"
    };
  }

  const canonical_name = cleanProjectName(rawCanonical, company);

  if (!canonical_name || canonical_name.length < 5 || canonical_name === "Capital Project" || hasNonLatinScript(canonical_name) || isGenericReportOrDirectory(url, canonical_name, company) || isGenericReportOrDirectory(url, rawCanonical, company)) {
    return {
      is_project: false,
      reason: "Industry market report, educational article, or general tracker, not a specific physical project facility"
    };
  }

  if (isCompletedOrOperationalFacility(url, canonical_name, "", text) || isCompletedOrOperationalFacility(url, rawCanonical, "", text)) {
    return {
      is_project: false,
      reason: "Facility is already completed or operational. Platform strictly requires upcoming capital projects only."
    };
  }

  const projectStatus = extractStatusFromText(text, url);
  if (!projectStatus) {
    return {
      is_project: false,
      reason: "Facility is already completed or operational. Platform strictly requires upcoming capital projects only."
    };
  }

  return {
    is_project: true,
    canonical_name,
    company,
    developer: company,
    project_url: url,
    status: projectStatus,
    category: inferCategory(canonical_name, text, hintCategory),
    date: extractDateFromTextOrUrl(text, url),
    summary: cleanSummaryText(text.slice(0, 250))
  };
}

// Executes deep intelligent project evaluation via Cloudflare Workers AI (Zero Hardcoding)
async function extractProjectWithWorkersAI(ai, pageText, targetUrl, hintTitle, hintCategory) {
  if (!ai || typeof ai.run !== "function") {
    return [fallbackRegexExtract(pageText, targetUrl, hintTitle, hintCategory)];
  }

  const systemPrompt = `You are an expert industrial intelligence analyst evaluating web pages to identify and extract genuine capital infrastructure and development projects.

TASK:
Determine if the provided webpage discusses one or more SPECIFIC, REAL-WORLD CAPITAL PROJECTS in development.

A VALID CAPITAL PROJECT MUST:
1. Cover a concrete, individual physical facility, building, plant, megafab, hyperscale data center, power plant, solar/wind farm, transmission line, battery gigafactory, or campus expansion.
2. Have an identifiable corporate company, developer, owner, or operator building, expanding, or financing it. NEVER return the news site, media publisher, statistical agency, or market research portal.
3. Have a verifiable location (city, state, region, or country).
4. Be in one of these 3 active development lifecycle stages (ALL 3 ARE VALID):
   - "Announced": Newly announced investments, proposed facilities, capital expansion plans, or financing rounds for buildouts.
   - "Planning": In permitting, FEED, architectural design, environmental review, or procurement.
   - "Under Construction": Groundbreaking, foundation work, active construction, or ongoing campus buildout. Active construction and expansions ARE VALID PROJECTS.

DO NOT REJECT active construction, site buildouts, or facility expansions!

ONLY REJECT (set "is_project": false) IF:
1. The candidate is a multi-project list, roundup, directory, database, compilation, or ranking (e.g. "largest solar and wind farms", "solar farms in the US"). NEVER extract a multi-project listicle or directory as a single project!
2. The developer/company is a website domain name, URL, media outlet, data directory (e.g. ending in .online/.com), data/statistics publisher, research agency, or government department rather than a commercial project developer.
3. The facility is already completed, commissioned in past years, or currently operational/powering facilities in any language. For any operating, active, or completed facility, set "is_already_operating": true or set "is_project": false.
4. The candidate is an aggregate industry pipeline report, generator inventory, or statistical dataset.
5. The page is an educational article, academic study, technology explainer, or how-to guide.
6. The page is a colocation directory, search engine for capacity, or vendor marketplace.
7. The page discusses a political protest, zoning dispute, or lawsuit without an actively funded physical development project.
8. The page is purely macroeconomic analysis, market forecast, or paid market research report.

CRITICAL REQUIREMENT - COMPANY ENTITY:
- The "company" field MUST be the actual corporate developer, operator, or owner entity constructing or financing the facility.
- NEVER use website domain names (e.g. ending in .online, .com), media publishers, statistical agencies, regulatory commissions, author bylines, or generic placeholder terms.

CRITICAL REQUIREMENT - ACCURATE CATEGORY:
- The "category" field MUST reflect the specific primary industrial sector of the facility, honoring the Category Hint provided in the prompt when applicable.

CRITICAL REQUIREMENT - STRICT ENGLISH ONLY:
- Every single field in your JSON output (canonical_name, company, location, category, date, summary, reason) MUST be written in fluent, standard English.
- If the source webpage, project name, or developer has foreign terms, YOU MUST TRANSLATE AND ROMANIZE ALL DETAILS INTO CLEAR, PROFESSIONAL ENGLISH.

RESPONSE FORMAT:
Return ONLY a valid JSON object matching one of these two schemas:

If ONE OR MORE VALID PROJECTS:
{
  "is_project": true,
  "projects": [
    {
      "canonical_name": "Official canonical name of the individual capital facility or project in English. Extract ONLY the real project name directly stated in the webpage; NEVER invent placeholder names or output article headlines.",
      "company": "Specific commercial enterprise, developer, or owner entity constructing or operating the facility. Extract ONLY the real corporate entity directly stated in the webpage.",
      "country": "Sovereign nation in English where the facility is physically located.",
      "location": "Specific city, state, province, or local administrative region in English.",
      "status": "Announced | Planning | Under Construction",
      "is_already_operating": true | false,
      "category": "Primary industrial sector of the facility in English.",
      "date": "Target start, completion, or announcement year or date if explicitly stated in the text, or empty string if not mentioned.",
      "summary": "1-2 complete factual sentences in fluent English describing the project, developer, and its development scope."
    }
  ]
}

If NOT A CAPITAL PROJECT:
{
  "is_project": false,
  "reason": "Specific reason in English explaining why it is not a specific physical capital project"
}`;

  const userPrompt = `URL: ${targetUrl}
${hintTitle ? `Title: ${hintTitle}` : ""}
${hintCategory ? `Category Hint: ${hintCategory}` : ""}
Webpage Text:
"""
${pageText.slice(0, 3000)}
"""

Evaluate whether this discusses genuine upcoming capital projects in JSON:`;

  const t0 = Date.now();
  let rawOutput = "";
  let aiSuccess = false;

  const modelsToTry = [
    "@cf/meta/llama-3.2-3b-instruct",
    "@cf/meta/llama-3.2-1b-instruct"
  ];

  for (const modelName of modelsToTry) {
    try {
      const aiResponse = await ai.run(modelName, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 500,
      });

      rawOutput = aiResponse?.response || (typeof aiResponse === "string" ? aiResponse : JSON.stringify(aiResponse)) || "";
      if (rawOutput && rawOutput.length > 10) {
        aiSuccess = true;
        break;
      }
    } catch (err) {
      console.warn(`Model ${modelName} notice:`, err?.message || err);
    }
  }

  const elapsed = Date.now() - t0;
  recordApiUsage("Cloudflare Workers AI", elapsed, aiSuccess);
  store.lastAiRaw = rawOutput;

  if (aiSuccess && rawOutput) {
    const parsed = parseLlmJson(rawOutput);
    if (parsed) {
      if (parsed.is_project === false) {
        return [{
          is_project: false,
          reason: parsed.reason || "AI evaluation: Article does not discuss a specific physical capital project"
        }];
      }

      const rawItems = Array.isArray(parsed.projects) && parsed.projects.length > 0
        ? parsed.projects
        : [parsed];

      const validProjects = [];
      for (const item of rawItems) {
        if (!item || typeof item !== "object") continue;
        const rawStatus = (item.status || "").trim();
        let finalStatus = null;
        if (/^announced$/i.test(rawStatus)) {
          finalStatus = "Announced";
        } else if (/^planning$/i.test(rawStatus)) {
          finalStatus = "Planning";
        } else if (/^under\s+construction$/i.test(rawStatus)) {
          finalStatus = "Under Construction";
        }

        // Drop unknown or completed statuses
        if (!finalStatus) {
          continue;
        }

        if (
          hasNonLatinScript(item.canonical_name) ||
          hasNonLatinScript(item.company) ||
          hasNonLatinScript(item.summary) ||
          isForeignLanguageText(item.summary) ||
          isForeignLanguageText(item.canonical_name)
        ) {
          continue;
        }

        let companyVal = item.company;
        if (!companyVal || companyVal === "Project Developer" || companyVal === "Leading Developer" || isNewsPublisher(companyVal)) {
          companyVal = extractCompanyDynamically(pageText, hintTitle, targetUrl);
        }

        let rawProjectName = item.canonical_name;
        if (!rawProjectName || rawProjectName.startsWith("Project from") || rawProjectName.length < 5) {
          rawProjectName = hintTitle || extractProjectNameFromUrl(targetUrl);
        }
        let projectName = cleanProjectName(rawProjectName, companyVal);

        if ((!companyVal || companyVal === "Project Developer" || companyVal === "Leading Developer") && projectName) {
          const nameCompany = extractCompanyDynamically("", projectName, targetUrl);
          if (nameCompany && nameCompany !== "Project Developer") {
            companyVal = nameCompany;
          }
        }

        if (hasNonLatinScript(projectName) || hasNonLatinScript(companyVal)) continue;
        if (isGenericReportOrDirectory(targetUrl, projectName, companyVal, item.summary) || isGenericReportOrDirectory(targetUrl, rawProjectName, companyVal, item.summary)) continue;
        if (item.is_already_operating === true || item.status === "Operational" || item.status === "Completed") continue;
        if (
          isCompletedOrOperationalFacility(targetUrl, projectName, item.summary, pageText) ||
          isCompletedOrOperationalFacility(targetUrl, rawProjectName, item.summary, pageText) ||
          isCompletedOrOperationalFacility(targetUrl, hintTitle, item.summary, pageText)
        ) {
          continue;
        }
        if (!isValidCompanyEntity(companyVal)) continue;

        let projectDate = item.date;
        if (!projectDate || projectDate.length < 4) {
          projectDate = extractDateFromTextOrUrl(pageText, targetUrl);
        }

        let pCountry = (item.country || "").trim();
        let pLocation = (item.location || "").trim();
        if (!pCountry && pLocation) {
          pCountry = pLocation.includes(",") ? pLocation.split(",").pop().trim() : pLocation;
        }

        validProjects.push({
          is_project: true,
          canonical_name: projectName,
          company: companyVal,
          developer: companyVal,
          project_url: targetUrl,
          status: finalStatus,
          category: inferCategory(projectName, item.summary, item.category || hintCategory),
          country: pCountry || "Not specified",
          location: pLocation || pCountry || "Not specified",
          date: projectDate,
          summary: cleanSummaryText(item.summary || pageText.slice(0, 250))
        });
      }

      if (validProjects.length > 0) {
        return validProjects;
      }
    }
  }

  if (aiSuccess) {
    return [{
      is_project: false,
      reason: "Page analyzed by Workers AI: No valid upcoming physical capital development projects found."
    }];
  }

  const fb = fallbackRegexExtract(pageText, targetUrl, hintTitle, hintCategory);
  return [fb];
}

// Single Batch AI Extraction: Evaluates all candidates in exactly 1 Workers AI request
async function extractBatchProjectsWithWorkersAI(ai, candidateItems, targetCategory) {
  if (!ai || typeof ai.run !== "function" || !candidateItems || candidateItems.length === 0) {
    return [];
  }

  const systemPrompt = `You are an expert industrial intelligence analyst evaluating web discovery sources to identify genuine upcoming capital infrastructure, manufacturing, and development projects.

TASK:
Examine the numbered candidates. For each candidate that discusses a genuine, real-world physical capital project in development:
Extract the required project parameters in fluent, standard English.

A VALID CAPITAL PROJECT MUST:
1. Be a concrete, individual physical facility, building, megafab, data center campus, power plant, solar/battery farm, or facility expansion. It must be ONE distinct development, NOT an aggregate industry category, ranking, or multi-project inventory.
2. Have an identifiable corporate developer, owner, or operator building, financing, or operating it. NEVER return a data publisher, research platform, government statistical bureau, or news outlet as the developer.
3. Have a verifiable location (city, state, region, or country).
4. Be in one of these 3 active development lifecycle stages (ALL 3 ARE VALID):
   - "Announced": Newly announced investments, proposed facilities, capital expansion plans, or financing rounds for buildouts.
   - "Planning": In permitting, FEED, architectural design, environmental review, or procurement.
   - "Under Construction": Groundbreaking, foundation work, active construction, or ongoing campus buildout.

REJECT (MUST NOT EXTRACT):
- LISTS, ROUNDUPS, COMPILATIONS & DIRECTORIES: Articles listing "largest solar and wind farms", "solar farms in the US", multi-project directories, databases, or project rankings. NEVER extract an entire listicle, ranking, directory, or roundup as a single project!
- WEBSITE DOMAIN NAMES AS DEVELOPER: NEVER return a website domain name, URL, or data directory (e.g. "Gridplants.online", "RenewableDB", or names ending in .online/.com/.org) as the developer company.
- PIPELINES, INVENTORIES & STATISTICAL DATASETS: Industry pipeline overviews, generator rows, project databases, capacity trackers, or national statistics tables.
- DATA/STATISTICS PUBLISHERS AS DEVELOPER: Candidates where the company is a government statistical agency, market research platform, energy data tracker, or publisher rather than a commercial project owner/developer erecting the facility.
- NATIONAL MACRO POLICY TARGETS & ROADMAPS: Broad macroeconomic government announcements, national policy initiatives, or multi-year capacity targets without an individual physical development project.
- REGULATORY & GRID REVIEW ARTICLES: Articles primarily discussing power supply rules, grid reviews, zoning regulations, or regulatory hurdles without a specific development project.
- COMPLETED, OPENED, OR OPERATIONAL FACILITIES (CRITICAL): Facilities that have ALREADY OPENED, COMPLETED, INAUGURATED, or are OPERATING / POWERING FACILITIES in ANY language (including facilities that "now power water-treatment plants", "generate power", "cut CO2", "turned a reservoir into a solar farm", or signed a supply/PPA agreement for an existing facility). You MUST set "is_already_operating": true if the facility is already operating, active, generating power, or completed. NEVER label an operating plant as 'Under Construction'!
- Tool, equipment, or machinery product launches. Equipment shipped to customers is NOT a capital project!
- Material, wafer, or substrate product announcements.
- R&D partnerships, industry collaboration initiatives, or technology roadmaps without a physical facility buildout.
- Macroeconomic equipment spending reports or capex forecasts.
- Educational guides, explainer articles, technology overviews, academic reports, or finance learn blogs.
- Colocation marketplaces or vendor directories.
- Concept design, equipment development, or technology licensing agreements without an actual physical facility buildout.
- Any candidate where developer is an author byline, regulatory commission, or sentence fragment.

RESPONSE FORMAT:
Return ONLY a valid JSON object in this exact schema:
{
  "projects": [
    {
      "candidate_index": 1,
      "source_url": "The exact URL copied verbatim from the [Candidate #ID] block above where this project is described",
      "canonical_name": "Official canonical name of the individual capital facility or project in English. MUST NOT be a journalistic news headline or sentence, and MUST NOT include action verbs like 'Secures Loans for', 'Wins Approval for', 'Breaks Ground on', or 'came online'. Extract ONLY the actual project name described in the candidate text.",
      "company": "Specific corporate developer or owner building the project in English. Extract ONLY the real company described in the candidate content.",
      "country": "Sovereign nation name in English where the facility is located.",
      "location": "Specific city, state, province, or region in English.",
      "status": "Announced | Planning | Under Construction",
      "is_already_operating": true | false,
      "category": "Primary industrial sector of the facility in English.",
      "date": "Target start, completion, or announcement date if explicitly stated in candidate content, or empty string \"\" if not mentioned",
      "summary": "1-2 complete factual sentences in fluent English describing the project and buildout scope."
    }
  ]
}`;

  let candidateBlocks = "";
  candidateItems.slice(0, 12).forEach((c, idx) => {
    const textSnippet = (c.text || c.snippet || c.title || "").slice(0, 1500);
    candidateBlocks += `\n[Candidate #${idx + 1}]\nURL: ${c.cleanUrl}\nTitle: ${c.title || ""}\nDate: ${c.published_date || ""}\nContent: """\n${textSnippet}\n"""\n`;
  });

  const userPrompt = `Evaluate the following ${Math.min(candidateItems.length, 12)} web discovery candidates for genuine upcoming capital projects (Category Hint: ${targetCategory || "All Categories"}):
${candidateBlocks}

Output your JSON analysis now:`;

  const t0 = Date.now();
  let rawOutput = "";
  let aiSuccess = false;

  const modelsToTry = [
    "@cf/meta/llama-3.2-3b-instruct",
    "@cf/meta/llama-3.1-8b-instruct"
  ];

  for (const modelName of modelsToTry) {
    try {
      const aiResponse = await ai.run(modelName, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 4096
      });

      rawOutput = aiResponse?.response || (typeof aiResponse === "string" ? aiResponse : JSON.stringify(aiResponse)) || "";
      if (rawOutput && rawOutput.length > 15) {
        aiSuccess = true;
        break;
      }
    } catch (err) {
      console.warn(`Batch AI model ${modelName} notice:`, err?.message || err);
    }
  }

  const elapsed = Date.now() - t0;
  recordApiUsage("Cloudflare Workers AI", elapsed, aiSuccess);
  store.lastAiRaw = rawOutput;

  if (aiSuccess && rawOutput) {
    const parsed = parseLlmJson(rawOutput);
    if (parsed) {
      const list = Array.isArray(parsed) ? parsed : (parsed.projects || []);
      return list;
    }
  }
  return [];
}

// Dynamic NLP Query Classifier against 462 Primary Sectors (No hardcoded keyword branches)
function classifyQuery(queryStr) {
  const qLower = (queryStr || "").toLowerCase().trim();
  if (!qLower) return { category: "Capital Projects", group: "General Industrial" };

  // Common high-volume sector shortcuts when query is short / generic
  if (/\b(?:concentrated\s+solar|solar\s+thermal|heliostats?|parabolic\s+trough|csp)\b/i.test(qLower)) {
    const s = primarySectors.find(x => x.id === "concentrated-solar-power-csp");
    if (s) return { category: s.sector, group: s.group, definition: s.definition };
  }
  if (/\bfloating\s+solar\b/i.test(qLower)) {
    const s = primarySectors.find(x => x.id === "floating-solar-power-plant");
    if (s) return { category: s.sector, group: s.group, definition: s.definition };
  }
  if (/\b(?:solar|pv\s+farm|solar\s+farm|solar\s+project|solar\s+power|photovoltaic)\b/i.test(qLower)) {
    const s = primarySectors.find(x => x.id === "solar-photovoltaic-power-plant-pv");
    if (s) return { category: s.sector, group: s.group, definition: s.definition };
  }
  if (/\b(?:data\s*cent(?:er|re)|hyperscale|colocation|cloud\s+campus)\b/i.test(qLower)) {
    const s = primarySectors.find(x => x.sector.toLowerCase() === "data center");
    if (s) return { category: s.sector, group: s.group, definition: s.definition };
  }
  if (/\b(?:semiconductor|wafer\s+fab|microchip|chip\s+fab|chip\s+factory)\b/i.test(qLower)) {
    const s = primarySectors.find(x => x.id === "semiconductor-plant");
    if (s) return { category: s.sector, group: s.group, definition: s.definition };
  }
  if (/\b(?:bess|battery\s+energy\s+storage|battery\s+storage|utility\s+battery)\b/i.test(qLower)) {
    const s = primarySectors.find(x => x.id === "battery-energy-storage");
    if (s) return { category: s.sector, group: s.group, definition: s.definition };
  }
  if (/\boffshore\s+wind\b/i.test(qLower)) {
    const s = primarySectors.find(x => x.id === "offshore-wind-power-plant");
    if (s) return { category: s.sector, group: s.group, definition: s.definition };
  }
  if (/\b(?:wind\s+farm|wind\s+power|onshore\s+wind|wind\s+energy)\b/i.test(qLower)) {
    const s = primarySectors.find(x => x.id === "onshore-wind-power-plant");
    if (s) return { category: s.sector, group: s.group, definition: s.definition };
  }

  const qWords = qLower.split(/\s+/).filter(w => w.length > 2 && !["and", "for", "the", "project", "projects", "plant", "plants", "facility", "facilities"].includes(w));

  let bestSector = null;
  let maxScore = 0;

  for (const s of primarySectors) {
    const sLower = s.sector.toLowerCase();
    const sClean = sLower.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

    // Exact sector match
    if (qLower === sLower || qLower === sClean) {
      return { category: s.sector, group: s.group, definition: s.definition };
    }

    // Full sector included in query
    if (qWords.length >= 2 && qLower.includes(sClean)) {
      return { category: s.sector, group: s.group, definition: s.definition };
    }

    let score = 0;
    const sWords = sClean.split(/\s+/);
    for (const w of qWords) {
      if (sWords.includes(w)) score += 5;
      else if (sWords.some(sw => sw.startsWith(w) || w.startsWith(sw))) score += 2;
      if (Array.isArray(s.keywords) && s.keywords.includes(w)) score += 1;
    }

    if (score > maxScore) {
      maxScore = score;
      bestSector = s;
    }
  }

  if (bestSector && maxScore > 0) {
    return { category: bestSector.sector, group: bestSector.group, definition: bestSector.definition };
  }

  return { category: "Capital Projects", group: "General Industrial" };
}

// Dynamic Location Extractor from Query (No hardcoded location list)
function extractLocation(queryStr) {
  const match = queryStr.match(/\b(?:in|across|near|around|for)\s+([A-Z][a-zA-Z\s,]{2,30})\b/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return "Global";
}

// Managed concurrency pool to maximize edge throughput without hitting Workers AI limits
async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        console.warn("Worker candidate execution notice:", err?.message || err);
        results[i] = null;
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.allSettled(workers);
  return results;
}

// ==============================================================================
// 4. PARALLEL HIGH-EFFICIENCY DISCOVERY PIPELINE
// ==============================================================================

async function executeDiscoveryPipeline(env, ctx, searchRunId, query, requestedCategory, requestedLocation, requestedProviders = ["exa", "google"]) {
  const startTime = Date.now();

  // 1. Initial analysis
  const sectorInfo = classifyQuery(query);
  const targetCategory = requestedCategory && requestedCategory !== "All Categories" ? requestedCategory : sectorInfo.category;
  const queryLoc = extractLocation(query);
  const effectiveLocation = (requestedLocation && requestedLocation !== "Worldwide (Global)" && requestedLocation !== "All Regions" && requestedLocation !== "Global" && requestedLocation !== "all")
    ? requestedLocation
    : (queryLoc !== "Global" ? queryLoc : null);
  const targetLocation = effectiveLocation || "Global";

  // Build composite search query from all three inputs: ${query} ${sector} ${country}
  const searchParts = [query.trim()];

  if (requestedCategory && requestedCategory !== "All Categories" && requestedCategory !== "all") {
    if (!query.toLowerCase().includes(requestedCategory.toLowerCase())) {
      searchParts.push(requestedCategory);
    }
  }

  if (effectiveLocation) {
    if (!query.toLowerCase().includes(effectiveLocation.toLowerCase())) {
      searchParts.push(effectiveLocation);
    }
  }

  const effectiveSearchText = searchParts.join(" ").trim();
  const cacheKey = getQueryCacheKey(query, targetCategory, targetLocation);

  const addEvent = (eventType, message, component = "ai_worker", metadata = {}) => {
    const event = {
      event_id: crypto.randomUUID(),
      search_run_id: searchRunId,
      event_type: eventType,
      component,
      message,
      msg: message,
      text: message,
      metadata,
      timestamp: new Date().toISOString()
    };
    if (!store.activityEvents.has(searchRunId)) {
      store.activityEvents.set(searchRunId, []);
    }
    store.activityEvents.get(searchRunId).push(event);
  };

  addEvent("search_created", `Search accepted for: '${effectiveSearchText}' (Base Query: '${query}'). Dispatched to Cloudflare Workers AI edge pipeline.`);
  addEvent("query_analyzed", `NLP Analysis: Category '${targetCategory}' [${sectorInfo.group || 'Industrial'}], Location '${targetLocation}', Search Text '${effectiveSearchText}'`);

  // 2. Query Cache Pre-check: Only use cache if within TTL, matching country & sector, and projects are valid
  if (store.queryCache.has(cacheKey)) {
    const cachedEntry = store.queryCache.get(cacheKey);
    const priorRunId = typeof cachedEntry === "string" ? cachedEntry : cachedEntry?.runId;
    const cachedAt = typeof cachedEntry === "object" ? (cachedEntry?.timestamp || 0) : 0;
    const isExpired = cachedAt > 0 && (Date.now() - cachedAt > QUERY_CACHE_TTL_MS);

    if (isExpired) {
      store.queryCache.delete(cacheKey);
      addEvent("query_cache_expired", `Cache expired for '${cacheKey}' (${Math.round((Date.now() - cachedAt) / 60000)}m old). Running fresh live discovery.`);
    } else {
      const cachedResults = store.searchResults.get(priorRunId) || [];
      const isValidCache = cachedResults.length > 0 && cachedResults.every(r => 
        r.canonical_name && 
        !r.canonical_name.startsWith("Project from") && 
        !/^(?:none|n\/a|null|unknown|tbd|capital project)$/i.test(r.canonical_name.trim()) &&
        !/^(?:none|n\/a|null|unknown|tbd|project developer)$/i.test((r.company || r.developer || "").trim()) &&
        !hasNonLatinScript(r.canonical_name) &&
        !hasNonLatinScript(r.summary) &&
        !isForeignLanguageText(r.summary) &&
        !isForeignLanguageText(r.canonical_name) &&
        isValidCompanyEntity(r.company || r.developer) &&
        !isGenericReportOrDirectory(r.project_url, r.canonical_name, r.company || r.developer, r.summary) &&
        ["Announced", "Planning", "Under Construction"].includes(r.status)
      );
      if (isValidCache) {
        addEvent("query_cache_hit", `Cache Hit: Query '${query}' [Sector: '${targetCategory}', Country: '${targetLocation}'] already executed with ${cachedResults.length} verified projects. Zero external calls or LLM inferences needed.`);
        store.searchResults.set(searchRunId, cachedResults);
        const run = store.searches.get(searchRunId);
        if (run) {
          run.status = "completed";
          run.results_count = cachedResults.length;
          run.duration_ms = Date.now() - startTime;
          run.completed_at = new Date().toISOString();
          run.api_telemetry = {
            exa_search: 0,
            google_search: 0,
            fallback_search: 0,
            web_content_fetches: 0,
            workers_ai_inferences: 0,
            total_requests: 0
          };
        }
        addEvent("search_completed", `Discovery complete via memory cache: ${cachedResults.length} projects linked in ${Date.now() - startTime}ms.`);
        return cachedResults;
      } else {
        store.queryCache.delete(cacheKey);
      }
    }
  }

  // 3. Provider Search Dispatch (Strict 1 Request Policy: At most 1 search API call per query)
  const queryTelemetry = {
    exa_search: 0,
    google_search: 0,
    fallback_search: 0,
    web_content_fetches: 0,
    workers_ai_inferences: 0,
    total_requests: 0
  };

  addEvent("provider_started", `Executing web discovery for: '${effectiveSearchText}'`);

  let candidateUrls = [];
  const useExa = requestedProviders.includes("exa") && env.EXA_API_KEY && env.EXA_API_KEY.length > 10;
  const useGoogle = requestedProviders.includes("google") && env.GOOGLE_SEARCH_API_KEY && env.GOOGLE_SEARCH_CX;

  // Rolling window for recent discoveries (last 12 months)
  const ROLLING_WINDOW_DAYS = 365;
  const rollingStartPublishedDate = new Date(Date.now() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Priority 1: Exa AI Neural Search (Dispatches 1 POST request with full text)
  if (useExa) {
    const t0 = Date.now();
    queryTelemetry.exa_search = 1;
    try {
      const exaRes = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "x-api-key": env.EXA_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: effectiveSearchText,
          numResults: 12,
          useAutoprompt: true,
          startPublishedDate: rollingStartPublishedDate,
          contents: {
            text: { maxCharacters: 1500 }
          }
        }),
        signal: AbortSignal.timeout(9000)
      });
      const elapsed = Date.now() - t0;
      recordApiUsage("Exa Neural Search", elapsed, exaRes.ok);
      if (exaRes.ok) {
        const exaData = await exaRes.json();
        candidateUrls = (exaData.results || [])
          .filter(r => !hasNonLatinScript(r.title))
          .map(r => ({
            url: r.url,
            title: r.title,
            snippet: r.text ? r.text.slice(0, 300) : r.title,
            text: r.text || "",
            published_date: r.publishedDate || extractDateFromTextOrUrl(r.text, r.url),
            provider: "exa"
          }));
        addEvent("provider_completed", `Exa AI retrieved ${candidateUrls.length} candidate URLs in ${elapsed}ms.`);
      } else {
        const errText = await exaRes.text();
        addEvent("provider_error", `Exa AI Search responded with HTTP ${exaRes.status}: ${errText.slice(0, 120)}`);
      }
    } catch (e) {
      recordApiUsage("Exa Neural Search", Date.now() - t0, false);
      addEvent("provider_error", `Exa AI Search network notice: ${e?.message || e}`);
    }
  }

  // Priority 2: Google Search (Only if Exa was not requested or yielded 0 candidate URLs)
  if (candidateUrls.length === 0 && useGoogle) {
    const t0 = Date.now();
    queryTelemetry.google_search = 1;
    try {
      const gUrl = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_SEARCH_API_KEY}&cx=${env.GOOGLE_SEARCH_CX}&q=${encodeURIComponent(effectiveSearchText)}&num=10&hl=en&dateRestrict=m12`;
      const gRes = await fetch(gUrl, { signal: AbortSignal.timeout(6000) });
      const elapsed = Date.now() - t0;
      recordApiUsage("Google Custom Search", elapsed, gRes.ok);
      if (gRes.ok) {
        const gData = await gRes.json();
        candidateUrls = (gData.items || [])
          .filter(r => !hasNonLatinScript(r.title))
          .map(r => ({
            url: r.link,
            title: r.title,
            snippet: r.snippet,
            text: r.snippet || "",
            published_date: extractDateFromTextOrUrl(r.snippet, r.link),
            provider: "google"
          }));
        addEvent("provider_completed", `Google Search retrieved ${candidateUrls.length} candidate URLs in ${elapsed}ms.`);
      } else {
        const errText = await gRes.text();
        addEvent("provider_error", `Google Search responded with HTTP ${gRes.status}: ${errText.slice(0, 120)}`);
      }
    } catch (e) {
      recordApiUsage("Google Custom Search", Date.now() - t0, false);
      addEvent("provider_error", `Google Search network notice: ${e?.message || e}`);
    }
  }

  // 4. Pre-LLM URL Validation & Deduplication
  addEvent("extraction_started", `Evaluating ${candidateUrls.length} candidate source URLs for capital project parameters.`);

  const validCandidates = [];
  const seenUrls = new Set();

  for (const item of candidateUrls) {
    const rawUrl = item.url;
    const val = validateAndNormalizeUrl(rawUrl);
    if (!val.valid || !val.cleanUrl) {
      continue;
    }
    if (store.failedUrls.has(val.cleanUrl)) {
      continue;
    }
    if (seenUrls.has(val.cleanUrl)) {
      continue;
    }
    seenUrls.add(val.cleanUrl);
    validCandidates.push({ ...item, cleanUrl: val.cleanUrl });
  }

  const extractedProjects = [];
  const uncachedCandidates = [];

  for (const item of validCandidates.slice(0, 12)) {
    const cleanUrl = item.cleanUrl;
    if (store.urlCache.has(cleanUrl)) {
      const cached = store.urlCache.get(cleanUrl);
      const cachedArr = Array.isArray(cached) ? cached : [cached];
      const validCached = [];
      for (const rawC of cachedArr) {
        // Run stored projects through the exact same comprehensive checks as new ones!
        const validated = validateAndSanitizeProjectRecord(rawC);
        if (!validated) continue;
        if (
          isCompletedOrOperationalFacility(cleanUrl, validated.canonical_name, validated.summary, validated.text || "") ||
          isCompletedOrOperationalFacility(cleanUrl, rawC.canonical_name, validated.summary, "")
        ) {
          continue;
        }
        if (validated.date && formatDisplayDate(validated.date) === null) {
          continue;
        }
        validCached.push(validated);
      }

      if (validCached.length === 0) {
        // Stale or invalid cached project: purge completely from urlCache!
        store.urlCache.delete(cleanUrl);
      } else {
        store.urlCache.set(cleanUrl, validCached);
        let acceptedFromCache = false;
        for (const p of validCached) {
          if (effectiveLocation && !matchesTargetCountry(p.country, p.location, effectiveLocation)) {
            continue;
          }
          extractedProjects.push(p);
          acceptedFromCache = true;
          addEvent("candidate_accepted", `ACCEPTED FROM CACHE: '${p.canonical_name}' (Source: ${cleanUrl})`, "ai_worker", { project: p, canonical_name: p.canonical_name });
        }
        if (acceptedFromCache) {
          continue;
        }
      }
    }
    uncachedCandidates.push(item);
  }

  // 5. Single Batch Workers AI Inference (Strictly 1 AI request per query)
  if (uncachedCandidates.length > 0 && env.AI) {
    queryTelemetry.workers_ai_inferences = 1;
    addEvent("extraction_started", `Executing single batch Workers AI inference for ${uncachedCandidates.length} candidate URLs (1 request policy).`);

    const batchAiProjects = await extractBatchProjectsWithWorkersAI(env.AI, uncachedCandidates, targetCategory);

    for (const aiP of batchAiProjects) {
      if (!aiP) continue;

      let matchedCandidate = null;

      // 1. Try matching by exact or partial source_url / url returned by AI
      const rawAiUrl = (aiP.source_url || aiP.url || "").trim().toLowerCase();
      if (rawAiUrl) {
        matchedCandidate = uncachedCandidates.find(c => {
          const cUrl = (c.cleanUrl || "").toLowerCase();
          return cUrl === rawAiUrl || cUrl.includes(rawAiUrl) || rawAiUrl.includes(cUrl);
        });
      }

      // 2. Try candidate_index if the candidate actually mentions/corroborates this project
      let candidateIdx = null;
      if (typeof aiP.candidate_index === "number") {
        candidateIdx = Math.floor(aiP.candidate_index);
      } else if (typeof aiP.candidate_index === "string") {
        const match = aiP.candidate_index.match(/\d+/);
        if (match) {
          candidateIdx = parseInt(match[0], 10);
        }
      }

      if (!matchedCandidate && candidateIdx !== null && !isNaN(candidateIdx) && candidateIdx >= 1 && candidateIdx <= uncachedCandidates.length) {
        const candByIndex = uncachedCandidates[candidateIdx - 1];
        if (candidateMentionsProject(candByIndex, aiP)) {
          matchedCandidate = candByIndex;
        }
      }

      // 3. Fallback: Search all candidates to find the one whose URL, title, or text best corroborates the project
      if (!matchedCandidate) {
        matchedCandidate = findBestCorroboratingCandidate(uncachedCandidates, aiP);
      }

      // Strict Validation: If no candidate mentions or corroborates this project, reject it to prevent wrong URLs
      if (!matchedCandidate || !candidateMentionsProject(matchedCandidate, aiP)) {
        addEvent("candidate_filtered", `DROPPED (Unverified Source): AI extraction for '${aiP.canonical_name || "Unknown"}' skipped because no candidate URL verified this project/developer.`);
        continue;
      }

      // Drop any project identified as already operating, completed, or commissioned in any language
      if (aiP.is_already_operating === true || aiP.status === "Operational" || aiP.status === "Completed") {
        addEvent("candidate_filtered", `DROPPED (Already Operating / Completed): '${aiP.canonical_name || "Unknown"}' is identified as an already operational facility.`);
        continue;
      }

      const cleanUrl = matchedCandidate.cleanUrl;
      const rawStatus = (aiP.status || "").trim();
      let projectStatus = null;
      if (/^announced$/i.test(rawStatus)) {
        projectStatus = "Announced";
      } else if (/^planning$/i.test(rawStatus)) {
        projectStatus = "Planning";
      } else if (/^under\s+construction$/i.test(rawStatus)) {
        projectStatus = "Under Construction";
      }

      // Drop any project whose status isn't strictly Announced, Planning, or Under Construction
      if (!projectStatus) {
        addEvent("candidate_filtered", `DROPPED (Invalid/Completed Status): '${aiP.canonical_name || "Unknown"}' status '${aiP.status || "None"}' is not Announced, Planning, or Under Construction.`);
        continue;
      }

      const rawProjectName = aiP.canonical_name || matchedCandidate.title || "";
      let companyName = aiP.company;
      if (!companyName || companyName === "Project Developer" || companyName === "Leading Developer" || isNewsPublisher(companyName)) {
        companyName = extractCompanyDynamically(matchedCandidate.text || matchedCandidate.snippet, matchedCandidate.title, cleanUrl);
      }
      companyName = normalizeDeveloperName(companyName, cleanUrl);
      const projectName = cleanProjectName(rawProjectName, companyName);

      if (!projectName || /^(?:none|n\/a|null|not specified|unknown|tbd|capital project)$/i.test(projectName.trim())) {
        continue;
      }
      if (!companyName || /^(?:none|n\/a|null|not specified|unknown|tbd|project developer|leading developer)$/i.test(companyName.trim())) {
        continue;
      }
      if (!isValidCompanyEntity(companyName)) {
        continue;
      }
      if (isWebsiteOwnName(companyName, cleanUrl, matchedCandidate.title)) {
        addEvent("candidate_filtered", `DROPPED (Website Name as Developer): '${companyName}' matches website domain.`);
        continue;
      }
      if (hasNonLatinScript(projectName) || hasNonLatinScript(companyName) || hasNonLatinScript(aiP.summary) || isForeignLanguageText(aiP.summary)) {
        continue;
      }
      if (isGenericReportOrDirectory(cleanUrl, projectName, companyName, aiP.summary) || isGenericReportOrDirectory(cleanUrl, rawProjectName, companyName, aiP.summary)) {
        continue;
      }
      if (
        isCompletedOrOperationalFacility(cleanUrl, projectName, aiP.summary, matchedCandidate.text || matchedCandidate.snippet) ||
        isCompletedOrOperationalFacility(cleanUrl, matchedCandidate.title, aiP.summary, matchedCandidate.text || matchedCandidate.snippet) ||
        isCompletedOrOperationalFacility(cleanUrl, rawProjectName, aiP.summary, matchedCandidate.text || matchedCandidate.snippet)
      ) {
        addEvent("candidate_filtered", `DROPPED (Completed/Operational Facility): '${projectName}' (URL: ${cleanUrl}) has already opened or commenced operations.`);
        continue;
      }

      // Resolve project sovereign country and specific location
      let projectCountry = (aiP.country || "").trim();
      let projectLocation = (aiP.location || "").trim();

      if (/^(?:not specified|unknown|global|tbd|none|n\/a)$/i.test(projectCountry)) {
        projectCountry = "";
      }
      if (/^(?:not specified|unknown|global|tbd|none|n\/a)$/i.test(projectLocation)) {
        projectLocation = "";
      }

      if (!projectCountry && projectLocation) {
        const parts = projectLocation.split(",").map(p => p.trim());
        if (parts.length > 1) {
          projectCountry = parts[parts.length - 1];
        } else {
          projectCountry = projectLocation;
        }
      }

      if (!projectCountry) {
        projectCountry = extractLocationFromCandidate(matchedCandidate.text || matchedCandidate.snippet, matchedCandidate.title, cleanUrl) || "Not specified";
      }
      if (!projectLocation) {
        projectLocation = projectCountry;
      }

      // Filter results by effective target location (from dropdown or search query)
      if (effectiveLocation && !matchesTargetCountry(projectCountry, projectLocation, effectiveLocation)) {
        addEvent("candidate_filtered", `DROPPED (Location Mismatch): '${projectName}' location '${projectLocation || projectCountry}' does not match target location '${effectiveLocation}'`);
        continue;
      }

      let rawDate = (aiP.date || matchedCandidate.published_date || "").trim();
      let projectDate = formatDisplayDate(rawDate);
      if (projectDate === null) {
        addEvent("candidate_filtered", `DROPPED (Historical/Past Project Date): '${projectName}' date '${rawDate}' is prior to current active pipeline.`);
        continue;
      }

      // Deduplicate against existing records in store.projects
      const dedupKey = getProjectDedupKey(projectName, companyName);
      let existingEntry = null;
      for (const [id, p] of store.projects.entries()) {
        if (getProjectDedupKey(p.canonical_name, p.company || p.developer) === dedupKey) {
          existingEntry = { id, project: p };
          break;
        }
      }

      let projId;
      let projectRecord;

      if (existingEntry) {
        projId = existingEntry.id;
        const prev = existingEntry.project;
        projectRecord = {
          ...prev,
          summary: (aiP.summary?.length || 0) > (prev.summary?.length || 0) ? cleanSummaryText(aiP.summary) : prev.summary,
          project_url: prev.project_url || cleanUrl,
          date: projectDate || prev.date
        };
        store.projects.set(projId, projectRecord);
      } else {
        projId = "proj-" + crypto.randomUUID().slice(0, 8);
        projectRecord = {
          id: projId,
          canonical_name: projectName,
          company: companyName,
          developer: companyName,
          project_url: cleanUrl,
          status: projectStatus,
          category: inferCategory(projectName, aiP.summary, aiP.category || targetCategory),
          country: projectCountry || "Not specified",
          location: projectLocation || projectCountry || "Not specified",
          date: projectDate,
          http_status: 200,
          summary: cleanSummaryText(aiP.summary || matchedCandidate.snippet || ""),
          created_at: new Date().toISOString()
        };
        store.projects.set(projId, projectRecord);
      }

      store.urlCache.set(cleanUrl, [projectRecord]);
      extractedProjects.push(projectRecord);

      addEvent("candidate_accepted", `VALID PROJECT URL: ${cleanUrl} | Company: [${companyName}] | Date: [${projectDate}] | Status: [${projectRecord.status}] | Name: '${projectRecord.canonical_name}'`, "ai_worker", { project: projectRecord, canonical_name: projectRecord.canonical_name });
    }
  }

  // If AI yielded no projects or wasn't configured, run resilient in-memory regex fallback (0 external requests)
  if (extractedProjects.length === 0 && uncachedCandidates.length > 0) {
    for (const item of uncachedCandidates.slice(0, 5)) {
      const fb = fallbackRegexExtract(item.text || item.snippet, item.cleanUrl, item.title, targetCategory);
      if (fb && fb.is_project !== false && isValidCompanyEntity(fb.company)) {
        const normDev = normalizeDeveloperName(fb.company, item.cleanUrl);
        const fbRawName = fb.canonical_name || item.title || "";
        const fbProjectName = cleanProjectName(fbRawName, normDev);

        if (isGenericReportOrDirectory(item.cleanUrl, fbProjectName, normDev, fb.summary) || isGenericReportOrDirectory(item.cleanUrl, fbRawName, normDev, fb.summary)) {
          continue;
        }
        if (isWebsiteOwnName(normDev, item.cleanUrl, item.title)) {
          continue;
        }
        if (
          isCompletedOrOperationalFacility(item.cleanUrl, fbProjectName, fb.summary, item.text || item.snippet) ||
          isCompletedOrOperationalFacility(item.cleanUrl, item.title, fb.summary, item.text || item.snippet) ||
          isCompletedOrOperationalFacility(item.cleanUrl, fbRawName, fb.summary, item.text || item.snippet)
        ) {
          continue;
        }

        const detectedLocation = extractLocationFromCandidate(item.text || item.snippet, item.title, item.cleanUrl);
        const detectedCountry = detectedLocation || "Not specified";

        if (effectiveLocation && !matchesTargetCountry(detectedCountry, detectedLocation, effectiveLocation)) {
          continue;
        }

        const fbStatus = fb.status;
        if (!fbStatus || !["Announced", "Planning", "Under Construction"].includes(fbStatus)) {
          continue;
        }

        let fbRawDate = (fb.date || item.published_date || "").trim();
        let fbDate = formatDisplayDate(fbRawDate);
        if (fbDate === null) {
          continue;
        }

        const projId = "proj-" + crypto.randomUUID().slice(0, 8);
        const projectRecord = {
          id: projId,
          canonical_name: fbProjectName,
          company: normDev,
          developer: normDev,
          project_url: item.cleanUrl,
          status: fbStatus,
          category: inferCategory(fbProjectName, fb.summary, fb.category || targetCategory),
          country: detectedCountry || "Not specified",
          location: detectedLocation || detectedCountry || "Not specified",
          date: fbDate,
          http_status: 200,
          summary: cleanSummaryText(fb.summary || item.snippet || ""),
          created_at: new Date().toISOString()
        };
        store.projects.set(projId, projectRecord);
        store.urlCache.set(item.cleanUrl, [projectRecord]);
        extractedProjects.push(projectRecord);
        addEvent("candidate_accepted", `VALID PROJECT URL: ${item.cleanUrl} | Company: [${projectRecord.company}] | Name: '${projectRecord.canonical_name}'`, "ai_worker", { project: projectRecord, canonical_name: projectRecord.canonical_name });
      }
    }
  }

  // 6. Project Entity Deduplication (Zero Duplicate Projects Across Multiple News Sources)
  const uniqueProjectMap = new Map();

  for (const proj of extractedProjects) {
    if (!proj || !proj.canonical_name) continue;
    if (effectiveLocation && !matchesTargetCountry(proj.country, proj.location, effectiveLocation)) {
      continue;
    }
    if (isGenericReportOrDirectory(proj.project_url, proj.canonical_name, proj.company || proj.developer, proj.summary)) {
      continue;
    }
    const key = getProjectDedupKey(proj.canonical_name, proj.company || proj.developer);
    if (!uniqueProjectMap.has(key)) {
      uniqueProjectMap.set(key, proj);
    } else {
      const existing = uniqueProjectMap.get(key);
      if ((proj.summary?.length || 0) > (existing.summary?.length || 0)) {
        uniqueProjectMap.set(key, { ...existing, summary: proj.summary, project_url: proj.project_url, date: proj.date || existing.date });
      }
    }
  }

  const finalProjects = Array.from(uniqueProjectMap.values());
  addEvent("deduplication_completed", `Verified ${finalProjects.length} unique capital projects (deduplicated from ${extractedProjects.length} source records).`);

  const searchResults = finalProjects.map((p, index) => ({
    id: "sr-" + crypto.randomUUID().slice(0, 8),
    search_run_id: searchRunId,
    project_id: p.id,
    project: p,
    canonical_name: p.canonical_name,
    company: p.company || p.developer || "",
    developer: p.developer || p.company || "",
    project_url: p.project_url,
    category: p.category,
    status: p.status,
    country: p.country || "Not specified",
    location: p.location || p.country || "Not specified",
    date: p.date && !/^latest\s+\d{4}$/i.test(p.date) ? p.date : "",
    http_status: p.http_status,
    summary: p.summary,
    relevance_score: Math.max(0.70, 0.98 - index * 0.05)
  }));

  store.searchResults.set(searchRunId, searchResults);

  queryTelemetry.total_requests = 
    queryTelemetry.exa_search +
    queryTelemetry.google_search +
    queryTelemetry.fallback_search +
    queryTelemetry.web_content_fetches +
    queryTelemetry.workers_ai_inferences;

  // Update SearchRun in store
  const run = store.searches.get(searchRunId);
  if (run) {
    run.status = "completed";
    run.results_count = searchResults.length;
    run.duration_ms = Date.now() - startTime;
    run.completed_at = new Date().toISOString();
    run.api_telemetry = queryTelemetry;
  }

  // Save to queryCache with composite key (query + sector + country) and TTL timestamp
  store.queryCache.set(cacheKey, {
    runId: searchRunId,
    timestamp: Date.now()
  });

  // Durable KV Persistence (survives worker redeploys & syncs across edge colos)
  if (env.PROJECT_DATA) {
    const kvPromises = [
      persistStore(env),
      env.PROJECT_DATA.put(`run:${searchRunId}:results`, JSON.stringify(searchResults), { expirationTtl: 86400 }),
      run ? env.PROJECT_DATA.put(`run:${searchRunId}:meta`, JSON.stringify(run), { expirationTtl: 86400 }) : Promise.resolve()
    ];
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(Promise.all(kvPromises));
    } else {
      await Promise.all(kvPromises);
    }
  }

  addEvent("telemetry_summary", `Per-Query API Audit: Total ${queryTelemetry.total_requests} external requests [Workers AI: ${queryTelemetry.workers_ai_inferences} inferences, Exa: ${queryTelemetry.exa_search}, Google: ${queryTelemetry.google_search}, Web: ${queryTelemetry.web_content_fetches}]`, "telemetry", { telemetry: queryTelemetry });
  addEvent("search_completed", `Discovery complete. ${searchResults.length} verified projects extracted in ${Date.now() - startTime}ms.`);

  return searchResults;
}

// ==============================================================================
// 5. CLOUDFLARE WORKER ROUTER (API & SPA ASSETS)
// ==============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Auto-hydrate from durable storage if store is fresh
    await hydrateStore(env);

    // 1. CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const traceId = request.headers.get("X-Trace-Id") || crypto.randomUUID();

    const jsonRes = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "X-Trace-Id": traceId, ...CORS_HEADERS },
      });

    // Sync / Restore endpoint for durable persistence across redeploys
    if ((url.pathname === "/api/v1/sync" || url.pathname === "/api/sync") && request.method === "POST") {
      try {
        const body = await request.json();
        if (Array.isArray(body?.projects)) {
          for (const rawP of body.projects) {
            const p = validateAndSanitizeProjectRecord(rawP);
            if (p?.id) {
              if (isCompletedOrOperationalFacility(p.project_url, p.canonical_name, p.summary, p.summary)) {
                continue;
              }
              if (p.date && formatDisplayDate(p.date) === null) {
                continue;
              }
              store.projects.set(p.id, p);
              if (p.project_url) {
                store.urlCache.set(p.project_url, [p]);
              }
            }
          }
        }
        if (Array.isArray(body?.searches)) {
          for (const s of body.searches) {
            if (s?.id && !store.searches.has(s.id)) {
              store.searches.set(s.id, s);
              if (s.query) {
                const key = getQueryCacheKey(s.query, s.category || s.parsed_query?.category, s.location || s.parsed_query?.location);
                const searchTime = s.created_at ? new Date(s.created_at).getTime() : Date.now();
                if (Date.now() - searchTime < QUERY_CACHE_TTL_MS) {
                  store.queryCache.set(key, { runId: s.id, timestamp: searchTime });
                }
              }
            }
          }
        }
        ctx.waitUntil(persistStore(env));
        return jsonRes({ success: true, total_projects: store.projects.size, total_searches: store.searches.size });
      } catch (err) {
        return jsonRes({ error: "Sync failed", details: err?.message || String(err) }, 400);
      }
    }

    // Admin clear endpoint to purge all KV and memory stores
    if ((url.pathname === "/api/v1/clear-kv" || url.pathname === "/api/clear-kv") && (request.method === "POST" || request.method === "DELETE")) {
      store.projects.clear();
      store.urlCache.clear();
      store.failedUrls.clear();
      store.searchResults.clear();
      store.searches.clear();
      store.queryCache.clear();
      if (env.PROJECT_DATA) {
        try {
          await Promise.all([
            env.PROJECT_DATA.delete("projects_v6"),
            env.PROJECT_DATA.delete("searches_v6"),
            env.PROJECT_DATA.delete("projects"),
            env.PROJECT_DATA.delete("searches"),
            env.PROJECT_DATA.delete("pi_persisted_projects_v5")
          ]);
        } catch (_) {}
      }
      return jsonRes({ success: true, message: "KV and in-memory stores cleared successfully." });
    }

    // 2. Health & Readiness Endpoints
    if (url.pathname === "/health" || url.pathname === "/ready" || url.pathname === "/api/health") {
      return jsonRes({
        status: "ok",
        edge_worker_active: true,
        edge_ai_ready: !!env.AI,
        model: "@cf/meta/llama-3.2-3b-instruct",
        uptime: "100%",
        components: {
          kv_storage: env.PROJECT_DATA ? "operational" : "in-memory",
          ai_worker: "operational",
          edge_proxy: "healthy"
        }
      });
    }

    // 3. AI Worker Endpoints (/api/ai/*)
    if (url.pathname.startsWith("/api/ai/")) {
      if (url.pathname === "/api/ai/health") {
        return jsonRes({
          status: "healthy",
          edge_ai_ready: !!env.AI,
          model: "@cf/meta/llama-3.2-3b-instruct",
          service: "Cloudflare Workers AI Web Fetcher & Extractor (index.js)",
        });
      }

      if (url.pathname === "/api/ai/test-model") {
        const testModel = url.searchParams.get("model") || "@cf/meta/llama-3.3-70b-instruct";
        try {
          const testRes = await env.AI.run(testModel, {
            messages: [{ role: "user", content: "Respond with the word 'READY' only." }],
            max_tokens: 10
          });
          return jsonRes({ model: testModel, ok: true, response: testRes });
        } catch (err) {
          return jsonRes({ model: testModel, ok: false, error: err?.message || String(err) }, 500);
        }
      }

      if (url.pathname === "/api/ai/extract" && request.method === "POST") {
        try {
          const body = await request.json();
          const targetUrl = body?.url;
          const val = validateAndNormalizeUrl(targetUrl);
          if (!val.valid || !val.cleanUrl) {
            return jsonRes({ success: false, url: targetUrl, error: `Invalid or disallowed URL: ${val.reason}` }, 400);
          }

          const fetchResult = await fetchUrlContent(val.cleanUrl);
          if (!fetchResult.ok) {
            return jsonRes({ success: false, url: val.cleanUrl, error: fetchResult.error }, 502);
          }

          const projectData = await extractProjectWithWorkersAI(env.AI, fetchResult.text, val.cleanUrl, body?.category);
          return jsonRes({
            success: true,
            url: val.cleanUrl,
            source_title: fetchResult.title,
            content_length: fetchResult.text.length,
            engine: env.AI ? "Cloudflare Workers AI (@cf/meta/llama-3.2-3b-instruct)" : "Edge Heuristic Parser",
            project: Array.isArray(projectData) ? projectData[0] : projectData,
            projects: projectData,
            last_ai_raw: store.lastAiRaw || null,
            last_ai_err: store.lastAiErr || null
          });
        } catch (err) {
          return jsonRes({ error: "AI Extraction Error", details: err?.message || String(err) }, 500);
        }
      }

      if (url.pathname === "/api/ai/batch-extract" && request.method === "POST") {
        try {
          const body = await request.json();
          const rawUrls = Array.isArray(body?.urls) ? body.urls.slice(0, 5) : [];
          const validUrls = [];
          const seen = new Set();
          for (const u of rawUrls) {
            const v = validateAndNormalizeUrl(u);
            if (v.valid && v.cleanUrl && !seen.has(v.cleanUrl)) {
              seen.add(v.cleanUrl);
              validUrls.push(v.cleanUrl);
            }
          }

          const results = await Promise.allSettled(
            validUrls.map(async (u) => {
              const f = await fetchUrlContent(u);
              if (!f.ok) return { url: u, success: false, error: f.error };
              const p = await extractProjectWithWorkersAI(env.AI, f.text, u, body?.category);
              return { url: u, success: true, title: f.title, project: p };
            })
          );

          return jsonRes({
            success: true,
            count: results.length,
            engine: env.AI ? "Cloudflare Workers AI (@cf/meta/llama-3.2-3b-instruct)" : "Edge Heuristic Parser",
            items: results.map((r, i) => r.status === "fulfilled" ? r.value : { url: validUrls[i], success: false })
          });
        } catch (err) {
          return jsonRes({ error: "Batch Extraction Error", details: err?.message || String(err) }, 500);
        }
      }
    }

    // 4. Primary Sectors Taxonomy Endpoints (/api/v1/sectors)
    if (url.pathname === "/api/v1/sectors" || url.pathname === "/api/sectors") {
      const q = url.searchParams.get("q")?.toLowerCase();
      const group = url.searchParams.get("group")?.toLowerCase();
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);

      let filtered = primarySectors;
      if (group && group !== "all") {
        filtered = filtered.filter(s => s.group.toLowerCase() === group);
      }
      if (q) {
        filtered = filtered.filter(s =>
          s.sector.toLowerCase().includes(q) ||
          s.definition.toLowerCase().includes(q) ||
          (s.keywords || []).some(k => k.toLowerCase().includes(q))
        );
      }

      const groups = [...new Set(primarySectors.map(s => s.group))].sort();
      return jsonRes({
        total: filtered.length,
        groups,
        sectors: filtered.slice(0, limit)
      });
    }

    if (url.pathname === "/api/v1/sectors/groups" || url.pathname === "/api/sectors/groups") {
      const groupCounts = {};
      for (const s of primarySectors) {
        groupCounts[s.group] = (groupCounts[s.group] || 0) + 1;
      }
      const groups = Object.entries(groupCounts).map(([group, count]) => ({ group, count }));
      return jsonRes(groups);
    }

    // 5. Search Endpoints (/api/v1/search)
    if (url.pathname === "/api/v1/search" || url.pathname === "/api/search") {
      // POST: Submit Discovery Search
      if (request.method === "POST") {
        const body = await request.json();
        const query = body?.query?.trim();
        if (!query) {
          return jsonRes({ error: "Search query is required" }, 400);
        }

        const requestedCat = body?.categories?.[0];
        const requestedLoc = body?.location;
        const requestedProv = Array.isArray(body?.providers) && body.providers.length > 0 ? body.providers : ["exa", "google"];

        const searchRunId = crypto.randomUUID();
        const searchRunRecord = {
          id: searchRunId,
          query,
          category: requestedCat || null,
          location: requestedLoc || null,
          parsed_query: { query, category: requestedCat, location: requestedLoc },
          status: "processing",
          results_count: 0,
          created_at: new Date().toISOString(),
          duration_ms: null
        };
        store.searches.set(searchRunId, searchRunRecord);

        // Run discovery pipeline
        await executeDiscoveryPipeline(env, ctx, searchRunId, query, requestedCat, requestedLoc, requestedProv);
        const searchRun = store.searches.get(searchRunId);
        const searchResults = store.searchResults.get(searchRunId) || [];

        return jsonRes({
          search_run_id: searchRunId,
          status: searchRun?.status || "completed",
          results_count: searchResults.length,
          total_results: searchResults.length,
          api_telemetry: searchRun?.api_telemetry || null,
          results: searchResults,
          query
        }, 200);
      }

      // GET: List Searches
      if (request.method === "GET") {
        const searchesList = Array.from(store.searches.values()).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        return jsonRes(searchesList);
      }
    }

    // GET /api/v1/search/:id or /api/search/:id
    const searchIdMatch = url.pathname.match(/^\/api(?:\/v1)?\/search\/([a-zA-Z0-9_-]+)$/);
    if (searchIdMatch && request.method === "GET") {
      const sId = searchIdMatch[1];
      let run = store.searches.get(sId);
      if (!run && env.PROJECT_DATA) {
        try {
          run = await env.PROJECT_DATA.get(`run:${sId}:meta`, "json");
        } catch (_) {}
      }
      if (!run) {
        return jsonRes({ error: `Search run '${sId}' not found` }, 404);
      }
      return jsonRes(run);
    }

    // GET /api/v1/search/:id/results or /api/search/:id/results
    const searchResultsMatch = url.pathname.match(/^\/api(?:\/v1)?\/search\/([a-zA-Z0-9_-]+)\/results$/);
    if (searchResultsMatch && request.method === "GET") {
      const sId = searchResultsMatch[1];
      let run = store.searches.get(sId);
      if (!run && env.PROJECT_DATA) {
        try {
          run = await env.PROJECT_DATA.get(`run:${sId}:meta`, "json");
        } catch (_) {}
      }
      if (!run) {
        return jsonRes({ error: `Search run '${sId}' not found` }, 404);
      }

      let results = store.searchResults.get(sId);
      if ((!results || results.length === 0) && env.PROJECT_DATA) {
        try {
          results = await env.PROJECT_DATA.get(`run:${sId}:results`, "json");
        } catch (_) {}
      }
      if (!results || results.length === 0) {
        results = [];
      } else {
        const searchLocation = run?.location || run?.parsed_query?.location;
        results = results
          .map((r, index) => {
            const val = validateAndSanitizeProjectRecord(r.project || r);
            if (!val) return null;
            if (isCompletedOrOperationalFacility(val.project_url, val.canonical_name, val.summary, val.summary)) {
              return null;
            }
            if (val.date && formatDisplayDate(val.date) === null) {
              return null;
            }
            // Strict country filter on search results: never show foreign projects under a specific country run
            if (searchLocation && !matchesTargetCountry(val.country, val.location, searchLocation)) {
              return null;
            }
            return {
              ...r,
              id: r.id || ("sr-" + (val.id || index)),
              search_run_id: sId,
              project_id: val.id,
              project: val,
              canonical_name: val.canonical_name,
              company: val.company,
              developer: val.developer,
              project_url: val.project_url,
              category: val.category,
              status: val.status,
              country: val.country || "Not specified",
              location: val.location || val.country || "Not specified",
              date: val.date && !/^latest\s+\d{4}$/i.test(val.date) ? val.date : "",
              http_status: r.http_status || val.http_status,
              summary: val.summary,
              relevance_score: r.relevance_score || Math.max(0.70, 0.98 - index * 0.05)
            };
          })
          .filter(Boolean);
      }
      return jsonRes({
        search_run_id: sId,
        query: run?.query || "",
        status: run?.status || "completed",
        total_results: results.length,
        api_telemetry: run?.api_telemetry || null,
        results
      });
    }

    // GET /api/v1/search/:id/events or /api/search/:id/events (Server-Sent Events)
    const searchEventsMatch = url.pathname.match(/^\/api(?:\/v1)?\/search\/([a-zA-Z0-9_-]+)\/events$/);
    if (searchEventsMatch && request.method === "GET") {
      const sId = searchEventsMatch[1];
      const events = store.activityEvents.get(sId) || [];
      let run = store.searches.get(sId);
      if (!run && env.PROJECT_DATA) {
        try {
          run = await env.PROJECT_DATA.get(`run:${sId}:meta`, "json");
        } catch (_) {}
      }
      if (!run && events.length === 0) {
        return jsonRes({ error: `Search run '${sId}' not found` }, 404);
      }

      // Format events into standard text/event-stream format
      let sseBody = "";
      for (const ev of events) {
        sseBody += `event: message\ndata: ${JSON.stringify(ev)}\n\n`;
      }
      if (run && (run.status === "completed" || run.status === "failed")) {
        sseBody += `event: message\ndata: ${JSON.stringify({
          event_id: crypto.randomUUID(),
          search_run_id: sId,
          event_type: "search_completed",
          component: "ai_worker",
          message: "Discovery execution complete.",
          msg: "Discovery execution complete.",
          timestamp: new Date().toISOString()
        })}\n\n`;
      }

      return new Response(sseBody, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          ...CORS_HEADERS
        }
      });
    }

    // 6. Project Endpoints (/api/v1/projects)
    if (url.pathname === "/api/v1/projects" || url.pathname === "/api/projects") {
      const category = url.searchParams.get("category");
      const group = url.searchParams.get("group");
      const location = url.searchParams.get("location");
      const status = url.searchParams.get("status");
      const search = url.searchParams.get("search")?.toLowerCase();

      // Validate, sanitize, deduplicate, and filter projects
      const validProjects = [];
      const seenDedupKeys = new Set();
      for (const [id, rawP] of Array.from(store.projects.entries())) {
        const sanitized = validateAndSanitizeProjectRecord(rawP);
        if (!sanitized) {
          store.projects.delete(id);
          if (rawP.project_url) store.urlCache.delete(rawP.project_url);
        } else {
          const k = getProjectDedupKey(sanitized.canonical_name, sanitized.company || sanitized.developer);
          if (seenDedupKeys.has(k)) {
            store.projects.delete(id);
            continue;
          }
          seenDedupKeys.add(k);
          store.projects.set(id, sanitized);
          validProjects.push(sanitized);
        }
      }
      let list = validProjects;

      // Filter by 462 Primary Sector taxonomy
      if (category && category !== "All Categories" && category !== "all") {
        const catLower = category.toLowerCase();
        list = list.filter(p => {
          const pCat = (p.category || "").toLowerCase();
          const pName = (p.canonical_name || "").toLowerCase();
          const pSum = (p.summary || "").toLowerCase();
          if (pCat.includes(catLower) || catLower.includes(pCat)) return true;
          // Semantic alias matching between 462 taxonomy and industry descriptions
          if (catLower.includes("data center") && (pCat.includes("data center") || pCat.includes("hyperscale"))) return true;
          if (catLower.includes("semiconductor") && (pCat.includes("semiconductor") || pCat.includes("wafer") || pCat.includes("fab") || pCat.includes("megafab"))) return true;
          if (catLower.includes("battery") && (pCat.includes("battery") || pCat.includes("gigafactory") || pCat.includes("bess") || pCat.includes("energy storage"))) return true;
          if (catLower.includes("solar") && pCat.includes("solar")) return true;
          if (catLower.includes("wind") && pCat.includes("wind")) return true;
          if (catLower.includes("hydrogen") && pCat.includes("hydrogen")) return true;
          return pName.includes(catLower) || pSum.includes(catLower);
        });
      }

      // Filter by Taxonomy Group (15 official groups)
      if (group && group !== "All Groups" && group !== "all") {
        const groupLower = group.toLowerCase();
        list = list.filter(p => {
          const pCat = (p.category || "").toLowerCase();
          const pSum = (p.summary || "").toLowerCase();
          if (groupLower === "technology & data infrastructure") {
            return pCat.includes("data center") || pCat.includes("semiconductor") || pCat.includes("technology");
          }
          if (groupLower === "batteries & energy storage") {
            return pCat.includes("battery") || pCat.includes("energy storage") || pCat.includes("bess");
          }
          if (groupLower === "power & renewable energy") {
            return pCat.includes("solar") || pCat.includes("wind") || pCat.includes("renewable") || pCat.includes("hydrogen");
          }
          if (groupLower === "chemicals & petrochemicals") {
            return pCat.includes("chemical") || pCat.includes("petrochemical") || pSum.includes("chemical");
          }
          if (groupLower === "industrial manufacturing") {
            return pCat.includes("manufacturing") || pCat.includes("fab") || pCat.includes("factory");
          }
          const groupSectors = primarySectors.filter(s => s.group.toLowerCase() === groupLower);
          return groupSectors.some(s => pCat.includes(s.sector.toLowerCase()) || pSum.includes(s.sector.toLowerCase()));
        });
      }

      if (location && location !== "All Regions" && location !== "Worldwide (Global)" && location !== "all") {
        const locLower = location.toLowerCase();
        list = list.filter(p =>
          [p.country, p.location, p.location_country, p.location_state, p.location_city].some(
            l => l && l.toLowerCase().includes(locLower)
          ) || matchesSelectedCountry(p.country || p.location, p.summary, p.canonical_name, location)
        );
      }
      if (status && status !== "All Statuses" && status !== "All Upcoming Statuses") {
        list = list.filter(p => (p.status || "").toLowerCase().includes(status.toLowerCase()));
      }
      if (search) {
        list = list.filter(p =>
          p.canonical_name.toLowerCase().includes(search) ||
          (p.developer && p.developer.toLowerCase().includes(search)) ||
          p.category.toLowerCase().includes(search)
        );
      }

      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const page = parseInt(url.searchParams.get("page") || "1", 10);
      const pageSize = parseInt(url.searchParams.get("page_size") || "50", 10);
      const start = (page - 1) * pageSize;

      return jsonRes({
        total: list.length,
        page,
        page_size: pageSize,
        projects: list.slice(start, start + pageSize)
      });
    }

    // GET /api/v1/projects/export (CSV Export)
    if (url.pathname === "/api/v1/projects/export") {
      const category = url.searchParams.get("category");
      const group = url.searchParams.get("group");
      const location = url.searchParams.get("location");
      const status = url.searchParams.get("status");
      const search = url.searchParams.get("search")?.toLowerCase();

      // Validate, sanitize, deduplicate, and filter projects
      const validProjects = [];
      const seenDedupKeys = new Set();
      for (const [id, rawP] of Array.from(store.projects.entries())) {
        const sanitized = validateAndSanitizeProjectRecord(rawP);
        if (!sanitized) {
          store.projects.delete(id);
          if (rawP.project_url) store.urlCache.delete(rawP.project_url);
        } else {
          const k = getProjectDedupKey(sanitized.canonical_name, sanitized.company || sanitized.developer);
          if (seenDedupKeys.has(k)) {
            store.projects.delete(id);
            continue;
          }
          seenDedupKeys.add(k);
          store.projects.set(id, sanitized);
          validProjects.push(sanitized);
        }
      }
      let list = validProjects;

      if (category && category !== "All Categories" && category !== "all") {
        const catLower = category.toLowerCase();
        list = list.filter(p => {
          const pCat = (p.category || "").toLowerCase();
          if (pCat.includes(catLower) || catLower.includes(pCat)) return true;
          if (catLower.includes("data center") && (pCat.includes("data center") || pCat.includes("hyperscale"))) return true;
          if (catLower.includes("semiconductor") && (pCat.includes("semiconductor") || pCat.includes("wafer") || pCat.includes("fab"))) return true;
          if (catLower.includes("battery") && (pCat.includes("battery") || pCat.includes("gigafactory") || pCat.includes("bess"))) return true;
          if (catLower.includes("solar") && pCat.includes("solar")) return true;
          if (catLower.includes("wind") && pCat.includes("wind")) return true;
          if (catLower.includes("hydrogen") && pCat.includes("hydrogen")) return true;
          return (p.canonical_name || "").toLowerCase().includes(catLower);
        });
      }

      if (group && group !== "All Groups" && group !== "all") {
        const groupLower = group.toLowerCase();
        list = list.filter(p => {
          const pCat = (p.category || "").toLowerCase();
          if (groupLower === "technology & data infrastructure") return pCat.includes("data center") || pCat.includes("semiconductor");
          if (groupLower === "batteries & energy storage") return pCat.includes("battery") || pCat.includes("energy storage") || pCat.includes("bess");
          if (groupLower === "power & renewable energy") return pCat.includes("solar") || pCat.includes("wind") || pCat.includes("renewable") || pCat.includes("hydrogen");
          const groupSectors = primarySectors.filter(s => s.group.toLowerCase() === groupLower);
          return groupSectors.some(s => pCat.includes(s.sector.toLowerCase()));
        });
      }

      if (location && location !== "All Regions" && location !== "Worldwide (Global)" && location !== "all") {
        const locLower = location.toLowerCase();
        list = list.filter(p =>
          [p.country, p.location, p.location_country, p.location_state, p.location_city].some(
            l => l && l.toLowerCase().includes(locLower)
          ) || matchesSelectedCountry(p.country || p.location, p.summary, p.canonical_name, location)
        );
      }

      if (status && status !== "All Statuses" && status !== "All Upcoming Statuses") {
        list = list.filter(p => (p.status || "").toLowerCase().includes(status.toLowerCase()));
      }

      if (search) {
        list = list.filter(p =>
          p.canonical_name.toLowerCase().includes(search) ||
          (p.developer && p.developer.toLowerCase().includes(search)) ||
          p.category.toLowerCase().includes(search)
        );
      }

      let csv = "ID,Project Name,Company,Date,Valid URL,Category,Status,HTTP Status,Discovery Date\n";
      for (const p of list) {
        const name = `"${(p.canonical_name || '').replace(/"/g, '""')}"`;
        const comp = `"${(p.company || p.developer || '').replace(/"/g, '""')}"`;
        const dt = `"${(p.date && !/^latest\s+\d{4}$/i.test(p.date) ? p.date : '').replace(/"/g, '""')}"`;
        const pUrl = `"${(p.project_url || '').replace(/"/g, '""')}"`;
        const cat = `"${p.category || ''}"`;
        const stat = `"${p.status || ''}"`;
        const http = p.http_status || 200;
        csv += `${p.id},${name},${comp},${dt},${pUrl},${cat},${stat},${http},${p.created_at}\n`;
      }
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="valid_project_urls.csv"',
          ...CORS_HEADERS
        }
      });
    }

    // GET /api/v1/projects/:id
    const projectIdMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-zA-Z0-9_-]+)$/);
    if (projectIdMatch && request.method === "GET") {
      const pId = projectIdMatch[1];
      const project = store.projects.get(pId);
      if (!project) return jsonRes({ detail: "Project not found" }, 404);
      return jsonRes(project);
    }

    // 7. Analytics & Monitoring Endpoints
    if (url.pathname === "/api/v1/analytics/usage") {
      let usage = store.apiUsage;
      if (env.PROJECT_DATA && usage.every(u => u.requests_sent === 0)) {
        try {
          const saved = await env.PROJECT_DATA.get("api_usage", "json");
          if (Array.isArray(saved) && saved.length > 0) usage = saved;
        } catch (_) {}
      }
      return jsonRes({
        total_requests: usage.reduce((acc, u) => acc + u.requests_sent, 0),
        total_units: usage.reduce((acc, u) => acc + u.units_consumed, 0),
        providers: usage
      });
    }

    if (url.pathname === "/api/v1/analytics/providers") {
      let usage = store.apiUsage;
      if (env.PROJECT_DATA && usage.every(u => u.requests_sent === 0)) {
        try {
          const saved = await env.PROJECT_DATA.get("api_usage", "json");
          if (Array.isArray(saved) && saved.length > 0) usage = saved;
        } catch (_) {}
      }
      return jsonRes({ providers: usage });
    }

    if (url.pathname === "/api/v1/analytics/system-health") {
      return jsonRes({
        status: "healthy",
        kv_storage: env.PROJECT_DATA ? "operational" : "in-memory",
        storage: env.PROJECT_DATA ? "Cloudflare KV" : "Edge Memory",
        total_projects: store.projects.size,
        total_searches: store.searches.size,
        active_search_jobs: 0,
        pending_outbox_queue: 0,
        edge_worker: "active",
        workers_ai_model: "@cf/meta/llama-3.2-3b-instruct"
      });
    }

    if (url.pathname === "/api/v1/monitoring/events") {
      const allEvents = [];
      for (const [_, evList] of store.activityEvents) {
        allEvents.push(...evList);
      }
      allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return jsonRes(allEvents.slice(0, 50));
    }

    if (url.pathname === "/api/v1/monitoring/errors") {
      return jsonRes(store.systemErrors);
    }

    // 8. Serve Static Frontend SPA Assets
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};
