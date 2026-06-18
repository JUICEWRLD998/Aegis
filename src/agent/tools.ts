/**
 * The agent's tool surface — the ONLY way the LLM can act on the world.
 *
 * Design rule (the 40% integration story): every tool is backed by a real T3
 * Agent-Auth primitive, and none of them ever return raw PII. The LLM orchestrates
 * *capabilities*; the SDK/TEE enforces *authority and privacy*:
 *
 *   request_consent       → user→agent scoped, time-boxed delegation (signCredential)
 *   read_verified_profile → confirms vault data is sealed behind the TEE boundary
 *   make_disclosure_proof → derives coarse selective-disclosure assertions
 *   query_lenders         → invoke banking contract; lenders see proofs, not PII
 *   compare_offers        → deterministic ranking (no SDK; pure logic)
 *   request_step_up       → human-in-the-loop approval for the irreversible action
 *   execute_acceptance    → submit application; gated by consent + step-up
 *   get_audit_log         → cryptographic who/under-whose-authority/what/when trail
 *
 * Authority is enforced HERE, not just in the UI: consent existence, expiry,
 * revocation, per-function scope, and amount caps are all checked before a banking
 * call is even attempted.
 */
import type { ToolDef } from "./openrouter";
import type { AgentContext } from "./context";
import { DELEGATION_CONTRACT_ID } from "./context";
import {
  createScopedGrant,
  BANKING_FUNCTIONS,
  type BankingFunction,
} from "../t3/delegation";
import { getDisclosureAssertions } from "../t3/profile";
import { queryLenders, submitApplication, type LenderOffer } from "../t3/banking";
import { getAuditTrail } from "../t3/audit";

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<unknown>;

// ── helpers ────────────────────────────────────────────────────────────────

