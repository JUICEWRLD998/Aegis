import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const alt = "Aegis — Verifiable Agentic Private Banker";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const logo = await readFile(join(process.cwd(), "public", "aegis.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          background:
            "radial-gradient(900px 600px at 50% 20%, #15233f 0%, #090d15 60%)",
          color: "#eef2fa",
          fontFamily: "sans-serif",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoSrc}
          width={200}
          height={200}
          alt="Aegis"
          style={{ objectFit: "contain" }}
        />
        <div style={{ display: "flex", fontSize: 84, fontWeight: 700, letterSpacing: -2 }}>
          Aegis
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#a3afcb" }}>
          Verifiable Agentic Private Banker
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 18,
            fontSize: 20,
            color: "#5b8cff",
            letterSpacing: 1,
          }}
        >
          Built on Terminal 3 Agent Auth
        </div>
      </div>
    ),
    { ...size },
  );
}
