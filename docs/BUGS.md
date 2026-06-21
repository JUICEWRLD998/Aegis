# Terminal 3 SDK — Bug Reports

**Reporter:** fadhmusty@gmail.com
**Package:** `@terminal3/t3n-sdk@3.8.0`
**Environment:** Node v24.14.1, Windows 11. Testnet node `https://cn-api.sg.testnet.t3n.terminal3.io`.

Every bug below reproduces with a single offline, deterministic command — no network
and no API key required. Install dependencies once, then run the repro script:

```bash
npm install                              # pulls @terminal3/t3n-sdk@3.8.0 + tsx
node --import tsx scripts/sdk-bugs.ts     # runs all four repros, offline
```

Each report also cites the individual case (e.g. `BUG 1`) printed by that script.

---

## BUG-001 — `revokeDelegation()` default version resolution builds a relative URL and cannot revoke

- **Component:** `revokeDelegation` (delegation lifecycle)
- **Severity:** High — revocation is a core safety primitive, and its default,
  documented call shape is broken.

**Summary**

`revokeDelegation({ credentialJcsB64u, client })` — the natural call using the
authenticated client and nothing else — throws
`TypeError: Failed to parse URL from /api/contracts/current?name=tee%3Adelegation%2Fcontracts`.
The SDK resolves the delegation-contract version by `fetch`-ing a **relative** URL
instead of using the node URL the authenticated `client` already holds.

**Steps to reproduce**

```ts
import * as sdk from "@terminal3/t3n-sdk";
await sdk.revokeDelegation({ credentialJcsB64u: "AA", client: {} as never });
// The failure occurs during version resolution, before the client is used,
// so a stub client is sufficient to surface it.
```

Or run `node --import tsx scripts/sdk-bugs.ts` (BUG 1).

**Expected:** With an authenticated `client`, `revokeDelegation` resolves the
`tee:delegation/contracts` version against the client's own node URL and revokes, with
no extra arguments.

**Actual:** Throws `Failed to parse URL from /api/contracts/current?name=tee%3Adelegation%2Fcontracts`.
Revocation only succeeds if the caller manually supplies **both** `baseUrl`
(e.g. `getNodeUrl()`) **and** an explicit `scriptVersion`.

**Root cause**

```js
// revokeDelegation:
const base    = opts.baseUrl?.replace(/\/$/, "");
const version = opts.scriptVersion
    ?? await getScriptVersion(base ?? "", "tee:delegation/contracts");  // "" when baseUrl omitted
// getScriptVersion("") → fetch("" + "/api/contracts/current?name=" + ...)  // relative URL
```

`revokeDelegation` receives the authenticated `client` (which knows its node URL), but
the version-lookup path ignores it and falls back to `""`. A relative URL is
unconditionally unparseable by `fetch` in Node/undici, so the default revoke path can
never succeed; documentation alone cannot fix it.

**Suggested fix:** Default `baseUrl` to the client's configured node URL (the value
behind `getNodeUrl()` / the client's `baseUrl` config) when `opts.baseUrl` is omitted,
before calling `getScriptVersion`.

---

## BUG-002 — `buildDelegationCredential()` cannot represent a canonical tenant contract name

- **Component:** `buildDelegationCredential` / `validateCredentialBody` (`MAX_CONTRACT_LEN`)
  vs `canonicalTenantName` / `validateTail` (`TAIL_PATTERN`)
- **Severity:** Medium-High — blocks delegating an agent to a tenant contract with a
  normal tail, which is the central agent-authorisation use case.

**Summary**

The SDK's own `canonicalTenantName(tenantDid, tail)` produces contract script names of
the form `z:<40-hex-tid>:<tail>` (length `43 + tail.length`), and
`validateTail` / `TAIL_PATTERN` accept tails of 1–128 characters. But
`buildDelegationCredential` rejects any `contract` longer than `MAX_CONTRACT_LEN = 46`
with `ContractTooLong`. As a result, **any tenant contract whose tail is ≥ 4 characters
cannot be named in a delegation credential** — the SDK generates contract identifiers
that its own credential validator rejects.

**Steps to reproduce**

```ts
import * as sdk from "@terminal3/t3n-sdk";
const tid  = "did:t3n:" + "a".repeat(40);
const name = sdk.canonicalTenantName(tid, "banking-contracts"); // len 60
sdk.buildDelegationCredential({
  user_did: tid, org_did: tid, contract: name,
  agent_pubkey: /* 33 bytes */, vc_id: /* 16 bytes */,
  functions: ["query-lenders"], not_before_secs: 0n, not_after_secs: 9999999999n,
});
// → throws "ContractTooLong"
```

