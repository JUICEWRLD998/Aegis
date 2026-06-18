/**
 * Agent Auth — User → Agent delegation. THE core of the submission (the 40%).
 *
 * The user (data owner) signs a delegation credential that authorizes the agent
 * (by its pubkey) to invoke specific functions of a specific contract, within a
 * bounded validity window. The agent then signs each invocation, proving it acts
 * under that authority. Either can be revoked — whole-credential or per-function.
 *
 * All of this is programmatic in @terminal3/t3n-sdk@3.8.0:
 *   buildDelegationCredential(opts) -> DelegationCredential
 *   signCredential(jcs, secret)     -> { sig, addr }   (user signs, EIP-191)
 *   signAgentInvocation(preimage, secret)              (agent signs each call)
 *   buildInvocationPreimage(vcId, nonce, reqHash)
 *   revokeDelegation({ credentialJcsB64u, revokedFunctions?, client })
 *
 * This file is the integration exhibit: every delegation primitive in one place.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySdk = any;
import type { T3Session } from "./client";

let sdkPromise: Promise<AnySdk> | null = null;
async function loadSdk(): Promise<AnySdk> {
  if (!sdkPromise) sdkPromise = import("@terminal3/t3n-sdk");
  return sdkPromise;
}

/** Functions the agent may be granted on our banking contract. */
export const BANKING_FUNCTIONS = ["query-lenders", "submit-application"] as const;
export type BankingFunction = (typeof BANKING_FUNCTIONS)[number];

export interface GrantParams {
  userDid: string;
  agentPubkey: Uint8Array; // the agent's public key (its verifiable identity)
  orgDid: string; // tenant/org DID that owns the contract
  contract: string; // fully-qualified `z:<tid>:banking-contracts`
  functions: BankingFunction[]; // MUST be sorted + deduped (SDK enforces)
  vcId: Uint8Array; // unique credential id
  validForSecs: number; // bounded validity window
  nowSecs: number; // caller-supplied clock (no Date.now in some envs)
  scopes?: string[]; // e.g. ["amount<=20000"] — app-level scoping metadata
  metadata?: Record<string, string>;
}

export interface SignedGrant {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  credential: any; // DelegationCredential
  credentialJcsB64u: string; // canonical bytes, needed to revoke later
  userSig: Uint8Array;
  userAddr: Uint8Array;
  vcId: Uint8Array;
}

/**
 * Build + user-sign a scoped, time-boxed delegation credential.
 * `userSecret` is the data owner's signing key (EIP-191 / personal_sign).
 */
export async function createScopedGrant(
  params: GrantParams,
  userSecret: Uint8Array,
): Promise<SignedGrant> {
  const sdk = await loadSdk();

  const functions = [...params.functions].sort();
  const credential = sdk.buildDelegationCredential({
    user_did: params.userDid,
    agent_pubkey: params.agentPubkey,
    org_did: params.orgDid,
    contract: params.contract,
    functions,
    scopes: params.scopes,
    metadata: params.metadata,
    // The SDK expects BigInt second-counts (proven in scripts/delegation-roundtrip.ts);
    // the public API stays number-typed for ergonomics and coerces here.
    not_before_secs: BigInt(params.nowSecs),
    not_after_secs: BigInt(params.nowSecs + params.validForSecs),
    vc_id: params.vcId,
  });

  // Canonicalize → JCS bytes → user signs.
  const jcs: Uint8Array = sdk.canonicaliseCredential(credential);
  const { sig, addr } = sdk.signCredential(jcs, userSecret);
  const credentialJcsB64u: string = sdk.b64uEncodeBytes(jcs);

  return {
    credential,
    credentialJcsB64u,
    userSig: sig,
    userAddr: addr,
    vcId: params.vcId,
  };
}

/**
 * Revoke a delegation. Omit `functions` to kill the whole credential, or pass a
 * subset to revoke just those (e.g. revoke "submit-application" but keep
 * "query-lenders" alive — the live demo beat).
 */
export async function revokeGrant(
  session: T3Session,
  grant: SignedGrant,
  functions?: BankingFunction[],
): Promise<{ vcId: string; revokedFunctions: string[] | null }> {
  const sdk = await loadSdk();
  // NOTE: revokeDelegation's default version-resolution is broken (BUG-CAND-D):
  // it builds a relative URL and fails. We pass baseUrl + an explicitly resolved
  // version so revoke works reliably. Proven in scripts/delegation-roundtrip.ts.
  const baseUrl: string = sdk.getNodeUrl();
  const scriptVersion = await resolveDelegationVersion(baseUrl);

  const res = await sdk.revokeDelegation({
    credentialJcsB64u: grant.credentialJcsB64u,
    revokedFunctions: functions ? [...functions].sort() : undefined,
    client: session.client,
    baseUrl,
    scriptVersion,
  });
  return { vcId: res.vcId, revokedFunctions: res.revokedFunctions };
}

/** Resolve the live tee:delegation contract version (workaround for BUG-CAND-D). */
async function resolveDelegationVersion(baseUrl: string): Promise<string> {
  const url =
    `${baseUrl}/api/contracts/current?name=` +
    encodeURIComponent("tee:delegation/contracts");
  const r = await fetch(url);
  if (!r.ok) throw new Error(`delegation version lookup failed: HTTP ${r.status}`);
  const j = (await r.json()) as { current_version?: string };
  if (!j.current_version) throw new Error("no current_version in lookup response");
  return j.current_version;
}
