#!/usr/bin/env node

/**
 * Zenith CLI — Multi-provider AI image & chat generation
 *
 * Providers: HuggingFace (free), Gitee AI, ModelScope, A4F
 * Features: Token rotation, batch generation, interactive chat
 *
 * Usage:
 *   zenith "a beautiful sunset"
 *   zenith batch prompts.txt
 *   zenith chat "tell me a joke"
 *   zenith providers add gitee --token YOUR_TOKEN
 *   zenith providers add-token gitee --token ANOTHER_TOKEN
 */

import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import open from 'open'
import fs from 'node:fs/promises'
import path from 'node:path'
import Conf from 'conf'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { generateHuggingFace, HF_MODELS } from './providers/huggingface.js'
import { generateGiteeImage, GITEE_MODELS, chatGitee, GITEE_LLM_MODELS, parseGiteeError } from './providers/gitee.js'
import { generateModelScope, MS_MODELS } from './providers/modelscope.js'
import { generateA4F, A4F_MODELS } from './providers/a4f.js'
import { downloadImage } from './utils/download.js'
import {
  rotationManager,
  runWithTokenRotation,
  categorizeError,
  isRotatableError,
} from './token-rotation.js'
import type { ImageRequest, CliConfig, ProviderEntry } from './types.js'

// ─── Config ──────────────────────────────────────────────────────────────────

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

function getConfig(): CliConfig {
  return { ...DEFAULT_CONFIG, ...store.store }
}

function setConfig(partial: Partial<CliConfig>): void {
  const current = getConfig()
  store.store = { ...current, ...partial }
}

function setProvider(provider: string, entry: ProviderEntry): void {
  const config = getConfig()
  config.providers[provider] = entry
  setConfig({ providers: config.providers })
}

function addTokenToProvider(provider: string, token: string): void {
  const config = getConfig()
  const existing = config.providers[provider]
  const tokens = existing ? [...existing.tokens] : []
  if (!tokens.includes(token)) tokens.push(token)
  setProvider(provider, { tokens, baseUrl: existing?.baseUrl })
}

function removeTokenFromProvider(provider: string, token: string): void {
  const config = getConfig()
  const existing = config.providers[provider]
  if (!existing) return
  const tokens = existing.tokens.filter((t) => t !== token)
  setProvider(provider, { tokens, baseUrl: existing.baseUrl })
}

function getProviderConfig(provider: string): ProviderEntry | undefined {
  return getConfig().providers[provider]
}

