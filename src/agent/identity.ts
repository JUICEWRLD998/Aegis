/**
 * The agent's verifiable identity.
 *
 * An Aegis agent IS its secp256k1 keypair: the 33-byte compressed public key is
 * what the user names inside a delegation credential ("this agent, by this key,
 * may invoke these functions"), and the private key is what the agent signs each
 * invocation with — proving it acts under that authority. This is the same
 * identity primitive proven live in scripts/delegation-roundtrip.ts.
 *
 * Keep this the SINGLE place an agent key is materialised, so the identity story
 * (issue → name in credential → sign invocation) lives in one file.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";

export interface AgentIdentity {
  /** secp256k1 secret — signs invocations under a delegation. Never logged/leaked. */
  privateKey: Uint8Array;
  /** 33-byte compressed public key — the agent's verifiable identity in a credential. */
  pubkey: Uint8Array;
  pubkeyHex: string;
}

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

/**
 * Load the agent identity. Prefers an explicit `keyHex`, then `AGENT_KEY` from the
 * environment (lets the agent have a stable identity across runs — its DID/pubkey
 * stays constant, which matters for delegation + audit). Falls back to a fresh
 * random key when none is configured.
 */
export function loadAgentIdentity(opts: { keyHex?: string } = {}): AgentIdentity {
  const keyHex = opts.keyHex ?? process.env.AGENT_KEY;
  const privateKey = keyHex ? hexToBytes(keyHex) : secp256k1.utils.randomSecretKey();
  const pubkey = secp256k1.getPublicKey(privateKey, true); // compressed, 33 bytes
  return { privateKey, pubkey, pubkeyHex: toHex(pubkey) };
}
