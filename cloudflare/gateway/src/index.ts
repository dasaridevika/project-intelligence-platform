/**
 * Cloudflare Worker API Gateway for Project Intelligence Platform
 * Handles edge routing, rate limiting, CORS, trace ID injection, and static assets.
 */

export interface Env {
  BACKEND_API_URL: string;
  RATE_LIMIT_MAX_REQUESTS: string;
  ASSETS?: Fetcher;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Trace-Id, X-Internal-Key, Last-Event-ID",
  "Access-Control-Expose-Headers": "X-Trace-Id, X-Response-Time",
};

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

    // 3. API & Backend Routing: /api/*, /health, /ready, /docs, /openapi.json, /internal/*
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

        const backendUrl = new URL(url.pathname + url.search, env.BACKEND_API_URL);

        // Clone request headers and add trace headers
        const forwardedHeaders = new Headers(request.headers);
        forwardedHeaders.set("X-Trace-Id", traceId);
        forwardedHeaders.set("X-Forwarded-Host", url.host);
        forwardedHeaders.set("X-Forwarded-Proto", url.protocol.replace(":", ""));

        const backendResponse = await fetch(backendUrl.toString(), {
          method: request.method,
          headers: forwardedHeaders,
          body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
          redirect: "follow",
        });

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
