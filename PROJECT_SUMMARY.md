<!--
PROJECT_SUMMARY.md — auto‑maintained technical snapshot
Generate on first run if missing. Keep ≤ 400 tokens total.
Use ultra‑terse bullets (≤ 100 chars each).
Patch only bullets that actually change; never rename or delete this file.
DO NOT edit by hand — let the assistant update it.
-->

# 🗂️ Project Summary

## ➤ Purpose
Obsidian plugin hub (v1.4.0) for configuring AI providers in one centralized place

## ➤ Key Flows
- Add/edit/delete AI providers via settings UI
- SDK exposes providers to other plugins via waitForAI()
- Stream AI completions with chunk handlers and abort support
- Embed text with automatic IndexedDB caching per vault
- Migrate providers from other plugins with confirmation
- Fetch/refresh models from provider APIs

## ➤ Architecture
- Modules → monorepo: main plugin, SDK package (v1.1.1), example plugin
- Data flow → Plugin → AIProvidersService → Handlers → AI APIs + cache
- Integrations → OpenAI, Ollama, Gemini, OpenRouter, LM Studio, Groq APIs
- Fetch logic → FetchSelector: unified platform-aware fetch selection with integrated CORS retry

## ➤ Environment
- Runtime → TypeScript 4.7.4, Node 16+, Obsidian API, desktop/mobile
- Services → IndexedDB embeddings cache, i18n (en/de/ru/zh)
- Build/CI → esbuild, jest+jsdom tests, npm workspaces, prettier
- Fetch strategies → FetchSelector manages: electronFetch (desktop-only), obsidianFetch (fallback), native fetch

## ➤ Interfaces
- REST → Provider-specific APIs (OpenAI/Ollama format compatibility)
- SDK → execute(), embed(), fetchModels(), migrateProvider(), waitForAI()
- UI → Settings tab, provider forms, model selection, confirmation modals

## ➤ Invariants
- SDK version compatibility must be checked via checkCompatibility()
- Provider configs validated before save (URL format, unique names)
- Embeddings cache scoped per vault with unique database names
- API keys stored securely in Obsidian settings, not in cache
- Mobile platform MUST NOT use electronFetch (remote.net.request unavailable)
- FetchSelector enforces correct fetch implementation per platform/operation
- Desktop uses electronFetch by default; mobile uses obsidianFetch/native fetch
- CORS errors trigger automatic fallback to obsidianFetch for future requests via FetchSelector

## ➤ Open Issues / TODO
- Add Anthropic provider support
- Add 7 more translations (Spanish, Italian, French, Dutch, etc)
- Implement RAG search with optional BM25 search

---

<!-- LLM UPDATE PROTOCOL
1 Load this file first; treat it as the single source of truth.
2 If missing, create from the template above, replacing all <> placeholders with repo facts.
3 On any code/config change, revise only affected bullets; preserve unchanged lines.
4 Keep file ≤ 400 tokens; trim less‑critical detail before exceeding the limit.
5 Never output content that violates the Invariants or Key Flows.
--> 
