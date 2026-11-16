/**
 * Cloudflare Worker API Gateway for Project Intelligence Platform
 * Handles edge routing, rate limiting, CORS, trace ID injection, and static assets.
 */

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

export interface Env {
  BACKEND_API_URL: string;
  RATE_LIMIT_MAX_REQUESTS: string;
  ASSETS?: Fetcher;
  AI?: any;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Trace-Id, X-Internal-Key, Last-Event-ID",
  "Access-Control-Expose-Headers": "X-Trace-Id, X-Response-Time",
};

/**
 * Strips HTML tags, navigation, scripts, and styles, returning clean text for LLM inference.
 */
function cleanHtml(rawHtml: string): { title: string; metaDesc: string; text: string } {
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

const INVALID_FILE_EXTS = [
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
  ".mp4", ".mp3", ".avi", ".mov", ".zip", ".tar", ".gz", ".exe",
  ".csv", ".xlsx", ".docx", ".xml", ".rss", ".json"
];

const BLOCKED_DOMAINS = [
  "wikipedia.org", "wiktionary.org", "dictionary.cambridge.org", "merriam-webster.com",
  "dictionary.com", "investopedia.com", "britannica.com", "techtarget.com",
  "statista.com", "coursera.org", "youtube.com", "youtu.be", "facebook.com",
  "twitter.com", "x.com", "instagram.com", "tiktok.com", "pinterest.com",
  "reddit.com", "quora.com", "linkedin.com", "accounts.google.com"
];

/**
 * Validates candidate URL and blocks junk, social, non-HTML file types, and private IPs.
 */
function validateUrlAtEdge(targetUrl: string): { valid: boolean; cleanUrl?: string; reason?: string } {
  try {
    const parsed = new URL(targetUrl.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, reason: "Only HTTP and HTTPS protocols are permitted." };
    }

    const host = parsed.hostname.toLowerCase();
    if (!host || !host.includes(".")) {
      return { valid: false, reason: "Invalid domain host." };
    }

    // SSRF prevention: disallow local and private network addresses
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("172.")
    ) {
      return { valid: false, reason: "Access to private or localhost addresses is blocked." };
    }

    // Domain reputation blacklist check
    if (BLOCKED_DOMAINS.some((b) => host === b || host.endsWith("." + b))) {
      return { valid: false, reason: `Domain '${host}' is on blocked non-project or reference list.` };
    }

    // File extension check: only HTML web pages permitted
    const path = parsed.pathname.toLowerCase();
    if (INVALID_FILE_EXTS.some((ext) => path.endsWith(ext))) {
      return { valid: false, reason: "URL references a non-HTML file type." };
    }

    // Strip tracking parameters
    const searchParams = new URLSearchParams(parsed.search);
    const trackingKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "ref"];
    trackingKeys.forEach((k) => searchParams.delete(k));
    parsed.search = searchParams.toString();
    parsed.hash = "";

    return { valid: true, cleanUrl: parsed.toString() };
  } catch (err: any) {
    return { valid: false, reason: `Malformed URL: ${err?.message || err}` };
  }
}

/**
 * Edge URL fetcher with standard browser headers and timeout guard.
 */
async function fetchUrlContent(targetUrl: string): Promise<{
  ok: boolean;
  title: string;
  metaDesc: string;
  text: string;
  status: number;
  error?: string;
}> {
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
  } catch (err: any) {
    return { ok: false, title: "", metaDesc: "", text: "", status: 0, error: err?.message || String(err) };
  }
}

/**
 * Fallback regex extractor when Workers AI is unconfigured or unavailable.
 */
