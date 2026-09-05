// Tripo API — generates a game-ready 3D asset from a prompt.
// Real endpoint confirmed via manual curl test (see BOARD.tsv fact rows):
//   base:   https://openapi.tripo3d.ai/v3
//   auth:   header "Authorization: Bearer <key>"
//   start:  POST /v3/generation/text-to-model  body { prompt, model, texture }
//     - `model` is required; omitting it 400s. Using "v3.1-20260211" per check-in docs.
//   poll:   UNVERIFIED — this account has 0 credits, so a real generate call always 403s
//     before ever returning a task_id, and there's no way to reach the poll step to confirm
//     its shape firsthand. Modeled after worldlabs.ts's GET-by-id polling pattern
//     (GET /v3/generation/{task_id} returning something like { status, data: { model_urls } })
//     — treat this poll function as an assumption to re-verify once credits exist, not a
//     confirmed fact like the rest of this file.
// Mocked by default; real call only when mock: false is passed AND TRIPO_API_KEY is set.

const TRIPO_BASE_URL = "https://openapi.tripo3d.ai/v3"
const TRIPO_MODEL = "v3.1-20260211"

function authHeaders(): Record<string, string> {
  const key = process.env.TRIPO_API_KEY
  if (!key) {
    throw new Error("TRIPO_API_KEY not set; call with mock: true or set the key")
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  }
}

export async function startAssetGeneration(
  prompt: string,
  opts: { mock?: boolean } = {}
): Promise<{ taskId: string }> {
  const mock = opts.mock ?? true

  if (mock) {
    return { taskId: "mock-task-id" }
  }

  const res = await fetch(`${TRIPO_BASE_URL}/generation/text-to-model`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      prompt,
      model: TRIPO_MODEL,
      texture: true,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Tripo generate failed: ${res.status} ${res.statusText} — ${body}`)
  }

  const data = (await res.json()) as { data?: { task_id?: string } }
  const taskId = data.data?.task_id
  if (!taskId) {
    throw new Error("Tripo generate response missing task_id")
  }

  return { taskId }
}

// UNVERIFIED shape — see file header. Modeled after worldlabs.ts's poll pattern since a real
// success response has never been reachable (account has 0 credits).
export async function pollAssetGeneration(
  taskId: string,
  opts: { mock?: boolean } = {}
): Promise<{ done: boolean; modelUrl: string | null; error: string | null }> {
  const mock = opts.mock ?? true

  if (mock) {
    return { done: true, modelUrl: "/mock/tripo-asset.glb", error: null }
  }

  const res = await fetch(`${TRIPO_BASE_URL}/generation/${taskId}`, {
    method: "GET",
    headers: authHeaders(),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    return { done: false, modelUrl: null, error: `${res.status} ${res.statusText} — ${body}` }
  }

  const data = (await res.json()) as {
    data?: { status?: string; output?: { pbr_model?: string; model?: string } }
  }

  const status = data.data?.status
  const done = status === "success"
  const modelUrl = data.data?.output?.pbr_model ?? data.data?.output?.model ?? null

  return {
    done,
    modelUrl: done ? modelUrl : null,
    error: status === "failed" ? "Tripo generation failed" : null,
  }
}

// Back-compat convenience wrapper for mock-only call sites per CONTRACT.md's fallback table.
// Real callers should use startAssetGeneration + pollAssetGeneration directly.
export async function generateAsset(
  prompt: string,
  opts: { mock?: boolean } = {}
): Promise<{ modelUrl: string; format: "glb" }> {
  const mock = opts.mock ?? true
  if (mock) {
    return { modelUrl: "/mock/tripo-asset.glb", format: "glb" }
  }
  // Real path: start + poll once. This is a convenience wrapper only — it does not loop
  // waiting for completion (generation is async and can take a while), so a real, non-mock
  // caller should use startAssetGeneration + pollAssetGeneration on an interval instead.
  await startAssetGeneration(prompt, opts)
  throw new Error(
    "Tripo real generation started but is async — use startAssetGeneration + pollAssetGeneration on an interval instead of generateAsset for real (non-mock) calls"
  )
}
