/**
 * The server→browser event contract. Client-SAFE: this module has NO runtime
 * imports (no SDK, no node) so the React client can `import type` from it without
 * dragging server code into the bundle. The server emits structurally-compatible
 * objects; the client renders them.
 */

/** A single tool call in the agent's run — powers the live audit/activity panel. */
export interface TraceEntry {
  step: number;
  tool: string;
  args: unknown;
  result: unknown;
  ok: boolean;
  tsMs: number;
}

export interface ConsentReq {
  purpose: string;
  maxLoanAmount: number;
  maxLenders: number;
  functions: string[];
  validHours: number;
}

export interface StepUpReq {
  lenderId: string;
  lenderName?: string;
  amount: number;
  termMonths: number;
  apr?: number;
}

export interface ApprovalEnvelope {
  id: string;
  kind: "consent" | "step_up";
  request: ConsentReq | StepUpReq;
}

export type ServerEvent =
  | { type: "ready" }
  | { type: "assistant"; text: string }
  | { type: "tool"; entry: TraceEntry }
  | { type: "approval_required"; approval: ApprovalEnvelope }
  | { type: "approval_resolved"; approvalId: string; approved: boolean }
  | { type: "consent"; status: "granted" | "revoked"; detail?: unknown }
  | { type: "turn_done"; finalText: string }
  | { type: "error"; message: string };
