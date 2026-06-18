/**
 * Phase 4 proof — the lenders GENUINELY verify the agent's authority + identity and
 * receive ZERO PII. Runs the handlers in-process (no Next boot needed).
 *
 *   node --env-file=.env --import tsx scripts/lenders-demo.ts
 *
 * Every expectation is ASSERTED — the script exits non-zero if any check fails, so a
 * clean run actually means something. Demonstrates:
 *   • valid signed request → differentiated offers (distinct APR), agent authorized.
 *   • forged agent signature → rejected.
 *   • expired credential → rejected.
 *   • amount over the consented scope → rejected.
 *   • PII injected into the request → rejected.
 *   • acceptance (submit-application) → verified reference id.
 *   • no PII anywhere in requests or responses.
 */
import { createAgentContext, AutoApprover, DELEGATION_CONTRACT_ID } from "../src/agent/context";
import { createScopedGrant, BANKING_FUNCTIONS, type BankingFunction } from "../src/t3/delegation";
import { getDisclosureAssertions } from "../src/t3/profile";
import { buildSignedLenderRequest } from "../src/agent/lenderRequest";
import { handleQuote, handleAccept } from "../src/lenders/handler";
import { LENDERS } from "../src/lenders/catalog";
import { assertNoPii } from "../src/agent/guardrail";
import type { AgentContext } from "../src/agent/context";

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Build + install a consent grant on the context with an explicit validity window. */
async function installConsent(
  ctx: AgentContext,
  opts: { maxLoanAmount: number; functions: BankingFunction[]; nowSecs: number; validForSecs: number },
): Promise<void> {
  const vcId = crypto.getRandomValues(new Uint8Array(16));
  const functions = [...opts.functions].sort();
  const grant = await createScopedGrant(
    {
      userDid: ctx.userDid,
      agentPubkey: ctx.agent.pubkey,
      orgDid: ctx.orgDid,
      contract: DELEGATION_CONTRACT_ID,
      functions,
      vcId,
      validForSecs: opts.validForSecs,
      nowSecs: opts.nowSecs,
      scopes: [`amount<=${opts.maxLoanAmount}`],
      metadata: { purpose: "personal-loan-shopping" },
    },
    ctx.userSecret,
  );
  ctx.consent = {
    consentId: hex(vcId),
    grant,
    purpose: "personal-loan-shopping",
    maxLoanAmount: opts.maxLoanAmount,
    maxLenders: 3,
    functions,
    expiresAt: opts.nowSecs + opts.validForSecs,
    revoked: false,
    revokedFunctions: [],
  };
}

