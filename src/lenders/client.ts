/**
 * Agent-side lender client — sends signed, PII-free requests to the lenders and
 * collects their verified responses.
 *
 * Two transports, same wire format:
 *   • in-process (default, headless): calls handleQuote/handleAccept directly — used
 *     by scripts and by the server-side agent runtime.
 *   • HTTP (when LENDER_BASE_URL is set): POSTs to the Next.js lender routes, so the
 *     verification genuinely happens across a network/trust boundary.
 */
import { LENDERS } from "./catalog";
import { handleQuote, handleAccept } from "./handler";
import type { SignedLenderRequest, QuoteResponse, AcceptResponse } from "./wire";
import { buildSignedLenderRequest } from "../agent/lenderRequest";
import type { AgentContext } from "../agent/context";
import type { DisclosureAssertions } from "../t3/profile";

function baseUrl(): string | undefined {
  const b = (process.env.LENDER_BASE_URL ?? "").trim();
  return b || undefined;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`lender HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function dispatchQuote(req: SignedLenderRequest, nowSecs: number): Promise<QuoteResponse> {
  const base = baseUrl();
  if (base) return postJson<QuoteResponse>(`${base}/api/lenders/${req.lender_id}/quote`, req);
  return handleQuote(req, nowSecs);
}

async function dispatchAccept(req: SignedLenderRequest, nowSecs: number): Promise<AcceptResponse> {
  const base = baseUrl();
  if (base) return postJson<AcceptResponse>(`${base}/api/lenders/${req.lender_id}/accept`, req);
  return handleAccept(req, nowSecs);
}

export interface QueryParams {
  assertions: DisclosureAssertions;
  proofRef: string;
  requestedAmount: number;
  termMonths: number;
  lenderIds?: string[]; // defaults to all lenders
}

/** Ask every (or a subset of) lender for a quote, each under its own signed request. */
export async function queryAllLenders(
  ctx: AgentContext,
  params: QueryParams,
): Promise<QuoteResponse[]> {
  const nowSecs = ctx.nowSecs();
  const ids = params.lenderIds ?? LENDERS.map((l) => l.id);
  return Promise.all(
    ids.map((lenderId) => {
      const req = buildSignedLenderRequest(ctx, {
        fn: "query-lenders",
        lenderId,
        assertions: params.assertions,
        proofRef: params.proofRef,
        requestedAmount: params.requestedAmount,
        termMonths: params.termMonths,
      });
      return dispatchQuote(req, nowSecs);
    }),
  );
}

export interface AcceptParams {
  lenderId: string;
  offerId: string;
  assertions: DisclosureAssertions;
  proofRef: string;
  amount: number;
  termMonths: number;
}

/** Submit an acceptance to one lender — the transaction-authorization call. */
export async function acceptOffer(
  ctx: AgentContext,
  params: AcceptParams,
): Promise<AcceptResponse> {
  const req = buildSignedLenderRequest(ctx, {
    fn: "submit-application",
    lenderId: params.lenderId,
    assertions: params.assertions,
    proofRef: params.proofRef,
    requestedAmount: params.amount,
    termMonths: params.termMonths,
    offerId: params.offerId,
  });
  return dispatchAccept(req, ctx.nowSecs());
}
