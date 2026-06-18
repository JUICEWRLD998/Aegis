/** Placeholder home page. The chat UI, consent screen, step-up modal, audit panel
 *  and "Revoke authority" control are built in Phase 5. The lender API routes under
 *  /api/lenders/:lender/{quote,accept} are live now (Phase 4). */
export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 720 }}>
      <h1>Aegis</h1>
      <p>The verifiable agentic private banker.</p>
      <p style={{ color: "#666" }}>
        Phase 4: mock lenders verify an authorized agent + a selective-disclosure proof
        and receive zero PII. The chat experience arrives in Phase 5.
      </p>
      <ul style={{ color: "#666" }}>
        <li><code>POST /api/lenders/aurora/quote</code></li>
        <li><code>POST /api/lenders/meridian/quote</code></li>
        <li><code>POST /api/lenders/northwind/quote</code></li>
      </ul>
    </main>
  );
}
