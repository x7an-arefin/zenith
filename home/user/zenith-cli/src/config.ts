import Conf from 'conf'
import type { CliConfig, ProviderEntry } from './types.js'

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

export function setProvider(provider: string, entry: ProviderEntry): void {
  const config = getConfig()
  config.providers[provider] = entry
  setConfig({ providers: config.providers })
}

export function addTokenToProvider(provider: string, token: string): void {
  const config = getConfig()
  const existing = config.providers[provider]
  const tokens = existing ? [...existing.tokens] : []
  // Avoid duplicates
  if (!tokens.includes(token)) {
    tokens.push(token)
  }
  setProvider(provider, { tokens, baseUrl: existing?.baseUrl })
}

export function removeTokenFromProvider(provider: string, token: string): void {
  const config = getConfig()
  const existing = config.providers[provider]
  if (!existing) return
  const tokens = existing.tokens.filter((t) => t !== token)
  setProvider(provider, { tokens, baseUrl: existing.baseUrl })
}

export function removeProvider(provider: string): void {
  const config = getConfig()
  delete config.providers[provider]
  setConfig({ providers: config.providers })
}

export function getProviderConfig(provider: string): ProviderEntry | undefined {
  const config = getConfig()
  return config.providers[provider]
}

export function getProviderTokens(provider: string): string[] {
  return getProviderConfig(provider)?.tokens ?? []
}

export function getProviderBaseUrl(provider: string): string | undefined {
  return getProviderConfig(provider)?.baseUrl
}

export function setDefault(key: keyof CliConfig, value: unknown): void {
  setConfig({ [key]: value })
}
