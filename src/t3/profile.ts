/**
 * Verified financial profile & selective disclosure.
 *
 * THE privacy boundary of Aegis:
 *  - `VerifiedFinancialProfile` is the user's confidential data. It lives behind
 *    the TEE boundary (org-data vault / KYC profile). It is NEVER sent to the
 *    agent, the LLM, or any lender.
 *  - `DisclosureAssertions` are the ONLY things the agent is allowed to learn —
 *    coarse booleans/bands derived from the profile (e.g. "income ≥ 80k": true).
 *    These are what get attached to a lender query. Raw figures stay sealed.
 *
 * In production these assertions are computed INSIDE the TEE contract from vault
 * data (and PII for a final application is injected via {{profile.*}} placeholders
 * at egress). Here we model the same boundary in TS so the agent/LLM code can be
 * built and demoed without ever touching raw PII, regardless of org-data uptime.
 */
import type { T3Session } from "./client";
import {
  ensurePolicy,
  ensureScopeWriter,
  writeVerifiedRecord,
  readVerifiedRecord,
} from "./vault";

export const PROFILE_SCOPE = "banking/profile";
export const PROFILE_KEY = "verified-financials-v1";

/** Confidential — stays behind the TEE boundary. Never leaves to agent/LLM/lender. */
export interface VerifiedFinancialProfile {
  annual_income: number;
  currency: string;
  employment_status: "employed_full_time" | "employed_part_time" | "self_employed" | "unemployed";
  employer_verified: boolean;
  defaults_24mo: number;
  country_of_residence: string;
}

/** The ONLY information the agent/lenders may learn (selective disclosure). */
export interface DisclosureAssertions {
  income_ge_80k: boolean;
  income_band: "lt_50k" | "50k_80k" | "80k_120k" | "ge_120k";
  no_default_24mo: boolean;
  employment_verified: boolean;
  residency_ok: boolean;
}

/** Derive coarse, non-sensitive assertions from the confidential profile. */
export function deriveAssertions(p: VerifiedFinancialProfile): DisclosureAssertions {
  const incomeBand: DisclosureAssertions["income_band"] =
    p.annual_income >= 120_000
      ? "ge_120k"
      : p.annual_income >= 80_000
        ? "80k_120k"
        : p.annual_income >= 50_000
          ? "50k_80k"
          : "lt_50k";
  return {
    income_ge_80k: p.annual_income >= 80_000,
    income_band: incomeBand,
    no_default_24mo: p.defaults_24mo === 0,
    employment_verified:
      p.employer_verified &&
      (p.employment_status === "employed_full_time" ||
        p.employment_status === "employed_part_time"),
    residency_ok: !!p.country_of_residence,
  };
}

/**
 * A seeded demo profile — represents what KYC/onboarding would have verified into
 * the user's vault. Used as the source of truth for the boundary while the testnet
 * org-data write path is unstable (see docs/BUGS.md BUG-CAND-E/F).
 */
export const DEMO_VERIFIED_PROFILE: VerifiedFinancialProfile = {
  annual_income: 92_000,
  currency: "USD",
  employment_status: "employed_full_time",
  employer_verified: true,
  defaults_24mo: 0,
  country_of_residence: "SG",
};

/**
 * Best-effort: persist the verified profile to the T3 vault. Returns whether it
 * landed in the live vault or fell back to local (so callers/UI can be honest).
 */
export async function provisionVerifiedProfile(
  session: T3Session,
  profile: VerifiedFinancialProfile = DEMO_VERIFIED_PROFILE,
): Promise<{ persisted: "vault" | "local"; reason?: string }> {
  try {
    await ensurePolicy(session);
    await ensureScopeWriter(session, PROFILE_SCOPE);
    await writeVerifiedRecord(
      session,
      PROFILE_SCOPE,
      PROFILE_KEY,
      profile as unknown as Record<string, unknown>,
    );
    return { persisted: "vault" };
  } catch (e) {
    return { persisted: "local", reason: (e as Error).message };
  }
}

/**
 * Read the confidential profile from the vault, falling back to the demo profile
 * if the org-data path is unavailable. NOTE: this returns confidential data — only
 * the server/TEE side may call it; never expose its result to the agent/LLM.
 */
export async function loadVerifiedProfile(
  session: T3Session,
): Promise<{ profile: VerifiedFinancialProfile; source: "vault" | "local" }> {
  try {
    const profile = await readVerifiedRecord<VerifiedFinancialProfile>(
      session,
      PROFILE_SCOPE,
      PROFILE_KEY,
    );
    return { profile, source: "vault" };
  } catch {
    return { profile: DEMO_VERIFIED_PROFILE, source: "local" };
  }
}

/**
 * The agent-facing call: returns ONLY disclosure assertions. This is the function
 * the agent/LLM tool layer is allowed to invoke. Raw figures never cross here.
 */
export async function getDisclosureAssertions(
  session: T3Session,
): Promise<DisclosureAssertions> {
  const { profile } = await loadVerifiedProfile(session);
  return deriveAssertions(profile);
}
