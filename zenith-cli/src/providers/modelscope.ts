import ora from 'ora'
import type { ImageRequest, ImageResult, ModelInfo } from '../types.js'

const MODELSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const MS_MODELS: ModelInfo[] = [
  { id: 'Tongyi-MAI/Z-Image-Turbo', name: 'Z-Image Turbo' },
  { id: 'black-forest-labs/FLUX.2-dev', name: 'FLUX 2 Dev' },
  { id: 'black-forest-labs/FLUX.1-Krea-dev', name: 'FLUX 1 Krea Dev' },
  { id: 'MusePublic/489_ckpt_FLUX_1', name: 'FLUX 1' },
]

async function submitTask(
  token: string,
  body: Record<string, unknown>
): Promise<string> {
  const response = await fetch(`${MODELSCOPE_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errData = await response.json().catch(() => ({})) as { message?: string; error?: string }
    throw new Error(
      `ModelScope submission failed (${response.status}): ${errData.message || errData.error || response.statusText}`
    )
  }

  const data = (await response.json()) as {
    output?: { task_id?: string; task_status?: string }
    request_id?: string
  }
  const taskId = data.output?.task_id
  if (!taskId) {
    throw new Error('ModelScope returned no task_id')
  }
  return taskId
}

async function pollForResult(
  token: string,
  taskId: string,
  maxAttempts: number = 40,
  pollIntervalMs: number = 3000
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`${MODELSCOPE_BASE}/tasks/${taskId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-DashScope-Task-Type': 'image_generation',
      },
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as { message?: string; error?: string }
      throw new Error(
        `ModelScope poll failed (${response.status}): ${errData.message || errData.error || response.statusText}`
      )
    }

    const data = (await response.json()) as {
      output?: {
        results?: Array<{ url?: string }>
        task_status?: string
        task_metrics?: { TOTAL?: number; SUCCEEDED?: number; FAILED?: number }
      }
      message?: string
    }
    const output = data.output
    const status = output?.task_status

    if (status === 'SUCCEEDED') {
      const url = output?.results?.[0]?.url
      if (!url) throw new Error('ModelScope returned no image URL in result')
      return url
    }

    if (status === 'FAILED') {
      throw new Error(`ModelScope task failed: ${data.message || 'Unknown error'}`)
    }

    // PENDING or RUNNING — keep polling
    await sleep(pollIntervalMs)
  }

  throw new Error('ModelScope task timed out after maximum polling attempts')
}

export async function generateModelScope(
  request: ImageRequest,
  token: string
): Promise<ImageResult> {
  const spinner = ora('Submitting task to ModelScope...').start()

  const seed = request.seed ?? Math.floor(Math.random() * 2147483647)
  const model = request.model || 'Tongyi-MAI/Z-Image-Turbo'
  const size = `${request.width}x${request.height}`

  const body: Record<string, unknown> = {
    model,
    input: { prompt: request.prompt },
    parameters: {
      size,
      seed,
      steps: request.steps ?? 9,
    },
  }

  if (request.negativePrompt) {
    (body.parameters as Record<string, unknown>).negative_prompt = request.negativePrompt
  }
  if (request.guidanceScale !== undefined) {
    (body.parameters as Record<string, unknown>).guidance_scale = request.guidanceScale
  }

  spinner.text = `Submitting task for model: ${model} (${request.width}x${request.height}, seed: ${seed})...`
  const taskId = await submitTask(token, body)

  spinner.text = `Task submitted (ID: ${taskId.slice(0, 12)}...). Polling for result...`
  const imageUrl = await pollForResult(token, taskId)

  spinner.succeed('Image generated successfully')
  return {
    url: imageUrl,
    seed,
    model,
  }
}
