# AGENTS

## Purpose and Main Flow
- This plugin is a configuration hub for AI providers in Obsidian; it does not run AI itself.
- Settings flow: users add/edit providers in the settings UI, which persists config and exposes it to other plugins via the SDK.
- Runtime flow: SDK -> AIProvidersService -> provider handler -> provider API, with FetchSelector choosing the right fetch path and embeddings cached in IndexedDB.

## Development & Quality Standards
- 100% test coverage required (lines/branches/functions/statements) via Vitest coverage thresholds.
- Linting required; Prettier formatting is enforced via pre-commit.
- Cyclomatic complexity limit <= 10 enforced via eslint-plugin-sonarjs (cognitive complexity rule).
- Use Context7 for up-to-date documentation when changing or adding integrations.

## Code Style Rules
- Max three arguments per function; use an options object for anything more.
- Extract helper functions only when the same logic is used more than once.

## Protocol and Data Details
- Input parsing and mapping: provider settings (id/name/type/url/apiKey/model) map to handler-specific request payloads.
- Derived features/metrics: embeddings are chunked and cached per vault in IndexedDB using hashed keys.
- External API JSON: OpenAI-compatible providers use messages/model/stream payloads and return streaming deltas; embeddings return data[].embedding.
- Config parameters: type selects handler; url overrides base endpoints; debugLogging toggles verbose logs; useNativeFetch changes fetch strategy.

## Documentation Protocol
Developers must verify the relevance of AGENTS.md and README.md at the start of every task. If the task involves changes to architecture, behavior, or protocol, update the affected documentation to keep it in sync with reality.
