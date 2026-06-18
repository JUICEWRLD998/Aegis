# Bug Reports — Terminal 3 ADK

> Running log for the Bug Discovery Bounty (bugs track).
> Rules: SDK-related, in-scope, actionable, verifiable, **must include a
> reproduction**, and must require a code change to fix. First valid report wins
> duplicates. Out of scope: scanner noise, physical-access bugs, outdated-OSS CVEs.
> VALIDATE EVERY CLAIM BY REPRODUCING before submitting — low-effort AI reports get
> ignored / may cause suspension.

## Report template
```
### BUG-00X — <short title>
- Component: <sdk / contract host / dashboard / cli>
- SDK version: <x.y.z>
- Environment: <testnet, Node vXX, OS>
- Severity: <low / med / high>
- Steps to reproduce:
  1. ...
- Expected:
- Actual:
- Why a code change is required:
- Evidence: <logs / screenshots / minimal repro repo path>
- Status: DRAFT | REPRODUCED | SUBMITTED
```

---

## Observed on live testnet (2026-06-18) — verify framing before submitting

### BUG-CAND-A — `authenticate()` resolves to a Did object, typed/doc'd as string
- Component: sdk (`T3nClient.authenticate`)
- SDK version: 3.8.0 | Env: testnet, Node v24.14.1, Windows 11
- Observed: return value is `{ value: "did:t3n:…", toString: [Function] }`, not a
  `string`. The `Did` type is exported but its runtime object shape isn't documented;
  `console.log(did)` shows the wrapper, and `did === "did:t3n:…"` is false, so naive
  string usage breaks (only works via template-literal `toString`).
- Expected: a string DID (as docs examples imply), or documented `.value` accessor.
- Why code change: either return/normalize a string, or document the object shape +
  accessor so consumers don't silently mishandle it.
- Repro: `scripts/t3-smoke.ts` step 2 output. Status: REPRODUCED (confirm it's not
  intended/documented elsewhere before classifying bug vs doc-gap).

### BUG-CAND-B — `tenant.me()` returns `undefined` for a fresh authenticated key
- Observed: after successful auth (20k credits, valid DID), `client.tenant.me()`
  resolves to `undefined` rather than a record or a clear "not a tenant / call
  claim() first" signal.
- Why it matters: ambiguous onboarding state; a dev can't tell if they failed, or
  must `claim()` first. Verify whether `claim()` is the required precondition.
- Repro: `scripts/t3-smoke.ts` step 4. Status: REPRODUCED — needs Phase-1 follow-up
  (call `claim()` then `me()`); classify after.

### BUG-CAND-C — Delegation `contract` field max length (46) is shorter than a canonical tenant script name
- Component: sdk (`buildDelegationCredential` / `validateCredentialBody`)
- SDK version: 3.8.0 | Env: testnet, Node v24.14.1, Windows 11
- Observed: `DelegationCredential.contract` rejects strings >46 chars with
  `ContractTooLong`. But a canonical tenant contract script name is
  `z:<tid>:<tail>` where `<tid>` is a 40-hex tenant id — the prefix `z:<40hex>:`
  is already **43 chars**, leaving only **3 chars** for the tail. So you cannot put
  a normal tenant script name (e.g. `z:<tid>:banking-contracts`, 60 chars) in a
  delegation credential, even though that is exactly the contract an agent would be
  delegated to invoke. Docs/examples only ever show short system ids (`tee:payroll`).
- Expected: either the limit accommodates a full `z:<tid>:<tail>` script name, OR
  the docs specify what the `contract` field must contain for a TENANT contract
  (logical id vs script name) and how it maps to the deployed `z:<tid>:` script.
- Why code change: raise the length bound to fit canonical script names, or
  document/define the required short-id form + its resolution.
- Repro: `buildDelegationCredential({ ..., contract: "x".repeat(47) })` throws
  `ContractTooLong`; max accepted length is 46. `("z:"+"a".repeat(40)+":").length`
  is 43. Status: REPRODUCED. (Verify on testnet what the host actually expects in
  this field before final classification — bug vs missing-doc.)

### BUG-CAND-D — `revokeDelegation` auto version-resolution builds a relative URL / fails
- Component: sdk (`revokeDelegation`)
- SDK version: 3.8.0 | Env: testnet, Node v24.14.1, Windows 11
- Severity: high (revocation is a core safety primitive; default path is broken)
- Observed: calling `revokeDelegation({ credentialJcsB64u, client })` WITHOUT
  `baseUrl`/`scriptVersion` throws `Failed to parse URL from
  /api/contracts/current?name=tee%3Adelegation%2Fcontracts` — i.e. it constructs a
  RELATIVE URL for the version lookup instead of using the client's configured node
  base URL. Passing `baseUrl: getNodeUrl()` changes the failure to `fetch failed`,
  even though a manual `GET <nodeUrl>/api/contracts/current?name=tee:delegation/contracts`
  returns 200 `{"current_version":"2.0.1"}`. Only passing an explicit
  `scriptVersion: "2.0.1"` (skipping auto-resolution) makes revoke succeed.
