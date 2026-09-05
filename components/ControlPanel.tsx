"use client"

import type { MutableRefObject } from "react"
import { MODULE_META, type ModuleId } from "@/components/modules/types"

/**
 * Sliders are uncontrolled inputs. `onChange` writes straight into the
 * shared params ref — no `setState`, so there is zero React round-trip
 * between dragging a slider and the next `useFrame` picking up the new
 * value. This is what keeps canvas response instant.
 */
export function ControlPanel({
  module,
  paramsRef,
  accent,
}: {
  module: ModuleId
  paramsRef: MutableRefObject<Record<string, number>>
  accent: string
}) {
  const sliders = MODULE_META[module].sliders

  return (
    <div className="pointer-events-auto flex w-72 flex-col gap-4 rounded-2xl border border-white/10 bg-black/50 p-5 backdrop-blur-md shadow-2xl">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50">Controls</h2>
      {sliders.map((s) => (
        <label key={s.key} className="flex flex-col gap-1.5 text-sm text-white/85">
          <span className="flex items-center justify-between font-medium">
            <span>{s.label}</span>
            <SliderValue paramsRef={paramsRef} sliderKey={s.key} unit={s.unit} />
          </span>
          <input
            type="range"
            defaultValue={paramsRef.current[s.key]}
            min={s.min}
            max={s.max}
            step={s.step}
            onChange={(e) => {
              paramsRef.current[s.key] = parseFloat(e.target.value)
              const out = e.currentTarget.parentElement?.querySelector<HTMLSpanElement>(
                `[data-slider-value="${s.key}"]`
              )
              if (out) out.textContent = `${parseFloat(e.target.value).toFixed(2)}${s.unit ?? ""}`
            }}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-current"
            style={{ accentColor: accent, color: accent }}
          />
        </label>
      ))}
      {module === "projectiles" && (
        <button
          type="button"
          data-testid="launch-button"
          onClick={() => {
            // Bumping `_launchToken` on the shared params ref is the one
            // signal ProjectilesScene watches to (re)fire the ball — see
            // components/modules/ProjectilesScene.tsx. Clicking again with
            // the same slider values still bumps the token, so repeated
            // clicks always re-run the shot.
            paramsRef.current._launchToken = (paramsRef.current._launchToken ?? 0) + 1
          }}
          className="mt-1 rounded-xl px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-black transition-transform active:scale-95"
          style={{ backgroundColor: accent }}
        >
          Launch
        </button>
      )}
    </div>
  )
}

function SliderValue({
  paramsRef,
  sliderKey,
  unit,
}: {
  paramsRef: MutableRefObject<Record<string, number>>
  sliderKey: string
  unit?: string
}) {
  return (
    <span data-slider-value={sliderKey} className="font-mono text-xs text-white/60 tabular-nums">
      {paramsRef.current[sliderKey].toFixed(2)}
      {unit ?? ""}
    </span>
  )
}
