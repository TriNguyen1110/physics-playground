"use client"

import { useState, type MutableRefObject } from "react"
import { MODULE_META, type ModuleId, type SliderConfig } from "@/components/modules/types"

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
      {sliders.map((s) =>
        s.kind === "select" ? (
          <SelectControl key={s.key} slider={s} paramsRef={paramsRef} accent={accent} />
        ) : s.kind === "toggle" ? (
          <label key={s.key} className="flex items-center justify-between text-sm text-white/85">
            <span className="font-medium">{s.label}</span>
            <input
              type="checkbox"
              data-testid={`toggle-${s.key}`}
              defaultChecked={paramsRef.current[s.key] >= 0.5}
              onChange={(e) => {
                paramsRef.current[s.key] = e.target.checked ? 1 : 0
              }}
              className="h-4 w-8 cursor-pointer appearance-none rounded-full bg-white/15 transition-colors checked:bg-current"
              style={{ accentColor: accent, color: accent }}
            />
          </label>
        ) : (
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
        )
      )}
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

/**
 * Renders a discrete mode-index param (e.g. element_type, source_type,
 * launch_mode) as a labeled button group instead of a bare numeric slider —
 * "0.00"/"2.00" means nothing to a user, but clicking a labeled button does.
 * Local `useState` just drives which button looks active; the actual value
 * still writes straight into `paramsRef` with zero React round-trip, same
 * as every other control here.
 */
function SelectControl({
  slider,
  paramsRef,
  accent,
}: {
  slider: SliderConfig
  paramsRef: MutableRefObject<Record<string, number>>
  accent: string
}) {
  const [active, setActive] = useState(paramsRef.current[slider.key] ?? slider.default)
  const options = slider.options ?? []
  return (
    <div className="flex flex-col gap-1.5 text-sm text-white/85">
      <span className="font-medium">{slider.label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((label, i) => {
          const isActive = active === i
          return (
            <button
              key={label}
              type="button"
              data-testid={`select-${slider.key}-${i}`}
              onClick={() => {
                paramsRef.current[slider.key] = i
                setActive(i)
              }}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
              style={
                isActive
                  ? { backgroundColor: accent, color: "#05060a" }
                  : { backgroundColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.75)" }
              }
            >
              {label}
            </button>
          )
        })}
      </div>
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
