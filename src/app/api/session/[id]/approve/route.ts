/** POST /api/session/:id/approve — resolve a pending consent / step-up approval. */
import { resolveApproval } from "@/server/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const { approvalId, approved, reason } = (await req.json()) as {
    approvalId?: string;
    approved?: boolean;
    reason?: string;
  };
  if (!approvalId || typeof approved !== "boolean") {
    return Response.json({ error: "approvalId and approved required" }, { status: 400 });
  }
  const ok = resolveApproval(id, approvalId, approved, reason);
  return Response.json({ ok });
}
