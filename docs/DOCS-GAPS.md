# Terminal 3 — Documentation Gaps

**Reporter:** fadhmusty@gmail.com
**Package:** `@terminal3/t3n-sdk@3.8.0`

Each gap below is verified either against the published package types
(`dist/index.d.ts`) or against the live documentation at `docs.terminal3.io`, with the
exact location and evidence cited.

---

## DOC-001 — The programmatic delegation API is undocumented

- **Location:** `docs.terminal3.io/t3n/data-owner-guide/delegate-access`
- **Evidence:** The package exports a complete delegation lifecycle —
  `buildDelegationCredential`, `canonicaliseCredential`, `signCredential`,
  `validateCredentialBody`, `buildInvocationPreimage`, `signAgentInvocation`,
  `revokeDelegation`, and `DelegationCustodialClient`, alongside constants such as
  `DELEGATION_CREDENTIAL_DOMAIN`, `DELEGATION_INVOCATION_DOMAIN`, and
  `MAX_FUNCTIONS_PER_CREDENTIAL`.
- **Gap:** The data-owner guide presents granting and revoking an agent's access as a
  Dashboard-only workflow ("AI Agents" tab → "New agent" / "Remove"). It does not
  mention `buildDelegationCredential`, `signCredential`, `revokeDelegation`, or any
  other SDK function. A developer reading this guide would conclude that delegation
  cannot be performed in code.
- **Why it matters:** Minting, scoping, and revoking agent authority in code is the
  headline use case for an agentic SDK, yet it is undiscoverable from the documentation.
- **Suggested fix:** Add a "Delegation in the SDK" developer page documenting the full
  credential lifecycle (build → canonicalise → user-sign → per-call agent-sign →
  revoke), including validity-window and per-function revocation semantics, and
  cross-link it from the data-owner guide.

---

## DOC-002 — The audit query API (`getAuditEvents`) is undocumented

- **Location:** SDK export with no corresponding developer page (absent from the docs
  index at `docs.terminal3.io/llms.txt`).
- **Evidence:** `T3nClient.getAuditEvents(opts?: GetAuditEventsOptions): Promise<AuditPage>`
  returns audit events whose archived batches carry a `committed: boolean` flag
  ("committed fact — filter on this when you need only durable events").
- **Gap:** Product material references an immutable audit ledger, but no documentation
  page covers how to read it through the SDK, nor the meaning of `committed` (which
  distinguishes a durable event from an in-flight contract-level claim).
- **Why it matters:** Audit retrieval is a core compliance capability that is fully
  implemented but undiscoverable, and the `committed` semantics are easy to misread
  without guidance.
- **Suggested fix:** Document `getAuditEvents`, the event and batch shapes, and the
  meaning of the `committed` flag.

---

## DOC-003 — `invoke-contract` example payload does not match the published type

- **Location:** `docs.terminal3.io/developers/adk/get-started/walkthrough/invoke-contract`
- **Evidence:** The walkthrough's example calls
  `executeAndDecode({ script_name, script_version, function_name, input })`
  (snake_case, four fields). The published type is
  `interface ContractExecuteInput { version: string; functionName: string; input?: unknown }`
  (camelCase, no `script_name`).
- **Gap:** The documented example and the package type disagree on field names and on
  whether `script_name` belongs in the payload.
- **Why it matters:** A developer copying the example passes a shape that does not match
  the published type, and cannot tell from the docs which form the runtime accepts.
- **Suggested fix:** Reconcile the example with `ContractExecuteInput` and document the
  canonical payload for each execute entry point.

---

## DOC-004 — `authenticate()` returns a `Did` object, but examples treat it as a string

- **Location:** SDK type vs. usage in examples.
- **Evidence:** `interface Did { readonly value: string; toString(): string }`, and
  `authenticate(...)` resolves to a `Did`, not a `string`.
- **Gap:** Examples use the authenticated DID as if it were a plain string. At runtime
  `did === "did:t3n:…"` is `false`; the underlying string must be read via `did.value`
  (or coerced with `String(did)` / a template literal). This behaviour is correct per
  the type but is never explained in prose or examples.
- **Why it matters:** Treating the return value as a string fails silently — for
  example when used as an object key, in equality checks, or during serialisation.
- **Suggested fix:** Show `did.value` in examples and document the `Did` object shape.

---

## DOC-005 — The delegation `contract` field's required form and limits are undocumented

- **Location:** `BuildDelegationCredentialOpts.contract` (SDK type / JSDoc).
- **Evidence:** The field is documented only as `/** Contract id, e.g. "tee:payroll". */`
  and is capped at 46 characters. Tenant contracts, however, are named
  `z:<40-hex>:<tail>` by `canonicalTenantName`.
- **Gap:** The documentation never states what `contract` must contain for a tenant
  contract, how it relates to the `z:<tid>:<tail>` script name used at invocation, or
  that a length limit applies.
- **Why it matters:** A developer cannot determine which value authorises an agent for a
  tenant contract. (This also surfaces as a functional defect — see `BUGS.md` BUG-002,
  where the 46-character limit is incompatible with canonical tenant names.)
- **Suggested fix:** Document the exact value the `contract` field must hold for system
  and tenant contracts, and its length bound.

---

## DOC-006 — Dev-environment setup page states "4 steps" but renders five

- **Location:** `docs.terminal3.io/developers/adk/get-started/prerequisites/set-up-dev-env`
- **Evidence:** The subtitle reads "Quick 4 steps to set up your development
  environment", while five steps render: (1) Get your API key and DID, (2) Install Rust
  + WASM toolchain, (3) Install the SDK, (4) Set up the SDK, (5) Authenticate to T3N
  testnet.
- **Why it matters:** A factual inconsistency on the first onboarding page.
- **Suggested fix:** Correct the count to five, or merge two steps.

---

## DOC-007 — The linked getting-started repository is empty

- **Location:** `github.com/Terminal-3/adk-getting-start`
- **Evidence:** The repository is empty (GitHub reports `size: 0`, and the contents API
  returns "This repository is empty").
- **Why it matters:** A developer following the getting-started link finds no code,
  creating immediate onboarding friction.
- **Suggested fix:** Populate the repository with the walkthrough source, or redirect the
  link to a populated example.
