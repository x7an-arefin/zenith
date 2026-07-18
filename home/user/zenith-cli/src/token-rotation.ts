/**
 * Token Rotation Manager — adapted from zenith-image-generator
 *
 * Tracks exhausted tokens per-provider and automatically rotates
 * to the next available token when quota/rate-limit errors occur.
 */

function getUTCDateString(): string {
  return new Date().toISOString().split('T')[0]
}

export interface TokenStats {
  total: number
  active: number
  exhausted: number
}

export type ErrorCategory = 'quota' | 'rate-limit' | 'auth' | 'timeout' | 'provider' | 'unknown'

export function categorizeError(message: string, status?: number): ErrorCategory {
  const lower = message.toLowerCase()
  if (status === 429 || lower.includes('rate limit') || lower.includes('too many')) return 'rate-limit'
  if (lower.includes('quota') || lower.includes('exceeded') || lower.includes('insufficient')) return 'quota'
  if (status === 401 || status === 403 || lower.includes('unauthorized') || lower.includes('invalid')) return 'auth'
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout'
  if (status && status >= 500) return 'provider'
  return 'unknown'
}

export function isRotatableError(category: ErrorCategory): boolean {
  return category === 'quota' || category === 'rate-limit'
}

export class TokenRotationManager {
  private exhaustedTokens: Map<string, Set<string>> = new Map()
  private lastResetDate = ''

  /** Auto-reset exhaustion tracking at UTC midnight */
  private checkDailyReset() {
    const today = getUTCDateString()
    if (this.lastResetDate !== today) {
      this.exhaustedTokens.clear()
      this.lastResetDate = today
    }
  }

  /** Get the first non-exhausted token for a provider */
  getNextToken(providerId: string, allTokens: string[]): string | null {
    this.checkDailyReset()
    const exhausted = this.exhaustedTokens.get(providerId) || new Set()
    return allTokens.find((t) => !exhausted.has(t)) || null
  }

  /** Mark a token as exhausted (quota/rate-limit hit) */
  markExhausted(providerId: string, token: string): void {
    if (!this.exhaustedTokens.has(providerId)) {
      this.exhaustedTokens.set(providerId, new Set())
    }
    this.exhaustedTokens.get(providerId)!.add(token)
  }

  /** Get token usage stats for a provider */
  getStats(providerId: string, allTokens: string[]): TokenStats {
    const exhausted = this.exhaustedTokens.get(providerId) || new Set()
    const exhaustedCount = allTokens.filter((t) => exhausted.has(t)).length
    return {
      total: allTokens.length,
      active: allTokens.length - exhaustedCount,
      exhausted: exhaustedCount,
    }
  }

  /** Reset exhaustion tracking for a specific provider or all */
  reset(providerId?: string): void {
    if (providerId) this.exhaustedTokens.delete(providerId)
    else this.exhaustedTokens.clear()
  }

  /** Check if all tokens for a provider are exhausted */
  allExhausted(providerId: string, allTokens: string[]): boolean {
    if (allTokens.length === 0) return true
    const exhausted = this.exhaustedTokens.get(providerId) || new Set()
    return allTokens.every((t) => exhausted.has(t))
  }
}

/**
 * Wrap an async operation with automatic token rotation on quota errors.
 *
 * @param providerId  - Provider identifier (e.g. 'gitee', 'a4f')
 * @param allTokens   - All configured tokens for this provider
 * @param operation   - Async function that takes a token (or null) and returns a result
 * @param options     - allowAnonymous: allow null token; maxRetries: max rotation attempts
 */
export async function runWithTokenRotation<T>(
  providerId: string,
  allTokens: string[],
  operation: (token: string | null) => Promise<T>,
  options: { allowAnonymous?: boolean; maxRetries?: number; onRotate?: (token: string, error: Error) => void } = {}
): Promise<T> {
  const { allowAnonymous = false, maxRetries = 10, onRotate } = options

  if (allTokens.length === 0) {
    if (allowAnonymous) return operation(null)
    throw new Error(`No API tokens configured for provider '${providerId}'`)
  }

  let attempts = 0
  while (attempts < maxRetries) {
    const token = rotationManager.getNextToken(providerId, allTokens)

    if (!token) {
      if (allowAnonymous) return operation(null)
      throw new Error(
        `All ${allTokens.length} token(s) for '${providerId}' are exhausted. Try again tomorrow or reset with: zenith providers reset-tokens ${providerId}`
      )
    }

    try {
      return await operation(token)
    } catch (err) {
      const category = err instanceof Error ? categorizeError(err.message) : 'unknown'
      if (isRotatableError(category)) {
        rotationManager.markExhausted(providerId, token)
        attempts++
        if (onRotate) onRotate(token, err instanceof Error ? err : new Error(String(err)))
        continue
      }
      // Non-rotatable error — rethrow immediately
      throw err
    }
  }

  throw new Error(
    `Maximum retry attempts (${maxRetries}) reached for provider '${providerId}'. All tokens exhausted.`
  )
}

// Singleton instance
export const rotationManager = new TokenRotationManager()
