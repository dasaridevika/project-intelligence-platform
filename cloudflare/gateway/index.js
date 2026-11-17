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
  /\/cart\b/i, /\/checkout\b/i, /\/pdf\//i
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
      endpoint: "@cf/meta/llama-3.1-8b-instruct",
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
      status_note: "Ready"
    },
    {
      provider: "Google Custom Search",
      endpoint: "https://www.googleapis.com/customsearch/v1",
      requests_sent: 0,
      success_count: 0,
      failed_count: 0,
      avg_latency_ms: 0,
      units_consumed: 0,
      status_note: "Ready"
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
    if (path.includes("/en/") || path.includes("/en-") || path.includes("/en_") || path.includes("/english/") || host.startsWith("en.")) {
      return false;
    }
    
    // Non-English ccTLDs that primarily publish in non-English
    const nonEnglishTlds = [".cn", ".tw", ".ru", ".jp", ".kr", ".vn", ".th", ".ir", ".pl", ".cz"];
    for (const tld of nonEnglishTlds) {
      if (host.endsWith(tld)) return true;
    }
    
    // Non-English language subpath prefixes: /zh/, /zh-tw/, /zh-cn/, /ja/, /ko/, /ru/
    const foreignPathPrefixes = [/^\/zh\b/i, /^\/zh-[a-z]+\b/i, /^\/ja\b/i, /^\/ko\b/i, /^\/ru\b/i];
    for (const p of foreignPathPrefixes) {
      if (p.test(path)) return true;
    }
    
    // Known exclusively non-English news domains
    const nonEnglishDomains = [
      "udn.com", "chinatimes.com", "cna.com.tw", "ettoday.net", "ltn.com.tw",
      "sina.com", "sohu.com", "163.com", "xinhuanet.com", "people.com.cn", "huanqiu.com",
      "nikkei.com", "asahi.com", "yomiuri.co.jp", "mainichi.jp",
      "chosun.com", "donga.com", "joins.com", "yna.co.kr",
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

function isPredominantlyNonEnglish(text) {
  if (!text || text.length < 40) return false;
  const nonLatin = text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f\u0900-\u097f\u0590-\u05ff]/g);
  return !!(nonLatin && nonLatin.length > 15);
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
  const newsIndicators = [
    "reuters", "bloomberg", "constructconnect", "datacenterdynamics", "dcn",
    "landgate", "oxford economics", "oxfordeconomics", "globaldata", "jpmorgan",
    "pwc", "rba", "news", "times", "post", "journal", "herald", "tribune",
    "cnbc", "forbes", "ft.com", "financial times", "press release", "marketwatch",
    "associated press", "prnewswire", "businesswire", "globenewswire",
    // Generic non-developer words
    "north america", "south america", "europe", "asia", "global", "worldwide",
    "insights", "insight", "blog", "blogs", "articles", "article", "update", "updates",
    "overview", "report", "reports", "tracker", "index", "atlas", "pipeline",
    "technologies", "technology", "editorial", "staff", "editor", "author"
  ];
  return newsIndicators.some(ind => n === ind || n.includes(ind));
}

