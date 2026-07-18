import ora from 'ora'
import type { ImageRequest, ImageResult, ModelInfo } from '../types.js'

const A4F_BASE = 'https://api.a4f.co/v1'

export const A4F_MODELS: ModelInfo[] = [
  { id: 'provider-4/imagen-3.5', name: 'Imagen 3.5' },
  { id: 'provider-4/imagen-4', name: 'Imagen 4' },
  { id: 'provider-8/imagen-3', name: 'Imagen 3' },
  { id: 'provider-4/flux-schnell', name: 'FLUX Schnell' },
  { id: 'provider-8/z-image', name: 'Z-Image' },
  { id: 'provider-3/deepseek-v3', name: 'DeepSeek V3' },
]

export async function generateA4F(request: ImageRequest, token: string): Promise<ImageResult> {
  const spinner = ora('Generating image via A4F...').start()

  const model = request.model || A4F_MODELS[0].id
  const size = `${request.width}x${request.height}`

  try {
    const response = await fetch(`${A4F_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.trim()}`,
      },
      body: JSON.stringify({
        model,
        prompt: request.prompt,
        n: 1,
        size,
        response_format: 'url',
        seed: request.seed,
        steps: request.steps,
        guidance_scale: request.guidanceScale,
      }),
    })

    const data = (await response.json().catch(() => ({}))) as {
      data?: Array<{ url?: string; b64_json?: string }>
      error?: { message?: string }
    }

    if (!response.ok) {
      const msg = data.error?.message || `HTTP ${response.status}`
      spinner.fail(`A4F generation failed: ${msg}`)
      throw new Error(`A4F API error (${response.status}): ${msg}`)
    }

    const url = data.data?.[0]?.url
    if (!url) {
      spinner.fail('A4F generation failed: No image returned')
      throw new Error('No image URL in A4F response')
    }

    spinner.succeed('Image generated successfully')
    return { url, seed: request.seed ?? 0, model }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.includes('A4F')) {
      spinner.fail(`Generation failed: ${message}`)
    }
    throw err
  }
}
