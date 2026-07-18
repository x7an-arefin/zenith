# Zenith CLI ⚡

A powerful command-line interface for AI image generation, supporting multiple providers with a unified, channel-based architecture. Built as a CLI adaptation of [zenith-image-generator](https://github.com/WuMingDao/zenith-image-generator).

## Features

- 🎨 **Multi-Provider Support** — HuggingFace (free), ModelScope, A4F
- 🔐 **Token Management** — Secure per-provider token configuration with masking
- ⚙️ **Persistent Configuration** — Settings saved between sessions
- 📥 **Auto-Download** — Images saved locally with format detection
- 🖼️ **Auto-Open** — View generated images immediately
- 🌱 **Reproducible** — Seed control for consistent outputs
- 🔧 **Extensible** — Channel-based architecture for adding new providers

## Quick Start

```bash
# Generate an image (uses HuggingFace, no token needed)
npx tsx src/cli.ts "a cyberpunk city at night, neon lights, rain"

# Specify a provider and model
npx tsx src/cli.ts "a cat in space" --provider huggingface --model flux-1-schnell

# Set dimensions and seed
npx tsx src/cli.ts "portrait of a wizard" -w 512 -h 768 --seed 42

# Don't auto-open the image
npx tsx src/cli.ts "mountain landscape" --no-open
```

## Setup

```bash
# Install dependencies
npm install

# Build
npm run build

# Run
node dist/cli.js "your prompt here"

# Or use tsx for development
npx tsx src/cli.ts "your prompt here"

# Link globally (optional)
npm link
zenith "your prompt here"
```

## Commands

### Generate Images

```bash
# Default (HuggingFace, no token required)
zenith "a beautiful sunset over the ocean"

# With provider
zenith "sci-fi spaceship" --provider huggingface --model flux-1-schnell

# With dimensions
zenith "portrait" -w 512 -h 768

# With seed for reproducibility
zenith "abstract art" --seed 42

# With negative prompt
zenith "a dog" --negative "blurry, low quality"

# With inference steps
zenith "detailed landscape" --steps 30

# With guidance scale
zenith "creative art" --guidance 7.5

# Custom output path
zenith "nature scene" --output ./my-images/scene.png

# With API token (for providers that require it)
zenith "photo" --provider modelscope --token YOUR_TOKEN
zenith "photo" --provider a4f --token YOUR_TOKEN
```

### Configuration

```bash
# List all settings
zenith config list

# Set default provider
zenith config set defaultProvider modelscope

# Set default model
zenith config set defaultModel flux-1-schnell

# Set default dimensions
zenith config set defaultWidth 512
zenith config set defaultHeight 768

# Set output directory
zenith config set outputDir ./images

# Get a specific setting
zenith config get defaultProvider

# Reset a setting to default
zenith config unset defaultProvider
```

### Provider Management

```bash
# List configured providers
zenith providers list

# Add a provider with token
zenith providers add modelscope --token YOUR_TOKEN
zenith providers add a4f --token YOUR_TOKEN

# Add with custom base URL
zenith providers add custom --token YOUR_TOKEN --baseUrl https://your-api.com/v1

# Remove a provider
zenith providers remove custom

# List available models
zenith providers models
zenith providers models huggingface
```

### Download Images

```bash
# Download from URL
zenith download "https://example.com/image.jpg"

# With custom output
zenith download "https://example.com/image.jpg" -o ./my-image.png
```

## Available Models

### HuggingFace (Free, No Token Required)

| Model | Description |
|-------|-------------|
| `z-image-turbo` | Fast image generation (default) |
| `qwen-image-fast` | Qwen's fast image model |
| `ovis-image` | Ovis image generation |
| `flux-1-schnell` | FLUX.1 schnell model |

### ModelScope (Token Required)

| Model | Description |
|-------|-------------|
| `Tongyi-MAI/Z-Image-Turbo` | Z-Image Turbo |
| `black-forest-labs/FLUX.2-dev` | FLUX 2 Dev |
| `black-forest-labs/FLUX.1-Krea-dev` | FLUX 1 Krea Dev |
| `MusePublic/489_ckpt_FLUX_1` | FLUX 1 |

### A4F (Token Required)

| Model | Description |
|-------|-------------|
| `provider-4/imagen-3.5` | Imagen 3.5 |
| `provider-4/imagen-4` | Imagen 4 |
| `provider-8/imagen-3` | Imagen 3 |
| `provider-4/flux-schnell` | FLUX Schnell |
| `provider-8/z-image` | Z-Image |
| `provider-3/deepseek-v3` | DeepSeek V3 |

## Architecture

The CLI mirrors the channel-based architecture of zenith-image-generator:

```
src/
├── cli.ts              # Main CLI entry point (Commander.js)
├── config.ts           # Persistent configuration management (conf)
├── types.ts            # Shared TypeScript types
├── utils/
│   └── download.ts     # Image download utility
└── providers/
    ├── index.ts        # Provider exports
    ├── huggingface.ts  # HuggingFace Gradio API channel
    ├── modelscope.ts   # ModelScope async task channel
    └── a4f.ts          # A4F OpenAI-compatible channel
```

### Provider Channels

Each provider implements a standardized interface:

```typescript
interface ImageRequest {
  prompt: string
  negativePrompt?: string
  model?: string
  width: number
  height: number
  steps?: number
  guidanceScale?: number
  seed?: number
}

interface ImageResult {
  url: string
  seed: number
  model?: string
}
```

- **HuggingFace**: Uses Gradio Spaces API with SSE streaming and retry logic
- **ModelScope**: Uses async task submission with polling
- **A4F**: Uses OpenAI-compatible `/v1/images/generations` endpoint

## Configuration Storage

Settings are persisted using [conf](https://github.com/sindresorhus/conf) in your OS-specific config directory:
- **macOS**: `~/Library/Preferences/zenith-cli-nodejs/config.json`
- **Linux**: `~/.config/zenith-cli-nodejs/config.json`
- **Windows**: `%APPDATA%\zenith-cli-nodejs\Config\config.json`

## Examples

```bash
# Generate a portrait
zenith "a photorealistic portrait of a warrior, dramatic lighting" \
  --provider huggingface \
  --model z-image-turbo \
  -w 512 -h 768 \
  --seed 12345

# Generate with FLUX
zenith "a futuristic cityscape at sunset, cyberpunk style" \
  --provider huggingface \
  --model flux-1-schnell \
  --steps 8 \
  --guidance 3.5

# Quick generation (all defaults)
zenith "a cat sitting on a cloud"

# Set ModelScope as default, then generate
zenith config set defaultProvider modelscope
zenith providers add modelscope --token YOUR_TOKEN
zenith "a dragon flying over mountains"
```

## License

MIT
