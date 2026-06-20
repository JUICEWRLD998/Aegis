/**
 * Reproductions for the Terminal 3 SDK bug reports (docs/BUGS.md).
 * All of these are OFFLINE and DETERMINISTIC — no network, no API key — so any
 * reviewer can run them and see the defect:
 *
 *   node --import tsx scripts/sdk-bugs.ts
 *
 * SDK: @terminal3/t3n-sdk@3.8.0
 */
import * as sdk from "@terminal3/t3n-sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";

function hdr(n: string) { console.log("\n" + "═".repeat(72) + "\n" + n + "\n" + "═".repeat(72)); }

// ── BUG 1: revokeDelegation builds a relative URL when baseUrl is omitted ──────
async function bug1() {
  hdr("BUG 1 — revokeDelegation default version-resolution uses an empty base URL");
  // A real client is irrelevant: the failure happens during version resolution,
  // BEFORE the client is used. We pass a stub to prove that.
  try {
    await sdk.revokeDelegation({
      credentialJcsB64u: "AA",
      client: {} as never,
    });
    console.log("  ✗ expected a thrown error, got none");
  } catch (e) {
    console.log("  thrown:", (e as Error).message);
    console.log("  → relative URL '/api/contracts/current?...' is unparseable by fetch();");
    console.log("    revokeDelegation should derive the node URL from the authenticated client.");
  }
}

// ── BUG 2: contract field (max 46) can't hold a canonical tenant script name ──
function bug2() {
  hdr("BUG 2 — buildDelegationCredential rejects canonical tenant contract names");
  const tid = "did:t3n:" + "a".repeat(40);
  const tail = "banking-contracts"; // a perfectly valid tail (TAIL_PATTERN allows up to 128 chars)
  const name = sdk.canonicalTenantName(tid, tail);
  console.log(`  canonicalTenantName(tid, "${tail}") = "${name}" (len ${name.length})`);

  const base = {
    user_did: tid,
    agent_pubkey: secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true),
    org_did: tid,
    functions: ["query-lenders"],
    not_before_secs: 0n,
    not_after_secs: 9999999999n,
    vc_id: crypto.getRandomValues(new Uint8Array(16)),
  };
  try {
    sdk.buildDelegationCredential({ ...base, contract: name });
    console.log("  ✗ expected ContractTooLong, got none");
  } catch (e) {
    console.log("  buildDelegationCredential(contract = that name) →", (e as Error).message);
  }
  // shortest tenant name that still overflows: tail length 4 → 47 chars
  const shortName = sdk.canonicalTenantName(tid, "abcd");
  console.log(`  even the minimal case "${shortName}" (len ${shortName.length}) overflows the 46-char cap.`);
}

// ── BUG 3: b64uDecodeStrict accepts non-canonical base64url ───────────────────
function bug3() {
  hdr("BUG 3 — b64uDecodeStrict accepts non-canonical base64url (malleable)");
  const a = sdk.b64uDecodeStrict("AA");
  const b = sdk.b64uDecodeStrict("AB"); // trailing 4 bits are non-zero, must be rejected by a STRICT decoder
  const toHex = (u: Uint8Array) => Array.from(u, (x) => x.toString(16).padStart(2, "0")).join("");
  console.log(`  b64uDecodeStrict("AA") = [${toHex(a)}]`);
  console.log(`  b64uDecodeStrict("AB") = [${toHex(b)}]   ← different input, identical bytes`);
  console.log(`  re-encode of "AB" = "${sdk.b64uEncodeBytes(b)}"  (≠ "AB" → input was non-canonical)`);
  console.log("  → two distinct strings decode to the same bytes; a 'strict' decoder must reject 'AB'.");
}

// ── (minor) toBaseUnits float precision ───────────────────────────────────────
function bug4() {
  hdr("MINOR — toBaseUnits uses float math (number input) → precision loss / non-integer");
  const big = 9007199254740993; // > 2^53
  const out = sdk.toBaseUnits(big);
  console.log(`  toBaseUnits(${big}) = ${out}  (Number, in scientific notation — not an integer base-unit count)`);
  console.log("  → token amounts should be taken as string/bigint and computed in BigInt to avoid float error.");
}

async function main() {
  console.log("Terminal 3 SDK bug reproductions — @terminal3/t3n-sdk@3.8.0");
  await bug1();
  bug2();
  bug3();
  bug4();
  console.log("\nDone. See docs/BUGS.md for full write-ups.");
}
main().catch((e) => { console.error(e); process.exit(1); });
