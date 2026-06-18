# Terminal 3 ADK — Technical Findings (Phase 0 recon)

> Source of truth for how the real SDK works. Everything here is pulled from
> docs.terminal3.io + the `Terminal-3/z-tenant-flight` reference repo on 2026-06-18.
> Confirm anything marked ⚠️ against the live testnet once we have an API key.

## 1. The big realization: T3 is NOT a typical JS auth SDK

It is a **confidential-compute platform**. The model has two halves:

1. **TEE Contracts** — written in **Rust, compiled to WASM** (`wasm32-wasip2`), that
   run *inside* the hardware TEE. Your private business logic lives here. They
   import only the host capabilities ("WIT imports") they need.
2. **TypeScript client** (`@terminal3/t3n-sdk`) — your agent/app uses this to
   authenticate and **invoke** the deployed contracts. PII never passes through
   the TS layer or the LLM.

This is actually a *gift* for our pitch: privacy isn't a claim, it's enforced by
hardware. "The agent orchestrates; the enclave holds the data" is literally true.

## 2. The reference pattern == our app

`Terminal-3/z-tenant-flight` is "Duffel flight booking with PII privacy inside a
Trinity TEE." We swap **book flight → apply to lender**. Same shape:
- A no-PII `search-offers` call (→ our `query-lenders`)
- A PII-carrying `book-offer` call using placeholders (→ our `submit-application`)

## 3. The privacy mechanism: placeholders (this is our hero feature)

PII is **never** read by the contract or passed in `input`. Outbound calls that
need PII use the `http-with-placeholders` host interface with `{{profile.<field>}}`
markers. The host resolves them **inside the enclave, just before egress**:

```rust
"given_name":  "{{profile.first_name}}",
"family_name": "{{profile.last_name}}",
"born_on":     "{{profile.date_of_birth}}",
"email":       "{{profile.verified_contacts.email.value}}",
```

For banking we template e.g. `{{profile.annual_income}}`,
`{{profile.employment_status}}`, `{{profile.verified_contacts.email.value}}`.
⚠️ Confirm which financial fields the testnet profile schema supports; fields not
in the schema must be supplied by the contract directly.

## 3b. CORRECTION after reading @terminal3/t3n-sdk@3.8.0 type defs (ground truth)

Inspecting the installed package's `dist/index.d.ts` overturned several Phase-0
assumptions. **The SDK exposes the full delegation lifecycle programmatically** —
it is NOT dashboard-only. Confirmed exports:

- `buildDelegationCredential(opts)` → `DelegationCredential`
  - opts: `{ user_did, agent_pubkey, org_did, contract, functions[], scopes?,
    metadata?, not_before_secs, not_after_secs, vc_id }`
  - **Time-boxed** via not_before/not_after; functions must be sorted+deduped.
- `canonicaliseCredential(cred)` → JCS bytes; `signCredential(jcs, secret)` →
  `{ sig, addr }` (user signs, EIP-191 / personal_sign).
- `signAgentInvocation(preimage, secret)` + `buildInvocationPreimage(vcId, nonce,
  reqHash)` — the agent signs each invocation under the credential.
- `revokeDelegation({ credentialJcsB64u, revokedFunctions?, client })` →
  `{ vcId, revokedFunctions }`. **Per-function revocation supported** → we can
  revoke ONLY `submit-application` while keeping `query-lenders` live. Stronger
  demo beat than planned.
- `DelegationCustodialClient` — custodial signing variant.
- Also present: `OrgDataClient`, payroll delegation helpers
  (`buildPayrollInvocation`, `PAYROLL_FUNCTIONS_V1`) — confirms the payroll use
  case and gives us a second reference pattern.

Other confirmed surface facts:
- `T3nClient.authenticate(authInput)` **returns the `Did` directly** (no separate
  read needed). `handshake()` → `HandshakeResult`.