function num(v: unknown, fallback?: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (Number.isFinite(n)) return n;
  if (fallback !== undefined) return fallback;
  throw new Error(`expected a number, got ${JSON.stringify(v)}`);
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Resolve & validate the active consent for a given banking function. Returns the
 *  grant, or an `{ error }` object the LLM can read and recover from. */
function requireConsent(
  ctx: AgentContext,
  fn: BankingFunction,
): { error: string; detail?: string } | NonNullable<AgentContext["consent"]> {
  const c = ctx.consent;
  if (!c) return { error: "no_consent", detail: "Call request_consent first." };
  if (c.revoked) return { error: "consent_revoked", detail: "Authority was revoked." };
  if (ctx.nowSecs() > c.expiresAt)
    return { error: "consent_expired", detail: "The consent window has elapsed." };
  if (!c.functions.includes(fn) || c.revokedFunctions.includes(fn))
    return { error: "function_not_authorized", detail: `Consent does not cover "${fn}".` };
  return c;
}

function isError(x: unknown): x is { error: string } {
  return typeof x === "object" && x !== null && "error" in x;
}

/** Deterministic indicative offers — used when the TEE banking contract isn't
 *  deployed yet, mirroring the stub in contract/src/lenders.rs so the agent loop
 *  is fully demoable before Day 3. */
function stubOffers(requestedAmount: number, termMonths: number): LenderOffer[] {
  const proofRef = "sd:income_ge_80k,no_default_24mo";
  return [
    { lenderId: "bank-a", lenderName: "Aurora Bank", apr: 6.9, maxAmount: requestedAmount, termMonths, proofRef },
    { lenderId: "bank-b", lenderName: "Meridian Credit", apr: 7.4, maxAmount: requestedAmount, termMonths, proofRef },
    { lenderId: "bank-c", lenderName: "Northwind Finance", apr: 8.1, maxAmount: requestedAmount, termMonths, proofRef },
  ];
}

// ── handlers ─────────────────────────────────────────────────────────────────

const handlers: Record<string, Handler> = {
  /** Build + user-sign a scoped, time-boxed delegation. Human approves via the seam. */
  async request_consent(ctx, args) {
    const maxLoanAmount = num(args.max_loan_amount);
    const maxLenders = Math.max(1, Math.floor(num(args.max_lenders, 3)));
    const validHours = Math.max(1, Math.floor(num(args.valid_hours, 24)));
    const purpose = String(args.purpose ?? "personal-loan-shopping");

    const requested = Array.isArray(args.functions)
      ? (args.functions as string[])
      : [...BANKING_FUNCTIONS];
    const functions = [...BANKING_FUNCTIONS].filter((f) => requested.includes(f));
    if (functions.length === 0) functions.push(...BANKING_FUNCTIONS);

    const decision = await ctx.approver.requestConsent({
      purpose,
      maxLoanAmount,
      maxLenders,
      functions,
      validHours,
    });
    if (!decision.approved) {
      return { status: "denied", reason: decision.reason ?? "user declined consent" };
    }

    const now = ctx.nowSecs();
    const vcId = crypto.getRandomValues(new Uint8Array(16));
    const grant = await createScopedGrant(
      {
        userDid: ctx.userDid,
        agentPubkey: ctx.agent.pubkey,
        orgDid: ctx.orgDid,
        contract: DELEGATION_CONTRACT_ID,
        functions,
        vcId,
        validForSecs: validHours * 3600,
        nowSecs: now,
        scopes: [`amount<=${maxLoanAmount}`, `lenders<=${maxLenders}`],
        metadata: { purpose },
      },
      ctx.userSecret,
    );

    const expiresAt = now + validHours * 3600;
    ctx.consent = {
      consentId: hex(vcId),
      grant,
      purpose,
      maxLoanAmount,
      maxLenders,
      functions,
      expiresAt,
      revoked: false,
      revokedFunctions: [],
    };

    return {
      status: "granted",
      consent_id: ctx.consent.consentId,
      agent_identity: ctx.agent.pubkeyHex,
      purpose,
      max_loan_amount: maxLoanAmount,
      max_lenders: maxLenders,
      functions,
      scopes: [`amount<=${maxLoanAmount}`, `lenders<=${maxLenders}`],
      expires_at_unix: expiresAt,
    };
  },

  /** Confirm verified data is loaded behind the TEE boundary — WITHOUT returning it.
   *  Only category labels cross; raw values stay sealed. */
  async read_verified_profile(ctx) {
    // Touch the boundary server-side to confirm the profile resolves, but discard
    // the confidential payload — it must never reach the model.
    let source: "vault" | "local" = "local";
    try {
      const { loadVerifiedProfile } = await import("../t3/profile");
      source = (await loadVerifiedProfile(ctx.session)).source;
    } catch {
      source = "local";
    }
    return {
      profile_loaded: true,
      source,
      categories: ["income", "employment", "residency", "credit_history"],
      note:
        "Raw figures remain sealed in the TEE. Use make_disclosure_proof to derive " +
        "shareable assertions; the underlying values never enter this conversation.",
    };
  },

  /** Derive coarse selective-disclosure assertions (booleans/bands) + a proof handle.
   *  These — and ONLY these — are what lenders receive. */
  async make_disclosure_proof(ctx) {
    const assertions = await getDisclosureAssertions(ctx.session);
    const trueClaims = Object.entries(assertions)
      .filter(([, v]) => v === true)
      .map(([k]) => k)
      .sort();
    const proofRef = `sd:${trueClaims.join(",")}`;
    return { proof_ref: proofRef, assertions };
  },

  /** Invoke the banking contract to collect indicative offers. Lenders receive only
   *  the disclosure proof + agent identity — never PII. */
  async query_lenders(ctx, args) {
    const grant = requireConsent(ctx, "query-lenders");
    if (isError(grant)) return grant;

    const requestedAmount = num(args.requested_amount);
    const termMonths = Math.floor(num(args.term_months, 36));
    if (requestedAmount > grant.maxLoanAmount) {
      return {
        error: "amount_exceeds_consent",
        detail: `Requested $${requestedAmount} exceeds consented max $${grant.maxLoanAmount}.`,
      };
    }

    let offers: LenderOffer[];
    let source: "contract" | "stub";
    try {
      offers = await queryLenders(ctx.session, ctx.tenantDid, { requestedAmount, termMonths });
      source = "contract";
      if (offers.length === 0 && ctx.allowStubFallback) {
        offers = stubOffers(requestedAmount, termMonths);
        source = "stub";
      }
    } catch (e) {
      if (!ctx.allowStubFallback) {
        return { error: "query_failed", detail: (e as Error).message };
      }
      offers = stubOffers(requestedAmount, termMonths);
      source = "stub";
    }

    offers = offers.slice(0, grant.maxLenders); // honour the consented lender cap
    ctx.lastOffers = offers;
    return { source, lender_count: offers.length, offers };
  },

  /** Rank the offers (cheapest APR wins) and recommend one. Pure deterministic logic. */
  async compare_offers(ctx) {
    if (ctx.lastOffers.length === 0) {
      return { error: "no_offers", detail: "Call query_lenders first." };
    }
    const ranked = [...ctx.lastOffers]
      .sort((a, b) => a.apr - b.apr || b.maxAmount - a.maxAmount)
      .map((o, i) => ({
        rank: i + 1,
        lender_id: o.lenderId,
        lender_name: o.lenderName,
        apr: o.apr,
        term_months: o.termMonths,
        max_amount: o.maxAmount,
      }));
    const best = ranked[0];
    return {
      ranked,
      recommended_lender_id: best.lender_id,
      rationale: `${best.lender_name} offers the lowest APR (${best.apr}%).`,
    };
  },

  /** Human-in-the-loop step-up for the irreversible, high-value acceptance. */
  async request_step_up(ctx, args) {
    const grant = requireConsent(ctx, "submit-application");
    if (isError(grant)) return grant;

    const lenderId = String(args.lender_id ?? "");
    const amount = num(args.amount);
    const termMonths = Math.floor(num(args.term_months, 36));
    if (amount > grant.maxLoanAmount) {
      return {
        error: "amount_exceeds_consent",
        detail: `$${amount} exceeds consented max $${grant.maxLoanAmount}.`,
      };
    }
    const offer = ctx.lastOffers.find((o) => o.lenderId === lenderId);

    const decision = await ctx.approver.requestStepUp({
      lenderId,
      lenderName: offer?.lenderName,
      amount,
      termMonths,
      apr: offer?.apr,
    });
    if (!decision.approved) {
      return { approved: false, reason: decision.reason ?? "human declined the step-up" };
    }

    const stepUpId = hex(crypto.getRandomValues(new Uint8Array(8)));
    ctx.stepUp = { stepUpId, lenderId, amount, approvedAtSecs: ctx.nowSecs() };
    return { approved: true, step_up_id: stepUpId };
  },

  /** Submit the application. Gated by live consent AND a matching step-up approval.
   *  PII is injected by the host via {{profile.*}} placeholders at egress — never here. */
  async execute_acceptance(ctx, args) {
    const grant = requireConsent(ctx, "submit-application");
    if (isError(grant)) return grant;

    const lenderId = String(args.lender_id ?? "");
    const offerId = String(args.offer_id ?? lenderId);
    const amount = num(args.amount);
    const termMonths = Math.floor(num(args.term_months, 36));

    if (amount > grant.maxLoanAmount) {
      return {
        error: "amount_exceeds_consent",
        detail: `$${amount} exceeds consented max $${grant.maxLoanAmount}.`,
      };
    }
    const su = ctx.stepUp;
    if (!su || su.lenderId !== lenderId || su.amount !== amount) {
      return {
        error: "step_up_required",
        detail: "A matching human step-up approval is required before acceptance.",
      };
    }

    try {
      const res = await submitApplication(ctx.session, ctx.tenantDid, {
        lenderId,
        offerId,
        amount,
        termMonths,
      });
      return { source: "contract", ...res };
    } catch (e) {
      if (!ctx.allowStubFallback) {
        return { error: "submit_failed", detail: (e as Error).message };
      }
      return {
        source: "stub",
        status: "submitted",
        referenceId: `APP-${lenderId}-${offerId}`,
        stepUpId: su.stepUpId,
      };
    }
  },

  /** The compliance trail: who acted, under whose authority, what was done, when. */
  async get_audit_log(ctx, args) {
    const limit = Math.min(100, Math.max(1, Math.floor(num(args.limit, 20))));
    try {
      const { events } = await getAuditTrail(ctx.session, { limit });
      return { count: events.length, events };
    } catch (e) {
      return { count: 0, events: [], note: `audit read unavailable: ${(e as Error).message}` };
    }
  },
};

/** JSON-Schema tool definitions advertised to the model. */
export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "request_consent",
      description:
        "Obtain the user's scoped, time-boxed, revocable consent (a signed user→agent " +
        "delegation) BEFORE touching any lender. Must be called first. Triggers a human " +
        "approval. Define the purpose, the maximum loan amount, how many lenders may be " +
        "contacted, and the validity window.",
      parameters: {
        type: "object",
        properties: {
          purpose: { type: "string", description: "Why authority is requested, e.g. 'personal-loan-shopping'." },
          max_loan_amount: { type: "number", description: "Hard cap on the loan amount the agent may pursue." },
          max_lenders: { type: "number", description: "Max number of lenders to contact (default 3)." },
          valid_hours: { type: "number", description: "How long the consent stays valid, in hours (default 24)." },
          functions: {
            type: "array",
            items: { type: "string", enum: [...BANKING_FUNCTIONS] },
            description: "Banking functions to authorize. Defaults to all.",
          },
        },
        required: ["purpose", "max_loan_amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_verified_profile",
      description:
        "Confirm the user's verified financial data is loaded behind the TEE boundary. " +
        "Returns only category labels — never raw values. Use before deriving a proof.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "make_disclosure_proof",
      description:
        "Derive coarse selective-disclosure assertions (e.g. income band, no-defaults) and " +
        "a proof handle from the sealed profile. These assertions are the ONLY thing lenders " +
        "receive about the user. Raw figures never leave the TEE.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "query_lenders",
      description:
        "Ask lenders for indicative offers, sending only the disclosure proof + the agent's " +
        "identity (no PII). Requires active consent; the amount must be within the consented cap.",
      parameters: {
        type: "object",
        properties: {
          requested_amount: { type: "number", description: "Loan amount to quote." },
          term_months: { type: "number", description: "Loan term in months (default 36)." },
        },
        required: ["requested_amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_offers",
      description: "Rank the offers returned by query_lenders (lowest APR wins) and recommend one.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "request_step_up",
      description:
        "Request explicit human approval (step-up) for the irreversible, high-value loan " +
        "acceptance. Required before execute_acceptance. Pass the chosen lender and amount.",
      parameters: {
        type: "object",
        properties: {
          lender_id: { type: "string" },
          amount: { type: "number" },
          term_months: { type: "number" },
        },
        required: ["lender_id", "amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_acceptance",
      description:
        "Submit the loan application to the chosen lender. Requires active consent AND a " +
        "matching human step-up approval. PII is injected host-side via placeholders at egress.",
      parameters: {
        type: "object",
        properties: {
          lender_id: { type: "string" },
          offer_id: { type: "string" },
          amount: { type: "number" },
          term_months: { type: "number" },
        },
        required: ["lender_id", "amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_audit_log",
      description:
        "Read the cryptographic audit trail (who acted, under whose authority, what, when) " +
        "to confirm and summarise everything that happened.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "Max events to read (default 20)." } },
      },
    },
  },
];

/** Dispatch a single tool call. Unknown tools return a structured error the LLM can read. */
export async function runTool(
  ctx: AgentContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const handler = handlers[name];
  if (!handler) return { error: "unknown_tool", detail: `No tool named "${name}".` };
  try {
    return await handler(ctx, args ?? {});
  } catch (e) {
    return { error: "tool_failed", detail: (e as Error).message };
  }
}

export const TOOL_NAMES = Object.keys(handlers);
