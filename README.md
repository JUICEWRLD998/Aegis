# Aegis — The Verifiable Agentic Private Banker

> Built on **Terminal 3 Agent Auth** for the T3 Agent Dev Kit Bounty.
> An AI private banker that shops, compares and applies for loans on your behalf —
> proving who it is and what you authorized, while your raw financial data **never
> leaves the hardware TEE**. Lenders receive selective-disclosure assertions, not PII.

---

## Why it matters

Enterprises and regulators have one shared fear about agentic finance:
*"An AI is about to move money and touch PII — prove it's authorized, and prove
nothing leaked."* Aegis answers both, by construction:

- **Verifiable agent identity** — the agent acts as its own `did:t3n:…`.
- **Scoped delegated authority** — the user grants the agent access to a specific
  contract, functions, and allowed hosts. Egress is denied without it.
- **Data minimization by hardware** — PII is resolved inside the enclave via
  `{{profile.*}}` placeholders; it never enters the agent, the LLM, or the lenders.
- **Human-in-the-loop step-up** for the irreversible high-value action.
- **Auditability** — every action attributable to who/whose-authority/what/when.

## SDK Integration Map (the heart of the submission)

| Terminal 3 primitive | Where Aegis uses it | Code |
|---|---|---|
| Authenticated TEE session (`handshake` + `authenticate`) | Agent + user sign in, encrypted channel to enclave | `src/t3/client.ts` |
| Agent identity (`did:t3n`) | Agent acts as itself; lenders see a verifiable agent | `src/t3/client.ts` |
| TEE contract (Rust→WASM) | Private banking logic runs in the enclave | `contract/` |
| `http` host interface (no PII) | `query-lenders` indicative offers | `contract/src/lenders.rs` |
| `http-with-placeholders` ({{profile.*}}) | `submit-application` PII resolved host-side | `contract/src/application.rs` |
| Agent-auth grant (contract + functions + allowed hosts) | Scoped delegated authority; egress gating | onboarding / dashboard* |
| `contracts.register` | Deploy the WASM contract | `scripts/` (Day 1–3) |
| KV maps / secrets (`z:<tid>:secrets`) | Lender API keys held in-enclave | `contract/src/*` |
| `getUsage` token metering | Surface credit balance, guard actions | `src/t3/client.ts` |
| Audit ledger | Provenance trail in the UI | TBD — see `docs/SDK_FINDINGS.md` §9 |

\* Grant/revoke is dashboard-only in current testnet (logged as `docs/DOCS-GAPS.md`
GAP-003); we probe the OpenAPI spec for a programmatic path.

## Architecture

```
Chat UI ──▶ Agent runtime (OpenRouter→Gemini, tool loop)
                   │  tools = SDK-backed capabilities (no PII ever)
                   ▼
            T3 adapter (src/t3) ──▶ T3nClient.executeAndDecode
                                          │
                                   TEE contract (Rust/WASM, in enclave)
                                     ├─ query-lenders   (http, no PII)
                                     └─ submit-application (placeholders → PII host-side)
                                          │  proofs + agent did:t3n only
                            ┌─────────────┼─────────────┐
                          Bank A        Bank B        Bank C
```

## Stack

- **Next.js + TypeScript** — UI, agent runtime, mock-lender API routes (one deploy).
- **OpenRouter → Gemini** (`gemini-2.5-pro`, `flash` fallback) — simple tool loop.
- **`@terminal3/t3n-sdk`** — auth, contract invoke, metering.
- **Rust → WASM (`wasm32-wasip2`)** — the TEE contract.

## Getting started

```bash
cp .env.example .env        # fill T3N_API_KEY + OPENROUTER_API_KEY
npm install
npm run t3:smoke            # validate T3 session against testnet
npm run dev
```

Contract build (Day 1 toolchain):

```bash
rustup target add wasm32-wasip2
cd contract && cargo build --release --target wasm32-wasip2
```

## Repo layout

```
contract/        Rust→WASM TEE contract (the privacy core)
src/t3/          SDK adapter — single chokepoint for all T3 calls
src/agent/       OpenRouter/Gemini client + tool loop
src/banks/       mock lender API routes (verify agent + proof, return offers)
app/             Next.js UI (chat, consent, step-up, audit panel)
scripts/         t3-smoke, register/deploy helpers
docs/            SDK_FINDINGS, BUGS, DOCS-GAPS (bug-bounty trackers)
HACKATHON_PLAN.md  master plan
```

## Status

Phase 0 complete: recon done, real SDK model captured (`docs/SDK_FINDINGS.md`),
scaffold + contract skeleton in place, bug/gap trackers seeded. Next: claim API
key → `t3:smoke` → wire identity + grant (Phase 1).
