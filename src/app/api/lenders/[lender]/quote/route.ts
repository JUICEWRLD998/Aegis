/**
 * POST /api/lenders/:lender/quote — a mock lender's quote endpoint.
 *
 * The verification + pricing live in the framework-agnostic handler; this route is
 * the thin HTTP shell so the agent can hit a real lender over the network (and so
 * the browser demo can show the cross-trust-boundary call).
 */
import { handleQuote } from "@/lenders/handler";
import type { SignedLenderRequest } from "@/lenders/wire";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ lender: string }> },
): Promise<Response> {
  const { lender } = await ctx.params;
  const body = (await req.json()) as SignedLenderRequest;
  // The URL is authoritative for which lender this is.
  const signed: SignedLenderRequest = { ...body, lender_id: lender };
  const result = handleQuote(signed, Math.floor(Date.now() / 1000));
  return Response.json(result);
}
