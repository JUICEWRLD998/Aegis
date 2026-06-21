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
| Programmatic delegation (`buildDelegationCredential` → `signCredential` → `signAgentInvocation` → `revokeDelegation`) | Scoped delegated authority; per-call agent signing; whole-credential + per-function revoke* | `src/t3/delegation.ts` |
| `contracts.register` | Deploy the WASM contract | `src/t3/client.ts` |
| KV maps / secrets (`z:<tid>:secrets`) | Lender API keys held in-enclave | `contract/src/*`, `src/t3/vault.ts` |
| `getUsage` token metering | Surface credit balance, guard actions | `src/t3/client.ts` |
| `getAuditEvents` ledger | Provenance trail in the UI audit panel | `src/t3/audit.ts` |

\* The SDK ships the full delegation lifecycle programmatically, but it is undocumented
(`docs/DOCS-GAPS.md` DOC-001) and two default call paths are broken (`docs/BUGS.md`
BUG-001, BUG-002). `src/t3/delegation.ts` implements it with the documented workarounds.

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
npm run t3:smoke            # validate a live T3 session against testnet
npm run dev                 # full UI at http://localhost:3000
```

Headless demos / verification (each loads `.env`):

```bash
npm run agent:demo         # agent tool loop end-to-end
npm run lenders:demo       # query-lenders + submit-application against mock lenders
npm run ui-e2e             # drives the session/consent/step-up flow
npm run edge-cases         # adversarial / security edge-case suite
npm run sdk-bugs           # offline, deterministic repro for docs/BUGS.md (no API key)
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
                   (client, delegation, audit, profile, vault, banking)
src/agent/       OpenRouter/Gemini client + tool loop (identity, guardrail, context)
src/lenders/     mock lender API logic (verify agent + proof, return offers)
src/server/      in-memory session + event store (consent, step-up, SSE)
src/app/         Next.js UI + API routes (chat, consent, step-up, audit panel)
scripts/         t3-smoke, demos, edge-case + SDK-bug repro suites
docs/            BUGS, DOCS-GAPS (bug-bounty trackers)
```

## Status

End-to-end flow built and demoable:

- **Identity + delegation** — agent authenticates as its own `did:t3n`; user signs a
  scoped delegation credential (contract + functions + bounded validity window); the
  agent signs every invocation under it; whole-credential and per-function revoke.
  (`src/t3/delegation.ts`)
- **Private banking flow** — `query-lenders` (no PII) and `submit-application`
  (`{{profile.*}}` placeholders resolved host-side) against three mock lenders. The
  privacy boundary is enforced in the TEE contract and mirrored in TS so the agent/LLM
  path is provably PII-free in the demo regardless of org-data uptime.
- **Human-in-the-loop step-up** before the irreversible application submit, over an SSE
  session channel (`src/server/`, `src/app/api/session/*`).
- **Audit panel** — live provenance trail via `getAuditEvents` (`src/t3/audit.ts`).
- **Bug-bounty deliverables** — 4 reproducible SDK bugs (`docs/BUGS.md`) and 7
  documentation gaps (`docs/DOCS-GAPS.md`), each with a one-command repro.

Quick check: `npm run t3:smoke` (live session) → `npm run dev` (full UI).
