#!/usr/bin/env node

/**
 * Zenith CLI v2 — Multi-provider AI image & chat generation
 *
 * Providers: HuggingFace (free), Gitee AI, ModelScope, A4F
 * Features:  Token rotation, batch generation, interactive chat
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
import { generateGitee, GITEE_MODELS, chatGitee, GITEE_LLM_MODELS } from './providers/gitee.js'
import { generateModelScope, MS_MODELS } from './providers/modelscope.js'
import { generateA4F, A4F_MODELS } from './providers/a4f.js'
import { downloadImage } from './utils/download.js'
import {
  rotationManager,
  runWithTokenRotation,
  categorizeError,
} from './token-rotation.js'
import type { ImageRequest, ImageResult, CliConfig, ProviderEntry } from './types.js'

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
  store.store = { ...getConfig(), ...partial }
}

function setProvider(provider: string, entry: ProviderEntry): void {
  const c = getConfig()
  c.providers[provider] = entry
  setConfig({ providers: c.providers })
}

function addToken(provider: string, token: string): void {
  const c = getConfig()
  const existing = c.providers[provider]
  const tokens = existing ? [...existing.tokens] : []
  if (!tokens.includes(token)) tokens.push(token)
  setProvider(provider, { tokens, baseUrl: existing?.baseUrl })
}

function removeToken(provider: string, token: string): void {
  const c = getConfig()
  const existing = c.providers[provider]
  if (!existing) return
  setProvider(provider, { tokens: existing.tokens.filter(t => t !== token), baseUrl: existing.baseUrl })
}

function getProviderTokens(p: string): string[] {
  return getConfig().providers[p]?.tokens ?? []
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function saveImage(url: string, outPath: string): Promise<string> {
  const full = path.resolve(outPath)
  await fs.mkdir(path.dirname(full), { recursive: true })
  return downloadImage(url, full)
}

function printHeader() {
  console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════════════╗'))
  console.log(chalk.bold.cyan('  ║       ⚡  Zenith Image Generator CLI  ⚡       ║'))
  console.log(chalk.bold.cyan('  ╚══════════════════════════════════════════╝\n'))
}

function maskToken(t: string): string {
  if (t.length <= 12) return '••••••••'
  return t.slice(0, 6) + '••••••' + t.slice(-4)
}

// ─── Generation with Token Rotation ──────────────────────────────────────────

async function generateWithRotation(
  provider: string, request: ImageRequest, overrideToken?: string
): Promise<ImageResult> {
  const tokens = overrideToken ? [overrideToken] : getProviderTokens(provider)
  return runWithTokenRotation(
    provider.toLowerCase(), tokens,
    async (tok) => {
      switch (provider.toLowerCase()) {
        case 'huggingface': case 'hf':
          return generateHuggingFace(request, tok ?? undefined)
        case 'gitee': case 'gitee-ai':
          if (!tok) throw new Error('Gitee AI requires a token')
          return generateGitee(request, tok)
        case 'modelscope': case 'ms':
          if (!tok) throw new Error('ModelScope requires a token')
          return generateModelScope(request, tok)
        case 'a4f':
          if (!tok) throw new Error('A4F requires a token')
          return generateA4F(request, tok)
        default:
          throw new Error(`Unknown provider: ${provider}`)
      }
    },
    {
      allowAnonymous: provider.toLowerCase() === 'huggingface',
      onRotate: (tok, err) => {
        const cat = categorizeError(err.message)
        console.log(chalk.yellow(`\n  ⚠ Token ${maskToken(tok)} exhausted (${cat}). Rotating to next token...`))
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
  .enablePositionalOptions()

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
  .option('--token <value>', 'API token (overrides config)')
  .action(async (promptParts: string[] | undefined, opts: Record<string, any>) => {
    if (!promptParts || promptParts.length === 0) { program.help(); return }

    const prompt = promptParts.join(' ')
    const cfg = getConfig()
    const provider = opts.provider || cfg.defaultProvider
    const model = opts.model || cfg.defaultModel
    const width = Number(opts.width) || cfg.defaultWidth
    const height = Number(opts.height) || cfg.defaultHeight
    const steps = opts.steps ? Number(opts.steps) : undefined
    const guidanceScale = opts.guidance ? Number(opts.guidance) : undefined
    const seed = opts.seed ? Number(opts.seed) : undefined
    const negativePrompt = opts.negative || undefined
    const openImage = opts.open !== false
    const token = opts.token
    const outputBase = opts.output || `${cfg.outputDir}/zenith-${Date.now()}`

    printHeader()
    console.log(chalk.bold('  Prompt:'), chalk.white(`"${prompt}"`))
    console.log(chalk.bold('  Provider:'), chalk.white(provider))
    console.log(chalk.bold('  Model:'), chalk.white(model))
    console.log(chalk.bold('  Dimensions:'), chalk.white(`${width}x${height}`))
    const allTok = token ? [token] : getProviderTokens(provider)
    if (allTok.length > 1) console.log(chalk.bold('  Tokens:'), chalk.white(`${allTok.length} configured (rotation enabled)`))
    console.log()

    const request: ImageRequest = { prompt, negativePrompt, model, width, height, steps, guidanceScale, seed }

    try {
      const result = await generateWithRotation(provider, request, token)
      console.log(chalk.bold.green('\n  ✓ Generation Complete'))
      console.log(chalk.gray('  ─────────────────────────────────'))
      console.log(`  ${chalk.cyan('Model:')} ${result.model ?? 'default'}`)
      console.log(`  ${chalk.cyan('Seed:')}  ${result.seed}`)
      console.log(`  ${chalk.cyan('Size:')}  ${width}x${height}`)
      console.log(chalk.gray('  ─────────────────────────────────\n'))

      const saveSpinner = ora('  Saving image...').start()
      try {
        const outPath = await saveImage(result.url, outputBase)
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

// ─── Generate alias ──────────────────────────────────────────────────────────

program
  .command('generate').alias('gen')
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
  .option('--token <value>', 'API token')
  .action((prompt: string, opts: Record<string, any>) => {
    program.parse(['node', 'zenith', prompt, ...Object.entries(opts).flatMap(([k, v]) => [`--${k}`, String(v)])])
  })

// ─── Batch ───────────────────────────────────────────────────────────────────

const batchCmd = program.command('batch').description('Generate images from a list of prompts')

batchCmd
  .argument('<file>', 'Text file with one prompt per line')
  .option('-p, --provider <name>', 'Provider to use')
  .option('-m, --model <name>', 'Model ID')
  .option('-o, --output-dir <path>', 'Output directory')
  .option('-w, --width <px>', 'Image width')
  .option('-h, --height <px>', 'Image height')
  .option('-s, --steps <n>', 'Inference steps')
  .option('-g, --guidance <scale>', 'Guidance scale')
  .option('-n, --negative <prompt>', 'Negative prompt')
  .option('--delay <ms>', 'Delay between requests (ms)', '1000')
  .option('--token <value>', 'API token (disables rotation)')
  .option('--no-open', "Don't auto-open images")
  .action(async (file: string, opts: Record<string, any>) => {
    const cfg = getConfig()
    const provider = opts.provider || cfg.defaultProvider
    const model = opts.model || cfg.defaultModel
    const outputDir = opts.outputDir || cfg.outputDir
    const width = Number(opts.width) || cfg.defaultWidth
    const height = Number(opts.height) || cfg.defaultHeight
    const steps = opts.steps ? Number(opts.steps) : undefined
    const guidanceScale = opts.guidance ? Number(opts.guidance) : undefined
    const negativePrompt = opts.negative || undefined
    const delay = Number(opts.delay) || 1000
    const openImage = opts.open !== false
    const token = opts.token

    printHeader()
    console.log(chalk.bold.cyan('  📦 Batch Image Generation'))
    console.log(chalk.gray('  ─────────────────────────────────'))
    console.log(`  ${chalk.cyan('File:')} ${file}`)
    console.log(`  ${chalk.cyan('Provider:')} ${provider}`)
    console.log(`  ${chalk.cyan('Model:')} ${model}`)
    console.log(`  ${chalk.cyan('Size:')} ${width}x${height}`)
    const allTok = token ? [token] : getProviderTokens(provider)
    if (allTok.length > 1) console.log(chalk.bold(`  ${chalk.cyan('Tokens:')} ${allTok.length} configured (rotation enabled)`))
    console.log(`  ${chalk.cyan('Delay:')} ${delay}ms between requests\n`)

    let lines: string[]
    try {
      const content = await fs.readFile(file, 'utf-8')
      lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'))
    } catch { console.error(chalk.red(`  ✗ Cannot read file: ${file}`)); process.exit(1) }
    if (lines.length === 0) { console.error(chalk.red('  ✗ No valid prompts found')); process.exit(1) }

    console.log(chalk.bold(`  Found ${lines.length} prompt(s)\n`))
    await fs.mkdir(outputDir, { recursive: true })

    const results: Array<{ prompt: string; success: boolean; path?: string; error?: string }> = []

    for (let i = 0; i < lines.length; i++) {
      const p = lines[i]
      const idx = i + 1
      console.log(chalk.bold.yellow(`  [${idx}/${lines.length}] ${p}`))
      try {
        const req: ImageRequest = { prompt: p, negativePrompt, model, width, height, steps, guidanceScale }
        const result = await generateWithRotation(provider, req, token)
        const outPath = path.join(outputDir, `zenith-batch-${Date.now()}-${idx}.png`)
        await saveImage(result.url, outPath)
        results.push({ prompt: p, success: true, path: outPath })
        console.log(chalk.green(`  ✓ Saved: ${outPath}`))
      } catch (err: any) {
        results.push({ prompt: p, success: false, error: err.message })
        console.log(chalk.red(`  ✗ Failed: ${err.message}`))
      }
      if (i < lines.length - 1 && delay > 0) await new Promise(r => setTimeout(r, delay))
    }

    const ok = results.filter(r => r.success).length
    const fail = results.filter(r => !r.success).length
    console.log(chalk.bold('\n  ─── Batch Summary ───'))
    console.log(`  ${chalk.green('✓ Success:')} ${ok}`)
    console.log(`  ${chalk.red('✗ Failed:')} ${fail}`)
    if (fail > 0) {
      console.log(chalk.yellow('\n  Failed prompts:'))
      for (const r of results.filter(r => !r.success)) console.log(`    - "${r.prompt}" → ${r.error}`)
    }
    console.log()

    if (openImage) {
      const okRes = results.filter(r => r.success && r.path)
      if (okRes.length > 0 && okRes.length <= 5) {
        console.log(chalk.cyan('  Opening generated images...'))
        for (const r of okRes) if (r.path) await open(r.path)
      } else if (okRes.length > 5) {
        console.log(chalk.yellow(`  ${okRes.length} images generated — skipping auto-open (too many)`))
      }
    }
  })

batchCmd.command('create <file>').description('Create a sample prompts file')
  .action(async (file: string) => {
    const sample = [
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
    await fs.writeFile(file, sample.join('\n'))
    console.log(chalk.green(`  ✓ Created sample prompts file: ${file}\n`))
  })

// ─── Chat ────────────────────────────────────────────────────────────────────

const chatCmd = program.command('chat').description('Chat with LLM providers')

chatCmd
  .argument('[message...]', 'Message to send')
  .option('-p, --provider <name>', 'Provider (gitee)', 'gitee')
  .option('-m, --model <name>', 'Model ID')
  .option('--token <value>', 'API token')
  .option('--max-tokens <n>', 'Max tokens in response', '1000')
  .option('--temperature <n>', 'Temperature (0-2)', '0.7')
  .option('--interactive', 'Start interactive chat session')
  .action(async (msgParts: string[] | undefined, opts: Record<string, any>) => {
    if (opts.interactive) { await interactiveChat(opts); return }
    if (!msgParts || msgParts.length === 0) {
      console.error(chalk.red('  ✗ Please provide a message or use --interactive'))
      console.log(chalk.yellow('  Usage: zenith chat "your message"'))
      console.log(chalk.yellow('  Usage: zenith chat --interactive'))
      process.exit(1)
    }

    const msg = msgParts.join(' ')
    const prov = opts.provider
    const mdl = opts.model
    const maxT = Number(opts.maxTokens) || 1000
    const temp = Number(opts.temperature) ?? 0.7
    const toks = opts.token ? [opts.token] : getProviderTokens(prov)

    if (toks.length === 0) {
      console.error(chalk.red(`\n  ✗ ${prov} requires an API token for chat.`))
      console.error(chalk.yellow(`    zenith providers add ${prov} --token YOUR_TOKEN`))
      process.exit(1)
    }

    try {
      const result = await runWithTokenRotation(
        prov, toks,
        async (tok) => {
          if (!tok) throw new Error('Chat requires a token')
          return chatGitee({ model: mdl || (prov === 'gitee' ? 'DeepSeek-V3' : undefined), messages: [{ role: 'user', content: msg }], maxTokens: maxT, temperature: temp }, tok)
        },
        { onRotate: (tok) => { console.log(chalk.yellow(`\n  ⚠ Token ${maskToken(tok)} exhausted. Rotating...`)) } }
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

async function interactiveChat(opts: Record<string, any>): Promise<void> {
  const prov = opts.provider || 'gitee'
  const mdl = opts.model || 'DeepSeek-V3'
  const maxT = Number(opts.maxTokens) || 1000
  const temp = Number(opts.temperature) ?? 0.7
  const toks = opts.token ? [opts.token] : getProviderTokens(prov)

  if (toks.length === 0) {
    console.error(chalk.red(`\n  ✗ ${prov} requires an API token.`))
    console.error(chalk.yellow(`    zenith providers add ${prov} --token YOUR_TOKEN`))
    process.exit(1)
  }

  const rl = readline.createInterface({ input, output })

  console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════════╗'))
  console.log(chalk.bold.cyan('  ║        ⚡  Zenith Chat Session  ⚡        ║'))
  console.log(chalk.bold.cyan('  ╚══════════════════════════════════════╝\n'))
  console.log(chalk.gray(`  Provider: ${prov}  |  Model: ${mdl}`))
  if (toks.length > 1) console.log(chalk.gray(`  Tokens: ${toks.length} configured (rotation enabled)`))
  console.log(chalk.gray('  Type "exit" or "quit" to end\n'))

  const messages: Array<{ role: string; content: string }> = []

  while (true) {
    const userInput = await rl.question(chalk.bold.cyan('You: '))
    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log(chalk.yellow('\n  Goodbye! 👋\n'))
      break
    }
    messages.push({ role: 'user', content: userInput })
    const spinner = ora('  Thinking...').start()

    try {
      const result = await runWithTokenRotation(
        prov, toks,
        async (tok) => {
          if (!tok) throw new Error('Chat requires a token')
          return chatGitee({ model: mdl, messages, maxTokens: maxT, temperature: temp }, tok)
        },
        { onRotate: (tok) => { console.log(chalk.yellow(`\n  ⚠ Token ${maskToken(tok)} exhausted. Rotating...`)) } }
      )
      spinner.stop()
      messages.push({ role: 'assistant', content: result.content })
      console.log(chalk.bold.green('\nAssistant:') + ' ' + chalk.white(result.content) + '\n')
      if (result.usage) console.log(chalk.gray(`  Tokens: ${result.usage.total_tokens} | Model: ${result.model}\n`))
    } catch (err: any) {
      spinner.fail(`Chat failed: ${err.message}`)
      console.log()
    }
  }
  rl.close()
}

// ─── Config ──────────────────────────────────────────────────────────────────

const configCmd = program.command('config').description('Manage CLI configuration')

configCmd.command('list').alias('ls').description('Show all configuration')
  .action(() => {
    const cfg = getConfig()
    console.log(chalk.bold.cyan('\n  ⚙️  Zenith CLI Configuration'))
    console.log(chalk.gray('  ─────────────────────────────────'))
    console.log(`  ${chalk.cyan('defaultProvider:')}  ${cfg.defaultProvider}`)
    console.log(`  ${chalk.cyan('defaultModel:')}     ${cfg.defaultModel}`)
    console.log(`  ${chalk.cyan('defaultWidth:')}     ${cfg.defaultWidth}`)
    console.log(`  ${chalk.cyan('defaultHeight:')}    ${cfg.defaultHeight}`)
    console.log(`  ${chalk.cyan('outputDir:')}        ${cfg.outputDir}`)
    console.log(`  ${chalk.cyan('openAfterGenerate:')}`, cfg.openAfterGenerate)
    const pKeys = Object.keys(cfg.providers)
    if (pKeys.length > 0) {
      console.log(`\n  ${chalk.cyan('providers:')}`)
      for (const [name, p] of Object.entries(cfg.providers)) {
        console.log(`    ${chalk.yellow(name)}: ${p.tokens.map(t => maskToken(t)).join(', ')} (${p.tokens.length} token(s))`)
        if (p.baseUrl) console.log(`      baseUrl: ${p.baseUrl}`)
      }
    } else {
      console.log(`\n  ${chalk.gray('(no providers configured)')}`)
    }
    console.log(chalk.gray('  ─────────────────────────────────\n'))
  })

configCmd.command('set <key> [value]').description('Set a config value')
  .action((key: string, value: string) => {
    const validKeys = ['defaultProvider', 'defaultModel', 'defaultWidth', 'defaultHeight', 'outputDir', 'openAfterGenerate']
    if (!validKeys.includes(key)) {
      console.error(chalk.red(`  ✗ Invalid key. Valid: ${validKeys.join(', ')}`))
      process.exit(1)
    }
    let parsed: any = value
    if (key === 'defaultWidth' || key === 'defaultHeight') parsed = Number(value)
    if (key === 'openAfterGenerate') parsed = value === 'true'
    setConfig({ [key]: parsed })
    console.log(chalk.green(`  ✓ Set ${key} = ${value}`))
  })

configCmd.command('get <key>').description('Get a config value')
  .action((key: string) => {
    const cfg = getConfig()
    if (key in cfg) console.log(chalk.cyan(key) + ':', chalk.white(JSON.stringify((cfg as any)[key])))
    else console.log(chalk.yellow(`  Key not found: ${key}`))
  })

configCmd.command('reset [key]').description('Reset config key(s) to default')
  .action((key: string | undefined) => {
    if (key) {
      if (key in DEFAULT_CONFIG) { setConfig({ [key]: (DEFAULT_CONFIG as any)[key] }); console.log(chalk.green(`  ✓ Reset ${key}`)) }
      else console.error(chalk.red(`  ✗ Invalid key: ${key}`))
    } else { setConfig(DEFAULT_CONFIG); console.log(chalk.green('  ✓ All config reset to defaults')) }
  })

// ─── Providers ───────────────────────────────────────────────────────────────

const provCmd = program.command('providers').alias('prov').description('Manage API providers')

provCmd.command('list').alias('ls').description('List configured providers')
  .action(() => {
    const cfg = getConfig()
    const keys = Object.keys(cfg.providers)
    console.log(chalk.bold.cyan('\n  📡 Configured Providers'))
    console.log(chalk.gray('  ─────────────────────────────────'))
    if (keys.length === 0) {
      console.log(chalk.gray('  No providers configured.'))
      console.log(chalk.yellow('\n  Add one:'))
      console.log(chalk.yellow('    zenith providers add gitee --token YOUR_TOKEN'))
    } else {
      for (const name of keys) {
        const p = cfg.providers[name]
        const masked = p.tokens.map(t => maskToken(t)).join(', ')
        console.log(`  ${chalk.green('●')} ${chalk.bold(name)}: ${masked} (${p.tokens.length} token(s))`)
        if (p.baseUrl) console.log(`      baseUrl: ${p.baseUrl}`)
      }
    }
    console.log(chalk.gray('  ─────────────────────────────────\n'))
  })

provCmd.command('add <name>').description('Add a provider with initial token')
  .option('--token <value>', 'API token')
  .option('--baseUrl <url>', 'Custom base URL')
  .action((name: string, opts: Record<string, any>) => {
    const tokens = opts.token ? [opts.token] : []
    setProvider(name, { tokens, baseUrl: opts.baseUrl })
    console.log(chalk.green(`  ✓ Added provider: ${name}`))
    if (opts.token) console.log(chalk.gray('    Token configured'))
    if (opts.baseUrl) console.log(chalk.gray(`    Base URL: ${opts.baseUrl}`))
    if (!opts.token) console.log(chalk.yellow('    Add tokens later: zenith providers add-token <name> --token TOKEN'))
  })

provCmd.command('add-token <name>').alias('add-tokens').description('Add tokens to an existing provider')
  .option('--token <value>', 'API token (comma-separated for multiple)')
  .action((name: string, opts: Record<string, any>) => {
    if (!opts.token) { console.error(chalk.red('  ✗ Provide --token')); process.exit(1) }
    const newTokens = opts.token.split(',').map((t: string) => t.trim()).filter(Boolean)
    const existing = getConfig().providers[name]
    const currentTokens = existing?.tokens ?? []
    let added = 0
    for (const token of newTokens) {
      if (!currentTokens.includes(token)) { addToken(name, token); added++ }
    }
    if (added > 0) {
      console.log(chalk.green(`  ✓ Added ${added} token(s) to: ${name}`))
      console.log(chalk.gray(`    Total tokens: ${getProviderTokens(name).length}`))
    } else {
      console.log(chalk.yellow('  All tokens already exist'))
    }
  })

provCmd.command('remove-token <name>').description('Remove a token from a provider')
  .option('--token <value>', 'API token to remove')
  .option('--index <n>', 'Remove by index (1-based)')
  .action((name: string, opts: Record<string, any>) => {
    const tokens = getProviderTokens(name)
    if (tokens.length === 0) { console.error(chalk.red(`  ✗ No tokens for: ${name}`)); process.exit(1) }
    if (opts.index) {
      const idx = Number(opts.index) - 1
      if (idx < 0 || idx >= tokens.length) { console.error(chalk.red(`  ✗ Invalid index. Range: 1-${tokens.length}`)); process.exit(1) }
      const removed = tokens[idx]
      removeToken(name, removed)
      console.log(chalk.green(`  ✓ Removed token ${idx + 1}: ${maskToken(removed)}`))
    } else if (opts.token) {
      if (!tokens.includes(opts.token)) { console.error(chalk.red('  ✗ Token not found')); process.exit(1) }
      removeToken(name, opts.token)
      console.log(chalk.green(`  ✓ Removed token: ${maskToken(opts.token)}`))
    } else { console.error(chalk.red('  ✗ Specify --token or --index')); process.exit(1) }
    console.log(chalk.gray(`    Remaining: ${getProviderTokens(name).length}`))
  })

provCmd.command('remove <name>').alias('rm').description('Remove a provider and all tokens')
  .action((name: string) => {
    const cfg = getConfig()
    if (cfg.providers[name]) {
      const count = cfg.providers[name].tokens.length
      delete cfg.providers[name]
      setConfig({ providers: cfg.providers })
      console.log(chalk.green(`  ✓ Removed provider: ${name} (${count} token(s) deleted)`))
    } else { console.log(chalk.yellow(`  Provider not found: ${name}`)) }
  })

provCmd.command('status [provider]').alias('stats').description('Show token rotation status')
  .action((provider: string | undefined) => {
    const cfg = getConfig()
    const keys = provider ? [provider] : Object.keys(cfg.providers)
    if (keys.length === 0) { console.log(chalk.gray('  No providers configured.\n')); return }
    console.log(chalk.bold.cyan('\n  📊 Token Rotation Status'))
    console.log(chalk.gray('  ─────────────────────────────────'))
    for (const name of keys) {
      const tokens = getProviderTokens(name)
      if (tokens.length === 0) { console.log(`\n  ${chalk.yellow('●')} ${chalk.bold(name)}: no tokens configured`); continue }
      const stats = rotationManager.getStats(name, tokens)
      const allExhausted = stats.active === 0
      console.log(`\n  ${chalk.bold(name)}`)
      console.log(`    Total:     ${stats.total}`)
      console.log(`    Active:    ${chalk.green(stats.active)}`)
      console.log(`    Exhausted: ${allExhausted ? chalk.red(stats.exhausted) : chalk.yellow(stats.exhausted)}`)
      if (tokens.length <= 10) {
        console.log('    Tokens:')
        for (let i = 0; i < tokens.length; i++) console.log(`      ${chalk.gray(`${i + 1}.`)} ${maskToken(tokens[i])}`)
      }
    }
    console.log(chalk.gray('  ─────────────────────────────────\n'))
  })

provCmd.command('reset-tokens <provider>').description('Reset exhausted token tracking')
  .action((provider: string) => {
    rotationManager.reset(provider)
    console.log(chalk.green(`  ✓ Reset token exhaustion tracking for: ${provider}`))
    console.log(chalk.gray('    All tokens are now marked as active.\n'))
  })

provCmd.command('models [provider]').description('List available models')
  .action((provider: string | undefined) => {
    console.log(chalk.bold.cyan('\n  🤖 Available Models'))
    console.log(chalk.gray('  ─────────────────────────────────'))
    const showAll = !provider
    if (showAll || provider === 'huggingface' || provider === 'hf') {
      console.log(chalk.bold.yellow('\n  HuggingFace (free):'))
      for (const m of HF_MODELS) console.log(`    ${chalk.green('●')} ${m.name}  ${chalk.gray(m.description || '')}`)
    }
    if (showAll || provider === 'gitee') {
      console.log(chalk.bold.yellow('\n  Gitee AI (token required):'))
      console.log(chalk.gray('    Image Models:'))
      for (const m of GITEE_MODELS) console.log(`      ${chalk.green('●')} ${m.name}`)
      console.log(chalk.gray('    LLM Models:'))
      for (const m of GITEE_LLM_MODELS) console.log(`      ${chalk.green('●')} ${m.name}`)
    }
    if (showAll || provider === 'modelscope' || provider === 'ms') {
      console.log(chalk.bold.yellow('\n  ModelScope (token required):'))
      for (const m of MS_MODELS) console.log(`    ${chalk.green('●')} ${m.name}  ${chalk.gray(m.id)}`)
    }
    if (showAll || provider === 'a4f') {
      console.log(chalk.bold.yellow('\n  A4F (token required):'))
      for (const m of A4F_MODELS) console.log(`    ${chalk.green('●')} ${m.name}  ${chalk.gray(m.id)}`)
    }
    console.log(chalk.gray('  ─────────────────────────────────\n'))
  })

// ─── Download ────────────────────────────────────────────────────────────────

program.command('download').alias('dl').description('Download an image from a URL')
  .argument('<url>', 'Image URL')
  .option('-o, --output <path>', 'Output path', './output/zenith.png')
  .action(async (url: string, opts: Record<string, any>) => {
    const spinner = ora('  Downloading...').start()
    try {
      const outPath = await saveImage(url, opts.output)
      spinner.succeed(chalk.green(`  Downloaded: ${outPath}`))
    } catch (err: any) { spinner.fail(chalk.red(`  Failed: ${err.message}`)); process.exit(1) }
  })

program.parse()
