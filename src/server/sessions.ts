/**
 * In-memory session store + the bridge that makes the agent's human-in-the-loop
 * seam work over HTTP.
 *
 * The agent runtime (runAgent) calls `Approver.requestConsent` / `requestStepUp`
 * mid-loop and awaits a decision. In the browser, that decision comes from a modal.
 * `DeferredApprover` turns each request into (a) an `approval_required` event pushed
 * to the session's SSE stream and (b) a Promise the loop blocks on — resolved later
 * when the client POSTs its decision to /api/session/:id/approve.
 *
 * State lives in a module-level Map (one server process). This is demo/dev-grade —
 * fine for the hero flow; a real deployment would back it with a store + auth.
 */
import {
  createAgentContext,
  type AgentContext,
  type Approver,
  type ConsentRequest,
  type StepUpRequest,
  type ApprovalDecision,
} from "../agent/context";
import { runAgent } from "../agent/runtime";
import { revokeGrant, type BankingFunction } from "../t3/delegation";
import type { ChatMessage } from "../agent/openrouter";
import type { ServerEvent } from "./events";

interface Session {
  id: string;
  ctx: AgentContext;
  events: ServerEvent[];
  subscribers: Set<(e: ServerEvent) => void>;
  pending?: { id: string; resolve: (d: ApprovalDecision) => void };
  history: ChatMessage[];
  busy: boolean;
}

const sessions = new Map<string, Session>();

function emit(s: Session, e: ServerEvent): void {
  s.events.push(e);
  for (const sub of s.subscribers) {
    try {
      sub(e);
    } catch {
      /* a dead subscriber must not break the loop */
    }
  }
}

class DeferredApprover implements Approver {
  constructor(private getSession: () => Session | undefined) {}

  private defer(kind: "consent" | "step_up", request: unknown): Promise<ApprovalDecision> {
    const s = this.getSession();
    if (!s) return Promise.resolve({ approved: false, reason: "session_gone" });
    return new Promise<ApprovalDecision>((resolve) => {
      const id = crypto.randomUUID();
      s.pending = { id, resolve };
      emit(s, {
        type: "approval_required",
        approval: { id, kind, request: request as never },
      });
    });
  }

  requestConsent(req: ConsentRequest): Promise<ApprovalDecision> {
    return this.defer("consent", req);
  }
  requestStepUp(req: StepUpRequest): Promise<ApprovalDecision> {
    return this.defer("step_up", req);
  }
}

/** Create a session (opens the authenticated T3 context — may take a few seconds). */
export async function createSession(): Promise<string> {
  const id = crypto.randomUUID();
  let ref: Session | undefined;
  const approver = new DeferredApprover(() => ref);
  const ctx = await createAgentContext({ approver });
  ref = { id, ctx, events: [], subscribers: new Set(), history: [], busy: false };
  sessions.set(id, ref);
  emit(ref, { type: "ready" });
  return id;
}

export function hasSession(id: string): boolean {
  return sessions.has(id);
}

/** Subscribe to a session's event stream; replays the backlog so late SSE
 *  connections never miss events. Returns an unsubscribe fn. */
export function subscribe(id: string, cb: (e: ServerEvent) => void): () => void {
  const s = sessions.get(id);
  if (!s) throw new Error("unknown session");
  for (const e of s.events) cb(e);
  s.subscribers.add(cb);
  return () => {
    s.subscribers.delete(cb);
  };
}

/** Kick off one agent turn (detached). Events stream as the loop runs. */
export function sendMessage(id: string, message: string): void {
  const s = sessions.get(id);
  if (!s) throw new Error("unknown session");
  if (s.busy) return;
  s.busy = true;

  runAgent(s.ctx, message, {
    history: s.history,
    onAssistant: (text) => emit(s, { type: "assistant", text }),
    onTrace: (entry) => {
      emit(s, { type: "tool", entry });
      if (entry.tool === "request_consent" && entry.ok) {
        const r = entry.result as { status?: string };
        if (r?.status === "granted") emit(s, { type: "consent", status: "granted", detail: entry.result });
      }
    },
  })
    .then((res) => {
      s.history = res.messages.slice(1); // drop the system prompt; keep the dialogue
      emit(s, { type: "turn_done", finalText: res.finalText });
    })
    .catch((e) => emit(s, { type: "error", message: (e as Error).message }))
    .finally(() => {
      s.busy = false;
    });
}

/** Resolve a pending consent/step-up approval from the client. */
export function resolveApproval(
  id: string,
  approvalId: string,
  approved: boolean,
  reason?: string,
): boolean {
  const s = sessions.get(id);
  if (!s?.pending || s.pending.id !== approvalId) return false;
  const p = s.pending;
  s.pending = undefined;
  p.resolve({ approved, reason });
  emit(s, { type: "approval_resolved", approvalId, approved });
  return true;
}

/**
 * Revoke the agent's authority — the live kill-switch demo beat. Marks the local
 * grant revoked IMMEDIATELY (so the next tool call is denied without waiting on the
 * network), then best-effort revokes on-chain. Pass `functions` for per-function
 * revocation (e.g. kill acceptance but keep querying alive).
 */
export async function revoke(
  id: string,
  functions?: BankingFunction[],
): Promise<{ revoked: boolean; reason?: string; live?: unknown }> {
  const s = sessions.get(id);
  if (!s) throw new Error("unknown session");
  const c = s.ctx.consent;
  if (!c) return { revoked: false, reason: "no_active_consent" };

  if (functions && functions.length) {
    c.revokedFunctions = Array.from(new Set([...c.revokedFunctions, ...functions]));
  } else {
    c.revoked = true;
  }

  let live: unknown;
  try {
    live = await revokeGrant(s.ctx.session, c.grant, functions);
  } catch (e) {
    live = { error: (e as Error).message }; // local revoke already took effect
  }
  emit(s, { type: "consent", status: "revoked", detail: { functions: functions ?? "all", live } });
  return { revoked: true, live };
}
