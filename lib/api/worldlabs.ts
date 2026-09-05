// World Labs World API — generates an explorable backdrop from a prompt.
// Real endpoint/auth TBD from check-in docs. Mocked until WORLDLABS_API_KEY exists and
// mock: false is passed explicitly.

export async function generateWorld(
  prompt: string,
  opts: { mock?: boolean } = {}
): Promise<{ previewUrl: string }> {
  const mock = opts.mock ?? true
  if (!mock && !process.env.WORLDLABS_API_KEY) {
    throw new Error("WORLDLABS_API_KEY not set; call with mock: true or set the key")
  }
  if (mock) {
    return { previewUrl: "/mock/worldlabs-preview.jpg" }
  }
  throw new Error("World Labs real API call not yet implemented — fill in after check-in")
}