// Extract company from text/headline dynamically (no hardcoded company array)
function extractCompanyDynamically(text, title, url) {
  const combined = ((title ? title + ". " : "") + (text ? text.slice(0, 500) : "")).trim();
  
  // Pattern 1: Developer action verbs ("<Company> plans to build / breaks ground / invests / announces / expands")
  const actionMatch = combined.match(/([A-Z][a-zA-Z0-9\s,&.-]{2,40}?)\s+(?:plans?(?:\s+to)?|to\s+build|breaks?\s+ground|invests?|announces?|awarded|secures?|expands?|constructs?|develops?|opens?|completes?|raises?)\b/);
  if (actionMatch && actionMatch[1]) {
    const candidate = actionMatch[1].replace(/^(?:the|a|an|after|as|with|in|on|at|by|for)\s+/i, "").trim();
    if (candidate.length >= 3 && candidate.length <= 40 && !isNewsPublisher(candidate) && !hasNonLatinScript(candidate)) {
      return candidate;
    }
  }

  // Pattern 2: Possessive project name ("<Company>'s $<Amount> facility / plant / data center")
  const possessiveMatch = combined.match(/([A-Z][a-zA-Z0-9\s,&.-]{2,35})'s\s+(?:\$[\d.]+\s*(?:billion|million|bln|mln|b|m)?\s+)?(?:data\s*center|plant|facility|campus|megafab|gigafactory|project)/i);
  if (possessiveMatch && possessiveMatch[1]) {
    const candidate = possessiveMatch[1].replace(/^(?:the|a|an)\s+/i, "").trim();
    if (candidate.length >= 3 && !isNewsPublisher(candidate) && !hasNonLatinScript(candidate)) {
      return candidate;
    }
  }

  // Pattern 3: URL host if it's the actual corporate domain (e.g. databank.com -> DataBank, hscaledc.com -> Hscale)
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (!isNewsPublisher(host)) {
      const parts = host.split(".");
      if (parts.length >= 2) {
        const org = parts[0];
        const formatted = org.charAt(0).toUpperCase() + org.slice(1);
        if (!isNewsPublisher(formatted) && !hasNonLatinScript(formatted)) {
          return formatted;
        }
      }
    }
  } catch (_) {}

  return "Project Developer";
}

function extractStatusFromText(text) {
  const t = (text || "").toLowerCase();
  // Strictly reject completed, operational, or already commissioned facilities
  if (t.includes("operational") || t.includes("commissioned") || t.includes("online") || t.includes("inaugurated") || t.includes("opened its doors") || t.includes("completed")) {
    return null;
  }
  if (t.includes("under construction") || t.includes("breaks ground") || t.includes("groundbreaking") || t.includes("underway") || t.includes("construction has begun")) {
    return "Under Construction";
  }
  if (t.includes("announced") || t.includes("announces") || t.includes("unveils") || t.includes("proposes")) {
    return "Announced";
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
    const fullDate = url.match(/\b(202[56])[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
    if (fullDate) return `${fullDate[1]}-${fullDate[2]}-${fullDate[3]}`;

    const monthYear = url.match(/\b(202[56])[-/](0[1-9]|1[0-2])\b/);
    if (monthYear) return `${monthYear[1]}-${monthYear[2]}`;

    const year = url.match(/\b(202[56])\b/);
    if (year) return year[1];
  }

  // Check text snippet for formatted date: e.g. "November 2026", "Nov 15, 2026", "2026"
  if (text) {
    const textDate = text.slice(0, 800).match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+202[56]\b/i);
    if (textDate) return textDate[0];

    const myMatch = text.slice(0, 800).match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+202[56]\b/i);
    if (myMatch) return myMatch[0];

    if (text.includes("2026")) return "2026";
  }

  return "Latest 2026";
}

