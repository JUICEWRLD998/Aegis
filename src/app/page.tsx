"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ServerEvent,
  ApprovalEnvelope,
  ConsentReq,
  StepUpReq,
  TraceEntry,
} from "@/server/events";

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
}
interface ConsentState {
  status: "granted" | "revoked";
  detail?: Record<string, unknown>;
}

const SUGGESTIONS = [
  "Get me the best personal loan, up to $20,000 over 36 months.",
  "Find me a $10k loan over 24 months and accept the cheapest.",
  "Find me a personal loan of $15,000 over 48 months and show me the options.",
];

const TOOL_LABELS: Record<string, string> = {
  request_consent: "Requested scoped consent",
  read_verified_profile: "Read verified profile (sealed)",
  make_disclosure_proof: "Generated disclosure proof",
  query_lenders: "Queried lenders",
  compare_offers: "Compared offers",
  request_step_up: "Requested step-up approval",
  execute_acceptance: "Submitted application",
  get_audit_log: "Read audit trail",
};

function money(n: unknown): string {
  return typeof n === "number" ? `$${n.toLocaleString()}` : String(n ?? "");
}

function summarize(entry: TraceEntry): { detail: string; badges: { label: string; good: boolean }[] } {
  const r = (entry.result ?? {}) as Record<string, unknown>;
  const badges: { label: string; good: boolean }[] = [];
  let detail = "";
  switch (entry.tool) {
    case "request_consent":
      detail = r.status === "granted" ? `scoped grant • ≤${money(r.max_loan_amount)} • ${r.max_lenders} lenders` : String(r.status ?? "");
      break;
    case "make_disclosure_proof":
      detail = String(r.proof_ref ?? "");
      break;
    case "read_verified_profile":
      detail = `sealed in TEE (source: ${r.source})`;
      break;
    case "query_lenders": {
      const offers = (r.offers as unknown[] | undefined)?.length ?? 0;
      detail = `${offers} offer(s)${r.source ? ` via ${r.source}` : ""}`;
      const results = (r.results as { verified?: { agent_authorized?: boolean; no_pii?: boolean } }[] | undefined) ?? [];
      if (results.length) {
        badges.push({ label: "agent identity verified", good: results.every((x) => x.verified?.agent_authorized) });
        badges.push({ label: "no PII sent to lenders", good: results.every((x) => x.verified?.no_pii) });
      }
      break;
    }
    case "compare_offers":
      detail = r.recommended_lender_id ? `recommends ${r.recommended_lender_id}` : "";
      break;
    case "request_step_up":
      detail = r.approved ? "approved by human" : `denied (${r.reason ?? ""})`;
      break;
    case "execute_acceptance": {
      detail = r.status ? `${r.status}${r.reference_id ? ` • ${r.reference_id}` : ""}` : "";
      const v = r.verified as { agent_authorized?: boolean; no_pii?: boolean } | undefined;
      if (v) {
        badges.push({ label: "agent identity verified", good: !!v.agent_authorized });
        badges.push({ label: "no PII", good: !!v.no_pii });
      }
      break;
    }
    case "get_audit_log":
      detail = `${r.count ?? 0} event(s)`;
      break;
  }
  if (r.error) detail = `error: ${r.error}`;
  return { detail, badges };
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [pending, setPending] = useState<ApprovalEnvelope | null>(null);
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const createdRef = useRef(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const msgRef = useRef<HTMLDivElement>(null);

  // create the session once
  useEffect(() => {
    if (createdRef.current) return;
    createdRef.current = true;
    fetch("/api/session", { method: "POST" })
      .then((r) => r.json())
      .then((d) => setSessionId(d.sessionId))
      .catch(() => {});
  }, []);

  // subscribe to the event stream
  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/session/${sessionId}/events`);
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data) as ServerEvent;
      switch (e.type) {
        case "ready":
          setReady(true);
          break;
        case "assistant":
          setMessages((m) => [...m, { role: "assistant", text: e.text }]);
          break;
        case "tool":
          setTraces((t) => [...t, e.entry]);
          break;
        case "approval_required":
          setPending(e.approval);
          break;
        case "approval_resolved":
          setPending((p) => (p && p.id === e.approvalId ? null : p));
          break;
        case "consent":
          setConsent({ status: e.status, detail: e.detail as Record<string, unknown> });
          break;
        case "turn_done":
          setBusy(false);
          break;
        case "error":
          setBusy(false);
          setMessages((m) => [...m, { role: "assistant", text: `⚠️ ${e.message}` }]);
          break;
      }
    };
    es.onerror = () => {};
    return () => es.close();
  }, [sessionId]);

  useEffect(() => { msgRef.current?.scrollTo(0, msgRef.current.scrollHeight); }, [messages, busy]);
  useEffect(() => { feedRef.current?.scrollTo(0, feedRef.current.scrollHeight); }, [traces]);

  const send = useCallback(
    (text: string) => {
      if (!sessionId || !text.trim() || busy) return;
      setMessages((m) => [...m, { role: "user", text }]);
      setBusy(true);
      setInput("");
      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
      }).catch(() => setBusy(false));
    },
    [sessionId, busy],
  );

  const decide = useCallback(
    (approved: boolean) => {
      if (!sessionId || !pending) return;
      const approvalId = pending.id;
      setPending(null);
      fetch(`/api/session/${sessionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, approved }),
      }).catch(() => {});
    },
    [sessionId, pending],
  );

  const revoke = useCallback(
    (functions?: string[]) => {
      if (!sessionId) return;
      fetch(`/api/session/${sessionId}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ functions }),
      }).catch(() => {});
    },
    [sessionId],
  );

  const consentLive = consent?.status === "granted";
  const d = (consent?.detail ?? {}) as Record<string, unknown>;
  const revokedFns = Array.isArray(d.revoked_functions) ? (d.revoked_functions as string[]) : [];
  const acceptanceRevoked = revokedFns.includes("submit-application");

  return (
    <div className="app">
      {/* ── chat column ─────────────────────────────── */}
      <div className="panel">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo" src="/aegis.png" alt="Aegis" width={36} height={36} />
          <div>
            <h1>Aegis</h1>
            <p>Verifiable agentic private banker</p>
          </div>
          <div className="status-dot">
            <span className={`dot ${ready ? "on" : ""}`} />
            {ready ? "connected" : "connecting…"}
          </div>
        </div>

        <div className="messages" ref={msgRef}>
          {messages.length === 0 && (
            <div className="empty">
              <h2>Tell your banker what you need.</h2>
              <p>It will request scoped consent, prove your standing without revealing it, shop verifying lenders, and act under your approval.</p>
              <div className="chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chip" onClick={() => send(s)} disabled={!ready}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="role">{m.role === "user" ? "You" : "Aegis"}</div>
              {m.text}
            </div>
          ))}
          {busy && (
            <div className="msg assistant">
              <div className="role">Aegis</div>
              <div className="typing"><span /><span /><span /></div>
            </div>
          )}
        </div>

        <form
          className="composer"
          onSubmit={(e) => { e.preventDefault(); send(input); }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={ready ? "Ask Aegis to find or accept a loan…" : "Connecting to Terminal 3…"}
            disabled={!ready || busy}
          />
          <button className="send" type="submit" disabled={!ready || busy || !input.trim()}>Send</button>
        </form>
      </div>

      {/* ── authority + audit column ────────────────── */}
      <div className="side">
        <div className="panel">
          <div className="sec-head"><h3>Authority</h3></div>
          <div className="authority">
            <span className={`badge ${consent?.status ?? "none"}`}>
              {consent?.status === "granted"
                ? acceptanceRevoked ? "● Active — querying only" : "● Active delegation"
                : consent?.status === "revoked" ? "● Revoked" : "○ No authority granted"}
            </span>
            {consentLive && (
              <>
                <div className="kv"><span className="k">Loan cap</span><span className="v">{money(d.max_loan_amount)}</span></div>
                <div className="kv"><span className="k">Lenders</span><span className="v">≤ {String(d.max_lenders ?? "—")}</span></div>
                <div className="kv"><span className="k">Functions</span><span className="v mono">{Array.isArray(d.functions) ? (d.functions as string[]).join(", ") : "—"}</span></div>
                {revokedFns.length > 0 && (
                  <div className="kv"><span className="k">Revoked</span><span className="v mono revoked-fn">{revokedFns.join(", ")}</span></div>
                )}
                <div className="kv"><span className="k">Consent id</span><span className="v mono">{String(d.consent_id ?? "").slice(0, 12)}…</span></div>
                <div className="revoke-row">
                  <button className="revoke" onClick={() => revoke()}>Revoke authority</button>
                  {!acceptanceRevoked && (
                    <button className="revoke ghost" onClick={() => revoke(["submit-application"])}>Revoke acceptance only</button>
                  )}
                </div>
              </>
            )}
            {!consent && <p className="note" style={{ color: "var(--text-faint)", fontSize: 13, margin: 0 }}>The agent holds no authority until you grant a scoped, time-boxed consent.</p>}
          </div>
        </div>

        <div className="panel audit">
          <div className="sec-head"><h3>Live audit trail</h3></div>
          <div className="feed" ref={feedRef}>
            {traces.length === 0 && <div className="empty-sm">No activity yet. Every agent action appears here — who acted, under whose authority, and what was verified.</div>}
            {traces.map((t, i) => {
              const { detail, badges } = summarize(t);
              return (
                <div className="event" key={i}>
                  <div className="top">
                    <span className="tool">{TOOL_LABELS[t.tool] ?? t.tool}</span>
                    <span className={`tick ${t.ok ? "ok" : "err"}`}>{t.ok ? "✓" : "✕"}</span>
                  </div>
                  {detail && <div className="detail mono">{detail}</div>}
                  {badges.length > 0 && (
                    <div className="vbadges">
                      {badges.map((b, j) => (
                        <span key={j} className={`vbadge ${b.good ? "good" : "bad"}`}>{b.good ? "✓ " : "✕ "}{b.label}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── connecting loader ───────────────────────── */}
      {!ready && (
        <div className="boot" aria-busy="true" aria-label="Connecting">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="boot-logo" src="/aegis.png" alt="Aegis" width={72} height={72} />
          <div className="boot-label">Connecting to Terminal 3…</div>
        </div>
      )}

      {/* ── approval modals ─────────────────────────── */}
      {pending?.kind === "consent" && <ConsentModal req={pending.request as ConsentReq} onDecide={decide} />}
      {pending?.kind === "step_up" && <StepUpModal req={pending.request as StepUpReq} onDecide={decide} />}
    </div>
  );
}

function ConsentModal({ req, onDecide }: { req: ConsentReq; onDecide: (a: boolean) => void }) {
  return (
    <div className="overlay">
      <div className="modal">
        <div className="head">
          <div className="eyebrow">Consent required</div>
          <h2>Authorize your agent</h2>
        </div>
        <div className="body">
          <p className="note">Aegis is requesting a scoped, time-boxed, revocable delegation. It only gets exactly this — nothing more.</p>
          <div className="grant">
            <div className="kv"><span className="k">Purpose</span><span className="v">{req.purpose}</span></div>
            <div className="kv"><span className="k">Loan cap</span><span className="v">{money(req.maxLoanAmount)}</span></div>
            <div className="kv"><span className="k">Max lenders</span><span className="v">{req.maxLenders}</span></div>
            <div className="kv"><span className="k">Valid for</span><span className="v">{req.validHours} hours</span></div>
            <div className="kv"><span className="k">Functions</span></div>
            <div className="pill-row">{req.functions.map((f) => <span key={f} className="pill">{f}</span>)}</div>
          </div>
        </div>
        <div className="actions">
          <button className="btn-ghost" onClick={() => onDecide(false)}>Decline</button>
          <button className="btn-primary" onClick={() => onDecide(true)}>Grant consent</button>
        </div>
      </div>
    </div>
  );
}

function StepUpModal({ req, onDecide }: { req: StepUpReq; onDecide: (a: boolean) => void }) {
  return (
    <div className="overlay">
      <div className="modal">
        <div className="head">
          <div className="eyebrow">Step-up approval</div>
          <h2>Approve this transaction</h2>
        </div>
        <div className="body">
          <p className="note">The agent shops and negotiates. You commit. This irreversible action needs your explicit approval.</p>
          <div className="grant">
            <div className="big-amount">{money(req.amount)}</div>
            <div className="kv"><span className="k">Lender</span><span className="v">{req.lenderName ?? req.lenderId}</span></div>
            <div className="kv"><span className="k">Term</span><span className="v">{req.termMonths} months</span></div>
            {typeof req.apr === "number" && <div className="kv"><span className="k">APR</span><span className="v">{req.apr}%</span></div>}
          </div>
        </div>
        <div className="actions">
          <button className="btn-ghost" onClick={() => onDecide(false)}>Reject</button>
          <button className="btn-primary" onClick={() => onDecide(true)}>Approve &amp; submit</button>
        </div>
      </div>
    </div>
  );
}
