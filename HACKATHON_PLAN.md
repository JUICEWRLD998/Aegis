# AEGIS — The Verifiable Agentic Private Banker
### Terminal 3 Agent Auth Bounty — Master Plan

> Working codename: **Aegis** (the shield of trust around an autonomous banker). Rename freely.
> One-line pitch: *An AI private banker that can shop, negotiate and execute real banking actions on your behalf — proving who it is and what you authorized, without ever leaking your raw financial data to anyone.*

---

## 0. TL;DR for the impatient judge (and for us)

A customer tells their AI banker: **"Get me the best personal loan you can."**

Aegis then, fully autonomously:
1. Authenticates the user and requests a **scoped, time-boxed, revocable consent** ("share verified income + credit standing with up to 3 lenders; authorize a loan up to $X").
2. Pulls the user's **verified financial credentials** from their Terminal 3 vault (held in hardware-secured TEEs).
3. Generates **selective-disclosure proofs** ("income ≥ $80k", "employment verified", "no defaults in 24mo") — the raw payslips/KYC documents **never leave the TEE**.
4. Submits to several lender APIs. Each lender receives **only a verifiable proof + the agent's verifiable identity token** — never the PII.
5. Negotiates / compares offers, recommends the best.
6. Executes acceptance behind a **human-in-the-loop step-up approval** for the high-value action.
7. Emits a **cryptographic audit trail** of every action: who acted (agent identity), under whose authority (user delegation), what was disclosed, and when.

**Why this wins:** it is the canonical enterprise/government nightmare — *"an AI is about to move money and touch PII; prove it's allowed to, and prove nothing leaked"* — solved end-to-end using the **entire** Agent Auth SDK surface, not one feature.

---

## 1. Why this idea wins the bounty

### Scoring alignment (this is the rubric we are graded on)

| Criterion | Weight | How Aegis nails it |
|---|---|---|
| **SDK integrated in its entirety** | **40%** | We deliberately exercise *every* SDK primitive: agent identity issuance, user auth, delegated authority, scoped/revocable consent, TEE-backed data access, selective disclosure, transaction authorization, and audit. The flow is *designed around* the SDK, not bolted on. |
| **Completeness** | **30%** | One **flawless hero flow** (verifiable credit marketplace) end-to-end, plus a working autonomous secondary flow (savings sweep) to prove true agency. Demoable golden path + handled edge cases. |
| **Creativity** | **30%** | Banks receive *proofs, not data*. A verifiable agent identity answers the unsolved "who authorized this AI?" question. Agent-to-bank interaction where PII never crosses the trust boundary is a genuinely novel, 2026-relevant framing. |

### Why the judges (banks, governments, institutions) lean in
- **Data minimization by construction** — regulators' dream (GDPR / data-residency / AML).
- **Verifiable delegated authority** — answers "an AI did X; who said it could?" with cryptographic proof.
- **Human-in-the-loop step-up** for irreversible/high-value actions — shows we understand real banking risk.
- **Compliance-grade audit trail** — every action attributable and provable after the fact.
- This is a **reference architecture for regulated agentic finance** → directly targets the **Design Partner** invite.

---

## 2. The product, concretely

**Aegis** is a chat-based AI private banker. The user onboards once (verified identity + financial credentials into their Terminal 3 vault). From then on, the agent can *act and transact* on their behalf under explicit, scoped authority.

### Hero flow (the demo we will be judged on): Verifiable Credit Marketplace
The "get me a loan" flow above. This is where 80% of polish goes. It must be flawless.

### Secondary flow (proves true autonomy): Autonomous Savings Sweep *(stretch)*
Under a long-lived, narrowly-scoped delegation, Aegis runs on a schedule and moves idle cash into the best-yield account when it exceeds a threshold — **without being prompted**. Showcases long-lived delegated authority + recurring transaction authorization. Demoed as a "the agent acted while you slept" moment.

