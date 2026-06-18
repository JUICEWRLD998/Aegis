/**
 * Verified-data vault — the user's confidential financial data held in T3.
 *
 * Built on the org-data layer (SessionOrgDataClient): the data owner creates a
 * policy, then writes verified records into named scopes (e.g. "banking/profile",
 * "banking/income"). Read access is governed by policy + grants; a TEE contract
 * reads these on the user's behalf under a delegation, and discloses ONLY what the
 * scope/placeholders allow — raw bytes never flow back to the agent.
 *
 * For the agent/LLM side we only ever surface NON-sensitive derived assertions
 * (e.g. "income_ge_80k": true), never the underlying figures.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySdk = any;
import type { T3Session } from "./client";

let sdkPromise: Promise<AnySdk> | null = null;
async function loadSdk(): Promise<AnySdk> {
  if (!sdkPromise) sdkPromise = import("@terminal3/t3n-sdk");
  return sdkPromise;
}

function utf8ToHex(s: string): string {
  return Array.from(new TextEncoder().encode(s), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function hexToUtf8(hex: string): string {
  const clean = hex.replace(/^0x/i, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

/** Deterministic 32-hex entry id from a logical key, so writes are idempotent. */
function entryIdFor(key: string): string {
  // simple FNV-1a → 16 bytes (32 hex). Stable across runs for the same key.
  let h = 0xcbf29ce484222325n;
  for (const c of new TextEncoder().encode(key)) {
    h = BigInt.asUintN(64, (h ^ BigInt(c)) * 0x100000001b3n);
  }
  const hex = h.toString(16).padStart(16, "0");
  return (hex + hex).slice(0, 32);
}

async function client(session: T3Session): Promise<AnySdk> {
  const sdk = await loadSdk();
  return sdk.createOrgDataClientFromSession(session.client, sdk.getNodeUrl());
}

/**
 * The testnet org-data RPC path intermittently returns "fetch failed" at the
 * network layer (the same call succeeds on retry — see docs/BUGS.md). Wrap
 * org-data calls so transient failures don't break the flow.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!/fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test((e as Error).message)) {
        throw e; // a real server error (e.g. NotScopeWriter) — don't retry blindly
      }
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw new Error(`${label} failed after ${tries} tries: ${(lastErr as Error).message}`);
}

/** Ensure the data owner has a policy (idempotent-ish; ignores "already exists"). */
export async function ensurePolicy(session: T3Session): Promise<void> {
  const odc = await client(session);
  try {
    await withRetry("createPolicy", () =>
      odc.createPolicy({ orgDid: session.did, initialAdminDid: session.did }),
    );
  } catch (e) {
    const msg = (e as Error).message ?? "";
    // Only swallow genuine "already exists" — NOT OrgPolicyNotInitialised, which
    // signals createPolicy didn't actually initialise (testnet issue, see BUGS.md).
    if (!/already.*exist|conflict/i.test(msg)) throw e;
  }
}

/**
 * Make the data owner a writer for a scope. Required before writeData, else the
 * node rejects with `NotScopeWriter`. Idempotent.
 */
export async function ensureScopeWriter(
  session: T3Session,
  scope: string,
): Promise<void> {
  const odc = await client(session);
  await withRetry("setWriters", () =>
    odc.setWriters({ orgDid: session.did, scope, writers: [session.did] }),
  );
}

/** Write a verified record (JSON) into a scope. Idempotent upsert by logical key. */
export async function writeVerifiedRecord(
  session: T3Session,
  scope: string,
  key: string,
  record: Record<string, unknown>,
): Promise<{ entryId: string }> {
  const odc = await client(session);
  const entryId = entryIdFor(key);
  await withRetry("writeData", () =>
    odc.writeData({
      orgDid: session.did,
      scope,
      payloadHex: utf8ToHex(JSON.stringify(record)),
      entryId,
    }),
  );
  return { entryId };
}

/** Read a verified record back (JSON). */
export async function readVerifiedRecord<T = Record<string, unknown>>(
  session: T3Session,
  scope: string,
  key: string,
): Promise<T> {
  const odc = await client(session);
  const res = await withRetry<{ payload_hex: string }>("dataGet", () =>
    odc.dataGet({ orgDid: session.did, scope, entryId: entryIdFor(key) }),
  );
  return JSON.parse(hexToUtf8(res.payload_hex)) as T;
}
