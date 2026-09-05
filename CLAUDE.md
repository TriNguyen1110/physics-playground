# Project rules

## Build constraint, read this first

This is a one-day hackathon build (Spatial Intelligence + Generative 3D Hackathon, SF).
Demo grade, not production. Working beats complete, and shipped beats correct in the abstract.

- No abstractions for future reuse. Write the specific thing.
- No refactoring. If it works and is ugly, leave it.
- No auth, no billing, no onboarding, no empty states beyond one line of text.
- Error handling only where it protects the demo: never let a sponsor API call block the core
  simulator (see fallback table in CONTRACT.md), fail loudly everywhere else.
- No new dependencies unless one saves more than thirty minutes.
- If the choice is between shipping something plain and not shipping, ship plain.
- If a piece is not working after 45 minutes, say so and take the documented fallback instead
  of continuing.

Scope is fixed and the clock is not. When in doubt, cut. See CONTRACT.md's fallback table and
cut order. Never cut: the three `step()` modules being physically correct and interactive.

## North star: a museum exhibit, not a physics worksheet

Every module is judged on three things, in this order. A module that's 2/3 is not done.

1. **Correct.** The numbers are real physics, checked against a closed-form answer (verifier's
   DATA scope), not just "looks plausible." This is non-negotiable and comes first because the
   other two don't matter if the simulation is lying.
2. **Interactive and fun.** A slider isn't a form field, it's a knob you want to keep touching.
   Response has to feel instant (drive `step()` every frame via `useFrame`, never on React
   state re-render lag), ranges have to be wide enough to produce visibly different, sometimes
   surprising outcomes, and there should be an obvious "aha" — the exact moment a projectile
   clears the wall, a light ray hits total internal reflection, two charges snap together.
3. **Beautiful.** Think hands-on science museum exhibit (Exploratorium, not a textbook diagram),
   with a specific reference: **Beaker by Thix** (thix.co/beaker) — a near-black/dark
   laboratory void with one glowing, colorful, alive-feeling object as the entire focal point.
   Cold, not warm: near-black or deep-slate background (not white, not a skybox photo), the
   *simulation itself* (light rays, field vectors, the projectile and its trail) rendered as
   glowing/emissive against that dark void — like a chemical reaction glowing inside a dark
   beaker — rather than colorful surfaces lit by a bright environment. Motion eases instead of
   teleporting. Readouts are a small frosted-glass/translucent "museum placard" overlay with
   units, not raw JSON dumped on screen. Beauty is `scene`'s job and it is real scope, not
   polish to skip if short on time — but it never trades off against #1 or #2. A gorgeous scene
   with wrong physics fails; correct-but-ugly ships before beautiful-but-wrong does.

Concretely for `scene`: dark/near-black base scene across ALL modules (consistent cold identity,
not a different background per module), with each module's signature color living in what
*glows* — e.g. cool cyan-white for light/optics rays, electric blue/violet for field vectors,
a hot streak trail for the projectile against the same dark void. Soft rim/point lighting on
glowing elements (drei `Environment` set to something like `"night"`/`"warehouse"` at low
intensity, not a bright daytime preset), smooth eased camera framing between modules (no jump
cuts), and a frosted/glass readout panel, never a `<pre>` dump.

## The actual clock

Hacking runs **10:00 AM–1:00 PM, 1:45–6:00 PM**, submissions due **6:00 PM sharp**, demo slot is
2 minutes. Work backward from that, not forward from "how much can we fit":

- By ~1:00 PM (lunch): all three `step()` functions correct and unit-tested (DATA scope clear).
  If a module isn't there by lunch, it's the first thing cut, not projectiles/fields/light
  picked arbitrarily — cut whichever module's physics is least solid.
- By ~4:00 PM: all three modules interactive and rendered (SCREEN scope clear) — this is the
  minimum demoable product. Sponsor API integrations (World Labs backdrop, Tripo assets, mint.gg
  publish) only start after this bar is met, never before it.
- 4:00–5:30 PM: beauty pass (lighting, palette, readout styling) and sponsor integrations, in
  that order, per CONTRACT.md's cut order if time is short.
- 5:30–6:00 PM: freeze. No new commits after 5:30 except a fix for something that broke the demo
  path. Rehearse the 2-minute walkthrough at least once before 6:00.

## Stack

