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

- **Verifiable agent identity** — the agent acts as its own `did:t3n:…`, distinct from
  the user it works for.
- **Scoped delegated authority** — the user grants the agent a single contract and an
  explicit function allowlist, for a bounded window. Anything outside the grant is
  refused by the enclave.
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

## How Terminal 3 Agent Auth is used

Aegis is built on **`@terminal3/t3n-sdk@3.8.0`**. Every privileged action flows through
the Agent-Auth lifecycle — nothing the agent does is unauthenticated or unscoped. All
SDK calls live behind one adapter (`src/t3/`) so the integration is auditable in one place.

1. **Authenticated TEE session** — `client.handshake()` opens an encrypted channel to the
   enclave; `client.authenticate(createEthAuthInput(addr))` proves the wallet and returns
   the principal's `did:t3n`. The agent runs this with its *own* key, so it carries a
   verifiable agent identity distinct from the user. (`src/t3/client.ts`)
2. **User → agent delegation** — the user (data owner) signs a delegation credential
   (`buildDelegationCredential` → `canonicaliseCredential` → `signCredential`, EIP-191)
   scoping the agent to one contract, an explicit function allowlist (`query-lenders`,
   `submit-application`), and a bounded validity window. (`src/t3/delegation.ts`)
3. **Per-invocation agent signing** — for every contract call the agent builds an
   invocation preimage (`buildInvocationPreimage`) and signs it (`signAgentInvocation`),
   proving *this* call runs under *that* grant. The enclave rejects anything outside the
   credential's scope or window.
4. **Privacy-preserving execution** — `executeAndDecode` runs the WASM contract in the
   TEE. `query-lenders` uses the `http` host interface with zero PII; `submit-application`
   uses `http-with-placeholders`, where `{{profile.*}}` tokens resolve to PII *host-side,
   inside the enclave* — never in the agent, the LLM, or the lender request.
5. **Revocation** — the user can revoke the whole credential or individual functions
   (`revokeDelegation`); the agent's events stop resolving the moment the grant is pulled.
6. **Provenance** — `getAuditEvents` returns host-stamped events
   (actor / subject / `vc_id` / action / outcome), shown live in the UI audit panel.
   (`src/t3/audit.ts`)
7. **Metering** — `getUsage` surfaces the token-credit balance to display cost and guard
   actions when credit is exhausted. (`src/t3/client.ts`)

> **Demo note:** the privacy boundary is enforced by the TEE contract *and* mirrored in
> TypeScript (`src/t3/profile.ts`), so the agent/LLM path is provably PII-free even if
> org-data is unavailable mid-demo — raw financial figures never enter agent or LLM code.

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
- **`@terminal3/t3n-sdk@3.8.0`** — Agent Auth: authenticated TEE sessions, delegation
  credentials, contract invocation, audit, and metering.
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

Contract build (Rust → WASM toolchain):

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

- **Agent Auth** — authenticated `did:t3n` session, user-signed scoped delegation,
  per-call agent signing, whole-credential + per-function revoke (detailed above).
- **Private banking** — `query-lenders` (no PII) and `submit-application`
  (`{{profile.*}}` resolved host-side) against three mock lenders.
- **Human-in-the-loop step-up** before the irreversible submit, over an SSE channel
  (`src/server/`, `src/app/api/session/*`).
- **Live audit panel** via `getAuditEvents` (`src/t3/audit.ts`).
- **Bug-bounty deliverables** — 4 reproducible SDK bugs (`docs/BUGS.md`) and 7
  documentation gaps (`docs/DOCS-GAPS.md`), each with a one-command repro.

Quick check: `npm run t3:smoke` (live session) → `npm run dev` (full UI).
