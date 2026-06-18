# Documentation Gaps — Terminal 3 ADK

> Running log for the Bug Discovery Bounty (documentation-gaps track).
> Rules: must be SDK-related, actionable, verifiable, reproducible, and require a
> change to fix. First valid report wins duplicates. Validate before submitting.
> Each entry: location → gap → why it matters → suggested fix. Status: DRAFT until
> reproduced against live docs/testnet.

---

### GAP-001 — `cargo-component` referenced but never installed (set-up-dev-env)
- **Location:** `docs.terminal3.io/developers/adk/get-started/prerequisites/set-up-dev-env`
- **Gap:** Prose references `cargo-component`, but the only install command shown is
  `cargo install wasm-tools`. A new dev following the steps never installs
  `cargo-component`, yet the contract build (component model) appears to need it.
- **Why it matters:** Build step fails for a first-time user following docs literally.
- **Suggested fix:** Either add the `cargo install cargo-component` step, or remove
  the reference and clarify that `cargo build --target wasm32-wasip2` + `wasm-tools`
  is sufficient.
- **Status:** DRAFT — reproduce by following setup on a clean machine (we are a clean
  machine: Rust not installed). Confirm whether build needs cargo-component.

### GAP-002 — "4 steps" but five Step blocks render (set-up-dev-env)
- **Location:** same page.
- **Gap:** Page says "4 steps" while rendering five `<Step>` blocks.
- **Why it matters:** Minor, but a factual inconsistency in onboarding.
- **Suggested fix:** Correct the count or merge steps.
- **Status:** DRAFT — low severity; bundle with GAP-001.

### GAP-003 — Delegation is documented as dashboard-only but is fully in the SDK
- **Location:** `docs.terminal3.io/t3n/data-owner-guide/delegate-access`
- **Gap:** The data-owner guide presents granting/revoking an agent's access as a
  **Dashboard-only** workflow (AI Agents → New agent / Remove). But
  `@terminal3/t3n-sdk@3.8.0` exports a complete programmatic delegation API
  (`buildDelegationCredential`, `signCredential`, `signAgentInvocation`,
  `revokeDelegation`, `DelegationCustodialClient`). The docs never point developers
  to it, so an SDK-first developer would wrongly conclude code-based delegation
  isn't possible.
- **Why it matters:** The headline use case (agentic apps creating/scoping/revoking
  authority in code) is fully supported but undiscoverable from the docs.
- **Suggested fix:** Add a developer page documenting the delegation-credential API
  (build → canonicalise → sign → invoke → revoke), with the validity-window and
  per-function-revocation semantics, and cross-link from the data-owner guide.
- **Status:** CONFIRMED from package types. HIGH VALUE (a genuine doc gap, now
  correctly framed as "documented as dashboard-only, actually in SDK"). Reproduce
  by citing exports + the guide.

### GAP-004 — `agent-auth-update` term in docs doesn't match SDK vocabulary
- **Location:** `invoke-contract` references the data owner signing an
  `agent-auth-update` grant. The SDK has no such symbol; the actual mechanism is a
  signed **DelegationCredential** (`buildDelegationCredential` + `signCredential`).
- **Why it matters:** Terminology mismatch between docs and SDK confuses devs
  searching for `agent-auth-update`.
- **Suggested fix:** Align docs terminology with the SDK (DelegationCredential), or
  define `agent-auth-update` and map it to the SDK calls.
- **Status:** CONFIRMED from package types. Tie to GAP-003.

### GAP-008 — invoke-contract payload shape: docs vs types mismatch
- **Location:** `developers/adk/get-started/walkthrough/invoke-contract` vs
  `@terminal3/t3n-sdk@3.8.0` `ContractExecuteInput`.
- **Gap:** Docs show
  `executeAndDecode({ script_name, script_version, function_name, input })`
  (snake_case, 4 fields). The typed `ContractExecuteInput` is
  `{ version, functionName, input }` (camelCase, no script_name). Unclear which the
  runtime accepts.
- **Why it matters:** A developer copying the doc example may pass a payload the
  typed API/runtime rejects (or vice versa).
- **Suggested fix:** Reconcile the example with the published types; document the
  canonical payload shape for `execute`/`executeAndDecode`.
- **Status:** CONFIRMED mismatch in source materials. **Reproduce on testnet** to
  determine which the server accepts before final submission (could be a bug or a
  doc error — classify after repro).

### GAP-005 — Audit query API (`getAuditEvents`) exists but is undocumented
- **Location:** product/overview pages describe an "immutable audit ledger"; the SDK
  exposes `T3nClient.getAuditEvents(opts)` → `AuditPage` (with `AuditEvent`,
  `AuditBatch`, `GetAuditEventsOptions`), but **no docs page documents it**.
- **Why it matters:** Compliance/enterprise audit retrieval — a headline feature — is
  fully implemented in the SDK yet undiscoverable from docs. Devs can't find the
  `actor`/`subject`/`vc_id`/`committed` semantics (which are subtle: `committed`
  gates whether an `outcome:"success"` is durable vs a contract claim).
- **Suggested fix:** Add an audit page documenting `getAuditEvents`, the event/batch
  shapes, the `committed` caveat, and the delegated-read rule (reading another
  user's trail requires a live grant).
- **Status:** CONFIRMED from package types. Reproduce by citing exports + absence in
  docs index (llms.txt). Verify delegated-read-requires-live-grant on testnet — that
  is also a great demo assertion.

### GAP-006 — `adk-getting-start` repo is empty
- **Location:** `github.com/Terminal-3/adk-getting-start`
- **Gap:** Linked as the getting-started/quickstart repo but contains no files.
- **Why it matters:** Devs landing there get nothing; onboarding friction.
- **Suggested fix:** Populate with the walkthrough code, or remove/redirect to
  `z-tenant-flight`.
- **Status:** DRAFT — verify it's still empty at submission time.

### GAP-007 — `client.contracts` lifecycle methods inconsistently documented
- **Location:** `what-is-adk` overview lists `publish`/`enable`/`disable`/`unregister`;
  the `register-contract` walkthrough documents only `register` and explicitly says
  "no `publish` or `enable` methods."
- **Why it matters:** Contradiction about which lifecycle methods exist.
- **Suggested fix:** Reconcile the overview with the reference; document the real set.
- **Status:** DRAFT — verify actual method set against the installed package types.

---

## To verify once we have an API key / installed SDK
- [ ] Inspect `@terminal3/t3n-sdk` TypeScript types for the real exported surface.
- [ ] Pull `docs.terminal3.io/terminal-3-openapi.yml` + `api-reference/openapi.json`
      for grant/revoke + audit endpoints (resolves GAP-003/004/005).
- [ ] Reproduce GAP-001 by building a contract on this clean machine.
