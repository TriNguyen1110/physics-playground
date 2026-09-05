"use client"

import { MODULE_META, type ModuleId } from "@/components/modules/types"

const ORDER: ModuleId[] = ["light", "projectiles", "fields"]

export function ModuleSwitcher({ active, onSelect }: { active: ModuleId; onSelect: (m: ModuleId) => void }) {
  return (
    <div className="pointer-events-auto flex gap-2 rounded-full border border-white/10 bg-black/50 p-1.5 backdrop-blur-md shadow-2xl">
      {ORDER.map((m) => {
        const meta = MODULE_META[m]
        const isActive = m === active
        return (
          <button
            key={m}
            onClick={() => onSelect(m)}
            className="relative rounded-full px-4 py-2 text-sm font-medium transition-colors"
            style={{
              color: isActive ? "#0a0a0a" : "rgba(255,255,255,0.75)",
              backgroundColor: isActive ? meta.accent : "transparent",
            }}
          >
            {meta.label}
          </button>
        )
      })}
    </div>
  )
}
