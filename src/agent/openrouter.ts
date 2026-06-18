/**
 * OpenRouter → Gemini chat client with tool-calling.
 * Thin wrapper over the OpenAI-compatible /chat/completions endpoint OpenRouter
 * exposes, so we can drive a tool loop without pulling in a heavy framework.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  name?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool_calls?: any[];
}

export interface ChatResult {
  message: ChatMessage;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolCalls: Array<{ id: string; name: string; arguments: any }>;
  finishReason: string;
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export async function chat(opts: {
  messages: ChatMessage[];
  tools?: ToolDef[];
  model?: string;
  temperature?: number;
}): Promise<ChatResult> {
  const primary = opts.model ?? env("OPENROUTER_MODEL", "google/gemini-2.5-pro");
  const fallback = process.env.OPENROUTER_MODEL_FALLBACK;

  const body = {
    model: primary,
    messages: opts.messages,
    tools: opts.tools,
    tool_choice: opts.tools?.length ? "auto" : undefined,
    temperature: opts.temperature ?? 0.2,
  };

  let res = await post(body);
  if (!res.ok && fallback) {
    // Single retry on the cheaper/faster model if the primary errors.
    res = await post({ ...body, model: fallback });
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const choice = json.choices?.[0];
  const message: ChatMessage = choice?.message ?? { role: "assistant", content: "" };
  const toolCalls = (message.tool_calls ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tc: any) => ({
      id: tc.id,
      name: tc.function?.name,
      arguments: safeParse(tc.function?.arguments),
    }),
  );

  return { message, toolCalls, finishReason: choice?.finish_reason ?? "stop" };
}

async function post(body: unknown): Promise<Response> {
  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("OPENROUTER_API_KEY")}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://aegis.local",
      "X-Title": "Aegis - T3 Agentic Banker",
    },
    body: JSON.stringify(body),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeParse(s: unknown): any {
  if (typeof s !== "string") return s ?? {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
