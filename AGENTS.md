# AGENTS

## Purpose and Main Flow
- This plugin is a configuration hub for AI providers in Obsidian; it does not run AI itself.
- Settings flow: users add/edit providers in the settings UI, which persists config and exposes it to other plugins via the SDK.
- Runtime flow: SDK -> AIProvidersService -> provider handler -> provider API, with FetchSelector choosing the right fetch path and embeddings cached in IndexedDB.
- I18n reads the saved language on each call. If localStorage is unavailable or access throws, use English without changing the saved preference or caching the fallback.

## Development & Quality Standards
- 100% test coverage required (lines/branches/functions/statements) via Vitest coverage thresholds.
- Linting required; Prettier formatting is enforced via pre-commit.
- Cyclomatic complexity limit <= 10 enforced via eslint-plugin-sonarjs (cognitive complexity rule).
- Use Context7 for up-to-date documentation when changing or adding integrations.
- Test storage comes from the original `jsdom.window.localStorage`, explicitly exposed in `vitest.setup.ts` and restored/cleared around each test. Do not depend on Node's native storage or use a getItem-only global mock.
- Pull requests and `master` pushes run formatting, `npm run check`, and plugin/SDK/example builds in `.github/workflows/check.yml` using the committed lockfile.

## Code Style Rules
- Max three arguments per function; use an options object for anything more.
- Extract helper functions only when the same logic is used more than once.

## Protocol and Data Details
- Input parsing and mapping: provider settings (id/name/type/url/apiKey/model) map to handler-specific request payloads.
- Derived features/metrics: embeddings are chunked and cached per vault in IndexedDB using hashed keys.
- Cached embeddings send each missing text once per call, while returned vectors and progress preserve original input order and duplicate occurrences. Progress includes cache hits and texts in the provider’s processed snapshot; retrieval maps those actual texts to chunks rather than treating the count as a prefix. Document completion counts use object identity, aggregate repeated references, and exclude documents with no chunks. Check cancellation after awaited cache/provider work and after final progress before returning success.
- Snapshot the embedding provider before awaited work. Cache identity is a versioned SHA-256 hash of the JSON tuple `[id, type, url || '', model]`; do not log or persist that tuple or include API keys. Hash failure disables caching for the call without bypassing deduplication, progress, or cancellation. Legacy records remain untouched and miss lazily, so previously cached text may be retransmitted and billed when requested again. Merge only newly computed chunks into the latest matching record inside one short IndexedDB readwrite transaction, and always consume `tx.done`, including on request failure. Keep network and hashing outside that transaction; preserve the database version and record shape.
- External API JSON: OpenAI-compatible providers use messages/model/stream payloads and return streaming deltas; embeddings return data[].embedding.
- Desktop streaming cancellation must settle both the fetch promise before headers and the response body after headers. Cancelling a body reader also stops the native request. Cover these paths with real Web Streams, and release the signal listener after success or failure.
- Tool-calling: `toolsExecute()` is message-only, returns an OpenAI-style assistant message (`content`, `tool_calls`), and normalizes provider-specific tool formats (OpenAI-compatible, Anthropic, Ollama) for multi-step agent loops.
- Model override: `execute()` and `toolsExecute()` accept an optional `model` param; when set, it overrides the provider's default model for that call.
- Model capabilities: providers store per-model capabilities (`text`, `embedding`, `tools`, `vision`) in `modelCapabilities`; `getModelCapabilities()` retrieves them; `checkModelCapabilities()` probes a model via real API calls and persists results to settings.
- Config parameters: type selects handler; url overrides base endpoints; debugLogging toggles verbose logs; useNativeFetch changes fetch strategy; `ollamaContextScale` scales Ollama's context window (see below).
- Ollama context sizing: `num_ctx` bounds the prompt *and* the generated answer, so `OllamaHandler` sizes it as `estimated prompt tokens x ollamaContextScale + OUTPUT_RESERVE_TOKENS`, clamped to the model's real context length (or `FALLBACK_MAX_CONTEXT_LENGTH` when `ollama.show()` reports none) and never below a window the model already ran with. Constants live in `src/constants/ollamaContext.ts`; the scale is a slider (1-4, default 2) under Developer settings. Embeddings reserve no output tokens. A caller-supplied `options.num_ctx` is authoritative: `resolveContextWindow()` auto-sizes only when the key is absent, so an explicitly pinned window is never widened or shrunk. The computed window is always sent, including when it lands at or below `DEFAULT_CONTEXT_LENGTH` — omitting `num_ctx` hands the choice to Ollama's own configured default, which may be smaller than what was computed.
- Generation-limit reporting: `done_reason === 'length'` on the final stream chunk means generation stopped at a limit, but Ollama reports the same reason for a filled context window and for a reached `num_predict`, so the message stays neutral about the cause. `OllamaHandler` keeps the accumulated text untouched and reports via an unconditional `console.warn` plus a `Notice` — the warning must not be gated on `debugLogging`.
- Do not infer prompt truncation from token counts. Ollama removes whole old messages before evaluation, so `prompt_eval_count` can sit well below `num_ctx` even when history was lost, and a prompt that exactly fills the window was not necessarily truncated. A filled window also does not always stop generation — Ollama can shift context and continue. There is no reliable client-side signal, so nothing is claimed about dropped input.

## Documentation Protocol
Developers must verify the relevance of AGENTS.md and README.md at the start of every task. If the task involves changes to architecture, behavior, or protocol, update the affected documentation to keep it in sync with reality.

## SDK Publishing
- `@obsidian-ai-providers/sdk` is published from `.github/workflows/publish-sdk.yml`.
- npm publishing uses Trusted Publisher / GitHub OIDC for package `@obsidian-ai-providers/sdk`, repository `pfrankov/obsidian-ai-providers`, workflow `publish-sdk.yml`; do not add `NPM_TOKEN`/`NODE_AUTH_TOKEN` back for normal SDK releases.
- Keep `actions/setup-node` package manager cache disabled (`package-manager-cache: false`) in the SDK publish workflow so the job does not request unnecessary npm token handling.
