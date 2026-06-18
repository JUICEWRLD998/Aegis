/** GET /api/session/:id/events — Server-Sent Events stream of the session's activity. */
import { subscribe } from "@/server/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const encoder = new TextEncoder();
  let unsub: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        unsub = subscribe(id, send);
      } catch {
        send({ type: "error", message: "unknown session" });
        controller.close();
      }
    },
    cancel() {
      unsub?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