> Discipline: the hero flow must be perfect before the secondary flow gets *any* time. Completeness of one beats two half-built flows.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Aegis Web App (Next.js, single deployable)                 │
│                                                             │
│  ┌───────────────┐   ┌──────────────────────────────────┐  │
│  │ Chat UI       │──▶│ Agent Runtime (LLM tool-loop)    │  │
│  │ (React)       │   │  • OpenRouter → Gemini           │  │
│  │ consent /     │◀──│  • Tools = SDK-backed actions    │  │
│  │ step-up modal │   └──────────────┬───────────────────┘  │
│  └───────────────┘                  │                       │
│                                     ▼                       │
│                        ┌─────────────────────────┐          │
│                        │ Terminal 3 Agent Auth   │          │
│                        │ SDK adapter (our wrapper)│          │
│                        └───────────┬─────────────┘          │
└────────────────────────────────────┼────────────────────────┘
                                     │  (agent identity, consent,
                                     │   TEE vault, disclosure proofs,
                                     ▼   tx authorization, audit)
                          ┌─────────────────────┐
                          │ Terminal 3 Network  │  (TEEs hold PII)
                          └─────────────────────┘
                                     │  proofs + agent identity token only
            ┌────────────────────────┼────────────────────────┐
            ▼                        ▼                        ▼
   ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
   │ Mock Bank A  │         │ Mock Bank B  │         │ Mock Bank C  │  (verify proof
   │ (API route)  │         │ (API route)  │         │ (API route)  │   + agent id,
   └──────────────┘         └──────────────┘         └──────────────┘   return offer)
