/**
 * Lender-side verification — GENUINE, no mocks. This is what makes "banks verify an
 * authorized agent and see no PII" a cryptographic fact rather than a claim.
 *
 * A request is accepted only if ALL hold:
 *   1. No PII anywhere in the body (assertNoPii — the same backstop the agent uses).
 *   2. The readable credential fields re-canonicalise to EXACTLY the signed bytes
 *      (buildDelegationCredential → canonicaliseCredential == credential_jcs), and
 *      pass validateCredentialBody.
 *   3. A real wallet signed those bytes — recovered via ethRecoverEip191.
 *   4. The credential authorises this function, is inside its validity window, and
 *      the requested amount respects the `amount<=N` scope.
 *   5. The agent that signed THIS request holds the key the credential names:
 *      secp256k1.verify(agent_sig, sha256(buildInvocationPreimage(vc,nonce,reqHash)))
 *      against credential.agent_pubkey — binding the request to the agent identity
 *      and preventing tampering/replay (nonce).
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  buildDelegationCredential,
  canonicaliseCredential,
  validateCredentialBody,
  buildInvocationPreimage,
  ethRecoverEip191,
  b64uDecodeStrict,
} from "@terminal3/t3n-sdk";
import { assertNoPii, PiiLeakError } from "../agent/guardrail";
import {
  bytesToHex,
  hexToBytes,
  canonicalJson,
  type SignedLenderRequest,
} from "./wire";

export interface VerifyResult {
  ok: boolean;
  reasons: string[];
  /** Recovered signer address (0x…) — the wallet that authorised the agent. */
  signerAddrHex: string | null;
  noPii: boolean;
  agentAuthorized: boolean;
}

const ZERO_ADDR = "0".repeat(40);

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Largest amount permitted by the credential's `amount<=N` scope, or null if none. */
function amountCapFromScopes(scopes: string[]): number | null {
  for (const s of scopes) {
    const m = /^amount<=(\d+)$/.exec(s.trim());
    if (m) return Number(m[1]);
  }
  return null;
}

export function verifyLenderRequest(
  req: SignedLenderRequest,
  opts: { nowSecs: number; requiredFunction: "query-lenders" | "submit-application" },
): VerifyResult {
  const reasons: string[] = [];
  let signerAddrHex: string | null = null;
  let noPii = true;
  let agentAuthorized = false;

  // (1) No PII may reach a lender — at all.
  try {
    assertNoPii("lender_request", req.body);
  } catch (e) {
    noPii = false;
    reasons.push(e instanceof PiiLeakError ? `pii_present:${e.key}` : "pii_present");
  }

  const c = req.credential;

  // (2) Reconstruct the credential and confirm it matches the SIGNED bytes.
  let rebuiltJcs: Uint8Array | null = null;
  try {
    const rebuilt = buildDelegationCredential({
      user_did: c.user_did,
      agent_pubkey: hexToBytes(c.agent_pubkey_hex),
      org_did: c.org_did,
      contract: c.contract,
      functions: c.functions,
      scopes: c.scopes,
      metadata: c.metadata,
      not_before_secs: BigInt(c.not_before_secs),
      not_after_secs: BigInt(c.not_after_secs),
      vc_id: hexToBytes(c.vc_id_hex),
    });
    validateCredentialBody(rebuilt);
    rebuiltJcs = canonicaliseCredential(rebuilt);
    const signedJcs = b64uDecodeStrict(req.credential_jcs_b64u);
    if (!bytesEqual(rebuiltJcs, signedJcs)) {
      reasons.push("credential_mismatch"); // readable fields ≠ what was signed
      rebuiltJcs = null;
    }
  } catch (e) {
    reasons.push(`credential_invalid:${(e as Error).message}`);
  }

  // (3) Recover the wallet that signed the credential.
  if (rebuiltJcs) {
    try {
      const addr = ethRecoverEip191(rebuiltJcs, hexToBytes(req.user_sig_hex));
      const hex = bytesToHex(addr);
      if (hex === ZERO_ADDR) reasons.push("user_sig_invalid");
      else signerAddrHex = "0x" + hex;
    } catch (e) {
      reasons.push(`user_sig_invalid:${(e as Error).message}`);
    }
  }

  // (4) Authority: function, validity window, amount scope.
  if (!c.functions.includes(opts.requiredFunction)) {
    reasons.push(`function_not_authorized:${opts.requiredFunction}`);
  }
  try {
    const now = BigInt(opts.nowSecs);
    if (now < BigInt(c.not_before_secs)) reasons.push("not_yet_valid");
    if (now > BigInt(c.not_after_secs)) reasons.push("credential_expired");
  } catch {
    reasons.push("bad_validity_window");
  }
  const cap = amountCapFromScopes(c.scopes);
  if (cap !== null && req.body.requested_amount > cap) {
    reasons.push(`amount_exceeds_scope:${cap}`);
  }

  // (5) Bind the request to the agent identity named in the credential.
  if (req.body.agent_pubkey_hex !== c.agent_pubkey_hex) {
    reasons.push("agent_pubkey_mismatch");
  } else {
    try {
      const reqHash = sha256(new TextEncoder().encode(canonicalJson(req.body)));
      const preimage = buildInvocationPreimage(
        hexToBytes(c.vc_id_hex),
        hexToBytes(req.nonce_hex),
        reqHash,
      );
      // signAgentInvocation signs raw compact ECDSA over sha256(preimage).
      const valid = secp256k1.verify(
        hexToBytes(req.agent_sig_hex),
        sha256(preimage),
        hexToBytes(c.agent_pubkey_hex),
      );
      if (valid) agentAuthorized = true;
      else reasons.push("agent_sig_invalid");
    } catch (e) {
      reasons.push(`agent_sig_invalid:${(e as Error).message}`);
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    signerAddrHex,
    noPii,
    agentAuthorized,
  };
}
