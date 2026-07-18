/**
 * Shared types for Zenith CLI — adapted from zenith-image-generator
 */

export interface ImageRequest {
  prompt: string
  negativePrompt?: string
  model?: string
  width: number
  height: number
  steps?: number
  guidanceScale?: number
  seed?: number
}

export interface ImageResult {
  url: string
  seed: number
  model?: string
}

export interface ModelInfo {
  id: string
  name: string
  description?: string
}

export interface ProviderEntry {
  tokens: string[]
  baseUrl?: string
}

export interface CliConfig {
  providers: Record<string, ProviderEntry>
  defaultProvider: string
  defaultModel: string
  defaultWidth: number
  defaultHeight: number
  outputDir: string
  openAfterGenerate: boolean
}
