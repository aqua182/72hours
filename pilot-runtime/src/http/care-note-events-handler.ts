import { z } from "zod";
import { verifyPilotRequest } from "../auth/verified-pilot-request";
import { createPilotPool, withPilotActor } from "../db/actor-transaction";

const clinicId = z.string().uuid();
let applicationPool: ReturnType<typeof createPilotPool> | undefined;

/**
 * A small Server-Sent Events channel for the local Pilot. The event carries no
 * patient content; the browser re-fetches the already-authorized read model.
 */
export async function handleCareNoteEvents(request: Request, patientId: string) {
  const parsedClinic = clinicId.safeParse(new URL(request.url).searchParams.get("clinicId"));
  if (!parsedClinic.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  let identity;
  try { identity = await verifyPilotRequest(request); } catch { return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 }); }
  applicationPool ??= createPilotPool();
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastSeen = new Date(0).toISOString();
      const send = (event: string, data: Record<string, string>) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const poll = async () => {
        try {
          const changed = await withPilotActor(applicationPool!, identity, parsedClinic.data, async (client) => {
            const result = await client.query<{ changed_at: string | null }>("SELECT care_note_changed_after($1, $2::timestamptz)::text AS changed_at", [patientId, lastSeen]);
            return result.rows[0]?.changed_at ?? undefined;
          });
          if (changed) { lastSeen = changed; send("care-note-changed", { patientId }); }
          else send("heartbeat", {});
        } catch { send("closed", {}); if (timer) clearInterval(timer); controller.close(); }
      };
      send("ready", { patientId });
      await poll();
      timer = setInterval(() => { void poll(); }, 3_000);
    },
    cancel() { if (timer) clearInterval(timer); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
