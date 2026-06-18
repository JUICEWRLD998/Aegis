/**
 * Delegation round-trip — the Agent-Auth core, proven live.
 *   node --env-file=.env --import tsx scripts/delegation-roundtrip.ts
 *
 * Flow:
 *   1. Authenticate as the USER (data owner).
 *   2. Generate an AGENT keypair → its 33-byte compressed secp256k1 pubkey is the
 *      agent's verifiable identity inside the credential.
 *   3. buildDelegationCredential — scoped to our banking contract + functions, with
 *      a bounded validity window.
 *   4. canonicalise → signCredential with the user's key; assert the recovered
 *      address == the user's wallet address (the signature really is the user's).
 *   5. revokeDelegation — whole-credential, then re-test per-function semantics.
 *
 * Build+sign is pure local crypto (deterministic). Revoke hits the live
 * tee:delegation contract on testnet.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import * as sdk from "@terminal3/t3n-sdk";
import { openSession } from "../src/t3/client";

function hexToBytes(h: string): Uint8Array {
  const clean = h.trim().replace(/^0x/i, "");
  if (clean.length % 2 !== 0) throw new Error("odd-length hex key");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function main() {
  const userKey = process.env.T3N_API_KEY;
  if (!userKey) throw new Error("Set T3N_API_KEY");

  console.log("1) Authenticating as USER (data owner)...");
  const session = await openSession({ key: userKey });
  const userDid = session.did;
  const userAddress = session.address;
  console.log("   user did:", userDid);
  console.log("   user addr:", userAddress);

  console.log("2) Generating AGENT identity keypair...");
  const agentPriv = secp256k1.utils.randomSecretKey();
  const agentPubkey = secp256k1.getPublicKey(agentPriv, true); // compressed, 33 bytes
  console.log(`   agent pubkey (${agentPubkey.length}B):`, toHex(agentPubkey));

  console.log("3) Building scoped, time-boxed delegation credential...");
  // NOTE: the `contract` field caps at 46 chars (BUG-CAND-C). A canonical tenant
  // script name `z:<40hex-tid>:<tail>` exceeds that, so we use a short logical id
  // here. How this maps to the deployed z:<tid>:tail script is TBD on testnet.
  const contract = `tee:banking`;
  const vcId = crypto.getRandomValues(new Uint8Array(16));
  const now = BigInt(Math.floor(Date.now() / 1000));
  const functions = ["query-lenders", "submit-application"].sort();

  const credential = sdk.buildDelegationCredential({
    user_did: userDid,
    agent_pubkey: agentPubkey,
    org_did: userDid, // we own the contract in this test
    contract,
    functions,
    scopes: ["amount<=20000"],
    metadata: { purpose: "personal-loan-shopping" },
    not_before_secs: now,
    not_after_secs: now + 86400n, // valid 24h
    vc_id: vcId,
  });
  sdk.validateCredentialBody(credential);
  console.log("   credential valid. functions:", functions.join(", "));
  console.log("   validity:", now, "→", now + 86400n);

  console.log("4) User signs the credential (EIP-191)...");
  const jcs = sdk.canonicaliseCredential(credential);
  const { sig, addr } = sdk.signCredential(jcs, hexToBytes(userKey));
  const recovered = "0x" + toHex(addr);
  const matches = recovered.toLowerCase() === userAddress.toLowerCase();
  console.log("   recovered signer:", recovered);
  console.log("   matches user wallet:", matches ? "✅ YES" : "❌ NO");
  if (!matches) throw new Error("signature did not recover to the user's wallet");
  const credB64u = sdk.b64uEncodeBytes(jcs);
  console.log("   sig bytes:", sig.length, "| credential jcs b64u len:", credB64u.length);

  console.log("5) Revoking — PER-FUNCTION first (revoke submit-application only)...");
  try {
    const r1 = await sdk.revokeDelegation({
      credentialJcsB64u: credB64u,
      revokedFunctions: ["submit-application"],
      client: session.client,
      baseUrl: sdk.getNodeUrl(), // BUG-CAND-D: revoke builds a relative URL without this
      scriptVersion: "2.0.1", // skip auto-resolution which fails (see BUG-CAND-D)
    });
    console.log("   per-function revoke:", JSON.stringify(r1));
  } catch (e) {
    console.log("   per-function revoke error:", (e as Error).message);
  }

  console.log("6) Revoking WHOLE credential...");
  try {
    const r2 = await sdk.revokeDelegation({
      credentialJcsB64u: credB64u,
      client: session.client,
      baseUrl: sdk.getNodeUrl(),
      scriptVersion: "2.0.1",
    });
    console.log("   whole revoke:", JSON.stringify(r2));
  } catch (e) {
    console.log("   whole revoke error:", (e as Error).message);
  }

  console.log("\n✅ delegation round-trip done. Record results in SDK_FINDINGS.md.");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});
