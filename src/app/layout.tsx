/** Root layout — minimal shell for the Aegis app (chat UI lands in Phase 5). */
import type { ReactNode } from "react";

export const metadata = {
  title: "Aegis — Verifiable Agentic Private Banker",
  description:
    "An AI private banker that shops, negotiates and executes banking actions on your behalf — proving who it is and what you authorized, without leaking your raw financial data.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
