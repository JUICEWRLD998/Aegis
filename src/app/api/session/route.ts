/** POST /api/session — create an authenticated agent session (opens the T3 context). */
import { createSession } from "@/server/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    const sessionId = await createSession();
    return Response.json({ sessionId });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
