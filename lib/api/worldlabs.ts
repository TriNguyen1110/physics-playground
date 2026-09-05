// World Labs Marble API — generates an explorable backdrop world from a prompt.
// Real endpoint confirmed via check-in docs + manual curl test (see BOARD.tsv fact rows):
//   base:   https://api.worldlabs.ai
//   auth:   header "WLT-Api-Key: <key>" (NOT Bearer)
//   start:  POST /marble/v1/worlds:generate
//   poll:   GET  /marble/v1/operations/{operation_id}
// Generation takes ~5 minutes, so this is split into a non-blocking start + poll pair instead
// of one function that awaits completion. Mocked by default; real call only when mock: false
// is passed AND WORLDLABS_API_KEY is set.

const WORLDLABS_BASE_URL = "https://api.worldlabs.ai"

function authHeaders(): Record<string, string> {
  const key = process.env.WORLDLABS_API_KEY
  if (!key) {
    throw new Error("WORLDLABS_API_KEY not set; call with mock: true or set the key")
  }
  return {
    "WLT-Api-Key": key,
    "Content-Type": "application/json",
  }
}

export async function startWorldGeneration(
  prompt: string,
  opts: { mock?: boolean; displayName?: string } = {}
): Promise<{ operationId: string; worldId: string | null; previewUrl: string }> {
  const mock = opts.mock ?? true

  if (mock) {
    return {
      operationId: "mock-operation-id",
      worldId: "mock-world-id",
      previewUrl: "/mock/worldlabs-preview.jpg",
    }
  }

  const res = await fetch(`${WORLDLABS_BASE_URL}/marble/v1/worlds:generate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      display_name: opts.displayName ?? "physics-playground backdrop",
      model: "marble-1.1",
      world_prompt: { type: "text", text_prompt: prompt },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`World Labs generate failed: ${res.status} ${res.statusText} — ${body}`)
  }

  const data = (await res.json()) as {
    operation_id: string
    done?: boolean
    metadata?: { world_id?: string }
  }

  const operationId = data.operation_id
  if (!operationId) {
    throw new Error("World Labs generate response missing operation_id")
  }

  // metadata (and world_id within it) is null on the worlds:generate response itself — it only
  // shows up once you poll the operation, even a moment later. Do one immediate follow-up poll
  // so callers get a usable previewUrl right away instead of null.
  let worldId: string | null = null
  try {
    const opRes = await fetch(`${WORLDLABS_BASE_URL}/marble/v1/operations/${operationId}`, {
      method: "GET",
      headers: authHeaders(),
    })
    if (opRes.ok) {
      const opData = (await opRes.json()) as { metadata?: { world_id?: string } }
      worldId = opData.metadata?.world_id ?? null
    }
  } catch {
    // Non-fatal — caller can still poll later via pollWorldGeneration/re-fetch.
  }

  return {
    operationId,
    worldId,
    // Valid once generation is done (poll operationId until done: true).
    previewUrl: worldId
      ? `https://marble.worldlabs.ai/world/${worldId}`
      : "/mock/worldlabs-preview.jpg",
  }
}

export async function pollWorldGeneration(
  operationId: string,
  opts: { mock?: boolean } = {}
): Promise<{ done: boolean; error: string | null }> {
  const mock = opts.mock ?? true

  if (mock) {
    return { done: true, error: null }
  }

  const res = await fetch(`${WORLDLABS_BASE_URL}/marble/v1/operations/${operationId}`, {
    method: "GET",
    headers: authHeaders(),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    return { done: false, error: `${res.status} ${res.statusText} — ${body}` }
  }

  const data = (await res.json()) as {
    done?: boolean
    error?: { message?: string }
  }

  return {
    done: Boolean(data.done),
    error: data.error?.message ?? null,
  }
}

// Back-compat convenience wrapper kept for the mock-only call sites CONTRACT.md's fallback
// table describes; real callers should use startWorldGeneration + pollWorldGeneration directly.
export async function generateWorld(
  prompt: string,
  opts: { mock?: boolean } = {}
): Promise<{ previewUrl: string }> {
  const { previewUrl } = await startWorldGeneration(prompt, opts)
  return { previewUrl }
}