```

### Stack (lean, because 4 days)
- **One Next.js (TypeScript) app** — frontend + agent runtime + mock-bank API routes all in one deployable. Fewer moving parts = fewer ways to lose a day.
- **LLM:** OpenRouter → `google/gemini-2.5-pro` (reasoning) with `gemini-2.5-flash` fallback for speed/cost. Simple tool-calling loop (or Vercel AI SDK) — **no heavyweight agent framework**.
- **Terminal 3 Agent Auth SDK:** wrapped behind a thin internal `t3/` adapter module so every SDK call is in one place (easier to swap as we learn the real API, and it doubles as our "look how integrated it is" exhibit).
- **Mock banks:** 3 Next.js API routes that *actually verify* the agent identity token + disclosure proof before returning an offer. Verification must be real, not faked — that's the whole point.
- **Deploy:** Vercel (or local + tunnel for demo). Decide Day 3.

### Key design rule
**Every tool the LLM can call is backed by a real SDK primitive.** The LLM never sees raw PII — it orchestrates *capabilities*, the SDK enforces *authority and privacy*. This separation is the story we tell judges.

---

## 4. SDK Integration Map (this is the 40% — guard it with your life)

We will produce a one-page table in the final README mapping each SDK primitive → where Aegis uses it. Target: **use all of them.** Confirm exact names in Phase 0 against the real docs.

| SDK capability (confirm exact name in docs) | Where Aegis uses it |
|---|---|
| Agent identity issuance / verifiable agent credential | Each agent action carries the agent's identity token; mock banks verify it. |
| User authentication | Onboarding + session start. |
| Delegated authority (act-on-behalf-of) | The core "agent acts for user" grant. |
| Scoped consent (purpose, limits, expiry) | "Share income+credit with ≤3 lenders, loan ≤ $X, valid 24h." |
| Consent revocation | A "Revoke" button that genuinely kills the agent's authority mid-flow — great demo beat. |
| TEE-backed data vault access | Reading verified financial credentials without exfiltrating them. |
| Selective disclosure / proof generation | Proving "income ≥ $80k" etc. without revealing the document. |
| Transaction authorization / signing | Executing loan acceptance + (stretch) the savings sweep. |
| Step-up / human-in-the-loop approval | Required for the irreversible high-value action. |
| Audit / event log | Cryptographic provenance trail surfaced in the UI. |

> If the SDK exposes a primitive we haven't used, find a place to use it. Breadth of integration is literally 40% of the grade.

---

## 5. Day-by-day execution plan (June 18 → June 22)

> Reality check: ~4 days. Each day ends with a **working, demoable increment**. If we fall behind, we cut from the bottom of the "Stretch" lists, never from the hero flow.

### Day 1 — June 18 (today) → Foundation & Identity
**Phase 0 — Setup & recon ✅ COMPLETE (2026-06-18)**
- [x] Claim sandbox test tokens — DONE. 20,000 credits live; agent DID
      `did:t3n:8e3547bce411fd4f51fe1f25df033d83acccc869`.
- [x] Read docs + **read the real `@terminal3/t3n-sdk@3.8.0` type defs** (ground
      truth). Architecture corrected → see `docs/SDK_FINDINGS.md`. Every pitch
      pillar maps to a confirmed primitive (delegation, audit, placeholders).
- [x] `BUGS.md` / `DOCS-GAPS.md` started — already 5 confirmed doc gaps + 2 live
      observations. Corrected my own mis-framed gaps after reading real types.
- [x] Scaffold Next.js TS app + OpenRouter/Gemini client (`src/agent/openrouter.ts`).
- [x] T3 adapter built + typechecking clean: `client.ts`, `delegation.ts`,
      `audit.ts`, `banking.ts`. Rust TEE contract skeleton in `contract/`.
- [x] **Live validation:** `npm run t3:smoke` passes — handshake + authenticate +
      getUsage + getAuditEvents all confirmed against testnet.

> Architecture note (from recon): T3 = Rust→WASM TEE contract + TypeScript invoke
> client. PII resolved inside the enclave via `{{profile.*}}` placeholders — it
> never touches the agent or the LLM. Delegation is fully programmatic and
> per-function revocable. This is STRONGER than the original assumption.

**Phase 1 — Identity & delegation foundation**
- [ ] Issue/obtain an **agent identity**; verify it round-trips.
- [ ] Implement user auth + **onboarding** (load verified financial credentials into the vault — sandbox/mock data).
- [ ] Implement **scoped delegation + consent** grant; render a real consent screen.
- **EOD demo:** user logs in, grants a scoped consent, agent holds a verifiable identity. Console-level is fine.

### Day 2 — June 20 → Privacy core + Agent brain
**Phase 2 — Vault & selective disclosure**
- [ ] Read credentials from the **TEE vault** via SDK.
- [ ] Generate **selective-disclosure proofs** ("income ≥ X", "no defaults"). Confirm raw data never crosses the boundary.

**Phase 3 — Agent orchestration ✅ COMPLETE (2026-06-18)**
- [x] Built the Gemini tool-loop (`src/agent/runtime.ts`). All 8 tools wired,
      each SDK-backed (`src/agent/tools.ts`): `request_consent`,
      `read_verified_profile`, `make_disclosure_proof`, `query_lenders`,
      `compare_offers`, `request_step_up`, `execute_acceptance`, `get_audit_log`.
- [x] Strict guardrail enforced (`src/agent/guardrail.ts`): every tool result is
      run through `assertNoPii` before re-entering the conversation — the model
      *cannot* receive raw PII by construction. Authority (consent existence,
      expiry, revocation, per-function scope, amount cap) + human step-up enforced
      in the tool layer, not just the UI.
- [x] Human-in-the-loop modelled as a swappable `Approver` seam (AutoApprover for
      headless; web modals later). Agent identity = secp256k1 pubkey
      (`src/agent/identity.ts`), named inside the signed delegation credential.
- **EOD demo:** `npm run agent:demo` — agent reasons end-to-end from a NL request,
      produces real disclosure proofs + a user-signed scoped delegation, runs the
      full consent→proof→offers→step-up→accept→audit flow. Guardrail self-check
      confirms zero PII in the LLM context. **PASSED live on testnet.**
- Note: banking tools fall back to deterministic stub offers (mirroring
      `contract/src/lenders.rs`) until the TEE contract is deployed in Phase 4.

### Day 3 — June 21 → Banks, transactions, UI
**Phase 4 — Mock lenders + transactions ✅ COMPLETE (2026-06-18)**
- [x] 3 lender endpoints that **genuinely verify** (no mocks) — `src/lenders/`:
      `verify.ts` checks (1) no PII (`assertNoPii`), (2) the readable credential
      re-canonicalises to the **signed JCS bytes** + `validateCredentialBody`,
      (3) the user's wallet recovered via `ethRecoverEip191`, (4) function/validity-
      window/amount-scope authority, (5) the **agent identity** bound to this exact
      request via `secp256k1.verify(agent_sig, sha256(buildInvocationPreimage(...)))`
      against the credential's `agent_pubkey`. Differentiated offers in `catalog.ts`
      (Aurora prime / Meridian near-prime / Northwind specialist), priced purely from
      the coarse disclosure assertions.
- [x] Exposed as Next.js routes `POST /api/lenders/[lender]/{quote,accept}` (thin
      shells over `handler.ts`); agent reaches them via `src/lenders/client.ts`
      (in-process by default, HTTP when `LENDER_BASE_URL` is set).
- [x] **Transaction authorization** for acceptance: `execute_acceptance` builds a
      signed `submit-application` request (`src/agent/lenderRequest.ts`,
      `signAgentInvocation`) the lender re-verifies; gated by the existing human
      step-up. Agent tools (`query_lenders`/`execute_acceptance`) now route through
      the verifying lenders, not the stub.
- [x] Minimal Next.js app scaffolded (`src/app/`, `next.config.mjs`).
- **Proof:** `npm run lenders:demo` — valid signed request → 3 differentiated offers
      (7.3% / 8.2% / 10.1% APR), agent cryptographically authorized + user wallet
      recovered; forged agent sig / expired / over-scope / PII-in-body → all rejected;
      acceptance → verified reference; no PII on the wire. `npm run agent:demo` now runs
      the full hero flow against the verifying lenders. **PASSED** (typecheck clean).
- Note: real on-chain tx signing via the deployed TEE contract remains blocked by the
      Rust toolchain; the signed-invocation-verified-by-lender path is the demonstrated
      transaction authorization (the step-up modal UI lands in Phase 5).

**Phase 5 — Frontend & demo polish**
- [ ] Polished chat UI; consent screen; step-up modal; **live audit-trail panel**; a visible "Revoke authority" control.
- [ ] Script and dry-run the **golden-path demo**.
- **EOD demo:** full hero flow works in the browser, start to finish.

### Day 4 — June 22 → Harden, autonomy, SUBMIT (deadline 11:59 PM GMT+8)
**Phase 6 — Hardening & edge cases**
- [ ] Edge cases: consent denied, consent expired/revoked mid-flow, step-up rejected, a lender rejects the proof, LLM tool-call failure → graceful recovery.
- [ ] Security pass: confirm no PII in logs/LLM context/network to banks. Confirm authority is actually enforced server-side, not just in UI.

**Phase 7 — Bug Discovery Bounty (finalize)**
- [ ] Clean up `BUGS.md` / `DOCS-GAPS.md` accumulated all week into formal, reproducible reports (see §7).
- [ ] **Validate every single claim by reproducing it** before submission (their rules explicitly punish low-effort AI reports).
- [ ] Submit reports.

**Phase 8 — Submission package**
- [ ] **Record the demo video** (this is what actually gets judged — make it tight, 2–4 min, hero flow + the "banks see proofs not data" + "revoke kills authority" + audit trail beats).
- [ ] README with the SDK Integration Map (§4) front and center, architecture diagram, setup steps.
- [ ] Submit the BUIDL **with buffer before 11:59 PM GMT+8.** Do not cut it close to the deadline.

**Stretch (only if hero flow is flawless):** Phase 4b — Autonomous Savings Sweep (long-lived delegation + scheduled autonomous transaction).

---

## 6. The demo narrative (script the judges' "wow" moments)

A great BUIDL is sold by a great 3-minute video. Hit these beats in order:
1. **The ask:** "Get me the best personal loan." (Natural, human.)
2. **The consent:** scoped grant appears — limits, expiry, purpose. *"You're in control; the agent only gets exactly this."*
3. **The privacy reveal:** show the network panel — banks receive a **proof + agent identity**, and we open it to show **no PII inside.** *"Three banks just underwrote her. None of them saw her payslip."*
4. **The authority:** show the agent's verifiable identity the banks checked. *"They didn't just trust an API call — they verified an authorized agent."*
5. **The step-up:** high-value acceptance pauses for human approval. *"The AI shops and negotiates. The human commits."*
6. **The kill switch:** hit **Revoke** — the agent's next action is denied live. *"Authority is revocable, instantly."*
7. **The audit:** open the cryptographic trail. *"Every action: who, under whose authority, what was disclosed, when."*
8. *(Stretch)* **The autonomy:** "While she slept, Aegis swept her idle cash to a better account — under a narrow standing authority."

---

## 7. Bug Discovery Bounty strategy (run it in parallel, finalize last)

The user wants the bounty *finalized* last — correct. But the **smartest** move is to **capture issues continuously from Day 1**, because we'll naturally trip over onboarding bugs and doc gaps *while building*. Trying to "find bugs" cold on Day 4 wastes the richest source: our own build logs.

- Keep two living files from minute one: `BUGS.md`, `DOCS-GAPS.md`.
- For each entry, immediately record: **exact repro steps, expected vs actual, SDK version, environment, and why a code change is needed.** (Their rules require reproduction + that it needs a code fix.)
- Focus strictly on **SDK-related** issues (out of scope: scanner noise, physical-access, outdated-OSS — they list these as non-qualifying).
- **First valid report wins** duplicates → submit early-ish on Day 4, not at 11:58 PM.
- **Validate every claim by reproducing it before submitting.** Low-effort AI reports → ignored + possible suspension. We submit only verified, high-signal reports.

---

## 8. Risk register & cut lines

| Risk | Mitigation |
|---|---|
| Only 4 days | Hero flow is sacred; everything else is a labeled stretch we can drop. |
| SDK API differs from assumptions | `t3/` adapter isolates all SDK calls; Phase 0 confirms real names before we build on them. |
| TEE/proof primitive harder than expected | Fallback: even a basic selective-disclosure path preserves the core "proofs not data" story; deepen if time allows. |
| Gemini tool-calling flakiness | Keep the tool schema small and explicit; flash fallback; deterministic mocked bank responses. |
| Demo breaks live | We submit a **recorded** video, not a live demo. Record once it's stable. |
| Running over deadline | Hard internal deadline: **submit by GMT+8 evening, with buffer.** |

**Cut order if behind (drop top-first):** Autonomous Savings Sweep → 3rd mock bank → negotiation logic (just compare) → UI polish. **Never cut:** consent, disclosure proofs, agent-identity verification by banks, step-up, audit trail.

---

## 9. Definition of Done (MVP)

- [ ] User onboards; verified credentials live in the TEE vault.
- [ ] User grants a scoped, expiring, **revocable** consent.
- [ ] Agent (verifiable identity) reasons via Gemini and drives the whole flow.
- [ ] ≥2 mock banks **verify agent identity + disclosure proof** and return offers — **with zero PII received.**
- [ ] Loan acceptance gated by a **human step-up** approval.
- [ ] **Revoke** genuinely halts the agent mid-flow.
- [ ] **Audit trail** shows who/whose-authority/what-disclosed/when.
- [ ] README with SDK Integration Map + architecture; 2–4 min demo video.
- [ ] Validated, reproducible bug/doc-gap reports submitted.

---

## 10. Open decisions (pick fast, adjust later)
- **Consumer vs SME framing** → default **consumer personal-loan** (cleanest demo). Reframe to SME treasury if judges skew B2B.
- **Deploy target** → Vercel vs local+tunnel; decide Day 3 based on SDK runtime constraints.
- **Gemini model** → `gemini-2.5-pro` default, `flash` fallback.

---

*Build the shield. Prove the authority. Leak nothing. Win.*