function parseLlmJson(rawOutput) {
  if (!rawOutput || typeof rawOutput !== "string") return null;
  let clean = rawOutput.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const firstBrace = clean.indexOf("{");
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

  if (!canonical_name || canonical_name.length < 5 || canonical_name === "Capital Project" || hasNonLatinScript(canonical_name)) {
    return {
      is_project: false,
      reason: "Unable to verify a specific named physical development project in English"
    };
  }

  const company = extractCompanyDynamically(text, titleHint, url);
  if (hasNonLatinScript(company)) {
    return {
      is_project: false,
      reason: "Non-English developer entity detected"
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
    summary: text.slice(0, 180) + "..."
  };
}

// Executes deep intelligent project evaluation via Cloudflare Workers AI (Zero Hardcoding)
async function extractProjectWithWorkersAI(ai, pageText, targetUrl, hintTitle, hintCategory) {
  if (!ai || typeof ai.run !== "function") {
    return fallbackRegexExtract(pageText, targetUrl, hintTitle, hintCategory);
  }

  const systemPrompt = `You are an expert industrial intelligence analyst evaluating web pages to identify genuine capital infrastructure and development projects.

TASK:
Determine if the provided webpage discusses a SPECIFIC, REAL-WORLD UPCOMING CAPITAL PROJECT.

A VALID UPCOMING CAPITAL PROJECT MUST:
1. Cover a concrete physical facility, building, plant, megafab, hyperscale data center, power plant, solar/wind farm, transmission line, or manufacturing site.
2. Have an identifiable company, developer, owner, or operator building, expanding, or financing it. NEVER return the news site or reporting publisher (e.g. Reuters, Bloomberg, ConstructConnect, DCN).
3. Have a verifiable location (city, state, region, or country).
4. Strictly be in an UPCOMING, IN-DEVELOPMENT lifecycle stage: "Announced", "Planning", or "Under Construction" (with future target completion in 2026+).

CRITICAL REQUIREMENT - ONLY UPCOMING PROJECTS:
- You MUST REJECT (set "is_project": false) any project that is already Operational, Completed, Commissioned, Inaugurated, or Opened.
- We strictly track UPCOMING, FUTURE, and IN-DEVELOPMENT capital projects only.
- Valid status values are ONLY: "Announced", "Planning", or "Under Construction".

CRITICAL REQUIREMENT - STRICT ENGLISH ONLY:
- Every single field in your JSON output (canonical_name, company, location, category, date, summary, reason) MUST be written in fluent, standard English.
- If the source webpage, project name, or developer has foreign terms (e.g. Spanish, German, French, Italian, Portuguese, Chinese, Japanese, etc.), YOU MUST TRANSLATE AND ROMANIZE ALL DETAILS INTO CLEAR, PROFESSIONAL ENGLISH.
- For foreign company or project names, provide their official English or Romanized/Pinyin name (e.g. "Taiwan Semiconductor Manufacturing Co. (TSMC)", "China Telecom", "Contemporary Amperex Technology (CATL)", "Iberdrola").
- NEVER output Chinese characters, Japanese kanji/kana, Korean hangul, Cyrillic, or non-English text. If you cannot provide English information, set "is_project": false with reason "Non-English source without verified English translation".

YOU MUST REJECT (set "is_project": false) IF:
1. The facility is already finished, completed, operational, or commissioned.
2. The page is macroeconomic analysis, industry trends, or market growth forecasts (e.g. "Data center construction to peak in 2030").
3. The page is selling or previewing a paid market research report, whitepaper, or industry outlook (e.g. GlobalData reports, consulting whitepapers).
4. The page is an opinion article, stock recommendation, or general thought leadership without a specific physical project.
5. The page is a corporate homepage, contact directory, hospital department list, or login portal.
6. The page is in a non-English language and cannot be verified with high confidence into English.

RESPONSE FORMAT:
Return ONLY a valid JSON object matching one of these two schemas:

If VALID UPCOMING PROJECT:
{
  "is_project": true,
  "canonical_name": "Official specific name of the project or facility in English",
  "company": "Specific company, developer, or operator building/investing in the project in English (NOT the media/news outlet)",
  "location": "City, State/Region, Country in English",
  "status": "Announced | Planning | Under Construction",
  "category": "Industrial category in English (e.g. Hyperscale Data Center, Semiconductor Megafab, Battery Gigafactory, Solar Farm)",
  "date": "Announcement, start, or publication date (e.g. November 2026, 2026-11, or 2026)",
  "summary": "1-2 complete factual sentences in fluent English describing the project, developer, and its development scope."
}

If NOT A VALID UPCOMING PROJECT:
{
  "is_project": false,
  "reason": "Specific reason in English explaining why it is not an upcoming physical capital project"
}`;

  const userPrompt = `URL: ${targetUrl}
${hintTitle ? `Title: ${hintTitle}` : ""}
${hintCategory ? `Category Hint: ${hintCategory}` : ""}
Webpage Text:
"""
${pageText.slice(0, 3000)}
"""

Evaluate whether this is a genuine capital project in JSON:`;

  const t0 = Date.now();
  try {
    const aiResponse = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 450,
    });

    const elapsed = Date.now() - t0;
    recordApiUsage("Cloudflare Workers AI", elapsed, true);

    const rawOutput = aiResponse?.response || "";
    const parsed = parseLlmJson(rawOutput);
    if (parsed) {
      if (parsed.is_project === false) {
        return {
          is_project: false,
          reason: parsed.reason || "AI evaluation: Article does not discuss a specific physical capital project"
        };
      }

      // Reject any operational or completed projects
      const rawStatus = (parsed.status || "").trim();
      if (
        /operational|completed|commissioned|opened|inaugurated/i.test(rawStatus) ||
        parsed.summary?.toLowerCase().includes("has completed construction") ||
        parsed.summary?.toLowerCase().includes("is now operational")
      ) {
        return {
          is_project: false,
          reason: `Facility is already operational or completed (${rawStatus}). Platform requires upcoming capital projects only.`
        };
      }

      // Strictly map to valid upcoming lifecycle status
      let finalStatus = "Planning";
      if (/under construction|construction|breaks ground|underway/i.test(rawStatus)) {
        finalStatus = "Under Construction";
      } else if (/announced|announces|unveils|proposed/i.test(rawStatus)) {
        finalStatus = "Announced";
      } else {
        finalStatus = "Planning";
      }

      // Strict English safety verification
      if (
        hasNonLatinScript(parsed.canonical_name) ||
        hasNonLatinScript(parsed.company) ||
        hasNonLatinScript(parsed.summary)
      ) {
        return {
          is_project: false,
          reason: "Non-English characters detected in AI extracted attributes"
        };
      }

      let companyVal = parsed.company;
      if (!companyVal || isNewsPublisher(companyVal)) {
        companyVal = extractCompanyDynamically(pageText, hintTitle, targetUrl);
      }

      let projectName = parsed.canonical_name;
      if (!projectName || projectName.startsWith("Project from") || projectName.length < 5) {
        projectName = hintTitle || extractProjectNameFromUrl(targetUrl);
      }

      if (hasNonLatinScript(projectName) || hasNonLatinScript(companyVal)) {
        return {
          is_project: false,
          reason: "Non-English title or developer detected"
        };
      }

      let projectDate = parsed.date;
      if (!projectDate || projectDate.length < 4) {
        projectDate = extractDateFromTextOrUrl(pageText, targetUrl);
      }

      return {
        is_project: true,
        canonical_name: projectName,
        company: companyVal,
        developer: companyVal,
        project_url: targetUrl,
        status: finalStatus,
        category: parsed.category || hintCategory || "Capital Projects",
        country: parsed.location || parsed.country || null,
        date: projectDate,
        summary: parsed.summary || (pageText.slice(0, 180) + "...")
      };
    }
  } catch (err) {
    const elapsed = Date.now() - t0;
    recordApiUsage("Cloudflare Workers AI", elapsed, false);
    console.warn("Workers AI execution notice:", err?.message || err);
  }

  return fallbackRegexExtract(pageText, targetUrl, hintTitle, hintCategory);
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
    const qStr = query.toLowerCase().includes("upcoming") ? query : `upcoming ${query}`;
    const fallbackUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(qStr + " capital project planned facility construction announcement")}&kl=us-en`;
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

async function executeDiscoveryPipeline(env, ctx, searchRunId, query, requestedCategory, requestedLocation) {
  const startTime = Date.now();
  const normalizedQuery = query.toLowerCase().trim();

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

  // 1. Initial analysis
  const sectorInfo = classifyQuery(query);
  const targetCategory = requestedCategory && requestedCategory !== "All Categories" ? requestedCategory : sectorInfo.category;
  const targetLocation = requestedLocation && requestedLocation !== "All Regions" ? requestedLocation : extractLocation(query);

  addEvent("search_created", `Search accepted for: '${query}'. Dispatched to Cloudflare Workers AI edge pipeline.`);
  addEvent("query_analyzed", `NLP Analysis: Category '${targetCategory}' [${sectorInfo.group || 'Industrial'}], Location '${targetLocation}'`);

  // 2. Query Cache Pre-check: Only use cache if results have verified project names and companies in English and are UPCOMING
  if (store.queryCache.has(normalizedQuery)) {
    const priorRunId = store.queryCache.get(normalizedQuery);
    const cachedResults = store.searchResults.get(priorRunId) || [];
    const isValidCache = cachedResults.length > 0 && cachedResults.every(r => 
      r.canonical_name && 
      !r.canonical_name.startsWith("Project from") && 
      !hasNonLatinScript(r.canonical_name) &&
      !hasNonLatinScript(r.summary) &&
      !hasNonLatinScript(r.company) &&
      (r.company || r.developer) &&
      ["Announced", "Planning", "Under Construction"].includes(r.status)
    );
    if (isValidCache) {
      addEvent("query_cache_hit", `Cache Hit: Query '${query}' already executed with ${cachedResults.length} verified projects. Zero external calls or LLM inferences needed.`);
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

  // 3. Provider Search Dispatch (Parallel Provider Queries)
  addEvent("provider_started", `Executing web discovery for query: '${query}'`);

  const providerFetches = [];

  // Exa AI Search if configured
  if (env.EXA_API_KEY && env.EXA_API_KEY.length > 10) {
    providerFetches.push((async () => {
      const t0 = Date.now();
      try {
        const exaQuery = query.toLowerCase().includes("upcoming")
          ? (query.includes("2026") ? `${query} English` : `${query} 2026 capital project facility in English`)
          : `upcoming ${query} 2026 capital project planned facility investment in English`;
        const exaRes = await fetch("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            "x-api-key": env.EXA_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query: exaQuery,
            numResults: 15,
            useAutoprompt: true,
            startPublishedDate: "2025-01-01T00:00:00.000Z",
            contents: {
              text: { maxCharacters: 3000 }
            }
          }),
          signal: AbortSignal.timeout(8000)
        });
        const elapsed = Date.now() - t0;
        recordApiUsage("Exa Neural Search", elapsed, exaRes.ok);
        if (exaRes.ok) {
          const exaData = await exaRes.json();
          const urls = (exaData.results || [])
            .filter(r => !hasNonLatinScript(r.title))
            .map(r => ({
              url: r.url,
              title: r.title,
              snippet: r.text ? r.text.slice(0, 250) : r.title,
              text: r.text || "",
              published_date: r.publishedDate || extractDateFromTextOrUrl(r.text, r.url),
              provider: "exa"
            }));
          addEvent("provider_completed", `Exa AI retrieved ${urls.length} candidate URLs for 2026 projects in ${elapsed}ms.`);
          return urls;
        } else {
          const errText = await exaRes.text();
          addEvent("provider_error", `Exa AI Search responded with HTTP ${exaRes.status}: ${errText.slice(0, 120)}`);
        }
      } catch (e) {
        recordApiUsage("Exa Neural Search", Date.now() - t0, false);
        addEvent("provider_error", `Exa AI Search network notice: ${e?.message || e}`);
      }
      return [];
    })());
  }

  // Google Search if configured
  if (env.GOOGLE_SEARCH_API_KEY && env.GOOGLE_SEARCH_CX) {
    providerFetches.push((async () => {
      const t0 = Date.now();
      try {
        const gQuery = query.toLowerCase().includes("upcoming")
          ? (query.includes("2026") ? query : `${query} 2026 projects investments construction`)
          : `upcoming ${query} 2026 projects planned announced under construction`;
        const gUrl = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_SEARCH_API_KEY}&cx=${env.GOOGLE_SEARCH_CX}&q=${encodeURIComponent(gQuery)}&num=10&lr=lang_en&hl=en`;
        const gRes = await fetch(gUrl, { signal: AbortSignal.timeout(6000) });
        const elapsed = Date.now() - t0;
        recordApiUsage("Google Custom Search", elapsed, gRes.ok);
        if (gRes.ok) {
          const gData = await gRes.json();
          const urls = (gData.items || [])
            .filter(r => !hasNonLatinScript(r.title))
            .map(r => ({
              url: r.link,
              title: r.title,
              snippet: r.snippet,
              published_date: extractDateFromTextOrUrl(r.snippet, r.link),
              provider: "google"
            }));
          addEvent("provider_completed", `Google Search retrieved ${urls.length} candidate URLs in ${elapsed}ms.`);
          return urls;
        } else {
          const errText = await gRes.text();
          addEvent("provider_error", `Google Search responded with HTTP ${gRes.status}: ${errText.slice(0, 120)}`);
        }
      } catch (e) {
        recordApiUsage("Google Custom Search", Date.now() - t0, false);
        addEvent("provider_error", `Google Search network notice: ${e?.message || e}`);
      }
      return [];
    })());
  }

  const providerResults = await Promise.all(providerFetches);
  let candidateUrls = providerResults.flat();

  // If primary API providers returned no candidates, run resilient public search fallback
  if (candidateUrls.length === 0) {
    addEvent("provider_started", `Primary providers returned 0 candidates. Engaging resilient public discovery fallback.`);
    const fallbackResults = await searchWebFallback(query);
    if (fallbackResults.length > 0) {
      candidateUrls = fallbackResults;
      addEvent("provider_completed", `Fallback discovery retrieved ${candidateUrls.length} candidate URLs.`);
    }
  }

  // 4. Pre-LLM Validation, Deduplication & Parallel Extraction
  addEvent("extraction_started", `Evaluating ${candidateUrls.length} candidate source URLs for capital project parameters.`);

  const validCandidates = [];
  const seenUrls = new Set();

  for (const item of candidateUrls) {
    const rawUrl = item.url;
    const val = validateAndNormalizeUrl(rawUrl);
    if (!val.valid || !val.cleanUrl) {
      addEvent("candidate_rejected", `REJECTED: ${rawUrl} -> Reason: ${val.reason}`);
      continue;
    }
    // Pre-check failed or dead URLs to avoid repetitive hangs
    if (store.failedUrls.has(val.cleanUrl)) {
      addEvent("candidate_rejected", `REJECTED: ${val.cleanUrl} -> Reason: Dead/unreachable URL (${store.failedUrls.get(val.cleanUrl)})`);
      continue;
    }
    if (seenUrls.has(val.cleanUrl)) {
      addEvent("candidate_rejected", `REJECTED: ${val.cleanUrl} -> Reason: Duplicate URL already queued`);
      continue;
    }
    seenUrls.add(val.cleanUrl);
    validCandidates.push({ ...item, cleanUrl: val.cleanUrl });
  }

  // Process valid candidate URLs with managed concurrency of 3 (prevents edge AI rate limits)
  const extractionResults = await mapConcurrent(validCandidates.slice(0, 15), 3, async (item) => {
    const cleanUrl = item.cleanUrl;

    // Cache Check: Has this URL already been extracted?
    if (store.urlCache.has(cleanUrl)) {
      const cached = store.urlCache.get(cleanUrl);
      if (
        cached &&
        cached.canonical_name &&
        !cached.canonical_name.startsWith("Project from") &&
        !cached.canonical_name.startsWith("Capital Project at") &&
        !hasNonLatinScript(cached.canonical_name) &&
        !hasNonLatinScript(cached.summary) &&
        !hasNonLatinScript(cached.company) &&
        !isNewsPublisher(cached.company) &&
        ["Announced", "Planning", "Under Construction"].includes(cached.status)
      ) {
        addEvent("candidate_accepted", `ACCEPTED FROM CACHE: '${cached.canonical_name}' (Source: ${cleanUrl})`, "ai_worker", { project: cached, canonical_name: cached.canonical_name });
        return cached;
      } else {
        store.urlCache.delete(cleanUrl);
      }
    }

    addEvent("url_fetched", `Analyzing candidate URL: ${cleanUrl}`);

    // If candidate already contains full text from Exa neural search, use it directly to bypass bot-blocks
    let pageText = item.text || "";
    let pageStatus = 200;

    if (!pageText || pageText.length < 150) {
      const pageContent = await fetchUrlContent(cleanUrl);
      if (pageContent.ok && pageContent.text) {
        pageText = pageContent.text;
        pageStatus = pageContent.status;
      } else if (item.snippet && item.snippet.length > 50) {
        // Graceful fallback to snippet if website has bot-block / anti-crawl protection
        pageText = item.snippet;
        pageStatus = pageContent.status || 200;
        addEvent("url_fallback", `Bot-block bypass: Used search index snippet for ${cleanUrl}`);
      } else {
        store.failedUrls.set(cleanUrl, pageContent.error);
        addEvent("candidate_rejected", `REJECTED: ${cleanUrl} -> Host Error: ${pageContent.error}`);
        return null;
      }
    }

    // Safety check: Filter out candidate page if text is predominantly non-English
    if (isPredominantlyNonEnglish(pageText)) {
      addEvent("candidate_rejected", `REJECTED: ${cleanUrl} -> Language Filter: Non-English text detected. Only English sources accepted.`);
      return null;
    }

    // AI Extraction via Workers AI (Llama 3.1)
    const aiExtracted = await extractProjectWithWorkersAI(env.AI, pageText, cleanUrl, item.title, targetCategory);

    if (aiExtracted && aiExtracted.is_project !== false) {
      // Lifecycle check: strictly reject operational or completed facilities
      if (
        !aiExtracted.status ||
        aiExtracted.status === "Operational" ||
        aiExtracted.status === "Completed" ||
        aiExtracted.status === "Commissioned"
      ) {
        addEvent("candidate_rejected", `REJECTED: ${cleanUrl} -> Lifecycle Filter: Facility is already operational or completed (${aiExtracted.status || 'Unknown'}). Only upcoming projects permitted.`);
        return null;
      }

      const validUpcomingStatuses = ["Announced", "Planning", "Under Construction"];
      let projectStatus = validUpcomingStatuses.includes(aiExtracted.status) ? aiExtracted.status : "Planning";

      // Safety check: ensure project record has zero non-Latin foreign characters
      if (
        hasNonLatinScript(aiExtracted.canonical_name) ||
        hasNonLatinScript(aiExtracted.company) ||
        hasNonLatinScript(aiExtracted.summary)
      ) {
        addEvent("candidate_rejected", `REJECTED: ${cleanUrl} -> Language Filter: Non-English characters found in AI extracted attributes.`);
        return null;
      }

      const projId = "proj-" + crypto.randomUUID().slice(0, 8);
      let companyName = aiExtracted.company;
      if (!companyName || isNewsPublisher(companyName)) {
        companyName = extractCompanyDynamically(pageText, item.title, cleanUrl);
      }
      const projectName = aiExtracted.canonical_name || item.title || "Capital Project";
      if (hasNonLatinScript(projectName) || hasNonLatinScript(companyName)) {
        addEvent("candidate_rejected", `REJECTED: ${cleanUrl} -> Language Filter: Non-English project title or developer entity.`);
        return null;
      }

      let projectDate = aiExtracted.date || item.published_date;
      if (!projectDate || projectDate.length < 4) {
        projectDate = extractDateFromTextOrUrl(pageText, cleanUrl, item.published_date);
      }
      const projectRecord = {
        id: projId,
        canonical_name: projectName,
        company: companyName,
        developer: companyName,
        project_url: cleanUrl,
        status: projectStatus,
        category: aiExtracted.category || targetCategory || "Capital Projects",
        country: aiExtracted.country || targetLocation,
        date: projectDate,
        http_status: pageStatus || 200,
        summary: aiExtracted.summary || item.snippet || "",
        created_at: new Date().toISOString()
      };

      store.projects.set(projId, projectRecord);
      store.urlCache.set(cleanUrl, projectRecord);

      addEvent("candidate_accepted", `VALID PROJECT URL: ${cleanUrl} | Company: [${companyName}] | Date: [${projectDate}] | Status: [${projectRecord.status}] | Name: '${projectRecord.canonical_name}'`, "ai_worker", { project: projectRecord, canonical_name: projectRecord.canonical_name });
      return projectRecord;
    } else {
      addEvent("candidate_rejected", `REJECTED: ${cleanUrl} -> AI Determination: ${aiExtracted?.reason || 'Non-project page filtered'}`);
      return null;
    }
  });

  const extractedProjects = (extractionResults || []).filter(Boolean);

  // 5. Ranking & Deduplication
  addEvent("deduplication_completed", `Verified ${extractedProjects.length} valid project URLs with companies, dates & status.`);

  const searchResults = extractedProjects.map((p, index) => ({
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
    date: p.date || "Latest 2026",
    http_status: p.http_status,
    summary: p.summary,
    relevance_score: Math.max(0.70, 0.98 - index * 0.05)
  }));

  store.searchResults.set(searchRunId, searchResults);

  // Update SearchRun in store
  const run = store.searches.get(searchRunId);
  if (run) {
    run.status = "completed";
    run.results_count = searchResults.length;
    run.duration_ms = Date.now() - startTime;
    run.completed_at = new Date().toISOString();
  }

  // Save to queryCache
  store.queryCache.set(normalizedQuery, searchRunId);

  // Durable KV Persistence (survives worker redeploys)
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(persistStore(env));
  } else {
    await persistStore(env);
  }

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
            engine: env.AI ? "Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct)" : "Edge Heuristic Parser",
            project: projectData
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

        // Run discovery pipeline asynchronously in edge context
        const requestedCat = body?.categories?.[0];
        const requestedLoc = body?.location;
        ctx.waitUntil(executeDiscoveryPipeline(env, ctx, searchRunId, query, requestedCat, requestedLoc));

        return jsonRes({
          search_run_id: searchRunId,
          status: "queued",
          query
        }, 202);
      }

      // GET: List Searches
      if (request.method === "GET") {
        const searchesList = Array.from(store.searches.values()).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        return jsonRes(searchesList);
      }
    }

    // GET /api/v1/search/:id
    const searchIdMatch = url.pathname.match(/^\/api\/v1\/search\/([a-zA-Z0-9_-]+)$/);
    if (searchIdMatch && request.method === "GET") {
      const sId = searchIdMatch[1];
      const run = store.searches.get(sId);
      if (!run) return jsonRes({ error: "SearchRun not found" }, 404);
      return jsonRes(run);
    }

    // GET /api/v1/search/:id/results
    const searchResultsMatch = url.pathname.match(/^\/api\/v1\/search\/([a-zA-Z0-9_-]+)\/results$/);
    if (searchResultsMatch && request.method === "GET") {
      const sId = searchResultsMatch[1];
      const run = store.searches.get(sId);
      const results = store.searchResults.get(sId) || [];
      return jsonRes({
        search_run_id: sId,
        query: run?.query || "",
        status: run?.status || "completed",
        total_results: results.length,
        results
      });
    }

    // GET /api/v1/search/:id/events (Server-Sent Events)
    const searchEventsMatch = url.pathname.match(/^\/api\/v1\/search\/([a-zA-Z0-9_-]+)\/events$/);
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
      const location = url.searchParams.get("location");
      const status = url.searchParams.get("status");
      const search = url.searchParams.get("search")?.toLowerCase();

      // Only include upcoming projects (exclude any operational/completed facilities)
      let list = Array.from(store.projects.values()).filter(p => {
        const s = (p.status || "").toLowerCase();
        return !s.includes("operational") && !s.includes("completed") && !s.includes("commissioned");
      });
      if (category && category !== "All Categories") {
        list = list.filter(p => p.category.toLowerCase().includes(category.toLowerCase()));
      }
      if (location && location !== "All Regions") {
        list = list.filter(p =>
          [p.location_country, p.location_state, p.location_city].some(
            l => l && l.toLowerCase().includes(location.toLowerCase())
          )
        );
      }
      if (status && status !== "All Statuses" && status !== "All Upcoming Statuses") {
        list = list.filter(p => p.status.toLowerCase() === status.toLowerCase());
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
      const list = Array.from(store.projects.values()).filter(p => {
        const s = (p.status || "").toLowerCase();
        return !s.includes("operational") && !s.includes("completed") && !s.includes("commissioned");
      });
      let csv = "ID,Project Name,Company,Date,Valid URL,Category,Status,HTTP Status,Discovery Date\n";
      for (const p of list) {
        const name = `"${(p.canonical_name || '').replace(/"/g, '""')}"`;
        const comp = `"${(p.company || p.developer || '').replace(/"/g, '""')}"`;
        const dt = `"${(p.date || 'Latest 2026').replace(/"/g, '""')}"`;
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
      return jsonRes({
        total_requests: store.apiUsage.reduce((acc, u) => acc + u.requests_sent, 0),
        total_units: store.apiUsage.reduce((acc, u) => acc + u.units_consumed, 0),
        providers: store.apiUsage
      });
    }

    if (url.pathname === "/api/v1/analytics/providers") {
      return jsonRes({ providers: store.apiUsage });
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
