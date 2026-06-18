/** POST /api/session/:id/revoke — kill the agent's authority (all or per-function). */
import { revoke } from "@/server/sessions";
import type { BankingFunction } from "@/t3/delegation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { functions?: BankingFunction[] };
  try {
    const result = await revoke(id, body.functions);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
