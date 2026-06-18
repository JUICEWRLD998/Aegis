/**
 * T3 smoke test — run THE MOMENT we have an API key.
 *   npm run t3:smoke
 *
 * Purpose: validate every assumption in docs/SDK_FINDINGS.md against live testnet,
 * and resolve the open questions that gate the whole build:
 *   - Does handshake/authenticate work and return a did:t3n?
 *   - What does getUsage() actually return?
 *   - What is the REAL exported surface of @terminal3/t3n-sdk?
 *   - Is there an SDK/REST path for agent-auth grant + revoke + audit read?
 *     (GAP-003/004/005 — confirm before claiming "dashboard only".)
 *
 * This script is also our bug-hunting harness: capture anything surprising into
 * docs/BUGS.md or docs/DOCS-GAPS.md with a reproduction.
 */
import { openSession, getUsage } from "../src/t3/client";

async function main() {
  const key = process.env.T3N_API_KEY;
  if (!key) throw new Error("Set T3N_API_KEY (and run with: npm run t3:smoke)");

  console.log("1) Inspecting exported SDK surface...");
  const sdk = await import("@terminal3/t3n-sdk");
  console.log("   exports:", Object.keys(sdk).sort().join(", "));

  console.log("2) Opening authenticated TEE session...");
  const session = await openSession({ key });
  console.log("   did:", session.did);
  console.log("   address:", session.address);

  console.log("3) Reading token usage...");
  const usage = await getUsage(session);
  console.log("   available credits:", usage.available);

  console.log("4) Probing tenant record...");
  try {
    const me = await session.client.tenant?.me?.();
    console.log("   tenant.me():", JSON.stringify(me, null, 2));
  } catch (e) {
    console.log("   tenant.me() failed:", (e as Error).message);
  }

  console.log("5) Probing audit trail (getAuditEvents)...");
  try {
    const { getAuditTrail } = await import("../src/t3/audit");
    const trail = await getAuditTrail(session, { limit: 5 });
    console.log(`   ${trail.events.length} recent event(s):`);
    for (const e of trail.events) {
      console.log(
        `   - ${e.action} on ${e.target} → ${e.outcome} (actor=${e.actor}, vc=${e.vcId ?? "self"}, committed=${e.committed})`,
      );
    }
  } catch (e) {
    console.log("   getAuditEvents failed:", (e as Error).message);
  }

  console.log("\n✅ smoke passed. Confirm for build + bug bounty:");
  console.log("   - GAP-008: execute payload shape — does the server accept");
  console.log("     {script_name,script_version,function_name,input} (docs) or");
  console.log("     {version,functionName,input} (types)? Test executeAndDecode.");
  console.log("   - Delegation: buildDelegationCredential → signCredential round-trip,");
  console.log("     then revokeDelegation (whole + per-function).");
  console.log("   - Audit delegated-read: requires a LIVE grant to read user trail?");
  console.log("   - Privacy: confirm no PII appears in any returned object.");
}

main().catch((e) => {
  console.error("❌ smoke failed:", e);
  process.exit(1);
});
