/**
 * POST /api/lenders/:lender/accept — a mock lender's acceptance endpoint.
 *
 * The transaction-authorization path: re-verifies the signed submit-application
 * request (authority + agent identity, no PII) before issuing a reference id.
 */
import { handleAccept } from "@/lenders/handler";
import type { SignedLenderRequest } from "@/lenders/wire";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ lender: string }> },
): Promise<Response> {
  const { lender } = await ctx.params;
  const body = (await req.json()) as SignedLenderRequest;
  const signed: SignedLenderRequest = { ...body, lender_id: lender };
  const result = handleAccept(signed, Math.floor(Date.now() / 1000));
  return Response.json(result);
}
