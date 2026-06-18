/**
 * Audit trail — the compliance story made real. `getAuditEvents` returns
 * host-stamped events the agent/user performed, each carrying:
 *   actor    — who acted (agent DID on a delegated call, user on a self-call)
 *   subject  — whose data was touched (host-stamped pii_did)
 *   vc_id    — the delegation credential the action ran under (null = self-call)
 *   action / target / outcome — what happened, on what, with what result
 *   committed (batch-level) — whether the dispatch durably committed
 *
 * This is "who / under whose authority / what / when" with cryptographic
 * provenance — exactly what we surface in the UI audit panel.
 */
import type { T3Session } from "./client";

export interface AuditEvent {
  tsMs: number;
  subject: string;
  actor: string;
  vcId: string | null;
  action: string;
  target: string;
  outcome: string;
  details: string | null;
  committed: boolean;
}

/**
 * Read the audit trail. Omit `subjectDid` to read your own trail; as a delegated
 * agent, pass the user's DID to read the events you performed for them — admitted
 * only while that user's grant to you is live (revoke → this stops returning).
 */
export async function getAuditTrail(
  session: T3Session,
  opts: { subjectDid?: string; limit?: number; cursor?: string } = {},
): Promise<{ events: AuditEvent[]; nextCursor: string | null }> {
  const page = await session.client.getAuditEvents({
    pii_did: opts.subjectDid,
    limit: opts.limit ?? 50,
    cursor: opts.cursor,
  });

  const events: AuditEvent[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const batch of (page?.batches ?? []) as any[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const e of (batch.events ?? []) as any[]) {
      events.push({
        tsMs: e.ts_ms,
        subject: e.subject,
        actor: e.actor,
        vcId: e.vc_id ?? null,
        action: e.action,
        target: e.target,
        outcome: e.outcome,
        details: e.details ?? null,
        committed: batch.committed ?? false,
      });
    }
  }

  return { events, nextCursor: page?.next_cursor ?? null };
}
