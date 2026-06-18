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
