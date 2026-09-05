// mint.gg — publishes the assembled scene to a shareable URL.
// Mocked until MINTGG_API_KEY exists and mock: false is passed explicitly.

export async function publishScene(
  sceneId: string,
  opts: { mock?: boolean } = {}
): Promise<{ shareUrl: string }> {
  const mock = opts.mock ?? true
  if (!mock && !process.env.MINTGG_API_KEY) {
    throw new Error("MINTGG_API_KEY not set; call with mock: true or set the key")
  }
  if (mock) {
    return { shareUrl: `https://mint.gg/mock/${sceneId}` }
  }
  throw new Error("mint.gg real API call not yet implemented — fill in after check-in")
}
