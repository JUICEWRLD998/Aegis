/**
 * Phase 6 — edge cases + security pass. Drives the tool layer directly (deterministic,
 * no LLM) and asserts every failure mode recovers GRACEFULLY (a structured { error }
 * the agent can read), authority is enforced SERVER-SIDE, and no PII ever appears in
 * anything the agent/LLM sees.
 *
 *   node --env-file=.env --import tsx scripts/edge-cases.ts
 */
import { createAgentContext, type Approver, type AgentContext } from "../src/agent/context";
import { runTool } from "../src/agent/tools";
import { assertNoPii } from "../src/agent/guardrail";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Approver whose decisions are flippable per-scenario. */
class ScriptApprover implements Approver {
  consentApproved = true;
  stepUpApproved = true;
  async requestConsent() { return { approved: this.consentApproved }; }
  async requestStepUp() { return { approved: this.stepUpApproved }; }
}

function errOf(r: unknown): string | undefined {
  return typeof r === "object" && r && "error" in r ? String((r as { error: unknown }).error) : undefined;
}
function isErr(r: unknown, code: string): boolean {
  return errOf(r) === code;
}

async function grantConsent(ctx: AgentContext, max = 20000) {
  ctx.consent = null;
  return runTool(ctx, "request_consent", { purpose: "personal-loan-shopping", max_loan_amount: max, max_lenders: 3 });
}

async function main() {
  console.log("═".repeat(72));
  console.log("AEGIS — Phase 6 edge cases + security pass");
  console.log("═".repeat(72));

  const approver = new ScriptApprover();
  const ctx = await createAgentContext({ approver });
  const captured: unknown[] = [];
  const run = async (tool: string, args: Record<string, unknown> = {}) => {
    const r = await runTool(ctx, tool, args);
    captured.push(r);
    return r;
  };

  console.log("\n── authority enforced server-side ──");
  // 1. no consent → query denied
  ctx.consent = null;
  check("query_lenders with no consent → no_consent", isErr(await run("query_lenders", { requested_amount: 5000, term_months: 24 }), "no_consent"));

  // 2. consent denied by human → stays unauthorized
  approver.consentApproved = false;
  const denied = await run("request_consent", { purpose: "x", max_loan_amount: 20000 });
  check("consent denied → status denied", (denied as { status?: string }).status === "denied");
  check("after denial, query still no_consent", isErr(await run("query_lenders", { requested_amount: 5000 }), "no_consent"));
  approver.consentApproved = true;

  // 3. expired consent
  await grantConsent(ctx);
  ctx.consent!.expiresAt = ctx.nowSecs() - 10; // expire it
  check("expired consent → consent_expired", isErr(await run("query_lenders", { requested_amount: 5000 }), "consent_expired"));

  // 4. revoked consent (whole)
  await grantConsent(ctx);
  ctx.consent!.revoked = true;
  check("revoked consent → consent_revoked", isErr(await run("query_lenders", { requested_amount: 5000 }), "consent_revoked"));

  // 5. per-function revoke: query still works, accept denied
  await grantConsent(ctx);
  ctx.consent!.revokedFunctions = ["submit-application"];
  const qAfterPartial = await run("query_lenders", { requested_amount: 5000, term_months: 24 });
  check("per-function revoke: query_lenders still allowed", !errOf(qAfterPartial));
  check("per-function revoke: acceptance → function_not_authorized", isErr(await run("execute_acceptance", { lender_id: "aurora", amount: 5000 }), "function_not_authorized"));

  // 6. amount over consented cap
  await grantConsent(ctx, 10000);
  check("over-cap amount → amount_exceeds_consent", isErr(await run("query_lenders", { requested_amount: 50000 }), "amount_exceeds_consent"));

  console.log("\n── acceptance gating (step-up) ──");
  await grantConsent(ctx, 20000);
  await run("make_disclosure_proof");
  await run("query_lenders", { requested_amount: 20000, term_months: 36 });
  // 7. accept without step-up
  ctx.stepUp = null;
  check("accept without step-up → step_up_required", isErr(await run("execute_acceptance", { lender_id: "aurora", amount: 20000 }), "step_up_required"));
  // 8. step-up rejected by human
  approver.stepUpApproved = false;
  const su = await run("request_step_up", { lender_id: "aurora", amount: 20000, term_months: 36 });
  check("step-up rejected → approved:false", (su as { approved?: boolean }).approved === false);
  check("after rejected step-up, accept still blocked", isErr(await run("execute_acceptance", { lender_id: "aurora", amount: 20000 }), "step_up_required"));
  approver.stepUpApproved = true;

  console.log("\n── lender-side rejection + tool failures ──");
  // 9. all lenders decline (ineligible residency) → compare reports no offers
  await grantConsent(ctx, 20000);
  ctx.lastProof = {
    proofRef: "sd:",
    assertions: { income_ge_80k: false, income_band: "lt_50k", no_default_24mo: false, employment_verified: false, residency_ok: false },
  };
  const declined = await run("query_lenders", { requested_amount: 20000, term_months: 36 });
  const offers = (declined as { offers?: unknown[] }).offers ?? [];
  check("ineligible profile → 0 offers (lenders decline)", offers.length === 0, `${(declined as { results?: unknown[] }).results?.length ?? 0} declines`);
  check("compare_offers with none → no_offers (graceful)", isErr(await run("compare_offers"), "no_offers"));

  // 10. malformed tool args → tool_failed (no crash)
  check("malformed args → tool_failed (graceful)", isErr(await run("query_lenders", { term_months: 24 }), "tool_failed"));
  // 11. unknown tool
  check("unknown tool → unknown_tool", isErr(await run("does_not_exist", {}), "unknown_tool"));

  console.log("\n── security: no PII anywhere the agent/LLM can see ──");
  // Every tool result here is exactly what gets serialised into the LLM conversation.
  // (The runtime additionally runs assertNoPii on each before it re-enters the chat;
  //  see src/agent/runtime.ts — exercised by agent:demo / ui-e2e.)
  let leak = false;
  try {
    for (const r of captured) assertNoPii("tool_result", r);
  } catch (e) {
    leak = true;
    console.log("   LEAK:", (e as Error).message);
  }
  check("no raw PII in any tool result the LLM sees", !leak, `${captured.length} results scanned`);

  console.log("\n" + "─".repeat(72));
  if (failures === 0) {
    console.log("✅ Phase 6: every failure mode recovers gracefully; authority is enforced");
    console.log("   server-side (not just UI); no PII reaches the agent/LLM.");
  } else {
    console.log(`❌ ${failures} check(s) FAILED.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n❌ edge-cases failed:", e);
  process.exit(1);
});