function fallbackRegexExtract(text: string, url: string, hintCategory?: string): any {
  const invMatch = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(billion|million|b|m)\b/i);
  let invVal: number | null = null;
  if (invMatch) {
    const num = parseFloat(invMatch[1]);
    const scale = invMatch[2].toLowerCase();
    invVal = scale.startsWith("b") ? num * 1_000_000_000 : num * 1_000_000;
  }

  const capMatch = text.match(/(\d+(?:\.\d+)?)\s*(MW|GW|megawatt|gigawatt)\b/i);
  let capVal: number | null = null;
  let capUnit: string | null = null;
  if (capMatch) {
    capVal = parseFloat(capMatch[1]);
    capUnit = capMatch[2].toUpperCase().startsWith("G") ? "GW" : "MW";
  }

  const devMatch = text.match(/\b([A-Z][a-zA-Z0-9&.\s]{2,25})\s+(?:announced|breaks ground|is developing|to build|invests)\b/);
  const developer = devMatch ? devMatch[1].trim() : null;

  return {
    is_project: true,
    canonical_name: `Capital Project from ${new URL(url).hostname}`,
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
 * Uses Cloudflare Workers AI (Llama 3.1 8B Instruct) to analyze the fetched webpage and extract structured capital project data.
 */
async function extractProjectWithWorkersAI(
  ai: any,
  pageText: string,
  targetUrl: string,
  hintCategory?: string
): Promise<any> {
  if (!ai || typeof ai.run !== "function") {
    return fallbackRegexExtract(pageText, targetUrl, hintCategory);
  }

  const systemPrompt = `You are an expert capital project intelligence analyst. Extract factual data about the capital project, construction, manufacturing plant, or infrastructure development announced or described in the text.
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
    const aiResponse: any = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
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
  } catch (err: any) {
    console.warn("Workers AI execution notice:", err?.message || err);
  }

  return fallbackRegexExtract(pageText, targetUrl, hintCategory);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // 3. Cloudflare Workers AI Edge Worker endpoints: /api/ai/*
    if (url.pathname.startsWith("/api/ai/")) {
      const jsonResponse = (data: any, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { "Content-Type": "application/json", "X-Trace-Id": traceId, ...CORS_HEADERS },
        });

      if (url.pathname === "/api/ai/health") {
        return jsonResponse({
          status: "healthy",
          edge_ai_ready: !!env.AI,
          model: "@cf/meta/llama-3.1-8b-instruct",
          service: "Cloudflare Workers AI Web Fetcher & Extractor",
        });
      }

      if (url.pathname === "/api/ai/extract" && request.method === "POST") {
        try {
          const body: any = await request.json();
          const targetUrl = body?.url;
          if (!targetUrl || typeof targetUrl !== "string") {
            return jsonResponse({ error: "Missing or invalid 'url' in request body" }, 400);
          }

          // Pre-fetch URL & site reputation validation
          const validation = validateUrlAtEdge(targetUrl);
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

          const fetchResult = await fetchUrlContent(validation.cleanUrl);
          if (!fetchResult.ok) {
            return jsonResponse(
              {
                success: false,
                url: validation.cleanUrl,
                error: fetchResult.error || "Failed to fetch target URL",
                status: fetchResult.status,
              },
              502
            );
          }

          const projectData = await extractProjectWithWorkersAI(
            env.AI,
            fetchResult.text,
            validation.cleanUrl,
            body?.category
          );

          return jsonResponse({
            success: true,
            url: validation.cleanUrl,
            source_title: fetchResult.title,
            meta_description: fetchResult.metaDesc,
            content_length: fetchResult.text.length,
            engine: env.AI ? "Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct)" : "Edge Heuristic Parser",
            project: projectData,
          });
        } catch (err: any) {
          return jsonResponse({ error: "AI Extraction Error", details: err?.message || String(err) }, 500);
        }
      }

      if (url.pathname === "/api/ai/batch-extract" && request.method === "POST") {
        try {
          const body: any = await request.json();
          const rawUrls: string[] = Array.isArray(body?.urls) ? body.urls.slice(0, 5) : [];
          if (rawUrls.length === 0) {
            return jsonResponse({ error: "Empty or invalid 'urls' array in request body" }, 400);
          }

          // Deduplicate and validate all URLs
          const validUrls: string[] = [];
          const seen = new Set<string>();
          for (const u of rawUrls) {
            const v = validateUrlAtEdge(u);
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
              const f = await fetchUrlContent(u);
              if (!f.ok) return { url: u, success: false, error: f.error };
              const p = await extractProjectWithWorkersAI(env.AI, f.text, u, body?.category);
              return { url: u, success: true, title: f.title, project: p };
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
        } catch (err: any) {
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
        // Block external direct access to /internal/* unless caller provides X-Internal-Key
        if (url.pathname.startsWith("/internal/")) {
          const internalKey = request.headers.get("X-Internal-Key");
          if (!internalKey) {
            return new Response(
              JSON.stringify({
                error: "Forbidden",
                message: "Internal endpoints are protected and not directly accessible",
                trace_id: traceId,
              }),
              {
                status: 403,
                headers: { "Content-Type": "application/json", "X-Trace-Id": traceId, ...CORS_HEADERS },
              }
            );
          }
        }

        const cleanBaseUrl = env.BACKEND_API_URL.endsWith('/') ? env.BACKEND_API_URL : env.BACKEND_API_URL + '/';
        const cleanPath = url.pathname.replace(/^\//, '');
        const backendUrl = new URL(cleanPath + url.search, cleanBaseUrl);

        // Prepare forwarded headers with correct origin Host header
        const forwardedHeaders = new Headers(request.headers);
        forwardedHeaders.set("Host", backendUrl.host);
        forwardedHeaders.delete("cf-connecting-ip");
        forwardedHeaders.delete("cf-ray");
        forwardedHeaders.delete("cf-visitor");
        forwardedHeaders.set("X-Trace-Id", traceId);
        forwardedHeaders.set("X-Forwarded-Host", url.host);
        forwardedHeaders.set("X-Forwarded-Proto", url.protocol.replace(":", ""));

        let body: BodyInit | null | undefined = undefined;
        if (!["GET", "HEAD"].includes(request.method)) {
          body = await request.clone().arrayBuffer();
        }

        const maxRetries = 2;
        let backendResponse: Response | null = null;
        let lastError: any = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            backendResponse = await fetch(backendUrl.toString(), {
              method: request.method,
              headers: forwardedHeaders,
              body: body ? body.slice(0) : undefined,
              redirect: "follow",
            });

            // If backend returned 502/503 (e.g. Render spinning up), retry if attempts remain
            if ([502, 503, 504].includes(backendResponse.status) && attempt < maxRetries) {
              await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
              continue;
            }

            break;
          } catch (fetchErr: any) {
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

        // Copy backend response headers and apply CORS
        const responseHeaders = new Headers(backendResponse.headers);
        responseHeaders.set("X-Trace-Id", traceId);
        for (const [key, value] of Object.entries(CORS_HEADERS)) {
          if (!responseHeaders.has(key)) {
            responseHeaders.set(key, value);
          }
        }

        // Support SSE: disable edge buffering
        if (backendResponse.headers.get("Content-Type")?.includes("text/event-stream")) {
          responseHeaders.set("Cache-Control", "no-cache, no-transform");
          responseHeaders.set("X-Accel-Buffering", "no");
        }

        return new Response(backendResponse.body, {
          status: backendResponse.status,
          statusText: backendResponse.statusText,
          headers: responseHeaders,
        });
      } catch (err: any) {
        return new Response(
          JSON.stringify({
            error: "GatewayError",
            message: "Failed to connect to backend service.",
            details: err?.message || String(err),
            trace_id: traceId,
          }),
          {
            status: 502,
            headers: {
              "Content-Type": "application/json",
              "X-Trace-Id": traceId,
              ...CORS_HEADERS,
            },
          }
        );
      }
    }

    // 4. Serve Static Frontend Assets via Cloudflare Workers Static Assets binding
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};
