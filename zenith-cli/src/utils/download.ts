import fs from 'node:fs/promises'
import path from 'node:path'

const MAX_RETRIES = 3
const RETRY_DELAY = 2000

export async function downloadImage(url: string, outputPath: string): Promise<string> {
  // Ensure output directory exists
  const dir = path.dirname(path.resolve(outputPath))
  await fs.mkdir(dir, { recursive: true })

  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      let imageData: Buffer

      // Handle data URIs
      if (url.startsWith('data:')) {
        const match = url.match(/^data:image\/(\w+);base64,(.+)$/)
        if (!match) throw new Error('Invalid data URI format')
        const [, ext, base64] = match
        imageData = Buffer.from(base64, 'base64')

        // Adjust extension if needed
        const currentExt = path.extname(outputPath).replace('.', '')
        if (currentExt !== ext) {
          outputPath = outputPath.replace(/\.\w+$/, `.${ext}`)
        }
      } else if (url.startsWith('http://') || url.startsWith('https://')) {
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`)
        }
        const arrayBuffer = await response.arrayBuffer()
        imageData = Buffer.from(arrayBuffer)

        // Try to detect format from content-type and adjust extension
        const contentType = response.headers.get('content-type')
        if (contentType) {
          if (contentType.includes('jpeg') || contentType.includes('jpg')) {
            outputPath = outputPath.replace(/\.\w+$/, '.jpg')
          } else if (contentType.includes('webp')) {
            outputPath = outputPath.replace(/\.\w+$/, '.webp')
          } else if (contentType.includes('png')) {
            outputPath = outputPath.replace(/\.\w+$/, '.png')
          }
        }
      } else {
        throw new Error(`Unsupported URL scheme: ${url}`)
      }

      await fs.writeFile(outputPath, imageData)
      return outputPath
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * (attempt + 1)))
      }
    }
  }

  throw lastError!
}
