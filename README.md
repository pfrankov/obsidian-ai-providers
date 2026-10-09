# Obsidian AI Providers

AI Providers manages shared AI provider settings and gives other Obsidian plugins
a common API for generation, tool calling, embeddings, and vector retrieval.

Think of it like a control panel where you can:
- Store your API keys and settings for AI services
- Share these settings with other Obsidian plugins
- Avoid entering the same AI settings multiple times

When another plugin calls the SDK, AI Providers sends generation, tool-calling,
and embedding requests to the configured local or remote provider. It also caches
embeddings and ranks document chunks locally for vector-based retrieval.

<img width="700" alt="image" src="https://github.com/user-attachments/assets/09b6313d-726c-440b-9201-1b2f2e839fa7" />

## Required by plugins
- [Local GPT](https://github.com/pfrankov/obsidian-local-gpt)

## Supported providers
- OpenAI
- OpenRouter
- Anthropic
- Google Gemini
- Mistral AI
- Together AI
- Fireworks AI
- Perplexity AI
- DeepSeek
- xAI (Grok)
- Cerebras
- Z.AI
- Groq
- 302.AI
- Novita AI
- DeepInfra
- SambaNova
- LM Studio
- Ollama (and Open WebUI)
- OpenAI compatible API

## Features
- Fully encapsulated API for working with AI providers
- Develop AI plugins faster without dealing directly with provider-specific APIs
- Easily extend support for additional AI providers in your plugin
- Available in 11 languages: English, Spanish, French, Italian, Portuguese, German, Russian, Chinese, Japanese, Korean, and Dutch

## Installation
### Obsidian plugin store (recommended)
This plugin is available in the Obsidian community plugin store https://obsidian.md/plugins?id=ai-providers

### BRAT
You can install this plugin via [BRAT](https://obsidian.md/plugins?id=obsidian42-brat): `pfrankov/obsidian-ai-providers`

## Create AI provider

### Models and capabilities

Refreshing models selects the first returned model. An empty list or a failed
refresh keeps the current model selection. Capability checkbox edits and accepted
Check results save immediately for existing providers; new providers keep them
locally until Save.

Changing the provider type, URL, or API key, or closing the form, discards pending
refresh/check results. Changing the selected model or editing its capability
checkboxes also discards a pending check. Requests already sent to the provider
continue running and may still incur charges.

### Optional reasoning modes

The model capabilities section includes manual reasoning-mode checkboxes for
supported adapters. Select only modes documented for your model and endpoint.
These are declarations, not automatic detection: **Check** probes text,
embeddings, tools, and vision, and preserves the manual reasoning set.
Checking a mode does not change other plugins' requests or set a shared default.
A consuming plugin must explicitly select a declared mode for each request.

The checkboxes offer each adapter's wire vocabulary; they do not establish model
support. Nothing is selected automatically. Model names are only keys for saved
capabilities: changing or adding a model name never needs a code change.

| Provider transport | Request field | Manually selectable vocabulary |
| --- | --- | --- |
| OpenAI Chat Completions | `reasoning_effort` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| Z.AI | `reasoning_effort` | `low`, `high`, `max` |
| OpenRouter | `reasoning.effort` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| Ollama / Open WebUI | top-level `think` | `true`, `false`, `low`, `medium`, `high` |

The saved per-model declarations are the source of truth for request selection.
Select only values supported by your endpoint. The service rejects undeclared
values and values outside the adapter vocabulary; remote support is not probed.
It does not infer modes, sampling compatibility, tool support or API routing from
model names. Native Anthropic reasoning is not implemented.

Omission preserves the API default; it does not mean thinking is disabled.
`none`, `max` and `xhigh` are passed literally. No intensity mapping, token budget,
sampling rewrite or reasoning-specific fallback/retry is added. Sampling and tools
remain as supplied by the consumer. An endpoint may reject their combination with
reasoning; that error is surfaced. Consumers must explicitly omit incompatible
sampling options themselves. This feature adds no sampling-default control.

Contracts: [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning),
[OpenAI model compatibility](https://developers.openai.com/api/docs/guides/latest-model),
[Z.AI](https://docs.z.ai/api-reference/llm/chat-completion),
[OpenRouter](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) and its [per-model metadata](https://openrouter.ai/api/v1/models),
[Ollama](https://docs.ollama.com/capabilities/thinking).

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

Provider migration returns `false` if its confirmation dialog is canceled or
dismissed (including Escape or clicking outside), without adding or saving a
provider. Confirmed migrations resolve with the provider after settings are saved.

Requests using Obsidian's HTTP transport preserve provider error status, headers,
and body for the provider SDK's error handling and retries, including `Retry-After`.

### Embedding cache

Cached embeddings are isolated by provider ID, type, full URL, and model.
Renaming a provider or rotating its API key preserves cache hits. Changing the
model behind an unchanged endpoint/model name, or account-specific routing,
cannot be detected by this identity.

Older cache records do not identify their endpoint, so they are retained but
ignored. The first subsequent use of each previously cached text recomputes its
embedding and sends that text to the current provider again. This one-time lazy
rebuild can take time and incur provider charges; no background rebuild or
startup provider request is performed. Concurrent writes preserve each call's
new entries, but simultaneous misses can still send the same text more than once.

### Debug logging

Transport logs omit raw request/response header fields and the full request body.
They retain request method, status, body presence, and lifecycle details. This is
not comprehensive log sanitization: URLs, error objects, tool-message previews,
and explicitly enabled chunk logs may still contain private data. Review logs
before sharing them.

### Development checks

Use Node.js 24 and install the committed dependencies with `npm ci`.
Run `npm run format:check`, `npm run check`, `npm run build`,
`npm run sdk:build`, and `npm run example:build` before submitting a change.
The check command runs lint, tests with 100% coverage thresholds, and type checks.
These checks and builds also run on pull requests.

Quick reference (details in SDK docs):

```ts
try {
	const finalText = await aiProviders.execute({
		provider,
		prompt: "Hello",
		onProgress: (chunk, full) => {/* stream UI update */},
		abortController
	});
	// use finalText
} catch (e) {
	// handle error / abort
}
```

Tool-calling loops are available via `toolsExecute()` (SDK 1.7.0 / Service API v4). It is message-only and uses top-level `tools` / `tool_choice`, returning an OpenAI-style assistant message (`role`, `content`, `tool_calls`) that you can append directly to `messages` history.

Ollama tool calls are returned in arrival order across streamed chunks, including
repeated calls, with sequential IDs (`call_1`, `call_2`, ...).

Removed callbacks: onEnd / onError — promise resolve/reject covers them (only onProgress remains for streaming). Legacy chainable handler also deprecated.

## Roadmap
- [x] Docs for devs
- [x] Ollama context optimizations
- [x] German translations
- [x] Chinese translations
- [x] Update to latest OpenAI version and embedding models
- [x] Russian translations
- [x] Groq Provider support
- [x] Passing messages instead of one prompt
- [x] Anthropic Provider support
- [x] Shared embeddings to avoid re-embedding the same documents multiple times
- [x] Spanish, Italian, French, Dutch, Portuguese, Japanese, Korean translations
- [x] Encapsulated vector-based retrieval for RAG

## My other Obsidian plugins
- [Local GPT](https://github.com/pfrankov/obsidian-local-gpt) that assists with local AI for maximum privacy and offline access.
- [Colored Tags](https://github.com/pfrankov/obsidian-colored-tags) that colorizes tags in distinguishable colors.
