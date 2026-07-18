import ora from 'ora'
import type { ImageRequest, ImageResult, ModelInfo } from '../types.js'

const HF_SPACES: Record<string, string> = {
  'z-image-turbo': 'https://mrfakename-z-image-turbo.hf.space',
  'qwen-image-fast': 'https://qwen-qwen-image-fast.hf.space',
  'ovis-image': 'https://StepFormer-ovis-image-1.5.hf.space',
  'flux-1-schnell': 'https://black-forest-labs-FLUX.1-schnell.hf.space',
}

interface GradioModelConfig {
  endpoint: string
  buildData: (req: ImageRequest, seed: number) => unknown[]
}

const MODEL_CONFIGS: Record<string, GradioModelConfig> = {
  'z-image-turbo': {
    endpoint: 'generate_image',
    buildData: (req, seed) => [req.prompt, req.height, req.width, req.steps ?? 9, seed, false],
  },
  'qwen-image-fast': {
    endpoint: 'generate_image',
    buildData: (req, seed) => [req.prompt, seed, true, '1:1', 3, req.steps ?? 8],
  },
  'ovis-image': {
    endpoint: 'generate',
    buildData: (req, seed) => [req.prompt, req.height, req.width, seed, req.steps ?? 24, 4],
  },
  'flux-1-schnell': {
    endpoint: 'infer',
    buildData: (req, seed) => [req.prompt, seed, false, req.width, req.height, req.steps ?? 8],
  },
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callGradioApi(
  baseUrl: string,
  endpoint: string,
  data: unknown[],
  hfToken?: string
): Promise<unknown[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (hfToken) headers['Authorization'] = `Bearer ${hfToken}`

  const MAX_RETRIES = 3

  // Step 1: Queue the request
  const queueUrl = `${baseUrl}/gradio_api/call/${endpoint}`
  let queueData: { event_id?: string } | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const resp = await fetch(queueUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ data }),
    })

    if (resp.ok) {
      queueData = (await resp.json()) as { event_id?: string }
      break
    }

    const status = resp.status
    const shouldRetry = attempt < MAX_RETRIES - 1 && (status === 404 || status === 503)
    if (shouldRetry) {
      await sleep(600 * (attempt + 1))
      continue
    }
    const errText = await resp.text().catch(() => '')
    throw new Error(`HuggingFace Gradio API error (${status}): ${errText.slice(0, 200)}`)
  }

  if (!queueData?.event_id) {
    throw new Error('HuggingFace Gradio API: no event_id returned from queue')
  }

  // Step 2: Poll for result via SSE
  const resultUrl = `${baseUrl}/gradio_api/call/${endpoint}/${queueData.event_id}`
  let text = ''

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const resp = await fetch(resultUrl, { headers })
    if (resp.ok) {
      text = await resp.text()
      break
    }

    const status = resp.status
    const shouldRetry = attempt < MAX_RETRIES - 1 && (status === 404 || status === 503)
    if (shouldRetry) {
      await sleep(600 * (attempt + 1))
      continue
    }
    const errText = await resp.text().catch(() => '')
    throw new Error(`HuggingFace Gradio result error (${status}): ${errText.slice(0, 200)}`)
  }

  if (!text) {
    throw new Error('HuggingFace Gradio API: empty result after retries')
  }

  // Parse SSE "complete" event
  const lines = text.split('\n')
  let currentEvent = ''
  for (const line of lines) {
    if (line.startsWith('event:')) {
      currentEvent = line.substring(6).trim()
    } else if (line.startsWith('data:') && currentEvent === 'complete') {
      const jsonData = line.substring(5).trim()
      const parsed = JSON.parse(jsonData)
      if (Array.isArray(parsed)) return parsed
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.data)) return parsed.data
      throw new Error(`Unexpected complete payload: ${jsonData.slice(0, 200)}`)
    }
  }

  throw new Error(`Unexpected SSE response: ${text.substring(0, 200)}`)
}

function parseImageUrl(baseUrl: string, result: unknown): string {
  if (typeof result === 'string') {
    try {
      return new URL(result, baseUrl).toString()
    } catch {
      return result
    }
  }
  if (result && typeof result === 'object' && 'url' in result) {
    const rawUrl = (result as { url: string }).url
    return rawUrl ? parseImageUrl(baseUrl, rawUrl) : ''
  }
  throw new Error(`Unable to parse image URL from result: ${JSON.stringify(result).slice(0, 200)}`)
}

export const HF_MODELS: ModelInfo[] = Object.keys(HF_SPACES).map((id) => ({
  id,
  name: id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  description: HF_SPACES[id],
}))

export async function generateHuggingFace(
  request: ImageRequest,
  token?: string
): Promise<ImageResult> {
  const spinner = ora('Connecting to HuggingFace space...').start()

  const seed = request.seed ?? Math.floor(Math.random() * 2147483647)
  const modelId = request.model || 'z-image-turbo'
  const config = MODEL_CONFIGS[modelId] ?? MODEL_CONFIGS['z-image-turbo']

  spinner.text = `Generating image with model: ${modelId} (seed: ${seed})...`

  try {
    const baseUrl = HF_SPACES[modelId] ?? HF_SPACES['z-image-turbo']
    const data = config.buildData(request, seed)
    const result = await callGradioApi(baseUrl, config.endpoint, data, token)
    const imageUrl = parseImageUrl(baseUrl, result[0])

    spinner.succeed('Image generated successfully')
    return {
      url: imageUrl,
      seed,
      model: modelId,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    spinner.fail(`Generation failed: ${message}`)
    throw err
  }
}