function getProviderTokens(provider: string): string[] {
  return getProviderConfig(provider)?.tokens ?? []
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function saveImageToFile(imageUrl: string, outputPath: string): Promise<string> {
  const fullPath = path.resolve(outputPath)
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  return downloadImage(imageUrl, fullPath)
}

function printHeader() {
  console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════════════╗'))
  console.log(chalk.bold.cyan('  ║       ⚡  Zenith Image Generator CLI  ⚡       ║'))
  console.log(chalk.bold.cyan('  ╚══════════════════════════════════════════╝\n'))
}

function printGenerationSummary(req: ImageRequest, result: { model?: string; seed: number }) {
  console.log(chalk.bold.green('\n  ✓ Generation Complete'))
  console.log(chalk.gray('  ─────────────────────────────────'))
  console.log(`  ${chalk.cyan('Model:')} ${result.model ?? 'default'}`)
  console.log(`  ${chalk.cyan('Seed:')}  ${result.seed}`)
  console.log(`  ${chalk.cyan('Size:')}  ${req.width}x${req.height}`)
  if (req.steps) console.log(`  ${chalk.cyan('Steps:')} ${req.steps}`)
  if (req.guidanceScale) console.log(`  ${chalk.cyan('Guidance:')} ${req.guidanceScale}`)
  if (req.negativePrompt) console.log(`  ${chalk.cyan('Negative:')} ${req.negativePrompt}`)
  console.log(chalk.gray('  ─────────────────────────────────\n'))
}

function maskToken(token: string): string {
  if (token.length <= 12) return '••••••••'
  return token.slice(0, 6) + '••••••' + token.slice(-4)
}

// ─── Image Generation Wrappers with Token Rotation ───────────────────────────

async function generateWithRotation(
  provider: string,
  request: ImageRequest,
  tokenOverride?: string
): Promise<ImageResult> {
  const tokens = tokenOverride ? [tokenOverride] : getProviderTokens(provider)
  const allowAnonymous = provider.toLowerCase() === 'huggingface'

  return runWithTokenRotation(
    provider.toLowerCase(),
    tokens,
    async (token) => {
      switch (provider.toLowerCase()) {
        case 'huggingface':
        case 'hf':
          return generateHuggingFace(request, token ?? undefined)
        case 'gitee':
        case 'gitee-ai':
          if (!token) throw new Error('Gitee AI requires a token')
          return generateGiteeImage(request, token)
        case 'modelscope':
        case 'ms':
          if (!token) throw new Error('ModelScope requires a token')
          return generateModelScope(request, token)
        case 'a4f':
          if (!token) throw new Error('A4F requires a token')
          return generateA4F(request, token)
        default:
          throw new Error(`Unknown provider: ${provider}`)
      }
    },
    {
      allowAnonymous,
      onRotate: (token, error) => {
        const cat = categorizeError(error.message)
        console.log(chalk.yellow(`\n  ⚠ Token ${maskToken(token)} exhausted (${cat}). Rotating to next token...`))
      },
    }
  )
}

// ─── CLI Setup ───────────────────────────────────────────────────────────────

const program = new Command()

program
  .name('zenith')
  .description('Multi-provider AI image & chat generation CLI')
  .version('2.0.0')
  .addHelpText(
    'after',
    `
${chalk.bold('Examples:')}
  ${chalk.cyan('$ zenith "a cyberpunk city at night"')}
  ${chalk.cyan('$ zenith generate "a cat in space" -p gitee -m Qwen-Image')}
  ${chalk.cyan('$ zenith batch prompts.txt -p huggingface --delay 2')}
  ${chalk.cyan('$ zenith chat "tell me a joke"')}
  ${chalk.cyan('$ zenith providers add gitee --token YOUR_TOKEN')}
  ${chalk.cyan('$ zenith providers add-token gitee --token ANOTHER_TOKEN')}
  ${chalk.cyan('$ zenith providers status')}
`
  )

// ─── Default: Generate ───────────────────────────────────────────────────────

program
  .argument('[prompt...]', 'Text description of the image to generate')
  .option('-p, --provider <name>', 'Provider (huggingface, gitee, modelscope, a4f)')
  .option('-m, --model <name>', 'Model ID')
  .option('-o, --output <path>', 'Output file path')
  .option('-w, --width <px>', 'Image width')
  .option('-h, --height <px>', 'Image height')
  .option('-s, --steps <n>', 'Inference steps')
  .option('-g, --guidance <scale>', 'Guidance/CFG scale')
  .option('--seed <n>', 'Random seed')
  .option('-n, --negative <prompt>', 'Negative prompt')
  .option('--no-open', "Don't auto-open the image")
  .option('-t, --token <value>', 'API token (overrides config)')
  .action(async (promptParts: string[] | undefined, options: Record<string, any>) => {
    if (!promptParts || promptParts.length === 0) {
      program.help()
      return
    }

    const prompt = promptParts.join(' ')
    const config = getConfig()
    const provider = options.provider || config.defaultProvider
    const model = options.model || config.defaultModel
    const width = Number(options.width) || config.defaultWidth
    const height = Number(options.height) || config.defaultHeight
    const steps = options.steps ? Number(options.steps) : undefined
    const guidanceScale = options.guidance ? Number(options.guidance) : undefined
    const seed = options.seed ? Number(options.seed) : undefined
    const negativePrompt = options.negative || undefined
    const openImage = options.open !== false
    const token = options.token
    const outputBase = options.output || `${config.outputDir}/zenith-${Date.now()}`

    printHeader()
    console.log(chalk.bold('  Prompt:'), chalk.white(`"${prompt}"`))
    console.log(chalk.bold('  Provider:'), chalk.white(provider))
    console.log(chalk.bold('  Model:'), chalk.white(model))
    console.log(chalk.bold('  Dimensions:'), chalk.white(`${width}x${height}`))
    const allTokens = token ? [token] : getProviderTokens(provider)
    if (allTokens.length > 1) {
      console.log(chalk.bold('  Tokens:'), chalk.white(`${allTokens.length} configured (rotation enabled)`))
    }
    console.log()

    const request: ImageRequest = {
      prompt, negativePrompt, model, width, height, steps, guidanceScale, seed,
    }

    try {
      const result = await generateWithRotation(provider, request, token)
      printGenerationSummary(request, result)

      const saveSpinner = ora('  Saving image...').start()
      try {
        const outPath = await saveImageToFile(result.url, outputBase)
        saveSpinner.succeed(chalk.green(`  Image saved: ${outPath}`))
        if (openImage && result.url.startsWith('http')) {
          console.log(chalk.cyan('  Opening image...'))
          await open(outPath)
        }
      } catch (err: any) {
        saveSpinner.fail(chalk.red(`  Failed to save: ${err.message}`))
        console.log(chalk.yellow(`  Image URL: ${result.url}`))
      }
    } catch (err: any) {
      console.error(chalk.red(`\n  ✗ ${err.message}`))
      if (!token && getProviderTokens(provider).length === 0 && provider !== 'huggingface') {
        console.log(chalk.yellow(`  Add a token: zenith providers add ${provider} --token YOUR_TOKEN`))
      }
      process.exit(1)
    }
  })

// ─── Generate Alias ──────────────────────────────────────────────────────────

program
  .command('generate')
  .alias('gen')
  .description('Generate an image (alias for default command)')
  .argument('<prompt>', 'Text description')
  .option('-p, --provider <name>', 'Provider')
  .option('-m, --model <name>', 'Model ID')
  .option('-o, --output <path>', 'Output path')
  .option('-w, --width <px>', 'Image width')
  .option('-h, --height <px>', 'Image height')
  .option('-s, --steps <n>', 'Inference steps')
  .option('-g, --guidance <scale>', 'Guidance scale')
  .option('--seed <n>', 'Random seed')
  .option('-n, --negative <prompt>', 'Negative prompt')
  .option('--no-open', "Don't auto-open")
  .option('-t, --token <value>', 'API token')
  .action((prompt: string, options: Record<string, any>) => {
    program.parse(['node', 'zenith', prompt, ...Object.entries(options).flatMap(([k, v]) => [`--${k}`, String(v)])])
  })

// ─── Batch Command ───────────────────────────────────────────────────────────

const batchCmd = program.command('batch').description('Generate images from a list of prompts')

batchCmd
  .argument('<file>', 'Text file with one prompt per line')
  .option('-p, --provider <name>', 'Provider to use')
  .option('-m, --model <name>', 'Model ID')
  .option('-o, --output-dir <path>', 'Output directory')
  .option('-w, --width <px>', 'Image width')
  .option('-h, --height <px>', 'Image height')
  .option('-s, --steps <n>', 'Inference steps')
  .option('-g, --guidance <scale>', 'Guidance/CFG scale')
  .option('-n, --negative <prompt>', 'Negative prompt')
  .option('--delay <ms>', 'Delay between requests (ms)', '1000')
  .option('-t, --token <value>', 'API token (disables rotation)')
  .option('--no-open', "Don't auto-open images")
  .action(async (file: string, options: Record<string, any>) => {
    const config = getConfig()
    const provider = options.provider || config.defaultProvider
    const model = options.model || config.defaultModel
    const outputDir = options.outputDir || config.outputDir
    const width = Number(options.width) || config.defaultWidth
    const height = Number(options.height) || config.defaultHeight
    const steps = options.steps ? Number(options.steps) : undefined
    const guidanceScale = options.guidance ? Number(options.guidance) : undefined
    const negativePrompt = options.negative || undefined
    const delay = Number(options.delay) || 1000
    const openImage = options.open !== false
    const token = options.token

    printHeader()
    console.log(chalk.bold.cyan('  📦 Batch Image Generation'))
    console.log(chalk.gray('  ─────────────────────────────────'))
    console.log(`  ${chalk.cyan('File:')} ${file}`)
    console.log(`  ${chalk.cyan('Provider:')} ${provider}`)
    console.log(`  ${chalk.cyan('Model:')} ${model}`)
    console.log(`  ${chalk.cyan('Size:')} ${width}x${height}`)
    const allTokens = token ? [token] : getProviderTokens(provider)
    if (allTokens.length > 1) {
      console.log(chalk.bold(`  ${chalk.cyan('Tokens:')} ${allTokens.length} configured (rotation enabled)`))
    }
    console.log(`  ${chalk.cyan('Delay:')} ${delay}ms between requests`)
    console.log()

    // Read prompts
    let lines: string[]
    try {
      const content = await fs.readFile(file, 'utf-8')
      lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'))
    } catch {
      console.error(chalk.red(`  ✗ Cannot read file: ${file}`))
      process.exit(1)
    }

    if (lines.length === 0) {
      console.error(chalk.red('  ✗ No valid prompts found in file'))
      process.exit(1)
    }

    console.log(chalk.bold(`  Found ${lines.length} prompt(s)\n`))
    await fs.mkdir(outputDir, { recursive: true })

    const results: Array<{ prompt: string; success: boolean; path?: string; error?: string }> = []

    for (let i = 0; i < lines.length; i++) {
      const prompt = lines[i]
      const index = i + 1
      console.log(chalk.bold.yellow(`  [${index}/${lines.length}] ${prompt}`))

      try {
        const request: ImageRequest = {
          prompt, negativePrompt, model, width, height, steps, guidanceScale,
        }

        const result = await generateWithRotation(provider, request, token)
        const outPath = path.join(outputDir, `zenith-batch-${Date.now()}-${index}.png`)
        await saveImageToFile(result.url, outPath)
        results.push({ prompt, success: true, path: outPath })
        console.log(chalk.green(`  ✓ Saved: ${outPath}`))
      } catch (err: any) {
        results.push({ prompt, success: false, error: err.message })
        console.log(chalk.red(`  ✗ Failed: ${err.message}`))
      }

      if (i < lines.length - 1 && delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    // Summary
    const successCount = results.filter((r) => r.success).length
    const failCount = results.filter((r) => !r.success).length
    console.log(chalk.bold('\n  ─── Batch Summary ───'))
    console.log(`  ${chalk.green('✓ Success:')} ${successCount}`)
    console.log(`  ${chalk.red('✗ Failed:')} ${failCount}`)
    if (failCount > 0) {
      console.log(chalk.yellow('\n  Failed prompts:'))
      for (const r of results.filter((r) => !r.success)) {
        console.log(`    - "${r.prompt}" → ${r.error}`)
      }
    }
    console.log()

    if (openImage) {
      const successResults = results.filter((r) => r.success && r.path)
      if (successResults.length > 0 && successResults.length <= 5) {
        console.log(chalk.cyan('  Opening generated images...'))
        for (const r of successResults) {
          if (r.path) await open(r.path)
        }
      } else if (successResults.length > 5) {
        console.log(chalk.yellow(`  ${successResults.length} images generated — skipping auto-open (too many)`))
      }
    }
  })

batchCmd
  .command('create <file>')
  .description('Create a sample prompts file')
  .action(async (file: string) => {
    const samplePrompts = [
      '# Zenith CLI — Batch Prompts File',
      '# Lines starting with # are comments',
      '# One prompt per line',
      '',
      'a cyberpunk city at night with neon lights and flying cars',
      'a serene mountain landscape at sunrise, oil painting style',
      'a cute robot reading a book in a cozy library',
      'an underwater coral reef with tropical fish, photorealistic',
      'a steampunk airship above clouds, detailed digital art',
      '',
      '# Add your own prompts below!',
    ]
    await fs.writeFile(file, samplePrompts.join('\n'))
    console.log(chalk.green(`  ✓ Created sample prompts file: ${file}`))
    console.log(chalk.gray('  Edit the file and add your prompts (one per line).'))
    console.log(chalk.gray('  Lines starting with # are comments.\n'))
  })

// ─── Chat Command ────────────────────────────────────────────────────────────

const chatCmd = program.command('chat').description('Chat with LLM providers')

chatCmd
  .argument('[message...]', 'Message to send')
  .option('-p, --provider <name>', 'Provider (gitee)', 'gitee')
  .option('-m, --model <name>', 'Model ID')
  .option('-t, --token <value>', 'API token')
  .option('--max-tokens <n>', 'Max tokens in response', '1000')
  .option('--temperature <n>', 'Temperature (0-2)', '0.7')
  .option('--interactive', 'Start interactive chat session')
  .action(async (messageParts: string[] | undefined, options: Record<string, any>) => {
    if (options.interactive) {
      await interactiveChat(options)
      return
    }

    if (!messageParts || messageParts.length === 0) {
      console.error(chalk.red('  ✗ Please provide a message or use --interactive'))
      console.log(chalk.yellow('  Usage: zenith chat "your message"'))
      console.log(chalk.yellow('  Usage: zenith chat --interactive'))
      process.exit(1)
    }

    const message = messageParts.join(' ')
    const provider = options.provider
    const model = options.model
    const maxTokens = Number(options.maxTokens) || 1000
    const temperature = Number(options.temperature) ?? 0.7

    const tokens = options.token ? [options.token] : getProviderTokens(provider)
    if (tokens.length === 0) {
      console.error(chalk.red(`\n  ✗ ${provider} requires an API token for chat.`))
      console.error(chalk.yellow(`    zenith providers add ${provider} --token YOUR_TOKEN`))
      process.exit(1)
    }

    try {
      const result = await runWithTokenRotation(
        provider,
        tokens,
        async (token) => {
          if (!token) throw new Error('Chat requires a token')
          return chatGitee(
            {
              model: model || (provider === 'gitee' ? 'DeepSeek-V3' : undefined),
              messages: [{ role: 'user', content: message }],
              maxTokens,
              temperature,
            },
            token
          )
        },
        {
          onRotate: (token, error) => {
            console.log(chalk.yellow(`\n  ⚠ Token ${maskToken(token)} exhausted. Rotating...`))
          },
        }
      )

      console.log(chalk.bold.cyan('\n  ╔═══ Response ═══╗'))
      console.log(chalk.white(`  ${result.content}`))
      console.log(chalk.bold.cyan('  ╚════════════════╝\n'))

      if (result.usage) {
        console.log(chalk.gray(`  Tokens: ${result.usage.prompt_tokens} prompt + ${result.usage.completion_tokens} completion = ${result.usage.total_tokens} total`))
        console.log(chalk.gray(`  Model: ${result.model}\n`))
      }
    } catch (err: any) {
      console.error(chalk.red(`\n  ✗ Chat failed: ${err.message}`))
      process.exit(1)
    }
  })

async function interactiveChat(options: Record<string, any>): Promise<void> {
  const provider = options.provider || 'gitee'
  const model = options.model || 'DeepSeek-V3'
  const maxTokens = Number(options.maxTokens) || 1000
  const temperature = Number(options.temperature) ?? 0.7

  const tokens = options.token ? [options.token] : getProviderTokens(provider)
  if (tokens.length === 0) {
    console.error(chalk.red(`\n  ✗ ${provider} requires an API token for chat.`))
    console.error(chalk.yellow(`    zenith providers add ${provider} --token YOUR_TOKEN`))
    process.exit(1)
  }

  const rl = readline.createInterface({ input, output })

  console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════════╗'))
  console.log(chalk.bold.cyan('  ║        ⚡  Zenith Chat Session  ⚡        ║'))
  console.log(chalk.bold.cyan('  ╚══════════════════════════════════════╝\n'))
  console.log(chalk.gray(`  Provider: ${provider}  |  Model: ${model}`))
  if (tokens.length > 1) {
    console.log(chalk.gray(`  Tokens: ${tokens.length} configured (rotation enabled)`))
  }
  console.log(chalk.gray('  Type "exit" or "quit" to end the session\n'))

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

  while (true) {
    const userInput = await rl.question(chalk.bold.cyan('You: ') + chalk.white(''))

    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log(chalk.yellow('\n  Goodbye! 👋\n'))
      break
    }

    messages.push({ role: 'user' as const, content: userInput })

    const spinner = ora('  Thinking...').start()

    try {
      const result = await runWithTokenRotation(
        provider,
        tokens,
        async (token) => {
          if (!token) throw new Error('Chat requires a token')
          return chatGitee({ model, messages, maxTokens, temperature }, token)
        },
        {
          onRotate: (token, error) => {
            console.log(chalk.yellow(`\n  ⚠ Token ${maskToken(token)} exhausted. Rotating...`))
          },
        }
      )

      spinner.stop()
      messages.push({ role: 'assistant' as const, content: result.content })
      console.log(chalk.bold.green('\nAssistant:') + chalk.white(`  ${result.content}\n`))

      if (result.usage) {
        console.log(chalk.gray(`  Tokens: ${result.usage.total_tokens} | Model: ${result.model}\n`))
      }
    } catch (err: any) {
      spinner.fail(`Chat failed: ${err.message}`)
      console.log()
    }
  }

  rl.close()
}

// ─── Config Command ──────────────────────────────────────────────────────────

const configCmd = program.command('config').description('Manage CLI configuration')

configCmd
  .command('list')
  .alias('ls')
  .description('Show all configuration')
  .action(() => {
    const config = getConfig()
    console.log(chalk.bold.cyan('\n  ⚙️  Zenith CLI Configuration'))
    console.log(chalk.gray('  ─────────────────────────────────'))
    console.log(`  ${chalk.cyan('defaultProvider:')}  ${config.defaultProvider}`)
    console.log(`  ${chalk.cyan('defaultModel:')}     ${config.defaultModel}`)
    console.log(`  ${chalk.cyan('defaultWidth:')}     ${config.defaultWidth}`)
    console.log(`  ${chalk.cyan('defaultHeight:')}    ${config.defaultHeight}`)
    console.log(`  ${chalk.cyan('outputDir:')}        ${config.outputDir}`)
    console.log(`  ${chalk.cyan('openAfterGenerate:')}`, config.openAfterGenerate)

    const providerKeys = Object.keys(config.providers)
    if (providerKeys.length > 0) {
      console.log(`\n  ${chalk.cyan('providers:')}`)
      for (const [name, p] of Object.entries(config.providers)) {
        const masked = p.tokens.map((t) => maskToken(t))
        console.log(`    ${chalk.yellow(name)}: ${masked.join(', ')} (${p.tokens.length} token(s))`)
        if (p.baseUrl) console.log(`      baseUrl: ${p.baseUrl}`)
      }
    } else {
      console.log(`\n  ${chalk.gray('(no providers configured)')}`)
    }
    console.log(chalk.gray('  ─────────────────────────────────\n'))
  })

configCmd
  .command('set <key> [value]')
  .description('Set a config value')
  .action((key: string, value: string) => {
    const validKeys = ['defaultProvider', 'defaultModel', 'defaultWidth', 'defaultHeight', 'outputDir', 'openAfterGenerate']
    if (!validKeys.includes(key)) {
      console.error(chalk.red(`  ✗ Invalid key. Valid: ${validKeys.join(', ')}`))
      process.exit(1)
    }
    let parsedValue: any = value
    if (key === 'defaultWidth' || key === 'defaultHeight') parsedValue = Number(value)
    if (key === 'openAfterGenerate') parsedValue = value === 'true'
    setConfig({ [key]: parsedValue })
    console.log(chalk.green(`  ✓ Set ${key} = ${value}`))
  })

configCmd
  .command('get <key>')
  .description('Get a config value')
  .action((key: string) => {
    const config = getConfig()
    if (key in config) {
      console.log(chalk.cyan(key) + ':', chalk.white(JSON.stringify((config as any)[key])))
    } else {
      console.log(chalk.yellow(`  Key not found: ${key}`))
    }
  })

configCmd
  .command('reset [key]')
  .description('Reset config key(s) to default')
  .action((key: string | undefined) => {
    if (key) {
      if (key in DEFAULT_CONFIG) {
        setConfig({ [key]: (DEFAULT_CONFIG as any)[key] })
        console.log(chalk.green(`  ✓ Reset ${key} to default`))
      } else {
        console.error(chalk.red(`  ✗ Invalid key: ${key}`))
      }
    } else {
      setConfig(DEFAULT_CONFIG)
      console.log(chalk.green('  ✓ All config reset to defaults'))
    }
  })

// ─── Providers Command ───────────────────────────────────────────────────────

const providersCmd = program.command('providers').alias('prov').description('Manage API providers')

providersCmd
  .command('list')
  .alias('ls')
  .description('List configured providers')
  .action(() => {
    const config = getConfig()
    const keys = Object.keys(config.providers)
    console.log(chalk.bold.cyan('\n  📡 Configured Providers'))
    console.log(chalk.gray('  ─────────────────────────────────'))
    if (keys.length === 0) {
      console.log(chalk.gray('  No providers configured.'))
      console.log(chalk.yellow('\n  Add one:'))
      console.log(chalk.yellow('    zenith providers add gitee --token YOUR_TOKEN'))
    } else {
      for (const name of keys) {
        const p = config.providers[name]
        const masked = p.tokens.map((t) => maskToken(t)).join(', ')
        const stats = rotationManager.getStats(name, p.tokens)
        const statusColor = stats.exhausted > 0 ? chalk.yellow : chalk.green
        console.log(`  ${statusColor('●')} ${chalk.bold(name)}: ${masked} (${p.tokens.length} token(s))`)
        if (p.baseUrl) console.log(`      baseUrl: ${p.baseUrl}`)
      }
    }
    console.log(chalk.gray('  ─────────────────────────────────\n'))
  })

providersCmd
  .command('add <name>')
  .description('Add a provider with initial token')
  .option('-t, --token <value>', 'API token')
  .option('-b, --baseUrl <url>', 'Custom base URL')
  .action((name: string, options: { token?: string; baseUrl?: string }) => {
    const tokens = options.token ? [options.token] : []
    setProvider(name, { tokens, baseUrl: options.baseUrl })
    console.log(chalk.green(`  ✓ Added provider: ${name}`))
    if (options.token) console.log(chalk.gray('    Token configured'))
    if (options.baseUrl) console.log(chalk.gray(`    Base URL: ${options.baseUrl}`))
    if (!options.token) {
      console.log(chalk.yellow('    Add tokens later: zenith providers add-token <name> --token TOKEN'))
    }
  })

providersCmd
  .command('add-token <name>')
  .alias('add-tokens')
  .description('Add one or more tokens to an existing provider')
  .option('-t, --token <value>', 'API token (can be comma-separated for multiple)')
  .action((name: string, options: { token?: string }) => {
    if (!options.token) {
      console.error(chalk.red('  ✗ Please provide a token with --token'))
      process.exit(1)
    }
    const newTokens = options.token.split(',').map((t) => t.trim()).filter(Boolean)
    const existing = getProviderConfig(name)
    const currentTokens = existing?.tokens ?? []
    let added = 0
    for (const token of newTokens) {
      if (!currentTokens.includes(token)) {
        addTokenToProvider(name, token)
        added++
      }
    }
    if (added > 0) {
      console.log(chalk.green(`  ✓ Added ${added} token(s) to provider: ${name}`))
      console.log(chalk.gray(`    Total tokens: ${getProviderTokens(name).length}`))
    } else {
      console.log(chalk.yellow('  All tokens already exist for this provider'))
    }
  })

providersCmd
  .command('remove-token <name>')
  .description('Remove a token from a provider')
  .option('-t, --token <value>', 'API token to remove')
  .option('--index <n>', 'Remove token by index (1-based)')
  .action((name: string, options: { token?: string; index?: string }) => {
    const tokens = getProviderTokens(name)
    if (tokens.length === 0) {
      console.error(chalk.red(`  ✗ No tokens configured for provider: ${name}`))
      process.exit(1)
    }

    if (options.index) {
      const idx = Number(options.index) - 1
      if (idx < 0 || idx >= tokens.length) {
        console.error(chalk.red(`  ✗ Invalid index. Valid range: 1-${tokens.length}`))
        process.exit(1)
      }
      const removed = tokens[idx]
      removeTokenFromProvider(name, removed)
      console.log(chalk.green(`  ✓ Removed token ${idx + 1}: ${maskToken(removed)}`))
    } else if (options.token) {
      if (!tokens.includes(options.token)) {
        console.error(chalk.red('  ✗ Token not found for this provider'))
        process.exit(1)
      }
      removeTokenFromProvider(name, options.token)
      console.log(chalk.green(`  ✓ Removed token: ${maskToken(options.token)}`))
    } else {
      console.error(chalk.red('  ✗ Specify --token or --index'))
      process.exit(1)
    }
    console.log(chalk.gray(`    Remaining tokens: ${getProviderTokens(name).length}`))
  })

providersCmd
  .command('remove <name>')
  .alias('rm')
  .description('Remove a provider and all its tokens')
  .action((name: string) => {
    const config = getConfig()
    if (config.providers[name]) {
      const count = config.providers[name].tokens.length
      delete config.providers[name]
      setConfig({ providers: config.providers })
      console.log(chalk.green(`  ✓ Removed provider: ${name} (${count} token(s) deleted)`))
    } else {
      console.log(chalk.yellow(`  Provider not found: ${name}`))
    }
  })

providersCmd
  .command('status [provider]')
  .alias('stats')
  .description('Show token rotation status for providers')
  .action((provider: string | undefined) => {
    const config = getConfig()
    const keys = provider ? [provider] : Object.keys(config.providers)

    if (keys.length === 0) {
      console.log(chalk.gray('  No providers configured.\n'))
      return
    }

    console.log(chalk.bold.cyan('\n  📊 Token Rotation Status'))
    console.log(chalk.gray('  ─────────────────────────────────'))

    for (const name of keys) {
      const tokens = getProviderTokens(name)
      if (tokens.length === 0) {
        console.log(`\n  ${chalk.yellow('●')} ${chalk.bold(name)}: no tokens configured`)
        continue
      }

      const stats = rotationManager.getStats(name, tokens)
      const allExhausted = rotationManager.allExhausted(name, tokens)

      console.log(`\n  ${chalk.bold(name)}`)
      console.log(`    Total:     ${stats.total}`)
      console.log(`    Active:    ${chalk.green(stats.active)}`)
      console.log(`    Exhausted: ${allExhausted ? chalk.red(stats.exhausted) : chalk.yellow(stats.exhausted)}`)

      if (tokens.length <= 10) {
        console.log('    Tokens:')
        for (let i = 0; i < tokens.length; i++) {
          const isExhausted = rotationManager.getStats(name, tokens).exhausted > 0
          const icon = isRotatableError('quota' as any) ? '○' : '●'
          console.log(`      ${chalk.gray(`${i + 1}.`)} ${maskToken(tokens[i])}`)
        }
      }
    }
    console.log(chalk.gray('  ─────────────────────────────────\n'))
  })

providersCmd
  .command('reset-tokens <provider>')
  .description('Reset exhausted token tracking (makes all tokens active again)')
  .action((provider: string) => {
    rotationManager.reset(provider)
    console.log(chalk.green(`  ✓ Reset token exhaustion tracking for: ${provider}`))
    console.log(chalk.gray('    All tokens are now marked as active.\n'))
  })

providersCmd
  .command('models [provider]')
  .description('List available models')
  .action((provider: string | undefined) => {
    console.log(chalk.bold.cyan('\n  🤖 Available Models'))
    console.log(chalk.gray('  ─────────────────────────────────'))

    const showAll = !provider
    if (showAll || provider === 'huggingface' || provider === 'hf') {
      console.log(chalk.bold.yellow('\n  HuggingFace (free):'))
      for (const m of HF_MODELS) {
        console.log(`    ${chalk.green('●')} ${m.name}  ${chalk.gray(m.description || '')}`)
      }
    }

    if (showAll || provider === 'gitee') {
      console.log(chalk.bold.yellow('\n  Gitee AI (token required):'))
      console.log(chalk.gray('    Image Models:'))
      for (const m of GITEE_MODELS) {
        console.log(`      ${chalk.green('●')} ${m.name}`)
      }
      console.log(chalk.gray('    LLM Models:'))
      for (const m of GITEE_LLM_MODELS) {
        console.log(`      ${chalk.green('●')} ${m.name}`)
      }
    }

    if (showAll || provider === 'modelscope' || provider === 'ms') {
      console.log(chalk.bold.yellow('\n  ModelScope (token required):'))
      for (const m of MS_MODELS) {
        console.log(`    ${chalk.green('●')} ${m.name}  ${chalk.gray(m.id)}`)
      }
    }

    if (showAll || provider === 'a4f') {
      console.log(chalk.bold.yellow('\n  A4F (token required):'))
      for (const m of A4F_MODELS) {
        console.log(`    ${chalk.green('●')} ${m.name}  ${chalk.gray(m.id)}`)
      }
    }

    console.log(chalk.gray('  ─────────────────────────────────\n'))
  })

// ─── Download Command ────────────────────────────────────────────────────────

program
  .command('download')
  .alias('dl')
  .description('Download an image from a URL')
  .argument('<url>', 'Image URL')
  .option('-o, --output <path>', 'Output path', './output/zenith.png')
  .action(async (url: string, options: { output: string }) => {
    const spinner = ora('  Downloading...').start()
    try {
      const outPath = await saveImageToFile(url, options.output)
      spinner.succeed(chalk.green(`  Downloaded: ${outPath}`))
    } catch (err: any) {
      spinner.fail(chalk.red(`  Failed: ${err.message}`))
      process.exit(1)
    }
  })

program.parse()
