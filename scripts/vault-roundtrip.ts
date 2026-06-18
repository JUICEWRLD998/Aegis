/**
 * Vault round-trip — prove the verified-data layer.
 *   node --env-file=.env --import tsx scripts/vault-roundtrip.ts
 *
 * 1. Ensure the data owner has a policy.
 * 2. Write a verified financial record into a banking scope.
 * 3. Read it back and confirm it matches.
 * 4. Re-read the audit trail to see the write recorded.
 */
import { openSession } from "../src/t3/client";
import {
  ensurePolicy,
  ensureScopeWriter,
  writeVerifiedRecord,
  readVerifiedRecord,
} from "../src/t3/vault";
import { getAuditTrail } from "../src/t3/audit";

const SCOPE = "banking/profile";
const KEY = "verified-financials-v1";

async function main() {
  const key = process.env.T3N_API_KEY;
  if (!key) throw new Error("Set T3N_API_KEY");

  console.log("1) Authenticating + ensuring policy...");
  const session = await openSession({ key });
  console.log("   did:", session.did);
  await ensurePolicy(session);
  await ensureScopeWriter(session, SCOPE);
  console.log("   policy + scope-writer ok");

  console.log("2) Writing verified financial record...");
  const record = {
    annual_income: 92000,
    currency: "USD",
    employment_status: "employed_full_time",
    employer_verified: true,
    defaults_24mo: 0,
    // derived disclosure assertions the agent is allowed to see:
    assertions: { income_ge_80k: true, no_default_24mo: true },
  };
  const { entryId } = await writeVerifiedRecord(session, SCOPE, KEY, record);
  console.log("   wrote entry:", entryId);

  console.log("3) Reading it back...");
  const got = await readVerifiedRecord(session, SCOPE, KEY);
  console.log("   read:", JSON.stringify(got));
  const ok = JSON.stringify(got) === JSON.stringify(record);
  console.log("   round-trip matches:", ok ? "✅ YES" : "❌ NO");

  console.log("4) Audit trail after write...");
  const trail = await getAuditTrail(session, { limit: 5 });
  console.log(`   ${trail.events.length} event(s):`);
  for (const e of trail.events) {
    console.log(
      `   - ${e.action} on ${e.target} → ${e.outcome} (actor=${e.actor}, committed=${e.committed})`,
    );
  }

  console.log("\n✅ vault round-trip done.");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});
