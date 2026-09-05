"use client"

import { useState } from "react"
import { PALETTE } from "@/components/palette"

// Honest, one-line-per-sponsor attribution for judging (2-minute demo
// checklist asks to "identify the role of each event technology you used").
// Status text is kept true to the actual current build state, not aspirational —
// see BOARD.tsv for the underlying facts each line summarizes.
const CREDITS: { name: string; role: string; accent: string }[] = [
  {
    name: "World Labs (Marble)",
    role: "generates this world's backdrop — real API splat, merged into the scene, gated behind ?splat=1 pending final calibration",
    accent: PALETTE.cyan,
  },
  {
    name: "Tripo",
    role: "text-to-3D API wired and tested live (auth confirmed) — blocked on 0 credits on this account, so generation isn't live yet",
    accent: PALETTE.maroon,
  },
  {
    name: "mint.gg",
    role: "MCP tooling installed for the asset pipeline — not yet exercised in this build, publish path still mocked",
    accent: PALETTE.silver,
  },
  {
    name: "Convex",
    role: "real backend, running as a dev deployment — session/slider state sync, not a production deployment",
    accent: PALETTE.white,
  },
]

export function SponsorCredits() {
  const [open, setOpen] = useState(false)

  return (
    <div className="pointer-events-auto">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-white/10 bg-black/50 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-white/50 backdrop-blur-md transition-colors hover:text-white/80"
      >
        Powered by {open ? "▾" : "▸"}
      </button>

      {open && (
        <div className="mt-2 w-72 rounded-2xl border border-white/10 bg-black/50 p-4 backdrop-blur-md shadow-2xl">
          <ul className="flex flex-col gap-2.5">
            {CREDITS.map((c) => (
              <li key={c.name} className="flex gap-2 text-xs leading-snug">
                <span
                  className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: c.accent }}
                />
                <span>
                  <span className="font-semibold text-white/85">{c.name}</span>{" "}
                  <span className="text-white/55">{c.role}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
