/**
 * Throwaway probe (Phase 4) — confirm the crypto invariants verify.ts relies on:
 *   1. signAgentInvocation → 64-byte sig verifiable via noble
 *      secp256k1.verify(sig, sha256(preimage), agentPubkey).
 *   2. The did:t3n ↔ recovered-address relationship (can a lender map a recovered
 *      EIP-191 signer back to credential.user_did?).
 *
 *   node --import tsx scripts/probe-crypto.ts
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as sdk from "@terminal3/t3n-sdk";

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function main() {
  // ── 1. agent invocation sign/verify round-trip ────────────────────────────
  const agentPriv = secp256k1.utils.randomSecretKey();
  const agentPub = secp256k1.getPublicKey(agentPriv, true); // 33B compressed

  const vcId = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const reqHash = sha256(new TextEncoder().encode('{"hello":"world"}'));

  const preimage = sdk.buildInvocationPreimage(vcId, nonce, reqHash);
  const sig = sdk.signAgentInvocation(preimage, agentPriv);
  console.log("preimage len:", preimage.length, "| agent sig len:", sig.length);

  const digest = sha256(preimage);
  // noble v2 verify: verify(signature, messageHash, publicKey)
  const okSha = secp256k1.verify(sig, digest, agentPub);
  const okRaw = (() => {
    try {
      return secp256k1.verify(sig, preimage, agentPub);
    } catch {
      return false;
    }
  })();
  console.log("verify(sig, sha256(preimage), pub):", okSha);
  console.log("verify(sig, preimage, pub):        ", okRaw);

  // tamper → must fail
  const badHash = sha256(new TextEncoder().encode('{"hello":"WORLD"}'));
  const badPre = sdk.buildInvocationPreimage(vcId, nonce, badHash);
  console.log("verify against tampered preimage:  ", secp256k1.verify(sig, sha256(badPre), agentPub), "(want false)");

  // ── 2. credential sign → recover; did vs address ──────────────────────────
  const userKey = process.env.T3N_API_KEY;
  if (!userKey) {
    console.log("\n(skip did/address probe: set T3N_API_KEY to run it)");
    return;
  }
  const clean = userKey.trim().replace(/^0x/i, "");
  const userSecret = Uint8Array.from(
    clean.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
  );
  const userAddr = sdk.eth_get_address(userKey); // 0x...
  const cred = sdk.buildDelegationCredential({
    user_did: "did:t3n:placeholder",
    agent_pubkey: agentPub,
    org_did: "did:t3n:placeholder",
    contract: "tee:banking",
    functions: ["query-lenders"],
    not_before_secs: 0n,
    not_after_secs: 9999999999n,
    vc_id: vcId,
  });
  const jcs = sdk.canonicaliseCredential(cred);
  const { sig: userSig, addr } = sdk.signCredential(jcs, userSecret);
  const recovered = sdk.ethRecoverEip191(jcs, userSig);
  console.log("\nuser eth address:       ", userAddr.toLowerCase());
  console.log("signCredential addr:    ", "0x" + toHex(addr));
  console.log("ethRecoverEip191 addr:  ", "0x" + toHex(recovered));
  console.log("recovered == signer:    ", toHex(recovered) === toHex(addr));

  // probe did derivations
  for (const [label, bytes] of [
    ["compactDidFromBytes(recoveredAddr)", recovered],
    ["compactDidFromBytes(agentPub)", agentPub],
  ] as const) {
    try {
      console.log(`${label}:`, sdk.compactDidFromBytes(bytes));
    } catch (e) {
      console.log(`${label}: ERR ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
