"use client";

/**
 * The last resort, for when the root layout itself fails. It replaces the whole
 * document and gets no global styles, so its styling is inline.
 */
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f6f5f1", color: "#1a1c1a" }}>
        <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>We&apos;re having trouble right now</h1>
          <p style={{ margin: 0, color: "#5f625c" }}>Your accounts and money aren&apos;t affected. Please try again in a moment.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ marginTop: 8, padding: "10px 16px", borderRadius: 8, border: 0, background: "#0f5c4d", color: "#fff", font: "inherit", cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
