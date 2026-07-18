# Zenith CLI ⚡

A powerful command-line interface for AI image and chat generation, supporting multiple providers with token rotation. Built as a CLI adaptation of [zenith-image-generator](https://github.com/WuMingDao/zenith-image-generator).

## Features

- 🎨 **Multi-Provider Support** — HuggingFace (free), Gitee AI, ModelScope, A4F
- 🔄 **Token Rotation** — Automatic rotation across multiple tokens per provider on quota/rate-limit errors
- 💬 **LLM Chat** — Single-turn and interactive multi-turn chat sessions
- 📦 **Batch Generation** — Generate images from a prompts file
- 🔐 **Persistent Config** — Settings and tokens saved between sessions
- 📥 **Auto-Download** — Images saved locally with format detection
- 🖼️ **Auto-Open** — View generated images immediately
- 🌱 **Reproducible** — Seed control for consistent outputs

## Quick Start

```bash
# Generate an image (uses HuggingFace, no token needed)
zenith "a cyberpunk city at night, neon lights, rain"

# Specify provider and model
zenith "a cat in space" -p huggingface -m flux-1-schnell

# Set dimensions and seed
zenith "portrait of a wizard" -w 512 -h 768 --seed 42

# Batch generation from a file
zenith batch prompts.txt -p huggingface --delay 2000

# Chat with LLM
zenith chat "tell me a joke"
zenith chat --interactive   # Multi-turn session
```

## Setup & Install

### Option 1: Global install via wrapper (recommended)

```bash
# Clone the repo
git clone <repo-url> && cd zenith-cli

# Install dependencies
npm install

# Build
npm run build

# Make commands globally available
mkdir -p ~/bin
cat > ~/bin/zenith << 'WRAPPER'
#!/bin/bash
exec node /path/to/zenith-cli/dist/cli.js "$@"
WRAPPER
chmod +x ~/bin/zenith
ln -sf ~/bin/zenith ~/bin/zimg   # Short alias
export PATH="~/bin:$PATH"         # Add to your shell rc
```

### Option 2: Use directly

```bash
cd zenith-cli && npm install && npm run build
node dist/cli.js "your prompt here"
```

## Commands

### Image Generation

```bash
# Default (HuggingFace, no token)
zenith "a beautiful sunset over the ocean"

# With options
zenith "sci-fi spaceship" -p huggingface -m flux-1-schnell
zenith "portrait" -w 512 -h 768 --seed 42
zenith "a dog" -n "blurry, low quality"
zenith "detailed landscape" -s 30 -g 7.5

# With token-based providers
zenith providers add gitee --token YOUR_TOKEN
zenith "photo" -p gitee -m Qwen-Image
zenith "photo" -p modelscope -m "Tongyi-MAI/Z-Image-Turbo"
zenith "photo" -p a4f -m "provider-4/imagen-4"
```

### Batch Generation

```bash
# Create a sample prompts file
zenith batch create prompts.txt

# Generate all prompts from the file
zenith batch prompts.txt -p huggingface --delay 1500

# With specific provider and output
zenith batch prompts.txt -p gitee -m Qwen-Image -o ./my-images --delay 3000
```

Prompts file format (one per line, `#` for comments):
```
# My prompt list
a cyberpunk city at night with neon lights
a serene mountain landscape at sunrise
a cute robot reading a book
```

### Chat / LLM

```bash
# Single message
zenith chat "tell me a joke"
zenith chat "explain quantum computing" -p gitee -m DeepSeek-V3

# Interactive multi-turn session
zenith chat --interactive

# With options
zenith chat --interactive -m Qwen2.5-72B-Instruct --temperature 0.9 --max-tokens 2000
```

### Token Management

```bash
# Add a provider with initial token
zenith providers add gitee --token YOUR_TOKEN

# Add more tokens to an existing provider
zenith providers add-token gitee --token "token1,token2,token3"

# View rotation status
zenith providers status gitee

# Remove a specific token
zenith providers remove-token gitee --index 2
zenith providers remove-token gitee --token "abc123..."

# Reset exhaustion tracking (makes all tokens active again)
zenith providers reset-tokens gitee

# Remove entire provider
zenith providers remove gitee
```

### Configuration

```bash
zenith config list                          # Show all settings
zenith config set defaultProvider gitee     # Change default
zenith config set defaultWidth 512
zenith config get defaultProvider           # Get one setting
zenith config reset                         # Reset all to defaults
```

### Other

```bash
zenith providers list                       # List configured providers
zenith providers models                     # Show all available models
zenith providers models gitee               # Show models for one provider
zenith download "https://example.com/img.jpg" -o ./saved.png
zenith generate "a cat" --seed 42           # Alias for default command
```

## Available Models

### HuggingFace (Free, No Token)

| Model | Space URL |
|-------|-----------|
| `z-image-turbo` | mrfakename-z-image-turbo.hf.space |
| `qwen-image-fast` | qwen-qwen-image-fast.hf.space |
| `ovis-image` | StepFormer-ovis-image-1.5.hf.space |
| `flux-1-schnell` | black-forest-labs-FLUX.1-schnell.hf.space |

### Gitee AI (Token Required)

| Image Models | LLM Models |
|---|---|
| `Qwen-Image` | `DeepSeek-V3` |
| `FLUX.1-dev` | `Qwen2.5-72B-Instruct` |
| `FLUX_1-Krea-dev` | `GLM-4-9B-Chat` |
| `z-image-turbo` | |
| `GLM-Image` | |

### ModelScope (Token Required)

| Model | ID |
|-------|-----|
| Z-Image Turbo | `Tongyi-MAI/Z-Image-Turbo` |
| FLUX 2 Dev | `black-forest-labs/FLUX.2-dev` |
| FLUX 1 Krea Dev | `black-forest-labs/FLUX.1-Krea-dev` |
| FLUX 1 | `MusePublic/489_ckpt_FLUX_1` |

### A4F (Token Required)

| Model | ID |
|-------|-----|
| Imagen 3.5 | `provider-4/imagen-3.5` |
| Imagen 4 | `provider-4/imagen-4` |
| Imagen 3 | `provider-8/imagen-3` |
| FLUX Schnell | `provider-4/flux-schnell` |
| Z-Image | `provider-8/z-image` |
| DeepSeek V3 | `provider-3/deepseek-v3` |

## Token Rotation System

The CLI implements the same token rotation logic as the original zenith-image-generator:

1. **Multiple tokens per provider** — Configure 1 or more API tokens for any provider
2. **Automatic rotation on quota/rate-limit errors** — When a token hits its daily quota, the CLI automatically tries the next available token
3. **Daily reset** — Exhausted tokens are automatically reset at UTC midnight
4. **Smart error detection** — Auth errors and timeouts fail immediately (don't waste other tokens)
5. **Status tracking** — View which tokens are active vs exhausted with `zenith providers status`

```
⚠ Token gitee_••••••_002 exhausted (quota). Rotating to next token...
```

## Architecture

```
zenith-cli/
├── src/
│   ├── cli.ts                 # Main CLI entry (Commander.js)
│   ├── config.ts              # Persistent config (conf)
│   ├── token-rotation.ts      # Token rotation manager
│   ├── types.ts               # TypeScript types
│   ├── utils/
│   │   └── download.ts        # Image download utility
│   └── providers/
│       ├── index.ts           # Provider exports
│       ├── huggingface.ts     # HuggingFace Gradio API
│       ├── gitee.ts           # Gitee AI (image + chat)
│       ├── modelscope.ts      # ModelScope async task API
│       └── a4f.ts             # A4F OpenAI-compatible API
├── package.json
├── tsconfig.json
├── install.sh                 # System-wide install script
└── README.md
```

## License

MIT