- `getUsage()` → `UsagePage { balance: BalanceRow{available, reserved,
  last_settled_seq_no, version, credit_exhausted}, entries, next_cursor }`.
- `T3nClientConfig` = `{ wasmComponent, baseUrl?, transport?, timeout?, headers?,
  logLevel?, logger?, handlers? }` — `handlers.EthSign` via `metamask_sign`. Docs
  example was accurate.
- `executeBusinessContract({ tenant, contract, functionName, input, schema? })` is
  the cleanest cross-tenant invoke. `executeAndDecode(payload, schema?)` decodes.
- ⚠️ **DISCREPANCY:** docs "invoke-contract" shows
  `executeAndDecode({ script_name, script_version, function_name, input })` but the
  typed `ContractExecuteInput` is `{ version, functionName, input }`. The payload
  shape differs between docs and types → **verify on testnet, strong doc-gap/bug
  candidate** (see GAP-008).
- KYC helpers present (`KycStatus`, `createEmailOtpAuthInput`, OTP flow) → we can
  do real email-OTP user auth if needed.

Net effect on plan: the "Revoke" demo is now **in-app and per-function**, and our
delegation story is far richer (sign credential → agent signs invocation → scoped
+ time-boxed → revoke subset). This is a big win for the 40% integration score.

## 3c. LIVE TESTNET RUN (2026-06-18) — validated against real infra

`npm run t3:smoke` passed against testnet. Confirmed live:
- `handshake()` + `authenticate(createEthAuthInput(addr))` works end to end.
- Our agent identity DID: `did:t3n:8e3547bce411fd4f51fe1f25df033d83acccc869`
  (address `0x01475095f3db45c92ec0995af13302b86bb2abb1`).
- `getUsage()` → **20,000** credits available.
- `getAuditEvents()` returns a valid (empty) page — API works.
- ⚠️ `authenticate()` returns a **Did OBJECT** `{ value: "did:t3n:…", toString }`
  at runtime, not a plain string. Adapter now normalizes via `normalizeDid()`.
  → doc/type clarity gap (BUG-candidate, see BUGS.md).
- ⚠️ `client.tenant.me()` returned `undefined` (not an error, not a record).
  Hypothesis: must `client.tenant.claim()` to register as a tenant first. Confirm
  in Phase 1 — affects contract deploy (need a tenant DID to own `z:<tid>:…`).

## 3d. DELEGATION ROUND-TRIP — PROVEN LIVE (2026-06-18)

`scripts/delegation-roundtrip.ts` passes end to end on testnet. This is the 40%
core, de-risked on Day 1:
- ✅ Agent identity = 33-byte compressed secp256k1 pubkey (via `@noble/curves`
  `secp256k1.getPublicKey(sk, true)`; v2 API → import `@noble/curves/secp256k1.js`,
  `utils.randomSecretKey()`).
- ✅ `buildDelegationCredential` with scopes `["amount<=20000"]`, metadata, and a
  `not_before/not_after` 24h window. `validateCredentialBody` passes.
- ✅ `canonicaliseCredential` → `signCredential(jcs, userKeyBytes)` → recovered
  signer address **exactly equals** the user's wallet (`0x0147…abb1`). Proof the
  user authorized THIS agent for THESE functions.
- ✅ `revokeDelegation` PER-FUNCTION: revoked only `submit-application`, kept
  `query-lenders` → `{revokedFunctions:["submit-application"]}`. THE demo beat.
- ✅ `revokeDelegation` WHOLE: `{revokedFunctions:null}`.

Gotchas baked into the adapter:
- `contract` field max length = 46 (BUG-CAND-C). Canonical `z:<tid>:<tail>` doesn't
  fit; used short logical id `tee:banking`. Mapping to deployed script TBD on testnet.
- `revokeDelegation` default version-resolution is broken (BUG-CAND-D); we pass
  `baseUrl: getNodeUrl()` + `scriptVersion` from
  `GET /api/contracts/current?name=tee:delegation/contracts` (returns `2.0.1`).