async function main() {
  const NOW = Math.floor(Date.now() / 1000);
  console.log("═".repeat(72));
  console.log("AEGIS — Phase 4 lender verification proof");
  console.log("═".repeat(72));

  const ctx = await createAgentContext({ approver: new AutoApprover() });
  const assertions = await getDisclosureAssertions(ctx.session);
  const proofRef = `sd:${Object.entries(assertions).filter(([, v]) => v === true).map(([k]) => k).sort().join(",")}`;
  console.log(`\nagent identity: ${ctx.agent.pubkeyHex}`);
  console.log(`disclosure proof: ${proofRef}`);
  console.log(`assertions: ${JSON.stringify(assertions)}`);

  const allRequests: unknown[] = [];
  const allResponses: unknown[] = [];

  // ── happy path ────────────────────────────────────────────────────────────
  await installConsent(ctx, {
    maxLoanAmount: 20000,
    functions: [...BANKING_FUNCTIONS],
    nowSecs: NOW,
    validForSecs: 24 * 3600,
  });

  console.log("\n── valid signed requests → differentiated offers ──");
  const aprs: number[] = [];
  for (const lender of LENDERS) {
    const req = buildSignedLenderRequest(ctx, {
      fn: "query-lenders",
      lenderId: lender.id,
      assertions,
      proofRef,
      requestedAmount: 20000,
      termMonths: 36,
    });
    allRequests.push(req);
    const res = handleQuote(req, NOW);
    allResponses.push(res);
    const detail =
      res.decision === "offer"
        ? `APR ${res.offer!.apr}%  max $${res.offer!.maxAmount.toLocaleString()}  [authorized=${res.verified.agent_authorized} signer=${res.verified.user_signature_recovered ?? "—"}]`
        : `DECLINE (${res.reason})`;
    check(
      `${lender.name} offers & verifies the agent`,
      res.decision === "offer" && res.verified.agent_authorized && res.verified.no_pii,
      detail,
    );
    if (res.decision === "offer") aprs.push(res.offer!.apr);
  }
  check("offers are differentiated (distinct APRs)", new Set(aprs).size === aprs.length && aprs.length >= 2, `APRs: ${aprs.join(", ")}`);

  // ── negative cases ──────────────────────────────────────────────────────────
  console.log("\n── tamper / abuse cases (all must be rejected) ──");
  const baseReq = buildSignedLenderRequest(ctx, {
    fn: "query-lenders",
    lenderId: "northwind",
    assertions,
    proofRef,
    requestedAmount: 20000,
    termMonths: 36,
  });

  // forged agent signature (flip last byte)
  const forged = structuredClone(baseReq);
  forged.agent_sig_hex = forged.agent_sig_hex.slice(0, -2) + (forged.agent_sig_hex.endsWith("00") ? "01" : "00");
  const forgedRes = handleQuote(forged, NOW);
  check("forged agent sig → rejected", forgedRes.decision === "decline" && !!forgedRes.reason?.includes("agent_sig_invalid"), forgedRes.reason);

  // PII injected into the body (also invalidates the sig — both are correct to flag)
  const withPii = structuredClone(baseReq) as unknown as { body: Record<string, unknown> };
  withPii.body.annual_income = 92000;
  const piiRes = handleQuote(withPii as never, NOW);
  check("PII in body → rejected", piiRes.decision === "decline" && !!piiRes.reason?.includes("pii_present"), piiRes.reason);

  // amount over the consented scope
  const overAmount = buildSignedLenderRequest(ctx, {
    fn: "query-lenders",
    lenderId: "northwind",
    assertions,
    proofRef,
    requestedAmount: 999999,
    termMonths: 36,
  });
  const overRes = handleQuote(overAmount, NOW);
  check("over-scope amount → rejected", overRes.decision === "decline" && !!overRes.reason?.includes("amount_exceeds_scope"), overRes.reason);

  // expired credential
  await installConsent(ctx, {
    maxLoanAmount: 20000,
    functions: [...BANKING_FUNCTIONS],
    nowSecs: NOW - 48 * 3600,
    validForSecs: 3600, // expired ~47h ago
  });
  const expiredReq = buildSignedLenderRequest(ctx, {
    fn: "query-lenders",
    lenderId: "northwind",
    assertions,
    proofRef,
    requestedAmount: 20000,
    termMonths: 36,
  });
  const expiredRes = handleQuote(expiredReq, NOW);
  check("expired credential → rejected", expiredRes.decision === "decline" && !!expiredRes.reason?.includes("credential_expired"), expiredRes.reason);

  // ── acceptance (transaction authorization) ───────────────────────────────
  await installConsent(ctx, {
    maxLoanAmount: 20000,
    functions: [...BANKING_FUNCTIONS],
    nowSecs: NOW,
    validForSecs: 24 * 3600,
  });
  console.log("\n── acceptance (submit-application) ──");
  const acceptReq = buildSignedLenderRequest(ctx, {
    fn: "submit-application",
    lenderId: "aurora",
    assertions,
    proofRef,
    requestedAmount: 20000,
    termMonths: 36,
    offerId: "aurora-36",
  });
  allRequests.push(acceptReq);
  const acc = handleAccept(acceptReq, NOW);
  allResponses.push(acc);
  check("Aurora accept → verified reference", acc.status === "submitted" && acc.verified.agent_authorized && !!acc.reference_id, acc.reference_id ?? acc.reason);

  // ── guardrail: nothing on the wire carries PII ───────────────────────────
  console.log("\n── PII guardrail ──");
  let guardOk = true;
  try {
    for (const r of allRequests) assertNoPii("wire_request", r);
    for (const r of allResponses) assertNoPii("wire_response", r);
  } catch (e) {
    guardOk = false;
    console.log("   leak:", (e as Error).message);
  }
  check("no PII in any request or response", guardOk);

  console.log("\n" + "─".repeat(72));
  if (failures === 0) {
    console.log("✅ Phase 4 verified: lenders cryptographically check authority + agent");
    console.log("   identity, reject tampering/expiry/over-scope/PII, never see raw data.");
  } else {
    console.log(`❌ ${failures} check(s) FAILED.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n❌ lenders demo failed:", e);
  process.exit(1);
});
