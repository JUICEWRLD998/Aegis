/** Root layout — shell for the Aegis app. */
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const DESCRIPTION =
  "An AI private banker that shops, negotiates and executes banking actions on your behalf — proving who it is and what you authorized, without leaking your raw financial data.";

export const metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "Aegis — Verifiable Agentic Private Banker",
  description: DESCRIPTION,
  openGraph: {
    title: "Aegis — Verifiable Agentic Private Banker",
    description: DESCRIPTION,
    siteName: "Aegis",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Aegis — Verifiable Agentic Private Banker",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