- Testnet node URL: `https://cn-api.sg.testnet.t3n.terminal3.io`.

## 3e. PHASE 2 — verified data + disclosure (2026-06-18)

The org-data vault is the production home for verified financial data, but the
testnet endpoint is unstable/incomplete (BUG-CAND-E: intermittent `fetch failed`;
BUG-CAND-F: `createPolicy` doesn't initialise an individual's policy →
`OrgPolicyNotInitialised` on `setWriters`). KYC also not provisioned
(`kycStatus` → `precondition_failed: create-kyc-provider-session` first).

Decision: model the privacy boundary in code so the agent never sees raw PII,
independent of org-data uptime:
- `src/t3/vault.ts` — org-data adapter (createPolicy/setWriters/writeData/dataGet)
  with `withRetry` for the fetch-failed flakiness. Ready to light up when stable.
- `src/t3/profile.ts` — the boundary: `VerifiedFinancialProfile` (confidential,
  TEE-side only) vs `DisclosureAssertions` (coarse booleans/bands the agent may
  learn). `getDisclosureAssertions()` is the ONLY agent-facing call; raw figures
  never cross it. Falls back to a seeded verified profile if the vault is down.
- Confirmed: getUsage credits drop with real actions (20000 → 19858 after the
  delegation round-trips), so metering is live and accurate.

## 3f. PHASE 3 — agent orchestration (2026-06-18)

The Gemini tool-loop is live (`npm run agent:demo`, passed on testnet). Structure:
- `src/agent/identity.ts` — agent = secp256k1 keypair; pubkey is its verifiable
  identity inside the credential. Robust to unset/placeholder `AGENT_KEY` (mints
  a random identity rather than crashing on a stray CR).
- `src/agent/context.ts` — `AgentContext` (session + identity + consent/step-up
  state + trace) and the `Approver` seam (human-in-the-loop; AutoApprover for
  headless). `createScopedGrant` is first exercised here (was unused before).
- `src/agent/tools.ts` — 8 SDK-backed tools; authority (consent expiry/revocation/
  per-function scope/amount cap) + step-up enforced in the tool layer.
- `src/agent/guardrail.ts` — `assertNoPii` runs on every tool result before it
  re-enters the LLM conversation. Defense-in-depth on top of safe-by-design handlers.
- `src/agent/runtime.ts` — the loop; system prompt encodes the discipline
  (consent first → proof → query → compare → step-up → accept → audit).

Observations:
- `createScopedGrant` works against `buildDelegationCredential` once
  `not_before_secs`/`not_after_secs` are coerced to **BigInt** (the SDK rejects
  plain numbers; the proven roundtrip used BigInt). Fixed in `delegation.ts`.
- query/submit fall back to deterministic stub offers when the banking contract
  isn't deployed yet — keeps the agent loop demoable before Phase 4 deploy.
- `getAuditEvents()` returns an empty page for self-calls so far (delegation
  build+sign is local crypto; only revoke/execute hit the ledger). Expect events
  once contract invokes land in Phase 4.

## 3g. PHASE 4 — mock lenders + transaction authorization (2026-06-18)

Built `src/lenders/` (catalog/verify/handler/client/wire) + thin Next routes
(`src/app/api/lenders/[lender]/{quote,accept}/route.ts`) + agent-side signer
(`src/agent/lenderRequest.ts`). Lenders verify GENUINELY, reusing real SDK crypto.

Confirmed SDK surface used (from `index.d.ts`, ground truth):
- `buildInvocationPreimage(vcId, nonce, reqHash)` → `utf8(DELEGATION_INVOCATION_DOMAIN)
  || vc_id || nonce || request_hash`; doc states **SHA-256 of these bytes is what the
  agent sig is verified against**.
