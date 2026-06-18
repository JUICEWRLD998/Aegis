/**
 * Agent side of the lender wire — assembles and SIGNS a request to a lender.
 *
 * This is where the agent proves, per call, that it is acting under the user's
 * grant: it signs the invocation pre-image with its own secp256k1 key
 * (signAgentInvocation), carrying the user-signed credential alongside. The lender
 * verifies both signatures (see src/lenders/verify.ts). One place builds the
 * envelope so the bytes the agent signs match exactly what the lender hashes.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { buildInvocationPreimage, signAgentInvocation } from "@terminal3/t3n-sdk";
import type { AgentContext } from "./context";
import type { BankingFunction } from "../t3/delegation";
import type { DisclosureAssertions } from "../t3/profile";
import {
  bytesToHex,
  canonicalJson,
  type SignedLenderRequest,
  type WireCredential,
} from "../lenders/wire";

export interface BuildRequestOpts {
  fn: BankingFunction;
  lenderId: string;
  assertions: DisclosureAssertions;
  proofRef: string;
  requestedAmount: number;
  termMonths: number;
  offerId?: string;
}

/**
 * Build a signed lender request from the active consent grant. Throws if no consent
 * is held (the tool layer guards this, but we fail loudly rather than send unsigned).
 */
export function buildSignedLenderRequest(
  ctx: AgentContext,
  opts: BuildRequestOpts,
): SignedLenderRequest {
  const consent = ctx.consent;
  if (!consent) throw new Error("no active consent grant to sign a lender request");
  const { grant } = consent;
  const cred = grant.credential as {
    user_did: string;
    org_did: string;
    contract: string;
    functions: string[];
    scopes: string[];
    metadata: Record<string, string>;
    not_before_secs: bigint;
    not_after_secs: bigint;
    agent_pubkey: Uint8Array;
  };

  const agentPubkeyHex = bytesToHex(cred.agent_pubkey);
  const wireCredential: WireCredential = {
    user_did: cred.user_did,
    org_did: cred.org_did,
    contract: cred.contract,
    functions: cred.functions,
    scopes: cred.scopes,
    metadata: cred.metadata,
    not_before_secs: cred.not_before_secs.toString(),
    not_after_secs: cred.not_after_secs.toString(),
    agent_pubkey_hex: agentPubkeyHex,
    vc_id_hex: bytesToHex(grant.vcId),
  };

  const body = {
    assertions: opts.assertions,
    proof_ref: opts.proofRef,
    requested_amount: opts.requestedAmount,
    term_months: opts.termMonths,
    agent_pubkey_hex: agentPubkeyHex,
    ...(opts.offerId ? { offer_id: opts.offerId } : {}),
  };

  // Sign the invocation: sha256(canonical body) → pre-image → agent secp256k1 sig.
  const reqHash = sha256(new TextEncoder().encode(canonicalJson(body)));
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const preimage = buildInvocationPreimage(grant.vcId, nonce, reqHash);
  const agentSig = signAgentInvocation(preimage, ctx.agent.privateKey);

  return {
    fn: opts.fn,
    lender_id: opts.lenderId,
    body,
    credential: wireCredential,
    credential_jcs_b64u: grant.credentialJcsB64u,
    user_sig_hex: bytesToHex(grant.userSig),
    nonce_hex: bytesToHex(nonce),
    agent_sig_hex: bytesToHex(agentSig),
  };
}
