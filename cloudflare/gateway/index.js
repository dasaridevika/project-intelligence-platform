/**
 * Project Intelligence Platform - Edge AI Worker & Gateway (index.js)
 * 
 * Capabilities:
 * 1. Cloudflare Workers AI: Uses Meta Llama 3.1 8B Instruct (@cf/meta/llama-3.1-8b-instruct)
 * 2. Edge Web Fetcher: Fetches live HTML from valid URLs with timeout guards and HTML noise stripping
 * 3. Pre-LLM Validation & Deduplication: Blocks invalid sites, PDFs, social media, dictionaries, and duplicates
 * 4. Database & Query Cache Pre-Check: Prevents redundant LLM calls if data is already known
 * 5. Edge Reverse Proxy: Forwards /api/* to Render with automatic cold-start retries (502/503/504)
 * 6. Static Asset Serving: Hosts React SPA with single-page routing
 */

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
  // Dictionaries, encyclopedias, and generic reference
  "wikipedia.org", "wiktionary.org", "dictionary.cambridge.org", "merriam-webster.com",
  "dictionary.com", "investopedia.com", "britannica.com", "techtarget.com",
  "computerhope.com", "coursera.org", "statista.com", "wordreference.com",
  // Social media, video, and community forums
  "youtube.com", "youtu.be", "vimeo.com", "facebook.com", "fb.com", "twitter.com",
  "x.com", "instagram.com", "tiktok.com", "pinterest.com", "reddit.com", "quora.com",
  "linkedin.com", "medium.com",
  // Auth portals
  "accounts.google.com", "login.microsoftonline.com", "appleid.apple.com"
];

const TRACKING_QUERY_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "ref", "source", "mc_cid", "mc_eid"
];

// In-memory cache for edge deduplication
const processedUrlCache = new Map();

/**
 * Validates candidate URL: blocks non-HTML files, social media, dictionaries, and private IPs.
 * Normalizes canonical URL by stripping tracking parameters and hash fragments.
 */
function validateAndNormalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, reason: "Missing or invalid URL" };
  }

  try {
    const parsed = new URL(rawUrl.trim());

    // 1. Only HTTP or HTTPS allowed
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, reason: `Unsupported protocol '${parsed.protocol}'. Only HTTP and HTTPS are permitted.` };
    }

    const host = parsed.hostname.toLowerCase();
    if (!host || !host.includes(".")) {
      return { valid: false, reason: `Invalid domain host '${parsed.hostname}'.` };
    }

    // 2. SSRF Prevention: disallow localhost and private IP ranges
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

    // 3. Domain blacklist check (dictionaries, social media, forums)
    for (const blocked of BLOCKED_DOMAINS) {
      if (host === blocked || host.endsWith("." + blocked)) {
        return { valid: false, reason: `Domain '${host}' is on blocked reference or social media list.` };
      }
    }

    // 4. File extension check (only HTML/text pages allowed, no PDFs or binaries)
    const pathname = parsed.pathname.toLowerCase();
    for (const ext of INVALID_FILE_EXTENSIONS) {
      if (pathname.endsWith(ext)) {
        return { valid: false, reason: `URL points to non-HTML file type ('${ext}'). Only public HTML articles are allowed.` };
      }
    }

    // 5. Canonicalize: strip tracking query parameters and fragments
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

/**
 * Strips HTML noise (scripts, styles, nav, ads) and extracts clean readable article text.
 */
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
    text: text.slice(0, 6000),
  };
}

/**
 * Fetches the live webpage from the edge with standard browser headers and an 8s timeout.
 */
async function fetchUrlContent(targetUrl) {
  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { ok: false, title: "", metaDesc: "", text: "", status: res.status, error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const cleaned = cleanHtml(html);
    return { ok: true, ...cleaned, status: res.status };
  } catch (err) {
    return { ok: false, title: "", metaDesc: "", text: "", status: 0, error: err?.message || String(err) };
  }
}