- `signAgentInvocation(preimage, secret)` → **raw compact ECDSA (64 bytes) over
  sha256(preimage)**. ⚠️ GOTCHA (proven via `scripts/probe-crypto.ts`): noble v2
  secp256k1 **defaults to prehash:TRUE**, so the lender verifies with
  `secp256k1.verify(sig, preimage, agent_pubkey)` — pass the RAW preimage and let noble
  hash it. Passing `sha256(preimage)` double-hashes and always fails. (`verify(sig,
  sha256(preimage)) → false`, `verify(sig, preimage) → true`.)
- `ethRecoverEip191(msg, sig)` → recovers the 20-byte signer of an EIP-191 message;
  used to recover the user wallet that signed the credential JCS.
- `DelegationEnvelope` = `{ credential_jcs, user_sig, agent_sig, nonce, request_hash }`
  — our wire format mirrors it (JSON: bytes→hex, bigint window→string).
- Integrity trick: the lender reconstructs the credential from the readable wire
  fields via `buildDelegationCredential` → `canonicaliseCredential` and asserts the
  bytes equal `b64uDecodeStrict(credential_jcs_b64u)`. So the human-readable
  functions/window/scope are provably the ones the user signed — no guessing at the
  SDK's internal byte encoding.
- `canonicaliseRequest`/`requestHash` are typed ONLY for `PayrollRunRequest`, so the
  banking request body uses our own stable `canonicalJson` (sorted keys) hashed with
  `@noble/hashes/sha2` `sha256`. Both sides share `src/lenders/wire.ts`.

did↔address: `ethRecoverEip191` yields the signer's address; `did:t3n:<40hex>` is NOT
that address (recon: did `8e35…` vs addr `0147…`), so the lender surfaces the recovered
signer address rather than asserting did equality. Authority is still fully proven (a
real wallet signed exactly this scoped grant naming exactly this agent key).

✅ STATUS: PASSED. `npm run typecheck` clean; `npm run lenders:demo` → 3 differentiated
offers (7.3/8.2/10.1% APR), agent authorized + user wallet `0x0147…abb1` recovered, and
forged-sig / expired / over-scope / PII-in-body all rejected; `npm run agent:demo` runs
the full hero flow against the verifying lenders with the PII guardrail intact. The one
real bug found + fixed during the run: the prehash:true gotcha above.

## 4. Agent Auth = the delegation grant (the core SDK story for the 40%)

