/**
 * The 3 mock lenders and their pricing — driven ENTIRELY by the coarse disclosure
 * assertions the agent presents (income band, no-default flag, employment verified).
 *
 * Privacy invariant restated at the lender boundary: a lender only ever sees
 * `DisclosureAssertions` (booleans/bands), never a figure or a document. Two lenders
 * with different risk appetites therefore return genuinely different offers from the
 * SAME proof — which is the demo beat ("three banks underwrote her from a proof").
 */
import type { DisclosureAssertions } from "../t3/profile";
import type { LenderOffer } from "../t3/banking";

export interface LenderDecision {
  decision: "offer" | "decline";
  reason?: string; // present when declined
  offer?: LenderOffer; // present when offered (proofRef set by the lender)
}

export interface Lender {
  id: string;
  name: string;
  tagline: string;
  evaluate(
    assertions: DisclosureAssertions,
    requestedAmount: number,
    termMonths: number,
  ): LenderDecision;
}

/** Stable proof handle from the true assertions — echoes what the lender relied on. */
function proofRefFrom(a: DisclosureAssertions): string {
  const claims = Object.entries(a)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .sort();
  return `sd:${claims.join(",")}`;
}

/** Small term premium: longer money costs a touch more APR. */
function termPremium(termMonths: number): number {
  if (termMonths <= 12) return 0;
  if (termMonths <= 36) return 0.4;
  if (termMonths <= 60) return 0.9;
  return 1.4;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function offer(
  lender: Lender,
  apr: number,
  maxAmount: number,
  requestedAmount: number,
  termMonths: number,
  assertions: DisclosureAssertions,
): LenderDecision {
  return {
    decision: "offer",
    offer: {
      lenderId: lender.id,
      lenderName: lender.name,
      apr: round2(apr + termPremium(termMonths)),
      maxAmount: Math.min(maxAmount, requestedAmount),
      termMonths,
      proofRef: proofRefFrom(assertions),
    },
  };
}

/**
 * Aurora Bank — PRIME. Cheapest money, but strict: needs verified employment, a
 * clean record, and a high income band. Declines anyone who doesn't clear the bar.
 */
const aurora: Lender = {
  id: "aurora",
  name: "Aurora Bank",
  tagline: "Prime lender — lowest APR for strong profiles",
  evaluate(a, requestedAmount, termMonths) {
    if (!a.residency_ok) return { decision: "decline", reason: "residency_not_eligible" };
    if (!a.no_default_24mo) return { decision: "decline", reason: "recent_default_on_record" };
    if (!a.employment_verified) return { decision: "decline", reason: "employment_not_verified" };
    if (!a.income_ge_80k) return { decision: "decline", reason: "income_below_prime_threshold" };
    const base = a.income_band === "ge_120k" ? 5.9 : 6.9;
    const cap = a.income_band === "ge_120k" ? 60_000 : 40_000;
    return offer(aurora, base, cap, requestedAmount, termMonths, a);
  },
};

/**
 * Meridian Credit — NEAR-PRIME. More forgiving on income, still wants a clean record.
 */
const meridian: Lender = {
  id: "meridian",
  name: "Meridian Credit",
  tagline: "Near-prime — competitive rates, flexible income",
  evaluate(a, requestedAmount, termMonths) {
    if (!a.residency_ok) return { decision: "decline", reason: "residency_not_eligible" };
    if (!a.no_default_24mo) return { decision: "decline", reason: "recent_default_on_record" };
    let base = 9.4;
    if (a.income_band === "ge_120k") base -= 1.6;
    else if (a.income_band === "80k_120k") base -= 1.0;
    else if (a.income_band === "50k_80k") base -= 0.4;
    if (a.employment_verified) base -= 0.6;
    const cap = a.income_ge_80k ? 35_000 : 25_000;
    return offer(meridian, base, cap, requestedAmount, termMonths, a);
  },
};

/**
 * Northwind Finance — SUBPRINE. Accepts thin/impaired profiles (still residency-gated),
 * prices the risk in. Always quotes someone Aurora/Meridian would turn away.
 */
const northwind: Lender = {
  id: "northwind",
  name: "Northwind Finance",
  tagline: "Specialist — says yes when others say no",
  evaluate(a, requestedAmount, termMonths) {
    if (!a.residency_ok) return { decision: "decline", reason: "residency_not_eligible" };
    let base = 14.9;
    if (a.no_default_24mo) base -= 2.5;
    if (a.employment_verified) base -= 1.5;
    if (a.income_band === "ge_120k") base -= 2.0;
    else if (a.income_band === "80k_120k") base -= 1.2;
    else if (a.income_band === "50k_80k") base -= 0.6;
    const cap = a.no_default_24mo ? 20_000 : 12_000;
    return offer(northwind, base, cap, requestedAmount, termMonths, a);
  },
};

export const LENDERS: readonly Lender[] = [aurora, meridian, northwind];

export function getLender(id: string): Lender | undefined {
  return LENDERS.find((l) => l.id === id);
}