/**
 * Fallback regex extractor when Workers AI is unconfigured or rate limited.
 */
function fallbackRegexExtract(text, url, hintCategory) {
  const invMatch = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(billion|million|b|m)\b/i);
  let invVal = null;
  if (invMatch) {
    const num = parseFloat(invMatch[1]);
    const scale = invMatch[2].toLowerCase();
    invVal = scale.startsWith("b") ? num * 1_000_000_000 : num * 1_000_000;
  }

  const capMatch = text.match(/(\d+(?:\.\d+)?)\s*(MW|GW|megawatt|gigawatt)\b/i);
  let capVal = null;
  let capUnit = null;
  if (capMatch) {
    capVal = parseFloat(capMatch[1]);
    capUnit = capMatch[2].toUpperCase().startsWith("G") ? "GW" : "MW";
  }

  const devMatch = text.match(/\b([A-Z][a-zA-Z0-9&.\s]{2,25})\s+(?:announced|breaks ground|is developing|to build|invests)\b/);
  const developer = devMatch ? devMatch[1].trim() : null;

  let hostname = "Source";
  try {
    hostname = new URL(url).hostname;
  } catch (_) {}

  return {
    is_project: true,
    canonical_name: `Capital Project from ${hostname}`,
    category: hintCategory || "Capital Projects",
    developer,
    investment_value: invVal,
    investment_currency: invVal ? "USD" : null,
    capacity_value: capVal,
    capacity_unit: capUnit,
    location_country: "Global",
    location_state: null,
    location_city: null,
    status: "Announced",
    summary: text.slice(0, 240) + "...",
    confidence_score: invVal || capVal ? 0.75 : 0.5,
  };
}

/**
 * Executes Meta Llama 3.1 8B Instruct via Cloudflare Workers AI.
 */
