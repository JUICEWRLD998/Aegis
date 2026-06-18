# Aegis — Golden-Path Demo Runbook

The 2–4 minute hero flow that gets judged. Practice it once; record it once it's stable.

## Setup

```bash
# .env must have: T3N_API_KEY, OPENROUTER_API_KEY  (AGENT_KEY/TENANT_DID optional)
npm install
npm run dev          # http://localhost:3000
```

Open `http://localhost:3000`. Wait for the header to read **connected** (the T3
handshake + authenticate runs on session create; ~5s).

## The script (hit these beats in order)

1. **The ask.** Type: *"Get me the best personal loan, up to $20,000 over 36 months."*
   → Send. Say: *"She just asks in plain language."*

2. **The consent.** A **Consent** modal appears — scoped: purpose, **loan cap**,
   **max lenders**, **validity window**, the exact **functions** granted.
   Click **Grant consent**. Say: *"The agent gets exactly this — nothing more.
   Scoped, time-boxed, revocable."* → the **Authority** panel flips to *Active
   delegation* with the consent id.

3. **The privacy reveal.** Watch the **Live audit trail**:
   `Read verified profile (sealed)` → `Generated disclosure proof`
   (`sd:income_ge_80k,no_default_24mo,…`) → `Queried lenders`. On the lender event,
   point to the green badges: **✓ no PII sent to lenders** and **✓ agent identity
   verified**. Say: *"Three banks just underwrote her from a proof. None saw her
   payslip, her salary, or her name."*

4. **The authority.** Still on the lenders event — the recovered signer wallet is
   what each lender checked. Say: *"They didn't trust an API call. They
   cryptographically verified an authorized agent acting under her signed grant."*

5. **The step-up.** A **Step-up** modal appears for the acceptance — the big dollar
   amount, lender, APR. Say: *"The AI shops and negotiates. The human commits."*
   Click **Approve & submit** → `Submitted application` with a reference id +
   verification badges.

6. **The kill switch.** Click **Revoke authority** (or **Revoke acceptance only**).
   The Authority badge flips to **Revoked**. Ask the agent to accept again
   (e.g. *"Accept the Meridian offer too"*) → it's denied live. Say: *"Authority is
   revocable instantly — and the revoke is real, on Terminal 3."*

7. **The audit.** Scroll the audit trail. Say: *"Every action: who acted, under whose
   authority, what was disclosed, and when."*

## Backup / proof it's not faked

- `npm run lenders:demo` — lenders reject forged sigs / expired / over-scope / PII;
  accept only fully-verified requests. Differentiated offers from one proof.
- `npm run ui-e2e` (with `npm run dev` running) — drives this whole flow headlessly
  and asserts every beat (consent, both approvals, query, accept, revoke).
- `npm run agent:demo` — the same reasoning loop in the terminal.

## If something breaks live

We submit a **recorded** video, not a live demo. Record once the flow is stable.
The headless `ui-e2e` is the safety net — if the browser misbehaves on the day, the
recorded run + the e2e output prove the system works.