- Next.js (App Router, TypeScript, Tailwind) — already scaffolded.
- Three.js + `@react-three/fiber` + `@react-three/drei` for the 3D scene.
- `@react-three/rapier` for the `projectiles` module's real rigid-body physics.
- Convex for the shared-session backend (params sync across two clients in the same room).
- Sponsor integrations, mocked until check-in hands out real keys (see CONTRACT.md):
  World Labs (backdrop world), Tripo (hero 3D assets), mint.gg (one-click publish).

## Commands

- `npm run dev` — dev server on :3000. **Main session starts this once; agents never launch
  their own.**
- `npm run build` — production build, run before the demo as a smoke check.
- `npm run test:engine` / `npm run test:scene` / `npm run test:journeys` — verifier's regression
  suites (created as the verifier writes them; inert until then).
- `npx convex dev` — starts the Convex dev deployment. Run once real Convex credentials exist;
  until then `engine`'s Convex functions are written but not deployed.

## BOARD.tsv

**Main-session rule:** every time `engine` or `scene` commits a testable slice and appends a
`review` row, dispatch the verifier for that row's scope before treating it as done. If the
verifier kicks it back to `doing`, dispatch the owning builder with the fix from `note`, and
repeat. Never skip from a builder's commit straight to "looks done." Once verified, push.

All shared state lives in one append-only, tab-separated file. Never edit a line, only append
with `>>`. **The last row for a given `kind` + `id` is the current truth.**

```
ts    kind   id             value        owner      scope   note
```

`item` is a unit of work: `backlog`, `doing`, `review`, `done`, `blocked`, `delayed`.
`fact` is something already computed that another agent would otherwise recompute.

```
H+0.5	fact	step.shape	frozen per CONTRACT.md	engine	-	light/fields pure, projectiles delegates to Rapier
H+1.0	item	light-01	doing	engine	DATA	reflection/refraction step()
H+1.4	item	light-01	review	engine	DATA	committed a1b2c3d
H+1.5	fact	light.meta	{wavelength_nm, angle_deg}	engine	-	SceneObject.meta keys for light module
H+1.6	item	light-01	done	verifier	DATA	matches Snell's law within 1e-3
```

Read current state, last row per key wins:

```bash
awk -F'\t' '{r[$2"\t"$3]=$0} END{for(k in r) print r[k]}' BOARD.tsv | sort -t$'\t' -k2,3
```

Who may set what:

| Transition | Who |
|---|---|
| `backlog` -> `doing` | the owning builder, at tick start |
| `doing` -> `review` | the owning builder, after its commit lands |
| `review` -> `done` | **verifier only** |
| `review` -> `doing` | **verifier only**, on failure, reason in `note` |
| anything -> `blocked` | any agent |
| anything -> `delayed` | the main session only |
| new `item` in `backlog` | any agent, including the verifier |
| any `fact` | any agent |

Nothing reaches `done` by its own hand. Keep `note` to one line, no tabs.

## Grounding rules

Every physics scenario's on-screen readout must reproduce from `step()`'s actual returned
numbers — never a hardcoded display value. For `projectiles`, the readout must match what
Rapier's solver actually produced for that run, not a precomputed constant. The verifier checks
this by computing the expected closed-form value itself and diffing against what's rendered,
not by eyeballing the animation.

Run the `verifier` agent before anything goes on screen or into the demo.

## Conventions

Fail loudly. Assert `objects.length > 0` and no `NaN`/`Infinity` rather than logging a warning.
Cap retries and total runtime on any sponsor API call — no unbounded loops, no blocking the UI
thread on a network call that might not come back before the demo.

## Lessons carried over (main-session responsibilities)

- **Only one dev server, one port, at a time.** Kill/restart (clearing `.next` cache) if you see
  errors that look like a real bug but smell environmental.
- **Never let an agent `git stash`.** Commit first if a clean tree is needed.
- **A builder pushing to `review` is not verified.** Always dispatch the verifier before treating
  anything as done.
- **Background agent reports can end mid-task.** Check `BOARD.tsv` for the actual verdict row
  before trusting a notification's text.
- **Push only what's actually verified**, and only when nothing else has in-flight uncommitted
  changes in the same files. Cutting scope (`delayed`) is a human call.
- **Start the session `cd`'d into this repo's root**, not `~/Developer`. Custom `.claude/agents/*`
  only auto-load from the working directory the session started in.