async function extractProjectWithWorkersAI(ai, pageText, targetUrl, hintCategory) {
  if (!ai || typeof ai.run !== "function") {
    return fallbackRegexExtract(pageText, targetUrl, hintCategory);
  }

  const systemPrompt = `You are an expert capital project intelligence analyst. Extract factual data about the capital project, facility, infrastructure development, or industrial plant announced or described in the text.
If the text does NOT describe a real capital project, return {"is_project": false, "reason": "No capital project found"}.
If a project is found, return ONLY a valid JSON object matching this schema:
{
  "is_project": true,
  "canonical_name": "Official project name",
  "category": "Primary industrial sector (e.g. Data Center, Semiconductor, Solar Power, Battery, Clean Energy)",
  "developer": "Owner, developer, sponsor, or operator (or null if unstated)",
  "investment_value": 3500000000,
  "investment_currency": "USD",
  "capacity_value": 300,
  "capacity_unit": "MW",
  "location_country": "Country name",
  "location_state": "State or province (or null)",
  "location_city": "City or county (or null)",
  "status": "Announced | Planning | Under Construction | Operational | Completed",
  "summary": "2-3 sentence executive factual summary of the project scope and investment.",
  "confidence_score": 0.95
}`;

  const userPrompt = `Source URL: ${targetUrl}
${hintCategory ? `Category Hint: ${hintCategory}` : ""}
Web Page Text:
"""
${pageText.slice(0, 5000)}
"""

Extract structured capital project details in strict JSON:`;

  try {
    const aiResponse = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 800,
    });

    const rawOutput = aiResponse?.response || "";
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.warn("Workers AI execution notice:", err?.message || err);
  }

  return fallbackRegexExtract(pageText, targetUrl, hintCategory);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // 2. Generate or extract Trace ID
    const traceId = request.headers.get("X-Trace-Id") || crypto.randomUUID();

    const jsonResponse = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "X-Trace-Id": traceId, ...CORS_HEADERS },
      });

    // 3. Cloudflare Workers AI Endpoints: /api/ai/*
    if (url.pathname.startsWith("/api/ai/")) {
      if (url.pathname === "/api/ai/health") {
        return jsonResponse({
          status: "healthy",
          edge_ai_ready: !!env.AI,
          model: "@cf/meta/llama-3.1-8b-instruct",
          service: "Cloudflare Workers AI Web Fetcher & Extractor (index.js)",
        });
      }

      // Single URL Fetch & Extract
      if (url.pathname === "/api/ai/extract" && request.method === "POST") {
        try {
          const body = await request.json();
          const targetUrl = body?.url;
          if (!targetUrl || typeof targetUrl !== "string") {
            return jsonResponse({ error: "Missing or invalid 'url' in request body" }, 400);
          }

          // Step 1: Pre-check: Validate URL, block non-HTML file types and blacklisted domains
          const validation = validateAndNormalizeUrl(targetUrl);
          if (!validation.valid || !validation.cleanUrl) {
            return jsonResponse(
              {
                success: false,
                url: targetUrl,
                error: `Invalid or disallowed URL: ${validation.reason}`,
              },
              400
            );
          }

          const cleanUrl = validation.cleanUrl;

          // Step 2: In-memory cache check to prevent duplicate LLM calls for identical URLs
          if (processedUrlCache.has(cleanUrl)) {
            const cached = processedUrlCache.get(cleanUrl);
            return jsonResponse({
              ...cached,
              source: "edge_cache",
              cached: true,
            });
          }

          // Step 3: Fetch the live webpage from the edge
          const fetchResult = await fetchUrlContent(cleanUrl);
          if (!fetchResult.ok) {
            return jsonResponse(
              {
                success: false,
                url: cleanUrl,
                error: fetchResult.error || "Failed to fetch target URL",
                status: fetchResult.status,
              },
              502
            );
          }

          // Step 4: Extract structured project data with Workers AI
          const projectData = await extractProjectWithWorkersAI(
            env.AI,
            fetchResult.text,
            cleanUrl,
            body?.category
          );

          const responseData = {
            success: true,
            url: cleanUrl,
            source_title: fetchResult.title,
            meta_description: fetchResult.metaDesc,
            content_length: fetchResult.text.length,
            engine: env.AI ? "Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct)" : "Edge Heuristic Parser",
            project: projectData,
          };

          // Cache result (capped at 200 items)
          if (processedUrlCache.size > 200) {
            const firstKey = processedUrlCache.keys().next().value;
            processedUrlCache.delete(firstKey);
          }
          processedUrlCache.set(cleanUrl, responseData);

          return jsonResponse(responseData);
        } catch (err) {
          return jsonResponse({ error: "AI Extraction Error", details: err?.message || String(err) }, 500);
        }
      }

      // Batch URL Fetch & Extract
      if (url.pathname === "/api/ai/batch-extract" && request.method === "POST") {
        try {
          const body = await request.json();
          const rawUrls = Array.isArray(body?.urls) ? body.urls.slice(0, 5) : [];
          if (rawUrls.length === 0) {
            return jsonResponse({ error: "Empty or invalid 'urls' array in request body" }, 400);
          }

          // Deduplicate and filter out invalid sites before fetching
          const validUrls = [];
          const seen = new Set();
          for (const u of rawUrls) {
            const v = validateAndNormalizeUrl(u);
            if (v.valid && v.cleanUrl && !seen.has(v.cleanUrl)) {
              seen.add(v.cleanUrl);
              validUrls.push(v.cleanUrl);
            }
          }

          if (validUrls.length === 0) {
            return jsonResponse({ error: "None of the provided URLs are valid public web addresses" }, 400);
          }

          const results = await Promise.allSettled(
            validUrls.map(async (u) => {
              if (processedUrlCache.has(u)) {
                return { url: u, success: true, ...processedUrlCache.get(u), cached: true };
              }
              const f = await fetchUrlContent(u);
              if (!f.ok) return { url: u, success: false, error: f.error };
              const p = await extractProjectWithWorkersAI(env.AI, f.text, u, body?.category);
              const itemData = { url: u, success: true, title: f.title, project: p };
              processedUrlCache.set(u, itemData);
              return itemData;
            })
          );

          const items = results.map((r, i) =>
            r.status === "fulfilled" ? r.value : { url: validUrls[i], success: false, error: "Task rejected" }
          );

          return jsonResponse({
            success: true,
            count: items.length,
            engine: env.AI ? "Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct)" : "Edge Heuristic Parser",
            items,
          });
        } catch (err) {
          return jsonResponse({ error: "Batch Extraction Error", details: err?.message || String(err) }, 500);
        }
      }
    }

    // 4. API & Backend Routing: /api/*, /health, /ready, /docs, /openapi.json, /internal/*
    const isApiRequest =
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/internal/") ||
      url.pathname === "/health" ||
      url.pathname === "/ready" ||
      url.pathname === "/docs" ||
      url.pathname === "/openapi.json";

    if (isApiRequest) {
      try {
        if (url.pathname.startsWith("/internal/")) {
          const internalKey = request.headers.get("X-Internal-Key");
          if (!internalKey) {
            return jsonResponse(
              {
                error: "Forbidden",
                message: "Internal endpoints are protected and not directly accessible",
                trace_id: traceId,
              },
              403
            );
          }
        }

        const cleanBaseUrl = env.BACKEND_API_URL.endsWith("/") ? env.BACKEND_API_URL : env.BACKEND_API_URL + "/";
        const cleanPath = url.pathname.replace(/^\//, "");
        const backendUrl = new URL(cleanPath + url.search, cleanBaseUrl);

        const forwardedHeaders = new Headers(request.headers);
        forwardedHeaders.set("Host", backendUrl.host);
        forwardedHeaders.delete("cf-connecting-ip");
        forwardedHeaders.delete("cf-ray");
        forwardedHeaders.delete("cf-visitor");
        forwardedHeaders.set("X-Trace-Id", traceId);
        forwardedHeaders.set("X-Forwarded-Host", url.host);
        forwardedHeaders.set("X-Forwarded-Proto", url.protocol.replace(":", ""));

        let body = undefined;
        if (!["GET", "HEAD"].includes(request.method)) {
          body = await request.clone().arrayBuffer();
        }

        // Automatic retry loop for Render cold starts (502/503/504)
        const maxRetries = 2;
        let backendResponse = null;
        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            backendResponse = await fetch(backendUrl.toString(), {
              method: request.method,
              headers: forwardedHeaders,
              body: body ? body.slice(0) : undefined,
              redirect: "follow",
            });

            if ([502, 503, 504].includes(backendResponse.status) && attempt < maxRetries) {
              await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
              continue;
            }

            break;
          } catch (fetchErr) {
            lastError = fetchErr;
            if (attempt < maxRetries) {
              await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
              continue;
            }
          }
        }

        if (!backendResponse) {
          throw lastError || new Error("Backend connection timed out or unreachable.");
        }

        const responseHeaders = new Headers(backendResponse.headers);
        responseHeaders.set("X-Trace-Id", traceId);
        for (const [key, value] of Object.entries(CORS_HEADERS)) {
          if (!responseHeaders.has(key)) {
            responseHeaders.set(key, value);
          }
        }

        if (backendResponse.headers.get("Content-Type")?.includes("text/event-stream")) {
          responseHeaders.set("Cache-Control", "no-cache, no-transform");
          responseHeaders.set("X-Accel-Buffering", "no");
        }

        return new Response(backendResponse.body, {
          status: backendResponse.status,
          statusText: backendResponse.statusText,
          headers: responseHeaders,
        });
      } catch (err) {
        return jsonResponse(
          {
            error: "GatewayError",
            message: "Failed to connect to backend service.",
            details: err?.message || String(err),
            trace_id: traceId,
          },
          502
        );
      }
    }

    // 5. Serve Static Frontend SPA Assets
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};
