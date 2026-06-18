/**
 * Banking-domain wrappers over the T3 contract. These are the SDK-backed
 * capabilities the agent (LLM) is allowed to call. Each maps 1:1 to a function
 * exported by our Rust TEE contract (contract/src/*).
 *
 * Privacy invariant: NONE of these accept or return raw PII. They pass opaque
 * references; the enclave resolves {{profile.*}} placeholders for outbound calls.
 */
import { execute, scriptName, type T3Session } from "./client";

const TAIL = process.env.CONTRACT_TAIL ?? "banking-contracts";

function script(tenantDid: string): string {
  return scriptName(tenantDid, TAIL);
}

export interface LenderOffer {
  lenderId: string;
  lenderName: string;
  apr: number;
  maxAmount: number;
  termMonths: number;
  // proof metadata only — never the underlying documents
  proofRef: string;
}

/**
 * Query lenders WITHOUT disclosing PII. The contract sends only the
 * selective-disclosure assertions (e.g. income>=X, no-defaults) the user consented
 * to, plus the agent's did:t3n. Lenders return indicative offers.
 */
export async function queryLenders(
  session: T3Session,
  tenantDid: string,
  params: { requestedAmount: number; termMonths: number },
): Promise<LenderOffer[]> {
  const res = await execute<{ offers: LenderOffer[] }>(session, {
    scriptName: script(tenantDid),
    functionName: "query-lenders",
    input: params,
  });
  return res.offers ?? [];
}

/**
 * Submit a full application to a chosen lender. PII (name, income proof, etc.) is
 * injected by the host via placeholders at egress — it never enters the contract
 * or this process. Gated by the user's agent-auth grant + (app-side) step-up.
 */
export async function submitApplication(
  session: T3Session,
  tenantDid: string,
  params: { lenderId: string; offerId: string; amount: number; termMonths: number },
): Promise<{ status: string; referenceId: string; auditRef?: string }> {
  return execute(session, {
    scriptName: script(tenantDid),
    functionName: "submit-application",
    input: params,
  });
}
