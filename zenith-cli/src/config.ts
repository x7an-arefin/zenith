import Conf from 'conf'
import type { CliConfig } from './types.js'

const DEFAULT_CONFIG: CliConfig = {
  providers: {},
  defaultProvider: 'huggingface',
  defaultModel: 'z-image-turbo',
  defaultWidth: 1024,
  defaultHeight: 1024,
  outputDir: './output',
  openAfterGenerate: true,
}

const store = new Conf<CliConfig>({
  projectName: 'zenith-cli',
  defaults: DEFAULT_CONFIG,
})

export function getConfig(): CliConfig {
  return { ...DEFAULT_CONFIG, ...store.store }
}

export function setConfig(partial: Partial<CliConfig>): void {
  const current = getConfig()
  store.store = { ...current, ...partial }
}

export function setProvider(provider: string, tokens: string[], baseUrl?: string): void {
  const config = getConfig()
  config.providers[provider] = { tokens, ...(baseUrl && { baseUrl }) }
  setConfig({ providers: config.providers })
}

export function removeProvider(provider: string): void {
  const config = getConfig()
  delete config.providers[provider]
  setConfig({ providers: config.providers })
}

export function getProviderConfig(provider: string): { tokens: string[]; baseUrl?: string } | undefined {
  const config = getConfig()
  return config.providers[provider]
}

export function getProviderTokens(provider: string): string[] {
  return getProviderConfig(provider)?.tokens ?? []
}

export function getNextToken(provider: string): string | null {
  const tokens = getProviderTokens(provider)
  return tokens.length > 0 ? tokens[0] : null
}

export function setDefault(key: keyof CliConfig, value: unknown): void {
  setConfig({ [key]: value })
}
