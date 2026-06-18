/**
 * Phase 3 EOD demo — the agent reasons end-to-end from a natural-language request,
 * driving the full SDK-backed flow and producing selective-disclosure proofs.
 *
 *   node --env-file=.env --import tsx scripts/agent-demo.ts
 *   node --env-file=.env --import tsx scripts/agent-demo.ts "Refinance up to $15k over 24 months"
 *
 * Proves: NL request → scoped consent (signed delegation) → disclosure proof →
 * lender offers (proofs, not PII) → compare → human step-up → accept → audit trail,
 * with a guardrail assertion that NO raw PII ever entered the model conversation.
 */
import { createAgentContext, AutoApprover } from "../src/agent/context";
import { runAgent } from "../src/agent/runtime";
import { assertNoPii } from "../src/agent/guardrail";

const DEFAULT_REQUEST =
  "Get me the best personal loan you can, up to $20,000 over 36 months.";

function preview(v: unknown, max = 240): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("Set OPENROUTER_API_KEY to run the agent loop.");
  }
  const userRequest = process.argv[2] || DEFAULT_REQUEST;

  console.log("═".repeat(72));
  console.log("AEGIS — Phase 3 agent orchestration demo");
  console.log("═".repeat(72));
  console.log(`\n👤 User: "${userRequest}"\n`);

  const ctx = await createAgentContext({
    approver: new AutoApprover((m) => console.log("   " + m)),
  });
  console.log(`🪪 agent identity (pubkey): ${ctx.agent.pubkeyHex}`);
  console.log(`🧑 user did:               ${ctx.userDid}`);
  console.log(`🏛  tenant did:             ${ctx.tenantDid}\n`);

  const result = await runAgent(ctx, userRequest, {
    onTrace: (e) => {
      const tag = e.ok ? "✓" : "✗";
      console.log(`\n  ${tag} [${e.tool}] ${preview(e.args, 120)}`);
      console.log(`      → ${preview(e.result)}`);
    },
  });

  console.log("\n" + "─".repeat(72));
  console.log("🤖 Aegis:\n");
  console.log(result.finalText || "(no final text)");
  console.log("─".repeat(72));

  // Guardrail proof: re-scan EVERY tool message that reached the model for PII.
  let toolMsgs = 0;
  for (const m of result.messages) {
    if (m.role !== "tool" || typeof m.content !== "string") continue;
    toolMsgs++;
    let parsed: unknown;
    try {
      parsed = JSON.parse(m.content);
    } catch {
      parsed = m.content;
    }
    assertNoPii(m.name ?? "tool", parsed); // throws if any raw PII slipped through
  }

  console.log("\n📊 Summary");
  console.log(`   stop reason:     ${result.stopReason}`);
  console.log(`   tool calls:      ${result.trace.length}`);
  console.log(`   tool messages:   ${toolMsgs} scanned`);
  console.log(`   consent:         ${ctx.consent ? ctx.consent.consentId : "none"}`);
  console.log(`   step-up:         ${ctx.stepUp ? ctx.stepUp.stepUpId : "none"}`);
  console.log(`   offers seen:     ${ctx.lastOffers.length}`);
  console.log("\n✅ PII guardrail held: no raw financial data entered the LLM context.");
}

main().catch((e) => {
  console.error("\n❌ agent demo failed:", e);
  process.exit(1);
});