- Expected: with an authenticated `client`, `revokeDelegation` should resolve the
  delegation contract version against the client's own node URL with no extra args.
- Why code change: the version-resolution path must use the client/session base URL
  (absolute), not a relative path; default revoke must work without manual overrides.
- Repro: `scripts/delegation-roundtrip.ts` steps 5–6 (with/without baseUrl &
  scriptVersion). Workaround in our code: pass `baseUrl: getNodeUrl()` +
  `scriptVersion` from `GET /api/contracts/current`. Status: REPRODUCED.

### BUG-CAND-E — Org-data RPC path intermittently returns "fetch failed"
- Component: sdk (`SessionOrgDataClient` via `createOrgDataClientFromSession`)
- SDK version: 3.8.0 | Env: testnet (cn-api.sg.testnet.t3n.terminal3.io), Node v24, Win11
- Severity: med-high (blocks the verified-data layer intermittently)
- Observed: in a SINGLE authenticated session, `getUsage()` succeeds reliably but
  `policyGet`/`createPolicy`/`setWriters`/`writeData` frequently throw `fetch failed`
  at the network layer — then the SAME call succeeds on retry. So it's not auth,
  not the DID, not general connectivity (getUsage shares the transport). Earlier
  runs reached the server (returned `NotScopeWriter`, `OrgPolicyNotInitialised`),
  proving the endpoint exists but is unstable.
- Expected: org-data RPC calls as reliable as `token.get-usage`.
- Why code change: investigate the org-data execute transport (timeouts / keepalive
  / endpoint) — a core data API shouldn't need client-side retry to be usable.
- Repro: `scripts/probe-stability.ts` (getUsage OK + org-data fetch-failed in one
  run); `scripts/vault-roundtrip.ts`. Workaround: `withRetry` in `src/t3/vault.ts`.
  Status: REPRODUCED (intermittent).

### BUG-CAND-F — `createPolicy` succeeds but policy stays uninitialised
- Component: sdk / node (`OrgDataClient.createPolicy`)
- SDK version: 3.8.0 | Env: testnet
- Severity: high (verified-data writes are impossible)
- Observed: `createPolicy({ orgDid: <myDid>, initialAdminDid: <myDid> })` returns
  without a thrown error (after retry past the fetch-failed flakiness), but the
  immediately-following `setWriters({ orgDid: <myDid>, scope, writers:[<myDid>] })`
  rejects with `OrgPolicyNotInitialised: org policy is not initialised for this
  organisation`. So policy creation does not actually initialise the org policy for
  a self-owned (individual) org DID — leaving the entire write path
  (setWriters → writeData) unreachable.
- Expected: after a successful `createPolicy`, `policyGet` returns the policy and
  `setWriters` works; OR a clear error/precondition is documented (e.g. an org must
  be provisioned out-of-band, individual DIDs can't self-init a policy).
- Why code change: createPolicy must actually persist/initialise the policy, or the
  precondition must be enforced + documented.
- Repro: `scripts/vault-roundtrip.ts` → createPolicy (ok) then setWriters
  (OrgPolicyNotInitialised). `scripts/probe-policy.ts`. Status: REPRODUCED.
  NOTE: confirm createPolicy isn't silently failing under the fetch-failed flakiness
  before final classification (run when the node is responsive).

## Candidates to probe during build (not yet reproduced — DO NOT submit unverified)
- [ ] Placeholder resolution edge cases: missing profile field →
      `PlaceholderUnknown`; does it fail safely or leak the marker downstream?
- [ ] `host/http.egress_denied` behavior: does the contract leak any partial PII to
      logs before egress is denied? (privacy-critical)
- [ ] `executeAndDecode` error surface when `script_version` is stale/mismatched.
- [ ] `register` rejecting equal/lower version — exact error string + status code.
- [ ] `getUsage()` balance accounting accuracy after failed vs succeeded actions.
- [ ] Auth/handshake failure modes with malformed/expired API key.
- [ ] KV map prefix enforcement: attempt cross-tenant read of `z:<other-tid>:…`.

> These are leads, not findings. Each becomes a BUG-00X only after we reproduce it
> with a minimal, captured repro on live testnet.
