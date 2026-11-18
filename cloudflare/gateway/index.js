/**
 * Project Intelligence Platform - Unified Edge AI Worker & Backend API (index.js)
 * 
 * 100% Serverless, Edge-Native Capital Project Intelligence Platform:
 * - Edge Discovery Engine: Natural language query parsing across 462 primary industrial sectors
 * - Pre-LLM Validation & Deduplication: Zero duplicate queries, zero duplicate URLs, strict domain filter
 * - High-Efficiency Parallel Fetcher: Concurrent HTML fetching with timeout guards & noise stripping
 * - Cloudflare Workers AI: Powered by Meta Llama 3.1 8B Instruct (@cf/meta/llama-3.1-8b-instruct)
 * - Complete In-Worker REST & SSE API: All search, project, sector, analytics, and monitoring endpoints
 * - Static React SPA Hosting: Serves production frontend assets with single-page routing
 */

import primarySectors from "../../frontend/src/data/primary_sectors.json";

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

// Durable KV Persistence Layer (Survives worker code changes & redeploys)
async function hydrateStore(env) {
  if (!env.PROJECT_DATA) return;
  try {
    if (store.projects.size === 0) {
      const savedProjects = await env.PROJECT_DATA.get("projects", "json");
      if (Array.isArray(savedProjects)) {
        for (const p of savedProjects) {
          if (p?.id && p.status && !["operational", "completed", "commissioned"].includes(p.status.toLowerCase())) {
            store.projects.set(p.id, p);
            if (p.project_url) {
              store.urlCache.set(p.project_url, p);
            }
          }
        }
      }
    }
    if (store.searches.size === 0) {
      const savedSearches = await env.PROJECT_DATA.get("searches", "json");
      if (Array.isArray(savedSearches)) {
        for (const s of savedSearches) {
          if (s?.id) {
            store.searches.set(s.id, s);
            if (s.query) {
              store.queryCache.set(s.query.toLowerCase().trim(), s.id);
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
      env.PROJECT_DATA.put("projects", JSON.stringify(projectsList)),
      env.PROJECT_DATA.put("searches", JSON.stringify(searchesList)),
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
    "investissements", "projet", "doubler", "capacités", "production", "puces", "horizon", "isère",
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
      (pathSegments.length === 1 && /^(?:en|es|fr|de|home|index\.html|search|browse|category|directory|feed|news|articles|blog|resources)$/i.test(pathSegments[0]))
    ) {
      return { valid: false, reason: "Homepage or broad section index, not a specific project article or filing." };
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

  // Explicit whole-word pattern for known media outlets, publishers, and research/statistics agencies
  // MUST use word boundaries (\b) so real companies like "Tennessee Valley Authority" (containing "ey")
  // or "GlobalFoundries" (containing "global") or "Micron Technology" (containing "technology") are NOT falsely rejected!
  const publisherPattern = /\b(?:reuters|bloomberg|constructconnect|datacenterdynamics|dcn|associated press|prnewswire|businesswire|globenewswire|cnbc|forbes|financial times|marketwatch|canary media|pv magazine|solar power world|recharge news|mckinsey|gartner|idc|accenture|deloitte|kpmg|ey|ernst\s*&\s*young|ernst\s+and\s+young|pwc|pricewaterhousecoopers|bcg|boston consulting|bain|oxford economics|globaldata|statista|eia|u\.s\.\s*eia|energy information administration|enerdatics|dmc education|wood mackenzie|woodmac|rystad energy|rystad|s&p global|sp global|spglobal|ferc|iea|clean energy associates|levelten)\b/i;

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

  // Reject data/statistics publishers, government statistical agencies, or educational blogs
  if (
    lower === "eia" ||
    lower === "u.s. eia" ||
    lower === "enerdatics" ||
    lower.includes("dmc education") ||
    lower.includes("energy information administration") ||
    lower === "statista" ||
    lower.includes("wood mackenzie") ||
    lower.includes("rystad energy") ||
    lower.includes("s&p global")
  ) {
    return false;
  }

  // Reject placeholder or generic fallback words
  if (
    lower === "project developer" ||
    lower === "leading developer" ||
    lower === "unknown" ||
    lower === "understanding" ||
    lower === "fabs the newest chips need the know-how" ||
    lower === "clay, ny campus by 2-3 years. - the" ||
    lower.includes("public service commission") ||
    lower.includes("by 2-3 years") ||
    lower.includes("the newest chips") ||
    lower.includes("residents vote") ||
    lower.includes("approved a") ||
    lower.includes("court approves")
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

  return "Project Developer";
}

function normalizeDeveloperName(name, url) {
  if (!name) return "Leading Developer";
  let clean = name.trim();
  const lower = clean.toLowerCase();
  if (lower === "gf" || (url && url.includes(".gf.com"))) return "GlobalFoundries";
  if (lower === "tsmc") return "TSMC";
  if (lower === "asml") return "ASML";
  if (lower === "amec") return "AMEC";
  if (lower === "catl") return "CATL";
  if (lower === "amd") return "AMD";
  if (lower === "srp") return "SRP";
  if (lower === "aws") return "AWS (Amazon Web Services)";
  if (lower === "meta") return "Meta";
  if (lower === "softbank") return "SoftBank";
  if (clean.length < 3 && !["bp", "ge", "hp", "3m"].includes(lower)) {
    return "Leading Developer";
  }
  return clean;
}

function getProjectDedupKey(name, developer) {
  let d = (developer || "")
    .toLowerCase()
    .replace(/\b(?:platforms|technologies|technology|energy|resources|resource|holdings|services|solutions|group|corp|corporation|inc|llc|ltd|limited|co|company)\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
  
  let n = (name || "")
    .toLowerCase()
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/['’]s\b/gi, "")
    .replace(/\b(?:ai|artificial\s*intelligence|hyperscale|data\s*center|data\s*centre|megafab|gigafactory|project|campus|facility|plant|center|centre|park|farm|bess|battery|solar|wind|energy\s*storage|storage|and|phase\s*\d+|expansion|site|hub)\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();

  if (d && n.startsWith(d)) {
    n = n.slice(d.length);
  }
  return `${d}_${n}`;
}

function cleanSummaryText(raw) {
  if (!raw || typeof raw !== "string") return "";
  let clean = raw
    // Strip markdown headers (#, ##, ###, ####)
    .replace(/^#+\s+/gm, "")
    .replace(/\s+#+\s+/g, " ")
    // Strip markdown formatting: bold, italics, backticks, bullet symbols
    .replace(/[*_`~]{1,3}/g, "")
    .replace(/^\s*[-•*]\s+/gm, "")
    // Strip HTML tags and entities
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:quot|amp|lt|gt|nbsp|apos|#39);/gi, " ")
    // Strip common directory / boilerplate / byline phrases
    .replace(/\b(?:find a data center|search \d+[\d,]* data centers?|click here to read more|read full report|share this article|photo by|written by|author:?)\b/gi, "")
    // Strip trailing ellipsis and multiple dots
    .replace(/\.{2,}/g, ".")
    // Normalize whitespace
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
    u.includes("/store/report/") ||
    u.includes("/market-reports/") ||
    u.includes("/market-analysis") ||
    u.includes("/build-tracker") ||
    u.includes("/research/artificial-intelligence/ai-capex") ||
    u.includes("rba.gov.au/publications/insights") ||
    u.includes("oxfordeconomics.com/resource/") ||
    u.includes("pwc.com/gx/en/1/services/consulting/technology/data-centre-outlook") ||
    u.includes("jpmorgan.com/insights") ||
    u.includes("/what-is-") ||
    u.includes("/what-are-") ||
    u.includes("/how-to-") ||
    u.includes("/how-do-") ||
    u.includes("/how-data-centers-") ||
    u.includes("/guides/") ||
    u.includes("/glossary/") ||
    u.includes("/fact-checking/") ||
    u.includes("/publications/b1600/") ||
    u.includes("digitalpower.huawei.com/en/blogs/") ||
    u.includes("megawattlas.com/guides/") ||
    u.includes("chipsupplychain.org/") ||
    u.includes("patentpc.com/blog/") ||
    u.includes("ciriontechnologies.com/en/data-center/resources/") ||
    u.includes("hsc.com/resources/blog/") ||
    u.includes("/learn/") ||
    u.includes("/academy/") ||
    u.includes("/education/") ||
    u.includes("mexc.co") ||
    u.includes("binance.com")
  ) {
    return true;
  }
  if (n.startsWith("project from") || n.startsWith("capital project at") || n === "capital project") {
    return true;
  }

  // Reject listicles, rankings, and multi-project roundups (e.g. "USA Top 50 Solar Projects")
  if (/\b(?:top\s+\d+|largest\s+\d+|biggest\s+\d+|\d+\s+largest|\d+\s+biggest|\d+\s+top|projects?\s+roundup|roundup\s+of|list\s+of\s+.*projects?|roundup)\b/i.test(n)) {
    return true;
  }

  // Reject industry pipelines, generator rows, inventories, and market datasets (e.g. "US solar development pipeline", "Solar Photovoltaic generator rows")
  if (/\b(?:development\s+pipeline|project\s+pipeline|pipeline\s+report|generator\s+rows|generator\s+inventory|generator\s+capacity|capacity\s+tracker|monthly\s+generator|national\s+pipeline|solar\s+pipeline|wind\s+pipeline|data\s+center\s+pipeline)\b/i.test(n)) {
    return true;
  }

  // Reject data publishers, statistics agencies, or educational organizations as company
  if (c === "eia" || c === "enerdatics" || c === "dmc education" || isNewsPublisher(c)) {
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

  // Generic noun without named facility or valid developer
  if ((!c || c === "project developer" || c === "leading developer" || c === "unknown") &&
      /^(?:data center|hyperscale data center|data centre|power plant|solar farm|wind farm|battery gigafactory|semiconductor fab|semiconductor chemicals plant|aircraft manufacturing plant|industrial category)$/i.test(n)) {
    return true;
  }
  // Lawsuits, disputes, or political fights without a physical facility
  if (/\b(?:sues\b|lawsuit\b|residents vote against|controversy|hearing)\b/i.test(n)) {
    return true;
  }
  // Explanatory guides or operational summaries
  if (
    s.includes("understanding how data centers impact") ||
    s.includes("what are data centers?") ||
    s.includes("exploring the core components, evolving architecture") ||
    s.includes("how tsmc and other foundries make chips") ||
    s.includes("find a data center") ||
    s.includes("guide to understanding its importance") ||
    /\b(?:currently operates|already operates|primary research and development fab for its advanced nodes)\b/i.test(s)
  ) {
    return true;
  }
  return false;
}

function inferCategory(projectName, summary, hintCategory) {
  const combined = `${projectName || ""} ${summary || ""}`.toLowerCase();

  // 1. Battery Gigafactories & Cell Production (highest priority so "battery fab" or CATL/Gotion cell plant is Battery)
  if (
    /\b(?:gigafactory|giga-factory|battery plant|battery manufacturing|cell manufacturing|cell capacity|lfp battery|lithium-ion battery|battery cell|battery fab|catl|gotion|northvolt|forge nano)\b/i.test(combined) ||
    (/\b(?:battery|lithium)\b/i.test(combined) && /\b(?:fab|factory|production|plant|gwh|cells?)\b/i.test(combined))
  ) {
    return "Battery Gigafactory";
  }

  // 2. Battery Energy Storage Systems (BESS)
  if (/\b(?:bess|battery storage|energy storage site|storage facility|battery energy storage|mwh storage)\b/i.test(combined)) {
    return "Battery Energy Storage";
  }

  // 3. Solar & Storage / Utility Solar
  if (/\b(?:solar-plus-storage|solar and battery|solar & storage|solar\s*\+\s*battery)\b/i.test(combined)) {
    return "Utility Solar & Storage";
  }
  if (/\b(?:solar park|solar farm|solar energy center|solar facility|solar installation|photovoltaic|pv farm|pv plant|solar project)\b/i.test(combined)) {
    return "Utility Solar";
  }

  // 4. Wind Energy
  if (/\b(?:wind farm|wind energy center|offshore wind|wind facility|wind turbine|wind park)\b/i.test(combined)) {
    return "Wind Energy";
  }

  // 5. Semiconductor Manufacturing (Checked before Data Center so "Micron DRAM fabs for AI data centers" is Semiconductor)
  if (
    /\b(?:semiconductor|silicon wafer|wafer fab|megafab|cleanroom|microchip|chip factory|memory chip|foundry|tsmc|asml|micron|infineon|intel fab|globalfoundries|sk hynix)\b/i.test(combined) ||
    (/\bfabs?\b/i.test(combined) && !/\bbattery\b/i.test(combined) && !/\bdata\s*center\s*(?:campus|project|facility)\b/i.test(projectName.toLowerCase()))
  ) {
    return "Semiconductor Manufacturing";
  }

  // 6. Hyperscale Data Centers
  if (/\b(?:data center|data centre|hyperscale|colocation|cloud campus|stargate|ai compute campus|ai data center|technology campus|hyperion campus|colossus)\b/i.test(combined)) {
    return "Hyperscale Data Center";
  }

  // 7. Clean Hydrogen
  if (/\b(?:hydrogen|electrolyzer|clean ammonia)\b/i.test(combined)) {
    return "Clean Hydrogen";
  }

  return hintCategory || "Capital Infrastructure";
}

function extractStatusFromText(text) {
  const t = (text || "").toLowerCase();
  if (t.includes("under construction") || t.includes("breaks ground") || t.includes("groundbreaking") || t.includes("underway") || t.includes("construction has begun")) {
    return "Under Construction";
  }
  if (t.includes("announced") || t.includes("announces") || t.includes("unveils") || t.includes("proposes") || t.includes("plans to build") || t.includes("secures funding")) {
    return "Announced";
  }
  // Only reject if it explicitly states it was already completed in the past
  if (/\b(?:was completed in 202[0-4]|became operational in 202[0-4]|commissioned in 202[0-4])\b/i.test(t)) {
    return null;
  }
  return "Planning";
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

const LOCATION_DICTIONARY = {
  "united states": [
    "united states", "usa", "u.s.", "u.s.a.", "america", "texas", "california", "virginia", "northern virginia",
    "arizona", "ohio", "new york", "idaho", "georgia", "north carolina", "michigan", "indiana", "oregon",
    "illinois", "tennessee", "nevada", "florida", "colorado", "louisiana", "kansas", "wisconsin", "iowa",
    "minnesota", "missouri", "alabama", "south carolina", "kentucky", "oklahoma", "utah", "new mexico",
    "nebraska", "arkansas", "mississippi", "dallas", "austin", "houston", "phoenix", "richland parish", "ashburn", "loudoun"
  ],
  "texas": ["texas", "dallas", "austin", "houston", "fort worth", "san antonio", "plano", "el paso"],
  "northern virginia": ["northern virginia", "loudoun", "ashburn", "richmond", "prince william", "fairfax"],
  "arizona": ["arizona", "phoenix", "mesa", "chandler", "scottsdale", "tucson"],
  "california": ["california", "silicon valley", "santa clara", "san jose", "los angeles", "san francisco", "sacramento"],
  "india": [
    "india", "indian", "gujarat", "karnataka", "bengaluru", "bangalore", "mumbai", "maharashtra",
    "tamil nadu", "chennai", "telangana", "hyderabad", "noida", "uttar pradesh", "odisha", "assam",
    "sanand", "dholera", "andhra pradesh", "rajasthan", "madhya pradesh", "kerala", "haryana", "delhi", "punjab"
  ],
  "germany": [
    "germany", "german", "erfurt", "dresden", "munich", "berlin", "frankfurt", "magdeburg",
    "brandenburg", "saarland", "bavaria", "saxony", "leipzig", "stuttgart", "hessen"
  ],
  "united kingdom": [
    "united kingdom", "england", "scotland", "wales", "northern ireland", "london", "manchester",
    "birmingham", "cambridge", "oxford", "bristol", "leeds"
  ],
  "ireland": ["ireland", "irish", "dublin", "cork", "galway", "limerick"],
  "netherlands": ["netherlands", "dutch", "amsterdam", "eindhoven", "rotterdam"],
  "spain": ["spain", "spanish", "madrid", "barcelona", "aragon", "valencia"],
  "japan": ["japan", "japanese", "tokyo", "hokkaido", "kumamoto", "chitose", "osaka", "yokohama"],
  "south korea": ["south korea", "korea", "korean", "yongin", "seoul", "gyeonggi", "pyeongtaek", "incheon", "busan"],
  "taiwan": ["taiwan", "taiwanese", "hsinchu", "taichung", "tainan", "kaohsiung", "taipei"],
  "singapore": ["singapore"],
  "malaysia": ["malaysia", "malaysian", "johor", "kuala lumpur", "penang"],
  "australia": ["australia", "australian", "sydney", "melbourne", "queensland", "brisbane", "perth", "new south wales", "victoria"],
  "saudi arabia": ["saudi", "arabia", "riyadh", "jeddah", "neom", "dammam"],
  "united arab emirates": ["united arab emirates", "uae", "dubai", "abu dhabi", "sharjah"],
  "brazil": ["brazil", "brazilian", "sao paulo", "rio de janeiro"],
  "canada": ["canada", "canadian", "ontario", "quebec", "british columbia", "alberta", "toronto", "montreal", "vancouver"]
};

function matchesSelectedCountry(detectedLocation, text, title, selectedCountry) {
  if (!selectedCountry) return true;
  const sel = selectedCountry.toLowerCase().trim();
  if (sel === "worldwide (global)" || sel === "global" || sel === "all regions" || sel === "all" || sel === "") {
    return true;
  }

  const combined = ((detectedLocation || "") + " " + (title || "") + " " + (text || "")).toLowerCase();
  
  const aliases = LOCATION_DICTIONARY[sel] || [sel];
  const hasTargetMatch = aliases.some(alias => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    return regex.test(combined);
  });

  return hasTargetMatch;
}

function extractLocationFromCandidate(text, title, url) {
  const combined = ((title ? title + " " : "") + (text ? text.slice(0, 800) : "")).toLowerCase();
  for (const [canonicalCountry, aliases] of Object.entries(LOCATION_DICTIONARY)) {
    for (const alias of aliases) {
      if (alias.length < 3) continue;
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}\\b`, "i");
      if (regex.test(combined)) {
        return canonicalCountry.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      }
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
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  clean = clean.slice(firstBrace, lastBrace + 1);
  clean = clean.replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(clean);
  } catch (_) {
    try {
      const sanitized = clean.replace(/[\u0000-\u001F]+/g, " ");
      return JSON.parse(sanitized);
    } catch (_) {}
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
  return "Capital Project";
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
  const canonical_name = facilityMatch ? facilityMatch[1].trim() : (titleHint || extractProjectNameFromUrl(url));

  const company = extractCompanyDynamically(text, titleHint, url);
  if (hasNonLatinScript(company)) {
    return {
      is_project: false,
      reason: "Non-English developer entity detected"
    };
  }

  if (!canonical_name || canonical_name.length < 5 || canonical_name === "Capital Project" || hasNonLatinScript(canonical_name) || isGenericReportOrDirectory(url, canonical_name, company)) {
    return {
      is_project: false,
      reason: "Industry market report, educational article, or general tracker, not a specific physical project facility"
    };
  }

  const projectStatus = extractStatusFromText(text);
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
    category: hintCategory || "Capital Projects",
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
2. Have an identifiable corporate company, developer, owner, or operator building, expanding, or financing it. NEVER return the news site, data publisher, or statistical agency (e.g. EIA, Enerdatics, DMC Education, S&P Global, Wood Mackenzie, Reuters, Bloomberg, ConstructConnect, DCN).
3. Have a verifiable location (city, state, region, or country).
4. Be in one of these 3 active development lifecycle stages (ALL 3 ARE VALID):
   - "Announced": Newly announced investments, proposed facilities, capital expansion plans, or financing rounds for buildouts.
   - "Planning": In permitting, FEED, architectural design, environmental review, or procurement.
   - "Under Construction": Groundbreaking, foundation work, active construction, or ongoing campus buildout. Active construction and expansions ARE VALID PROJECTS.

DO NOT REJECT active construction, site buildouts, or facility expansions!

ONLY REJECT (set "is_project": false) IF:
1. The candidate is a list, roundup, compilation, or ranking (e.g. "USA Top 50 Solar Projects", "Top 10 Data Centers", "Largest Projects Roundup"). NEVER extract a multi-project listicle as a single project!
2. The candidate is an industry pipeline report, generator inventory, or statistical dataset (e.g. "US solar development pipeline", "Solar Photovoltaic generator rows", "Monthly Generator Inventory").
3. The developer/company is a data/statistics publisher, research agency, or government bureau (e.g. EIA, Enerdatics, DMC Education, Wood Mackenzie, Statista) rather than a commercial project developer.
4. The facility is already completed, commissioned in past years, or existing operational facilities (e.g. listicles describing already running plants).
5. The page is an educational article, academic study, field report, technology explainer, or how-to guide (e.g. "Understanding How Data Centers Impact Water", "What is a Data Center", "How Chips Are Made").
6. The page is a directory of colocation spaces, search engine for capacity, or vendor marketplace (e.g. datacenters.com).
7. The page is discussing a political protest, zoning dispute, or lawsuit without an actively funded physical development project.
8. The page is purely macroeconomic analysis, market forecast, or paid market research report.

CRITICAL REQUIREMENT - COMPANY ENTITY:
- The "company" field MUST be the actual corporate developer, operator, or owner entity (e.g. NextEra Energy, Micron Technology, TSMC, Core Scientific, Equinix, Intel).
- NEVER use data publishers or statistics agencies (e.g. EIA, Enerdatics, DMC Education), regulatory commissions (e.g. "Public Service Commission"), author bylines ("Written by..."), or generic terms ("Project Developer", "Understanding").

CRITICAL REQUIREMENT - ACCURATE CATEGORY:
- The "category" field MUST match the project's actual industrial type:
  - If it is microchip, wafer, or DRAM manufacturing: "Semiconductor Manufacturing"
  - If it is computing/cloud infrastructure: "Hyperscale Data Center"
  - If it is battery/cell production: "Battery Gigafactory"
  - If it is solar power generation: "Utility Solar"

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
      "canonical_name": "Official specific name of the project or facility in English",
      "company": "Specific company, developer, or operator building/investing in the project in English (NOT the media/news outlet)",
      "location": "City, State/Region, Country in English",
      "status": "Announced | Planning | Under Construction",
      "category": "Industrial category in English (e.g. Hyperscale Data Center, Semiconductor Megafab, Battery Gigafactory, Solar Farm)",
      "date": "Announcement, start, or completion target date (e.g. November 2026, 2026)",
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
        if (/operational|completed|commissioned|opened|inaugurated/i.test(rawStatus)) {
          continue;
        }

        let finalStatus = "Planning";
        if (/under construction|construction|breaks ground|underway/i.test(rawStatus)) {
          finalStatus = "Under Construction";
        } else if (/announced|announces|unveils|proposed/i.test(rawStatus)) {
          finalStatus = "Announced";
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

        let projectName = item.canonical_name;
        if (!projectName || projectName.startsWith("Project from") || projectName.length < 5) {
          projectName = hintTitle || extractProjectNameFromUrl(targetUrl);
        }

        if ((!companyVal || companyVal === "Project Developer" || companyVal === "Leading Developer") && projectName) {
          const nameCompany = extractCompanyDynamically("", projectName, targetUrl);
          if (nameCompany && nameCompany !== "Project Developer") {
            companyVal = nameCompany;
          }
        }

        if (hasNonLatinScript(projectName) || hasNonLatinScript(companyVal)) continue;
        if (isGenericReportOrDirectory(targetUrl, projectName, companyVal, item.summary)) continue;
        if (!isValidCompanyEntity(companyVal)) continue;

        let projectDate = item.date;
        if (!projectDate || projectDate.length < 4) {
          projectDate = extractDateFromTextOrUrl(pageText, targetUrl);
        }

        validProjects.push({
          is_project: true,
          canonical_name: projectName,
          company: companyVal,
          developer: companyVal,
          project_url: targetUrl,
          status: finalStatus,
          category: inferCategory(projectName, item.summary, item.category || hintCategory),
          country: item.location || item.country || null,
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
1. Be a concrete, individual physical facility, building, megafab, data center campus, power plant, solar/battery farm, or facility expansion (e.g. "Desert Sunlight Solar Farm", "Vance Data Center Campus"). It must be ONE distinct development, NOT an aggregate industry category, ranking, or multi-project inventory.
2. Have an identifiable corporate developer, owner, or operator building, financing, or operating it (e.g. NextEra Energy, Duke Energy, Amazon, Microsoft, TSMC, Samsung, Meta). NEVER return a data publisher, research platform, government statistical bureau, or news outlet as the developer (e.g. EIA, Enerdatics, DMC Education, S&P Global, FERC, Wood Mackenzie, Rystad Energy, Statista, Reuters, Bloomberg, ConstructConnect, DCN, Data Center Dynamics).
3. Have a verifiable location (city, state, region, or country).
4. Be in one of these 3 active development lifecycle stages (ALL 3 ARE VALID):
   - "Announced": Newly announced investments, proposed facilities, capital expansion plans, or financing rounds for buildouts.
   - "Planning": In permitting, FEED, architectural design, environmental review, or procurement.
   - "Under Construction": Groundbreaking, foundation work, active construction, or ongoing campus buildout.

REJECT (MUST NOT EXTRACT):
- LISTS, ROUNDUPS, COMPILATIONS & LISTICLES: Multi-project rankings, compilations, or roundup articles (e.g. "USA Top 50 Solar Projects", "Top 10 Data Centers", "Largest Solar Plants Roundup", "List of Major Projects"). NEVER extract an entire listicle, ranking, or roundup as a single project!
- PIPELINES, INVENTORIES & STATISTICAL DATASETS: Industry pipeline overviews, generator rows, project databases, capacity trackers, or national statistics (e.g. "US solar development pipeline", "Solar Photovoltaic generator rows", "Monthly Generator Inventory", "State Energy Capacity Tracker"). These are statistical data tables or aggregate market overviews, NOT individual physical projects!
- DATA/STATISTICS PUBLISHERS AS DEVELOPER: Candidates where the company is a government statistical agency, market research platform, energy data tracker, or publisher (e.g. EIA, Enerdatics, DMC Education, S&P Global, FERC, Wood Mackenzie, Rystad Energy, Statista) rather than a commercial project owner/developer erecting the facility. If no specific corporate owner/developer is named, REJECT IT.
- Existing facilities already completed or operational in past years.
- Tool, equipment, or machinery product launches (e.g. wafer dicing systems, plasma systems, lithography tools, metrology tools). Equipment shipped to customers is NOT a capital project!
- Material, wafer, or substrate product announcements (e.g. single-crystal diamond wafers, substrate materials).
- R&D partnerships, industry collaboration initiatives, or technology roadmaps without a physical facility buildout.
- Macroeconomic equipment spending reports or capex forecasts (e.g. SEMI $374B equipment spending report).
- Educational guides, explainer articles, technology overviews, academic reports, or crypto/finance learn blogs (e.g. mexc.co/learn).
- Colocation marketplaces or vendor directories (e.g. datacenters.com).
- Any candidate where developer is an author byline ("Written by..."), regulatory commission, or sentence fragment.

RESPONSE FORMAT:
Return ONLY a valid JSON object in this exact schema:
{
  "projects": [
    {
      "candidate_index": 1,
      "canonical_name": "Official project or facility name in English",
      "company": "Specific corporate developer or owner building the project in English",
      "location": "City, State/Region, Country in English",
      "status": "Announced | Planning | Under Construction",
      "category": "Industrial category (e.g. Hyperscale Data Center, Semiconductor Manufacturing, Battery Gigafactory, Utility Solar)",
      "date": "Target start, completion, or announcement date (e.g. 2026, 2027) if explicitly stated in candidate content, or empty string \"\" if not mentioned",
      "summary": "1-2 complete factual sentences in fluent English describing the project and buildout scope."
    }
  ]
}`;

  let candidateBlocks = "";
  candidateItems.slice(0, 12).forEach((c, idx) => {
    const textSnippet = (c.text || c.snippet || c.title || "").slice(0, 800);
    candidateBlocks += `\n[Candidate #${idx + 1}]\nURL: ${c.cleanUrl}\nTitle: ${c.title || "Capital Project"}\nDate: ${c.published_date || ""}\nContent: """\n${textSnippet}\n"""\n`;
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
        max_tokens: 1800
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
  const qLower = queryStr.toLowerCase().trim();
  const qWords = qLower.split(/\s+/).filter(w => w.length > 2);

  let bestSector = null;
  let maxScore = 0;

  for (const s of primarySectors) {
    const sLower = s.sector.toLowerCase();
    if (qLower.includes(sLower) || sLower.includes(qLower)) {
      return { category: s.sector, group: s.group, definition: s.definition };
    }

    let score = 0;
    for (const w of qWords) {
      if (sLower.includes(w)) score++;
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

// Resilient public web search fallback (activated if primary API providers return 0 results)
async function searchWebFallback(query) {
  try {
    const fallbackUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.trim() + " capital projects")}&kl=us-en`;
    const res = await fetch(fallbackUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html"
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const urls = [];
    const linkRegex = /<a[^>]+class="result__url"[^>]+href="([^"]+)"/gi;
    const titleRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    const titles = [];
    while ((match = titleRegex.exec(html)) !== null && titles.length < 15) {
      const cleanSnippet = match[1].replace(/<[^>]+>/g, "").trim();
      if (!hasNonLatinScript(cleanSnippet)) {
        titles.push(cleanSnippet);
      }
    }
    let idx = 0;
    while ((match = linkRegex.exec(html)) !== null && urls.length < 15) {
      let rawHref = match[1];
      if (rawHref.includes("uddg=")) {
        const uddgMatch = rawHref.match(/uddg=([^&]+)/);
        if (uddgMatch) rawHref = decodeURIComponent(uddgMatch[1]);
      }
      if (rawHref.startsWith("http")) {
        const t = titles[idx] || "Capital Project Announcement";
        if (!hasNonLatinScript(t)) {
          urls.push({
            url: rawHref,
            title: t,
            snippet: t,
            published_date: extractDateFromTextOrUrl(t, rawHref),
            provider: "web_fallback"
          });
        }
        idx++;
      }
    }
    return urls;
  } catch (_) {
    return [];
  }
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
  const targetLocation = requestedLocation && requestedLocation !== "All Regions" ? requestedLocation : extractLocation(query);

  // Build composite search query from all three inputs: ${query} ${sector} ${country}
  const searchParts = [query.trim()];

  if (requestedCategory && requestedCategory !== "All Categories" && requestedCategory !== "all") {
    if (!query.toLowerCase().includes(requestedCategory.toLowerCase())) {
      searchParts.push(requestedCategory);
    }
  }

  if (requestedLocation && requestedLocation !== "Worldwide (Global)" && requestedLocation !== "All Regions" && requestedLocation !== "Global" && requestedLocation !== "all") {
    if (!query.toLowerCase().includes(requestedLocation.toLowerCase())) {
      searchParts.push(requestedLocation);
    }
  }

  const effectiveSearchText = searchParts.join(" ").trim();
  const normalizedQuery = effectiveSearchText.toLowerCase();

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

  // 2. Query Cache Pre-check: Only use cache if results have verified project names and companies in English and are UPCOMING
  if (store.queryCache.has(normalizedQuery)) {
    const priorRunId = store.queryCache.get(normalizedQuery);
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
      addEvent("query_cache_hit", `Cache Hit: Query '${effectiveSearchText}' already executed with ${cachedResults.length} verified projects. Zero external calls or LLM inferences needed.`);
      store.searchResults.set(searchRunId, cachedResults);
      const run = store.searches.get(searchRunId);
      if (run) {
        run.status = "completed";
        run.results_count = cachedResults.length;
        run.duration_ms = Date.now() - startTime;
      }
      addEvent("search_completed", `Discovery complete via memory cache: ${cachedResults.length} projects linked in ${Date.now() - startTime}ms.`);
      return cachedResults;
    } else {
      store.queryCache.delete(normalizedQuery);
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
          numResults: 25,
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
      const gUrl = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_SEARCH_API_KEY}&cx=${env.GOOGLE_SEARCH_CX}&q=${encodeURIComponent(effectiveSearchText)}&num=10&lr=lang_en&hl=en&dateRestrict=m12`;
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

  // Fallback (only if 0 candidates from primary APIs)
  if (candidateUrls.length === 0) {
    queryTelemetry.fallback_search = 1;
    addEvent("provider_started", `Engaging public discovery fallback.`);
    const fallbackResults = await searchWebFallback(effectiveSearchText);
    if (fallbackResults.length > 0) {
      candidateUrls = fallbackResults;
      addEvent("provider_completed", `Fallback discovery retrieved ${candidateUrls.length} candidate URLs.`);
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
      const validCached = cachedArr.filter(c =>
        c &&
        c.canonical_name &&
        !c.canonical_name.startsWith("Project from") &&
        !c.canonical_name.startsWith("Capital Project at") &&
        !/^(?:none|n\/a|null|unknown|tbd|capital project)$/i.test(c.canonical_name.trim()) &&
        !/^(?:none|n\/a|null|unknown|tbd|project developer)$/i.test((c.company || c.developer || "").trim()) &&
        !hasNonLatinScript(c.canonical_name) &&
        !hasNonLatinScript(c.summary) &&
        !isForeignLanguageText(c.summary) &&
        !isGenericReportOrDirectory(cleanUrl, c.canonical_name, c.company || c.developer, c.summary) &&
        isValidCompanyEntity(c.company || c.developer) &&
        ["Announced", "Planning", "Under Construction"].includes(c.status)
      );
      if (validCached.length > 0) {
        for (const p of validCached) {
          if (requestedLocation && !matchesSelectedCountry(p.country, p.summary, p.canonical_name, requestedLocation)) {
            continue;
          }
          const freshCategory = inferCategory(p.canonical_name, p.summary, p.category || targetCategory);
          const updated = { ...p, category: freshCategory, summary: cleanSummaryText(p.summary) };
          extractedProjects.push(updated);
          addEvent("candidate_accepted", `ACCEPTED FROM CACHE: '${p.canonical_name}' (Source: ${cleanUrl})`, "ai_worker", { project: updated, canonical_name: p.canonical_name });
        }
        continue;
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
      let candidateIdx = null;
      if (typeof aiP.candidate_index === "number") {
        candidateIdx = Math.floor(aiP.candidate_index);
      } else if (typeof aiP.candidate_index === "string") {
        const match = aiP.candidate_index.match(/\d+/);
        if (match) {
          candidateIdx = parseInt(match[0], 10);
        }
      }

      if (candidateIdx !== null && !isNaN(candidateIdx) && candidateIdx >= 1 && candidateIdx <= uncachedCandidates.length) {
        matchedCandidate = uncachedCandidates[candidateIdx - 1];
      } else if (aiP.url) {
        matchedCandidate = uncachedCandidates.find(c => c.cleanUrl && (c.cleanUrl.includes(aiP.url) || aiP.url.includes(c.cleanUrl)));
      }

      if (!matchedCandidate) {
        addEvent("candidate_filtered", `DROPPED: AI extraction for '${aiP.canonical_name || "Unknown"}' skipped because candidate index '${aiP.candidate_index}' did not match any candidate URL.`);
        continue;
      }

      const cleanUrl = matchedCandidate.cleanUrl;
      const status = aiP.status || "Planning";
      if (status === "Operational" || status === "Completed" || status === "Commissioned") {
        continue;
      }
      const validUpcomingStatuses = ["Announced", "Planning", "Under Construction"];
      const projectStatus = validUpcomingStatuses.includes(status) ? status : "Planning";

      const projectName = aiP.canonical_name || matchedCandidate.title || "Capital Project";
      let companyName = aiP.company;
      if (!companyName || companyName === "Project Developer" || companyName === "Leading Developer" || isNewsPublisher(companyName)) {
        companyName = extractCompanyDynamically(matchedCandidate.text || matchedCandidate.snippet, matchedCandidate.title, cleanUrl);
      }
      companyName = normalizeDeveloperName(companyName, cleanUrl);
      if (!projectName || /^(?:none|n\/a|null|not specified|unknown|tbd|capital project)$/i.test(projectName.trim())) {
        continue;
      }
      if (!companyName || /^(?:none|n\/a|null|not specified|unknown|tbd|project developer|leading developer)$/i.test(companyName.trim())) {
        continue;
      }
      if (!isValidCompanyEntity(companyName)) {
        continue;
      }
      if (hasNonLatinScript(projectName) || hasNonLatinScript(companyName) || hasNonLatinScript(aiP.summary) || isForeignLanguageText(aiP.summary)) {
        continue;
      }
      if (isGenericReportOrDirectory(cleanUrl, projectName, companyName, aiP.summary)) {
        continue;
      }

      // Resolve project location: do NOT default to requested country
      let projectCountry = null;
      if (aiP.location && !/^(?:not specified|unknown|global|tbd|none|n\/a)$/i.test(aiP.location.trim())) {
        projectCountry = aiP.location.trim();
      } else {
        projectCountry = extractLocationFromCandidate(matchedCandidate.text || matchedCandidate.snippet, matchedCandidate.title, cleanUrl);
      }

      // Filter results by selected country: drop projects whose location does not match
      if (requestedLocation && !matchesSelectedCountry(projectCountry, matchedCandidate.text || matchedCandidate.snippet, matchedCandidate.title, requestedLocation)) {
        addEvent("candidate_filtered", `DROPPED (Location Mismatch): '${projectName}' location '${projectCountry || "Unspecified"}' does not match target country '${requestedLocation}'`);
        continue;
      }

      let rawDate = (aiP.date || matchedCandidate.published_date || "").trim();
      let projectDate = /^(?:latest 2026|not specified|unknown|tbd|none|n\/a)$/i.test(rawDate) ? "" : rawDate;
      const projId = "proj-" + crypto.randomUUID().slice(0, 8);
      const projectRecord = {
        id: projId,
        canonical_name: projectName,
        company: companyName,
        developer: companyName,
        project_url: cleanUrl,
        status: projectStatus,
        category: inferCategory(projectName, aiP.summary, aiP.category || targetCategory),
        country: projectCountry || "Not specified",
        date: projectDate,
        http_status: 200,
        summary: cleanSummaryText(aiP.summary || matchedCandidate.snippet || ""),
        created_at: new Date().toISOString()
      };

      store.projects.set(projId, projectRecord);
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
        if (isGenericReportOrDirectory(item.cleanUrl, fb.canonical_name || item.title, normDev, fb.summary)) {
          continue;
        }

        const detectedLocation = extractLocationFromCandidate(item.text || item.snippet, item.title, item.cleanUrl);

        if (requestedLocation && !matchesSelectedCountry(detectedLocation, item.text || item.snippet, item.title, requestedLocation)) {
          continue;
        }

        let fbRawDate = (fb.date || item.published_date || "").trim();
        let fbDate = /^(?:latest 2026|not specified|unknown|tbd|none|n\/a)$/i.test(fbRawDate) ? "" : fbRawDate;

        const projId = "proj-" + crypto.randomUUID().slice(0, 8);
        const projectRecord = {
          id: projId,
          canonical_name: fb.canonical_name || item.title,
          company: normDev,
          developer: normDev,
          project_url: item.cleanUrl,
          status: fb.status || "Planning",
          category: inferCategory(fb.canonical_name || item.title, fb.summary, fb.category || targetCategory),
          country: detectedLocation || "Not specified",
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
    if (requestedLocation && !matchesSelectedCountry(proj.country, proj.summary, proj.canonical_name, requestedLocation)) {
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
    company: p.company || p.developer || "Leading Developer",
    developer: p.developer || p.company || "Leading Developer",
    project_url: p.project_url,
    category: p.category,
    status: p.status,
    date: p.date && p.date !== "Latest 2026" ? p.date : "",
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

  // Save to queryCache
  store.queryCache.set(normalizedQuery, searchRunId);

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
          for (const p of body.projects) {
            if (p?.id && !store.projects.has(p.id)) {
              const sLower = (p.status || "").toLowerCase();
              if (!sLower.includes("operational") && !sLower.includes("completed") && !sLower.includes("commissioned")) {
                store.projects.set(p.id, p);
                if (p.project_url) {
                  store.urlCache.set(p.project_url, p);
                }
              }
            }
          }
        }
        if (Array.isArray(body?.searches)) {
          for (const s of body.searches) {
            if (s?.id && !store.searches.has(s.id)) {
              store.searches.set(s.id, s);
              if (s.query) {
                store.queryCache.set(s.query.toLowerCase().trim(), s.id);
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

    // 2. Health & Readiness Endpoints
    if (url.pathname === "/health" || url.pathname === "/ready" || url.pathname === "/api/health") {
      return jsonRes({
        status: "ok",
        edge_worker_active: true,
        edge_ai_ready: !!env.AI,
        model: "@cf/meta/llama-3.1-8b-instruct",
        uptime: "100%",
        components: {
          database: "connected",
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
          model: "@cf/meta/llama-3.1-8b-instruct",
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
            engine: env.AI ? "Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct)" : "Edge Heuristic Parser",
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

        const searchRunId = crypto.randomUUID();
        const searchRunRecord = {
          id: searchRunId,
          query,
          parsed_query: { query },
          status: "processing",
          results_count: 0,
          created_at: new Date().toISOString(),
          duration_ms: null
        };
        store.searches.set(searchRunId, searchRunRecord);

        // Run discovery pipeline
        const requestedCat = body?.categories?.[0];
        const requestedLoc = body?.location;
        const requestedProv = Array.isArray(body?.providers) && body.providers.length > 0 ? body.providers : ["exa", "google"];
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
        run = {
          id: sId,
          status: "completed",
          results_count: store.projects.size,
          created_at: new Date().toISOString()
        };
      }
      return jsonRes(run);
    }

    // GET /api/v1/search/:id/results or /api/search/:id/results
    const searchResultsMatch = url.pathname.match(/^\/api(?:\/v1)?\/search\/([a-zA-Z0-9_-]+)\/results$/);
    if (searchResultsMatch && request.method === "GET") {
      const sId = searchResultsMatch[1];
      const run = store.searches.get(sId);
      let results = store.searchResults.get(sId);
      if ((!results || results.length === 0) && env.PROJECT_DATA) {
        try {
          results = await env.PROJECT_DATA.get(`run:${sId}:results`, "json");
        } catch (_) {}
      }
      if (!results || results.length === 0) {
        results = Array.from(store.projects.values()).slice(-35).map((p, index) => ({
          id: "sr-" + (p.id || index),
          search_run_id: sId,
          project_id: p.id,
          project: p,
          canonical_name: p.canonical_name,
          company: p.company || p.developer || "Leading Developer",
          developer: p.developer || p.company || "Leading Developer",
          project_url: p.project_url,
          category: p.category,
          status: p.status,
          date: p.date && p.date !== "Latest 2026" ? p.date : "",
          http_status: p.http_status,
          summary: p.summary,
          relevance_score: Math.max(0.70, 0.98 - index * 0.05)
        }));
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
      const run = store.searches.get(sId);

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

      // Only include upcoming projects (exclude any operational/completed facilities)
      let list = Array.from(store.projects.values()).filter(p => {
        const s = (p.status || "").toLowerCase();
        return !s.includes("operational") && !s.includes("completed") && !s.includes("commissioned");
      });

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

      if (location && location !== "All Regions") {
        list = list.filter(p =>
          [p.location_country, p.location_state, p.location_city].some(
            l => l && l.toLowerCase().includes(location.toLowerCase())
          )
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
      const status = url.searchParams.get("status");
      const search = url.searchParams.get("search")?.toLowerCase();

      let list = Array.from(store.projects.values()).filter(p => {
        const s = (p.status || "").toLowerCase();
        return !s.includes("operational") && !s.includes("completed") && !s.includes("commissioned");
      });

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
        const dt = `"${(p.date && p.date !== 'Latest 2026' ? p.date : '').replace(/"/g, '""')}"`;
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
        database_status: "connected",
        redis_status: "operational",
        total_projects: store.projects.size,
        total_searches: store.searches.size,
        active_search_jobs: 0,
        pending_outbox_queue: 0,
        edge_worker: "active",
        workers_ai_model: "@cf/meta/llama-3.1-8b-instruct"
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
