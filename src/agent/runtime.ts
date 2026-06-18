/**
 * The agent runtime — the Gemini tool-loop that turns a natural-language request
 * ("get me the best loan") into a sequence of SDK-backed actions.
 *
 * Loop: send the conversation + tool defs to the model → if it asks for tool calls,
 * run each through `runTool`, pass the result through the PII guardrail, append it,
 * and iterate → stop when the model returns a final answer (or we hit the step cap).
 *
 * The guardrail (assertNoPii) sits on EVERY tool result before it re-enters the
 * conversation: the model literally cannot receive raw PII, by construction.
 */
import { chat, type ChatMessage } from "./openrouter";
import { TOOL_DEFS, runTool } from "./tools";
import { assertNoPii } from "./guardrail";
import type { AgentContext, AgentTraceEntry } from "./context";

const SYSTEM_PROMPT = `You are Aegis, a verifiable agentic private banker acting on a user's behalf.

You act under cryptographically-scoped authority and you protect the user's privacy by construction. Follow this discipline:

1. ALWAYS obtain consent first via request_consent before contacting any lender. Choose a sensible max loan amount and lender count from the user's request.
2. The user's raw financial data is sealed in a hardware TEE. You NEVER see it. You only ever work with coarse disclosure assertions (income bands, no-default flags) produced by make_disclosure_proof. Never ask the user for income figures, account numbers, or documents — you don't need them.
3. read_verified_profile only confirms the data is sealed; make_disclosure_proof derives the shareable assertions. Do both before querying lenders.
4. query_lenders sends only the proof + your agent identity to lenders — never PII. Then compare_offers to rank them.
5. Before accepting an offer (an irreversible, high-value action), you MUST get human approval via request_step_up, then call execute_acceptance with the SAME lender and amount.
6. Finish by reading get_audit_log and giving the user a short, plain-language summary: which offer you recommend/accepted, the APR, and a note that lenders only ever saw verifiable proofs — never their personal data.

If a tool returns an { error } object, read it, adapt, and recover — do not loop blindly. Be concise and act decisively.`;

export interface RunAgentOptions {
  /** Prior conversation turns (excluding the system prompt), if continuing a chat. */
  history?: ChatMessage[];
  maxSteps?: number;
  model?: string;
  /** Telemetry hook — fires after each tool call (powers the live UI activity panel). */
  onTrace?: (entry: AgentTraceEntry) => void;
  /** Fires with the model's assistant text on each turn (for streaming-ish UIs). */
  onAssistant?: (text: string) => void;
}

export interface RunAgentResult {
  finalText: string;
  messages: ChatMessage[];
  trace: AgentTraceEntry[];
  stopReason: "completed" | "max_steps";
}

/**
 * Drive the tool-loop for a single user request. Mutates `ctx` (consent, step-up,
 * offers, trace accumulate across turns) so a multi-turn chat can reuse one context.
 */
export async function runAgent(
  ctx: AgentContext,
  userInput: string,
  opts: RunAgentOptions = {},
): Promise<RunAgentResult> {
  const maxSteps = opts.maxSteps ?? 16;
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(opts.history ?? []),
    { role: "user", content: userInput },
  ];

  let finalText = "";
  let stopReason: RunAgentResult["stopReason"] = "max_steps";

  for (let step = 0; step < maxSteps; step++) {
    const res = await chat({ messages, tools: TOOL_DEFS, model: opts.model });
    messages.push(res.message);

    if (typeof res.message.content === "string" && res.message.content.trim()) {
      opts.onAssistant?.(res.message.content);
    }

    if (res.toolCalls.length === 0) {
      finalText = (res.message.content ?? "").trim();
      stopReason = "completed";
      break;
    }

    for (const tc of res.toolCalls) {
      const result = await runTool(ctx, tc.name, tc.arguments ?? {});

      // The privacy backstop: nothing carrying raw PII may re-enter the conversation.
      assertNoPii(tc.name, result);

      const ok = !(typeof result === "object" && result !== null && "error" in result);
      const entry: AgentTraceEntry = {
        step,
        tool: tc.name,
        args: tc.arguments,
        result,
        ok,
        tsMs: Date.now(),
      };
      ctx.trace.push(entry);
      opts.onTrace?.(entry);

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.name,
        content: JSON.stringify(result),
      });
    }
  }

  return { finalText, messages, trace: ctx.trace, stopReason };
}
