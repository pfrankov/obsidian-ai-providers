# Obsidian AI Providers

⚠️ Important Note:
This plugin is a configuration tool - it helps you manage your AI settings in one place.

Think of it like a control panel where you can:
- Store your API keys and settings for AI services
- Share these settings with other Obsidian plugins
- Avoid entering the same AI settings multiple times

**The plugin itself doesn't do any AI processing - it just helps other plugins connect to AI services more easily.**

<img width="700" alt="image" src="https://github.com/user-attachments/assets/09b6313d-726c-440b-9201-1b2f2e839fa7" />

## Required by plugins
- [Local GPT](https://github.com/pfrankov/obsidian-local-gpt)

## Supported providers
- Ollama
- OpenAI
- OpenAI compatible API
- OpenRouter
- Google Gemini
- LM Studio
- Groq

## Features
- Fully encapsulated API for working with AI providers
- Develop AI plugins faster without dealing directly with provider-specific APIs
- Easily extend support for additional AI providers in your plugin
- Available in 4 languages: English, Chinese, German, and Russian (more languages coming soon)

## Installation
### Obsidian plugin store (recommended)
This plugin is available in the Obsidian community plugin store https://obsidian.md/plugins?id=ai-providers

### BRAT
You can install this plugin via [BRAT](https://obsidian.md/plugins?id=obsidian42-brat): `pfrankov/obsidian-ai-providers`

## Create AI provider
### Ollama
1. Install [Ollama](https://ollama.com/).
2. Install Gemma 2 `ollama pull gemma2` or any preferred model [from the library](https://ollama.com/library).
3. Select `Ollama` in `Provider type`
4. Click refresh button and select the model that suits your needs (e.g. `gemma2`)

Additional: if you have issues with streaming completion with Ollama try to set environment variable `OLLAMA_ORIGINS` to `*`:
- For MacOS run `launchctl setenv OLLAMA_ORIGINS "*"`.
- For Linux and Windows [check the docs](https://github.com/ollama/ollama/blob/main/docs/faq.md#how-do-i-configure-ollama-server).

### OpenAI
1. Select `OpenAI` in `Provider type`
2. Set `Provider URL` to `https://api.openai.com/v1`
3. Retrieve and paste your `API key` from the [API keys page](https://platform.openai.com/api-keys)
4. Click refresh button and select the model that suits your needs (e.g. `gpt-4o`)

### OpenAI compatible server
There are several options to run local OpenAI-like server:
- [Open WebUI](https://docs.openwebui.com/tutorials/integrations/continue-dev/)
- [llama.cpp](https://github.com/ggerganov/llama.cpp)
- [llama-cpp-python](https://github.com/abetlen/llama-cpp-python#openai-compatible-web-server)
- [LocalAI](https://localai.io/model-compatibility/llama-cpp/#setup)
- Obabooga [Text generation web UI](https://github.com/pfrankov/obsidian-local-gpt/discussions/8)
- [LM Studio](https://lmstudio.ai/)
- ...maybe more

### OpenRouter
1. Select `OpenRouter` in `Provider type`
2. Set `Provider URL` to `https://openrouter.ai/api/v1`
3. Retrieve and paste your `API key` from the [API keys page](https://openrouter.ai/settings/keys)
4. Click refresh button and select the model that suits your needs (e.g. `anthropic/claude-3.7-sonnet`)

### Google Gemini
1. Select `Google Gemini` in `Provider type`
2. Set `Provider URL` to `https://generativelanguage.googleapis.com/v1beta/openai`
3. Retrieve and paste your `API key` from the [API keys page](https://aistudio.google.com/apikey)
4. Click refresh button and select the model that suits your needs (e.g. `gemini-1.5-flash`)

### LM Studio
1. Select `LM Studio` in `Provider type`
2. Set `Provider URL` to `http://localhost:1234/v1`
3. Click refresh button and select the model that suits your needs (e.g. `gemma2`)

### Groq
1. Select `Groq` in `Provider type`
2. Set `Provider URL` to `https://api.groq.com/openai/v1`
3. Retrieve and paste your `API key` from the [API keys page](https://groq.com/docs/api-reference/introduction)
4. Click refresh button and select the model that suits your needs (e.g. `llama3-70b-8192`)

## For plugin developers
[Docs: How to integrate AI Providers in your plugin.](./packages/sdk/README.md)

## Roadmap
- [x] Docs for devs
- [x] Ollama context optimizations
- [x] German translations
- [x] Chinese translations
- [x] Update to latest OpenAI version and embedding models
- [x] Russian translations
- [x] Groq Provider support
- [x] Passing messages instead of one prompt
- [ ] Anthropic Provider support
- [x] Shared embeddings to avoid re-embedding the same documents multiple times
- [ ] Spanish, Italian, French, Dutch, Portuguese, Japanese, Korean translations
- [ ] Incapsulated basic RAG search with optional BM25 search

## My other Obsidian plugins
- [Local GPT](https://github.com/pfrankov/obsidian-local-gpt) that assists with local AI for maximum privacy and offline access.
- [Colored Tags](https://github.com/pfrankov/obsidian-colored-tags) that colorizes tags in distinguishable colors.