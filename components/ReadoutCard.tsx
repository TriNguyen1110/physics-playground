"use client"

import type { ScenarioState } from "@/lib/physics/types"

/** Museum-placard style readout — never a raw <pre>/JSON dump. */
export function ReadoutCard({
  title,
  readouts,
  accent,
}: {
  title: string
  readouts: ScenarioState["readouts"]
  accent: string
}) {
  return (
    <div className="pointer-events-auto w-64 rounded-2xl border border-white/10 bg-black/50 p-5 backdrop-blur-md shadow-2xl">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/50">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
        {title}
      </h2>
      <dl className="flex flex-col gap-2">
        {readouts.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-white/55">{r.label}</dt>
            <dd className="font-mono tabular-nums text-white/95">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
