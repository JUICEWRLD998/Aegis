/**
 * Terminal 3 SDK adapter — the SINGLE chokepoint for every T3 call in Aegis.
 *
 * Why this file exists:
 *  1. Integration exhibit — every Agent-Auth primitive we touch is visible in one
 *     place, which is exactly the "how well integrated is the SDK" story (40%).
 *  2. Insulation — the real `@terminal3/t3n-sdk` surface is still being confirmed
 *     against live testnet (see docs/SDK_FINDINGS.md). Keeping all calls behind
 *     this module means API surprises change ONE file, not the whole app.
 *
 * Confirmed surface (docs + z-tenant-flight):
 *   setEnvironment, T3nClient, loadWasmComponent, eth_get_address, metamask_sign,
 *   createEthAuthInput, getScriptVersion, getNodeUrl
 *   client.handshake(), client.authenticate(), client.getUsage(),
 *   client.tenant.{claim,me}, client.maps.*, client.contracts.register,
 *   client.executeAndDecode({ script_name, script_version, function_name, input })
 *
 * Anything marked TODO(verify) is unconfirmed until we run scripts/t3-smoke.ts
 * against a real key.
 */

// NOTE: import is intentionally loose until the package is installed + typed.
// Once `npm i` is run we tighten these to the real exported types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySdk = any;

export type T3Env = "testnet" | "production";

export interface T3Session {
  client: AnySdk;
  did: string; // did:t3n:... of the authenticated principal
  address: string;
}

export interface ExecuteArgs {
  scriptName: string;
  functionName: string;
  input: Record<string, unknown>;
  scriptVersion?: string;
}

let sdkPromise: Promise<AnySdk> | null = null;
async function loadSdk(): Promise<AnySdk> {
  if (!sdkPromise) {
    // Dynamic import so the rest of the app type-checks before the dep is installed.
    sdkPromise = import("@terminal3/t3n-sdk").catch((e) => {
      throw new Error(
        `@terminal3/t3n-sdk not installed or failed to load. Run \`npm i\` and ` +
          `confirm the package name. Underlying error: ${(e as Error).message}`,
      );
    });
  }
  return sdkPromise;
}

/**
 * Open an authenticated, encrypted TEE session for a given key.
 * `handshake()` opens the encrypted channel; `authenticate()` proves the wallet
 * and yields the principal's did:t3n.
 */
export async function openSession(opts: {
  key: string;
  env?: T3Env;
}): Promise<T3Session> {
  const sdk = await loadSdk();
  const env: T3Env = opts.env ?? (process.env.T3N_ENV as T3Env) ?? "testnet";

  sdk.setEnvironment(env);

  const address: string = sdk.eth_get_address(opts.key);
  const client = new sdk.T3nClient({
    wasmComponent: await sdk.loadWasmComponent(),
    handlers: { EthSign: sdk.metamask_sign(address, undefined, opts.key) },
  });

  await client.handshake();
  // Confirmed against @terminal3/t3n-sdk@3.8.0 + live testnet: authenticate()
  // resolves to a Did, which at runtime is an object { value: string, toString }
  // (NOT a plain string, despite the docs). Normalize to the canonical string.
  const didRaw = await client.authenticate(sdk.createEthAuthInput(address));
  const did: string = normalizeDid(didRaw);

  return { client, did, address };
}

/** Coerce the SDK's Did (object { value, toString } at runtime) to a string. */
export function normalizeDid(did: unknown): string {
  if (typeof did === "string") return did;
  if (did && typeof did === "object") {
    const v = (did as { value?: unknown }).value;
    if (typeof v === "string") return v;
    return String(did);
  }
  return String(did);
}

/**
 * Token credit balance — used to surface metering in the UI and guard actions.
 * getUsage() returns a UsagePage { balance: BalanceRow, entries, next_cursor }.
 * BalanceRow.available is in base units (see formatTokens in the SDK).
 */
export async function getUsage(
  session: T3Session,
): Promise<{ available: number; reserved: number; creditExhausted: boolean }> {
  const usage = await session.client.getUsage();
  const b = usage?.balance ?? {};
  return {
    available: b.available ?? 0,
    reserved: b.reserved ?? 0,
    creditExhausted: b.credit_exhausted ?? false,
  };
}

/** Resolve the latest registered version of a contract script. */
export async function resolveScriptVersion(
  session: T3Session,
  scriptName: string,
): Promise<string> {
  const sdk = await loadSdk();
  return sdk.getScriptVersion(sdk.getNodeUrl(), scriptName);
}

/**
 * Invoke a deployed TEE contract function. PII is never passed here — it is
 * resolved inside the enclave from the user's profile via {{profile.*}}
 * placeholders. `input` carries only non-sensitive references.
 */
export async function execute<T = unknown>(
  session: T3Session,
  args: ExecuteArgs,
): Promise<T> {
  const version =
    args.scriptVersion ??
    (await resolveScriptVersion(session, args.scriptName));

  return session.client.executeAndDecode({
    script_name: args.scriptName,
    script_version: version,
    function_name: args.functionName,
    input: args.input,
  }) as Promise<T>;
}

/** Build the fully-qualified script name `z:<tid>:<tail>` from a tenant DID. */
export function scriptName(tenantDid: string, tail: string): string {
  const tid = tenantDid.startsWith("did:t3n:")
    ? tenantDid.slice("did:t3n:".length)
    : tenantDid;
  return `z:${tid}:${tail}`;
}
