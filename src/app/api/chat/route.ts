/** POST /api/chat — start one agent turn for a session. Events stream via SSE. */
import { sendMessage, hasSession } from "@/server/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const { sessionId, message } = (await req.json()) as {
    sessionId?: string;
    message?: string;
  };
  if (!sessionId || !hasSession(sessionId)) {
    return Response.json({ error: "unknown session" }, { status: 404 });
  }
  if (!message || !message.trim()) {
    return Response.json({ error: "empty message" }, { status: 400 });
  }
  sendMessage(sessionId, message.trim());
  return Response.json({ ok: true });
}
