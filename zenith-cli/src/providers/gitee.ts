import ora from 'ora'
import type { ImageRequest, ImageResult, ModelInfo } from '../types.js'

const GITEE_BASE = 'https://ai.gitee.com/v1'

export const GITEE_MODELS: ModelInfo[] = [
  { id: 'Qwen-Image', name: 'Qwen Image' },
  { id: 'FLUX.1-dev', name: 'FLUX 1 Dev' },
  { id: 'FLUX_1-Krea-dev', name: 'FLUX 1 Krea Dev' },
  { id: 'z-image-turbo', name: 'Z-Image Turbo' },
  { id: 'GLM-Image', name: 'GLM Image' },
]

export const GITEE_LLM_MODELS: ModelInfo[] = [
  { id: 'DeepSeek-V3', name: 'DeepSeek V3' },
  { id: 'Qwen2.5-72B-Instruct', name: 'Qwen2.5 72B Instruct' },
  { id: 'glm-4-9b-chat', name: 'GLM-4 9B Chat' },
]

function parseGiteeError(status: number, data: { error?: { message?: string }; message?: string }): Error {
  const msg = data.error?.message || data.message || `HTTP ${status}`
  if (status === 401 || msg.toLowerCase().includes('unauthorized')) {
    return new Error(`Gitee AI auth failed: ${msg}`)
  }
  if (status === 429 || msg.toLowerCase().includes('rate limit')) {
    return new Error(`Gitee AI rate limited: ${msg}`)
  }
  if (msg.toLowerCase().includes('quota')) {
    return new Error(`Gitee AI quota exceeded: ${msg}`)
  }
  return new Error(`Gitee AI error (${status}): ${msg}`)
}

export async function generateGitee(request: ImageRequest, token: string): Promise<ImageResult> {
  const spinner = ora('Generating image via Gitee AI...').start()

  const seed = request.seed ?? Math.floor(Math.random() * 2147483647)
  const modelId = request.model || 'z-image-turbo'
  const isFluxModel = modelId.toLowerCase().includes('flux')
  const isQwenModel = modelId.toLowerCase().startsWith('qwen-image')
  const isGlmModel = modelId.toLowerCase() === 'glm-image'

  const body: Record<string, unknown> = {
    prompt: request.prompt,
    model: modelId,
    width: request.width,
    height: request.height,
    seed,
    num_inference_steps: request.steps ?? 9,
    response_format: 'url',
  }

  if (!isFluxModel && request.negativePrompt) {
    body.negative_prompt = request.negativePrompt
  }

  if (request.guidanceScale !== undefined) {
    if (isQwenModel) body.cfg_scale = request.guidanceScale
    else body.guidance_scale = request.guidanceScale
  } else {
    if (isQwenModel) body.cfg_scale = 1
    if (isGlmModel) body.guidance_scale = 1.5
  }

  try {
    const response = await fetch(`${GITEE_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.trim()}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as { error?: { message?: string }; message?: string }
      throw parseGiteeError(response.status, errData)
    }

    const data = (await response.json()) as { data?: Array<{ url?: string }> }
    const url = data.data?.[0]?.url
    if (!url) throw new Error('Gitee AI returned no image URL')

    spinner.succeed('Image generated successfully')
    return { url, seed, model: modelId }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    spinner.fail(`Generation failed: ${message}`)
    throw err
  }
}

export interface ChatMessage {
  role: string
  content: string
}

export interface ChatRequest {
  model?: string
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
}

export interface ChatResult {
  content: string
  model: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export async function chatGitee(request: ChatRequest, token: string): Promise<ChatResult> {
  const model = request.model || 'DeepSeek-V3'

  const response = await fetch(`${GITEE_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.trim()}`,
    },
    body: JSON.stringify({
      model,
      messages: request.messages,
      max_tokens: request.maxTokens || 1000,
      temperature: request.temperature ?? 0.7,
      stream: false,
    }),
  })

  if (!response.ok) {
    const errData = await response.json().catch(() => ({})) as { error?: { message?: string }; message?: string }
    throw parseGiteeError(response.status, errData)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  }

  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('Gitee AI returned empty response')

  return {
    content,
    model,
    usage: data.usage,
  }
}
