/**
 * AgentContext — the live state an Aegis agent run carries.
 *
 * It binds together everything the tool layer needs: the authenticated T3 session,
 * the agent's verifiable identity, the user's signing key (to author delegations),
 * and the mutable run state (the active consent grant, a step-up approval, the last
 * offers seen, and a tool trace surfaced to the UI/audit panel).
 *
 * Human-in-the-loop is modelled as an `Approver` seam: `request_consent` and
 * `request_step_up` go through it. Headless demos use AutoApprover; the web app
 * swaps in an approver backed by the real consent / step-up modals — the runtime
 * doesn't change.
 */
import type { SignedGrant, BankingFunction } from "../t3/delegation";
import type { LenderOffer } from "../t3/banking";
import type { DisclosureAssertions } from "../t3/profile";
import { openSession, type T3Session } from "../t3/client";
import { loadAgentIdentity, type AgentIdentity } from "./identity";

/** Delegation `contract` field is capped at 46 chars (BUG-CAND-C); the canonical
 *  `z:<40hex>:<tail>` script name overflows it, so the credential scopes the agent
 *  to this short logical id. Maps to the deployed banking script at invoke time. */
export const DELEGATION_CONTRACT_ID = "tee:banking";

/** Live consent grant the agent currently holds (the user→agent delegation). */
export interface ConsentGrant {
  consentId: string; // vc id, hex
  grant: SignedGrant;
  purpose: string;
  maxLoanAmount: number;
  maxLenders: number;
  functions: BankingFunction[];
  expiresAt: number; // unix secs
  revoked: boolean;
  revokedFunctions: BankingFunction[];
}

/** A recorded human step-up approval for an irreversible/high-value action. */
export interface StepUpApproval {
  stepUpId: string;
  lenderId: string;
  amount: number;
  approvedAtSecs: number;
}

export interface ConsentRequest {
  purpose: string;
  maxLoanAmount: number;
  maxLenders: number;
  functions: BankingFunction[];
  validHours: number;
}

export interface StepUpRequest {
  lenderId: string;
  lenderName?: string;
  amount: number;
  termMonths: number;
  apr?: number;
}

export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}

/**
 * The human-in-the-loop seam. Implementations decide how a person approves —
 * console prompt, web modal, auto-approve in tests.
 */
export interface Approver {
  requestConsent(req: ConsentRequest): Promise<ApprovalDecision>;
  requestStepUp(req: StepUpRequest): Promise<ApprovalDecision>;
}

/** Approves everything — for headless demos/tests. Logs the decision points so the
 *  human-in-the-loop seam is still visible in the transcript. */
export class AutoApprover implements Approver {
  constructor(private log: (m: string) => void = () => {}) {}
  async requestConsent(req: ConsentRequest): Promise<ApprovalDecision> {
    this.log(
      `🔐 [consent] auto-approving: ${req.purpose} — share with ≤${req.maxLenders} ` +
        `lenders, loan ≤ $${req.maxLoanAmount.toLocaleString()}, valid ${req.validHours}h`,
    );
    return { approved: true };
  }
  async requestStepUp(req: StepUpRequest): Promise<ApprovalDecision> {
    this.log(
      `✋ [step-up] auto-approving high-value action: accept $${req.amount.toLocaleString()} ` +
        `from ${req.lenderName ?? req.lenderId} over ${req.termMonths}mo`,
    );
    return { approved: true };
  }
}

/** One entry in the agent's tool trace — what powers the UI audit/activity panel. */
export interface AgentTraceEntry {
  step: number;
  tool: string;
  args: unknown;
  result: unknown;
  ok: boolean;
  tsMs: number;
}

export interface AgentContext {
  session: T3Session;
  userDid: string;
  /** User's secp256k1 secret — authors (signs) the delegation credential. */
  userSecret: Uint8Array;
  agent: AgentIdentity;
  /** Tenant DID that owns the deployed banking script (`z:<tid>:<tail>`). */
  tenantDid: string;
  /** Org DID that owns the contract referenced by the credential. */
  orgDid: string;
  approver: Approver;
  /** Caller-supplied clock (unix secs) — no Date.now() buried in the adapters. */
  nowSecs: () => number;

  // ── mutable run state ────────────────────────────────────────────────
  consent: ConsentGrant | null;
  stepUp: StepUpApproval | null;
  /** The most recent disclosure proof — reused when querying/accepting with lenders. */
  lastProof: { proofRef: string; assertions: DisclosureAssertions } | null;
  lastOffers: LenderOffer[];
  trace: AgentTraceEntry[];

  /** When the TEE banking contract isn't deployed yet (Day 3), let banking tools
   *  fall back to deterministic stub offers so the agent loop is demoable now. */
  allowStubFallback: boolean;
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

export interface CreateContextOpts {
  /** The user/data-owner wallet key. Defaults to T3N_API_KEY. */
  userKey?: string;
  /** The agent's own signing key. Defaults to AGENT_KEY (or a random identity). */
  agentKey?: string;
  approver?: Approver;
  tenantDid?: string;
  allowStubFallback?: boolean;
  nowSecs?: () => number;
}

/**
 * Build a ready-to-run AgentContext: authenticate the user, materialise the agent
 * identity, and wire the approver + clock. In testnet the user, agent and tenant
 * can all be the same key (we own the contract we test against).
 */
export async function createAgentContext(
  opts: CreateContextOpts = {},
): Promise<AgentContext> {
  const userKey = opts.userKey ?? process.env.T3N_API_KEY;
  if (!userKey) throw new Error("Set T3N_API_KEY (or pass opts.userKey)");

  const session = await openSession({ key: userKey });
  const agent = loadAgentIdentity({ keyHex: opts.agentKey });
  const envTenant = (opts.tenantDid ?? process.env.TENANT_DID ?? "").trim();
  // Fall back to the user DID when no real tenant is configured (testnet: we own
  // the contract we test against). Guards against a blank/placeholder TENANT_DID.
  const tenantDid = envTenant.startsWith("did:t3n:") ? envTenant : session.did;

  return {
    session,
    userDid: session.did,
    userSecret: hexToBytes(userKey),
    agent,
    tenantDid,
    orgDid: session.did,
    approver: opts.approver ?? new AutoApprover(),
    nowSecs: opts.nowSecs ?? (() => Math.floor(Date.now() / 1000)),
    consent: null,
    stepUp: null,
    lastProof: null,
    lastOffers: [],
    trace: [],
    allowStubFallback: opts.allowStubFallback ?? true,
  };
}
