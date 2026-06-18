/**
 * The privacy guardrail — the enforcement point for Aegis's defining invariant:
 *
 *   The LLM context NEVER contains raw PII. Only coarse disclosure assertions
 *   (booleans/bands), opaque proof handles, and non-sensitive references.
 *
 * The tool handlers in tools.ts are written to only ever return safe shapes, but
 * the guardrail is the defense-in-depth backstop: every value about to be appended
 * to the model conversation is passed through `assertNoPii` first. If a confidential
 * profile field ever leaks into a tool output (a future bug, an SDK shape change),
 * the loop throws here rather than silently feeding PII to the model or a lender.
 *
 * We match on KEY NAMES from the confidential schema (see profile.ts
 * VerifiedFinancialProfile), not values — banded values like "80k_120k" are
 * intentionally allowed; a key literally named `annual_income` is not.
 */

/** Confidential keys that must never appear in anything the LLM/lenders can see. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "annual_income",
  "employment_status",
  "employer_verified",
  "defaults_24mo",
  "country_of_residence",
  "currency",
  "first_name",
  "last_name",
  "date_of_birth",
  "dob",
  "email",
  "phone",
  "ssn",
  "national_id",
  "payslip",
  "address",
]);

export class PiiLeakError extends Error {
  constructor(
    public readonly label: string,
    public readonly path: string,
    public readonly key: string,
  ) {
    super(
      `PII guardrail tripped: tool output "${label}" exposed forbidden key ` +
        `"${key}" at ${path}. Raw profile data must never enter LLM context.`,
    );
    this.name = "PiiLeakError";
  }
}

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

/**
 * Recursively assert a value carries no confidential profile keys. Throws
 * PiiLeakError on the first violation. Call this on every tool result before it
 * is serialised into the conversation.
 */
export function assertNoPii(label: string, value: unknown, path = "$"): void {
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoPii(label, v, `${path}[${i}]`));
    return;
  }

  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(normalizeKey(key))) {
      throw new PiiLeakError(label, `${path}.${key}`, key);
    }
    assertNoPii(label, v, `${path}.${key}`);
  }
}