Run `node --import tsx scripts/sdk-bugs.ts` (BUG 2). Even the minimal overflow case
`z:<40hex>:abcd` (47 chars) is rejected.

**Expected:** Either (a) the `contract` field accommodates a full `z:<tid>:<tail>`
script name so a credential can authorise a tenant contract, or (b) the field's
required form for tenant contracts is documented and enforced consistently with
`canonicalTenantName` / `validateTail`.

**Actual:** `MAX_CONTRACT_LEN = 46` is shorter than the minimum length of a canonical
tenant contract name with a ≥ 4-character tail (47); the two SDK components disagree.

**Root cause**

```js
MAX_CONTRACT_LEN = 46;
TAIL_PATTERN     = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/;   // tails up to 128 chars
canonicalTenantName = (did, tail) => "z:" + tenantDidHex(did) + ":" + validateTail(tail);
// "z:" (2) + 40 hex + ":" (1) + tail  =  43 + tail.length
```

This is an internal inconsistency between two SDK functions: `canonicalTenantName`
accepts inputs that `validateCredentialBody` rejects.

**Suggested fix:** Raise `MAX_CONTRACT_LEN` to cover canonical tenant script names
(≥ `43 + 128`), or split "system contract id" from "tenant script name" with documented
bounds for each.

---

## BUG-003 — `b64uDecodeStrict()` accepts non-canonical base64url

- **Component:** `b64uDecodeStrict` / `b64uDecode`
- **Severity:** Low-Medium — a function named *Strict* silently accepts malformed input.
  In a system that signs and keys on canonical bytes (credential JCS, `vc_id`), encoding
  malleability is a correctness and security concern.

**Summary**

`b64uDecodeStrict` (a direct alias of `b64uDecode`) does not verify that the trailing
bits of the final base64url quantum are zero. As a result, distinct input strings decode
to **identical** bytes — for example `"AA"` and `"AB"` both decode to `[0x00]`.

**Steps to reproduce**

```ts
import * as sdk from "@terminal3/t3n-sdk";
sdk.b64uDecodeStrict("AA"); // Uint8Array [0x00]
sdk.b64uDecodeStrict("AB"); // Uint8Array [0x00]  ← should be rejected (non-zero trailing bits)
sdk.b64uEncodeBytes(sdk.b64uDecodeStrict("AB")); // "AA"  (≠ "AB")
```

Run `node --import tsx scripts/sdk-bugs.ts` (BUG 3).

**Expected:** A strict base64url decoder rejects non-canonical input (RFC 4648 §3.5 —
trailing bits must be zero), so decoding is injective.

**Actual:** Trailing non-zero bits are silently discarded; `"AB"` decodes to the same
bytes as `"AA"`.

**Root cause**

`b64uDecode` only throws when the leftover bit count is `>= 6` (a length error); it never
checks that the discarded `< 6` trailing bits are zero:

```js
// ... accumulate 6 bits per char, emit bytes ...
if (bitsLeftover >= 6) throw new Error("invalid length");   // only length is checked
return Uint8Array.from(out);                                // trailing bits never validated
```

**Suggested fix:** After the loop, throw if the leftover bits are non-zero, and reject
inputs whose length is `% 4 == 1`.

---

## BUG-004 — `toBaseUnits()` uses floating-point math and loses precision

- **Component:** `toBaseUnits`
- **Severity:** Low — financial unit conversion via `number` / `Math.round` is lossy;
  for a token/credit system this can misstate base-unit amounts.

**Summary**

`toBaseUnits(value: number)` computes `Math.round(value * BASE_UNITS_PER_TOKEN)` in
IEEE-754 double precision. For inputs beyond ~2^53 (or with many fractional digits) the
result is wrong, and can even be returned in scientific notation — a non-integer
base-unit count.

**Steps to reproduce**

```ts
import * as sdk from "@terminal3/t3n-sdk";
sdk.toBaseUnits(9007199254740992); // 9.007199254740992e+21  (not an exact integer base-unit count)
```

Run `node --import tsx scripts/sdk-bugs.ts` (MINOR).

**Expected:** Exact integer base-unit conversion that accepts string/bigint amounts and
round-trips with the BigInt-based `formatTokens`.

**Actual:** Float multiplication plus `Math.round` produces precision loss and
scientific-notation output, asymmetric with the BigInt-based `formatTokens`.

**Root cause**

```js
toBaseUnits = v => Math.round(v * BASE_UNITS_PER_TOKEN);
```

**Suggested fix:** Accept `string | bigint`, parse the decimal, and scale in BigInt
(mirroring `formatTokens`).
