// Tripo API — generates a game-ready 3D asset from a prompt.
// Mocked until TRIPO_API_KEY exists and mock: false is passed explicitly.

export async function generateAsset(
  prompt: string,
  opts: { mock?: boolean } = {}
): Promise<{ modelUrl: string; format: "glb" }> {
  const mock = opts.mock ?? true
  if (!mock && !process.env.TRIPO_API_KEY) {
    throw new Error("TRIPO_API_KEY not set; call with mock: true or set the key")
  }
  if (mock) {
    return { modelUrl: "/mock/tripo-asset.glb", format: "glb" }
  }
  throw new Error("Tripo real API call not yet implemented — fill in after check-in")
}
