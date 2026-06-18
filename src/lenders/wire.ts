/**
 * The agent→lender wire contract — shared by the agent (signer) and the lender
 * (verifier) so both sides serialise/canonicalise identically.
 *
 * It mirrors the SDK's own `DelegationEnvelope` ({ credential_jcs, user_sig,
 * agent_sig, nonce, request_hash }), JSON-encoded for HTTP: byte fields become hex,
 * the credential window (bigint) becomes a decimal string. The lender re-derives
 * the canonical JCS from the readable fields and checks it against the signed bytes,
 * so the human-readable fields are provably the ones the user signed.
 */
import type { DisclosureAssertions } from "../t3/profile";
import type { BankingFunction } from "../t3/delegation";

/** Readable, reconstructable view of the signed DelegationCredential. */
export interface WireCredential {
  user_did: string;
  org_did: string;
  contract: string;
  functions: string[];
  scopes: string[];
  metadata: Record<string, string>;
  not_before_secs: string; // bigint as decimal string
  not_after_secs: string;
  agent_pubkey_hex: string; // 33-byte compressed
  vc_id_hex: string;
}

/** What the lender underwrites against — coarse assertions only, never PII. */
export interface LenderRequestBody {
  assertions: DisclosureAssertions;
  proof_ref: string;
  requested_amount: number;
  term_months: number;
  agent_pubkey_hex: string; // must match the credential's agent_pubkey
  offer_id?: string; // present on accept
}

/** The full signed request an agent POSTs to a lender. */
export interface SignedLenderRequest {
  fn: BankingFunction;
  lender_id: string;
  body: LenderRequestBody;
  credential: WireCredential;
  credential_jcs_b64u: string; // the exact bytes the user signed
  user_sig_hex: string; // 65-byte EIP-191 sig over credential_jcs
  nonce_hex: string; // 16-byte per-call nonce
  agent_sig_hex: string; // agent's per-call invocation signature
}

export interface QuoteResponse {
  lender_id: string;
  lender_name: string;
  decision: "offer" | "decline";
  reason?: string;
  offer?: {
    lenderId: string;
    lenderName: string;
    apr: number;
    maxAmount: number;
    termMonths: number;
    proofRef: string;
  };
  /** What the lender cryptographically verified (surfaced for the demo/audit panel). */
  verified: {
    agent_authorized: boolean;
    user_signature_recovered: string | null; // recovered signer address, 0x…
    no_pii: boolean;
  };
}

export interface AcceptResponse {
  lender_id: string;
  status: "submitted" | "rejected";
  reference_id?: string;
  reason?: string;
  verified: QuoteResponse["verified"];
}

// ── canonical encoding helpers (identical on both sides) ─────────────────────

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(h: string): Uint8Array {
  const clean = h.trim().replace(/^0x/i, "");
  if (clean.length % 2 !== 0) throw new Error("odd-length hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Deterministic JSON with recursively-sorted keys. Both sides hash the SAME bytes,
 * so the agent's signature over the request body verifies on the lender. (We can't
 * reuse the SDK's `canonicaliseRequest` — it's typed only for PayrollRunRequest.)
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}
