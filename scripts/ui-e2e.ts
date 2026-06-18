/**
 * Phase 5 headless E2E — drives the browser server stack without a browser.
 * Requires the dev server running (`npm run dev`).
 *
 *   node --import tsx scripts/ui-e2e.ts
 *
 * Creates a session, streams SSE, auto-approves consent + step-up (as a human would
 * click), runs the loan flow to completion, then exercises the live revoke kill-switch.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

interface AnyEvent { type: string; [k: string]: unknown }

async function main() {
  console.log("creating session…");
  const s = await fetch(`${BASE}/api/session`, { method: "POST" }).then((r) => r.json());
  const sessionId: string = s.sessionId;
  if (!sessionId) throw new Error("no sessionId: " + JSON.stringify(s));
  console.log("session:", sessionId);

  const tools: string[] = [];
  let consentGranted = false;
  let consentRevoked = false;
  let approvals = 0;
  let finalText = "";
  let assistantText = "";
  let turnDone = false;

  const handle = async (e: AnyEvent) => {
    switch (e.type) {
      case "ready": console.log("• ready"); break;
      case "assistant": assistantText += String(e.text ?? ""); break;
      case "tool": {
        const entry = e.entry as { tool: string; ok: boolean };
        tools.push(entry.tool);
        console.log(`• tool ${entry.tool} ${entry.ok ? "✓" : "✕"}`);
        break;
      }
      case "approval_required": {
        const a = e.approval as { id: string; kind: string };
        approvals++;
        console.log(`• approval_required (${a.kind}) → approving`);
        await fetch(`${BASE}/api/session/${sessionId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvalId: a.id, approved: true }),
        });
        break;
      }
      case "consent":
        if (e.status === "granted") consentGranted = true;
        if (e.status === "revoked") consentRevoked = true;
        console.log(`• consent ${e.status}`);
        break;
      case "turn_done":
        finalText = String(e.finalText ?? "");
        turnDone = true;
        break;
      case "error":
        console.log("• error:", e.message);
        turnDone = true;
        break;
    }
  };

  // stream SSE in the background
  const es = (async () => {
    const res = await fetch(`${BASE}/api/session/${sessionId}/events`);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (line) await handle(JSON.parse(line.slice(6)) as AnyEvent);
      }
    }
  })();

  // small delay so SSE attaches, then start the turn
  await new Promise((r) => setTimeout(r, 500));
  console.log('\nuser: "Get me the best personal loan, up to $20,000 over 36 months."\n');
  await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message: "Get me the best personal loan, up to $20,000 over 36 months." }),
  });

  // wait for completion (max 120s)
  const start = Date.now();
  while (!turnDone && Date.now() - start < 120_000) await new Promise((r) => setTimeout(r, 300));

  console.log("\n── turn result ──");
  console.log("tools:", tools.join(" → "));
  console.log("approvals handled:", approvals);
  console.log("consent granted:", consentGranted);
  console.log("assistant:", (finalText || assistantText).slice(0, 220));

  // exercise the live revoke kill-switch
  console.log("\n── revoke kill-switch ──");
  const rev = await fetch(`${BASE}/api/session/${sessionId}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }).then((r) => r.json());
  await new Promise((r) => setTimeout(r, 500));
  console.log("revoke result:", JSON.stringify(rev));

  // checks
  const checks: [string, boolean][] = [
    ["consent granted via modal", consentGranted],
    ["both approvals (consent + step-up) handled", approvals >= 2],
    ["queried lenders", tools.includes("query_lenders")],
    ["executed acceptance", tools.includes("execute_acceptance")],
    ["produced an answer", finalText.length > 0 || assistantText.length > 0],
    ["revoke succeeded", rev.revoked === true || consentRevoked],
  ];
  let failed = 0;
  console.log("\n── checks ──");
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "✓" : "✗"} ${name}`);
    if (!ok) failed++;
  }

  void es; // background stream; process exits below
  if (failed) {
    console.log(`\n❌ ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✅ Phase 5 server stack verified end-to-end.");
  process.exit(0);
}

main().catch((e) => {
  console.error("e2e failed:", e);
  process.exit(1);
});
