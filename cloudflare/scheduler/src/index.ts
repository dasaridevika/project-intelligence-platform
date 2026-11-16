/**
 * Cloudflare Scheduled Worker: Outbox Event Publisher
 * Claims pending outbox events from backend and dispatches them to Cloudflare Queues.
 */

export interface Env {
  BACKEND_API_URL: string;
  INTERNAL_API_KEY: string;
  SEARCH_QUEUE: Queue<any>;
}

export interface OutboxEventItem {
  event_id: string;
  search_run_id: string;
  event_type: string;
  schema_version: number;
  payload: Record<string, any>;
  created_at: string;
}

export interface ClaimResponse {
  claimed_count: number;
  events: OutboxEventItem[];
}

export async function processOutbox(env: Env): Promise<{ published: number; failed: number }> {
  let published = 0;
  let failed = 0;

  try {
    // 1. Claim pending outbox records
    const claimRes = await fetch(`${env.BACKEND_API_URL}/internal/v1/outbox/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": env.INTERNAL_API_KEY,
      },
      body: JSON.stringify({ batch_size: 10 }),
    });

    if (!claimRes.ok) {
      console.error(`Failed to claim outbox events. Status: ${claimRes.status}`);
      return { published, failed: 1 };
    }

    const data: ClaimResponse = await claimRes.json();
    if (!data.events || data.events.length === 0) {
      return { published: 0, failed: 0 };
    }

    console.log(`Claimed ${data.events.length} outbox events for publishing.`);

    // 2. Publish each event to Cloudflare Queues
    for (const ev of data.events) {
      try {
        if (env.SEARCH_QUEUE) {
          await env.SEARCH_QUEUE.send(ev.payload);
        } else {
          console.warn("SEARCH_QUEUE binding missing (running in local simulation mode)");
        }

        // 3. Mark published in backend
        const confirmRes = await fetch(
          `${env.BACKEND_API_URL}/internal/v1/outbox/${ev.event_id}/published`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Internal-Key": env.INTERNAL_API_KEY,
            },
          }
        );

        if (confirmRes.ok) {
          published++;
        } else {
          console.error(`Failed to confirm publication of event ${ev.event_id}`);
          failed++;
        }
      } catch (err) {
        console.error(`Error dispatching outbox event ${ev.event_id} to queue:`, err);
        failed++;
      }
    }
  } catch (err) {
    console.error("Outbox publisher execution failure:", err);
    failed++;
  }

  return { published, failed };
}

export default {
  // Invoked on cron schedule
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processOutbox(env));
  },

  // Invoked via HTTP for testing or manual triggers
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const internalKey = request.headers.get("X-Internal-Key");
    if (internalKey !== env.INTERNAL_API_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const result = await processOutbox(env);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
};
