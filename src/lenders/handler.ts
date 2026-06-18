/**
 * Lender request handlers — framework-agnostic so they run both behind a Next.js
 * route (Phase 5 browser) and in-process (headless Phase-4 proof). Each handler
 * VERIFIES first; only a fully-verified request gets a quote or an acceptance.
 */
import { getLender } from "./catalog";
import { verifyLenderRequest, type VerifyResult } from "./verify";
import type { SignedLenderRequest, QuoteResponse, AcceptResponse } from "./wire";

function verifiedSummary(v: VerifyResult): QuoteResponse["verified"] {
  return {
    agent_authorized: v.agentAuthorized,
    user_signature_recovered: v.signerAddrHex,
    no_pii: v.noPii,
  };
}

/** GET an indicative offer. Lender sees only assertions + a verified agent identity. */
export function handleQuote(
  req: SignedLenderRequest,
  nowSecs: number,
): QuoteResponse {
  const lender = getLender(req.lender_id);
  const lenderName = lender?.name ?? req.lender_id;

  const v = verifyLenderRequest(req, { nowSecs, requiredFunction: "query-lenders" });
  if (!lender) {
    return {
      lender_id: req.lender_id,
      lender_name: lenderName,
      decision: "decline",
      reason: "unknown_lender",
      verified: verifiedSummary(v),
    };
  }
  if (!v.ok) {
    return {
      lender_id: lender.id,
      lender_name: lender.name,
      decision: "decline",
      reason: `verification_failed:${v.reasons.join("|")}`,
      verified: verifiedSummary(v),
    };
  }

  const d = lender.evaluate(
    req.body.assertions,
    req.body.requested_amount,
    req.body.term_months,
  );
  return {
    lender_id: lender.id,
    lender_name: lender.name,
    decision: d.decision,
    reason: d.reason,
    offer: d.offer,
    verified: verifiedSummary(v),
  };
}

/** Accept (submit) — the transaction-authorization path. Re-verifies under the
 *  submit-application function before issuing a reference id. */
export function handleAccept(
  req: SignedLenderRequest,
  nowSecs: number,
): AcceptResponse {
  const lender = getLender(req.lender_id);
  const v = verifyLenderRequest(req, {
    nowSecs,
    requiredFunction: "submit-application",
  });

  if (!lender) {
    return {
      lender_id: req.lender_id,
      status: "rejected",
      reason: "unknown_lender",
      verified: verifiedSummary(v),
    };
  }
  if (!v.ok) {
    return {
      lender_id: lender.id,
      status: "rejected",
      reason: `verification_failed:${v.reasons.join("|")}`,
      verified: verifiedSummary(v),
    };
  }

  // Re-underwrite to confirm the lender still stands behind an offer for this proof.
  const d = lender.evaluate(
    req.body.assertions,
    req.body.requested_amount,
    req.body.term_months,
  );
  if (d.decision !== "offer") {
    return {
      lender_id: lender.id,
      status: "rejected",
      reason: d.reason ?? "no_qualifying_offer",
      verified: verifiedSummary(v),
    };
  }

  const offerId = req.body.offer_id ?? `${lender.id}-${req.body.term_months}`;
  return {
    lender_id: lender.id,
    status: "submitted",
    reference_id: `APP-${lender.id.toUpperCase()}-${offerId}`,
    verified: verifiedSummary(v),
  };
}