Outbound HTTP egress is authorized **per-call from the calling user's grant**, NOT
the contract. The data owner grants an agent:
- **Agent DID** (the agent's verifiable identity, `did:t3n:…`)
- **Authorized TEE contract**
- **Authorized functions** (optional — defaults to all)
- **Allowed hosts** (optional — defaults to all; the URLs the agent may reach)

Without a grant, the contract still runs but egress fails with
`host/http.egress_denied`; placeholder resolution fails with
`placeholder not permitted: <marker>` when the agent isn't authorized for that user.

⚠️ **MAJOR CONSTRAINT:** In current testnet, granting/revoking access to an agent
is **dashboard-only** (T3N Dashboard → AI Agents → New agent / Remove). The docs
expose **no SDK method** for creating or revoking a grant programmatically.
- Impact on our "Revoke kills authority live" demo beat: we may have to revoke via
  the dashboard on-camera (still a great beat — show the grant dying), OR find an
  undocumented/OpenAPI endpoint (check `terminal-3-openapi.yml`). **Logged as the
  #1 thing to verify with a real key, and a strong doc-gap report candidate.**

## 5. SDK surface (TypeScript) — confirmed names

```ts
import {
  T3nClient, loadWasmComponent, setEnvironment,
  createEthAuthInput, eth_get_address, metamask_sign,
  getScriptVersion, getNodeUrl,
} from "@terminal3/t3n-sdk";

setEnvironment("testnet");                       // "testnet" | "production"
const address = eth_get_address(process.env.T3N_API_KEY!);  // ⚠️ key vs agentKey naming, see gaps
const client = new T3nClient({
  wasmComponent: await loadWasmComponent(),      // all crypto runs in WASM
  handlers: { EthSign: metamask_sign(address, undefined, key) },
});
await client.handshake();                        // open encrypted TEE session
await client.authenticate(createEthAuthInput(address));  // prove wallet → did:t3n:…
await client.getUsage();                         // { balance: { available } } — token credits
```

Namespaced clients (from "what-is-adk"):
- `client.tenant` — `claim()` (register DID as tenant), `me()` (your record)
- `client.maps` — KV maps under `z:<tid>:…` prefix, per-map read/write rules
- `client.contracts` — `register({ tail, version, wasm })` → `{ contract_id }`
  (⚠️ docs mention `publish`/`enable`/`disable`/`unregister` in overview but only
  `register` is documented with code — verify the rest)
- `client.executeAndDecode({ script_name, script_version, function_name, input })`
  — invoke a contract; also raw `execute()`
- Cross-tenant: `executeBusinessContract()`

Script naming: `z:<tid>:<tail>` where `tid = tenantDid.slice("did:t3n:".length)`.
Get version before invoking: `getScriptVersion(getNodeUrl(), scriptName)`.

## 6. Contract structure (Rust → WASM)

```
contract/
├── src/{lib.rs, search.rs, booking.rs}   # lib.rs = wit-bindgen + Guest dispatch
├── wit/{world.wit, deps/}                # world + vendored host interfaces
└── Cargo.toml                            # crate-type = ["cdylib","lib"]
```
- Exported interface `contracts`, each fn takes `generic-input`
  `{ input, user-profile, context: option<list<u8>> }` → `result<list<u8>, string>`.
- Import only host interfaces you use — they are the contract's **entire capability set**:
  `host:tenant/tenant-context`, `host:interfaces/{logging,kv-store,http,http-with-placeholders}`.
- Secrets (e.g. lender API keys) read from KV map `z:<tid>:secrets` at runtime.

## 7. Toolchain required (NOT yet installed on this machine)

```bash
rustup target add wasm32-wasip2     # WASI Preview 2 target
cargo install wasm-tools            # optional, inspect components
npm install @terminal3/t3n-sdk      # Node >= 18 (we have v24)
```
- Rust itself (rustc/cargo) is **NOT installed** → Day 1 task: install rustup.
- Env var: `T3N_API_KEY`.

## 8. Deploy flow (end to end)

1. Write Rust contract → `cargo build --release --target wasm32-wasip2`
2. `tenant.contracts.register({ tail, version, wasm: <bytes> })` → `contract_id`
3. Create KV maps + seed secrets (lender API keys) via `client.maps`
4. **Grant the agent** access to the contract + functions + allowed hosts (dashboard ⚠️)
5. Agent: `handshake()` → `authenticate()` → `executeAndDecode(...)`

## 9. What this means for our architecture (vs original plan)

| Original assumption | Reality | Action |
|---|---|---|
| JS SDK with identity/consent/disclosure methods | Rust/WASM contracts + TS invoke client | Build a real contract (mirrors z-tenant-flight) |
| "Selective disclosure proofs" object | `{{profile.*}}` placeholders resolved in TEE | This IS our disclosure mechanism — even better, hardware-enforced |
| Revoke via SDK button | Dashboard-only grant/revoke (testnet) | Demo revoke via dashboard; file doc-gap; probe OpenAPI |
| Banks verify "agent identity token" | Agent has `did:t3n:` + egress gated by user grant | Banks = allowed-hosts; identity = authenticated DID |
| Audit "in UI" | ⚠️ audit ledger mentioned, no SDK read method found yet | Probe OpenAPI for audit-read; else surface our own action log |

Net: the idea holds up strongly. The privacy story is *stronger* than we assumed
(hardware TEE + placeholders). The main risk is grant/revoke + audit being
dashboard/opaque rather than SDK — verify the moment we have a key.
