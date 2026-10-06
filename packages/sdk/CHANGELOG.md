# @obsidian-ai-providers/sdk changelog

## 1.8.0

### Added
- Optional `reasoningMode` on `execute` / `toolsExecute` (service API **5**).
- `initAI(..., { minVersion })` soft gate so consumers can load against older
  AI Providers (e.g. `{ minVersion: 4 }`) and feature-detect with
  `supportsVersion(service, 5)`.
- `supportsVersion`, `recommendedPluginVersionForApi` helpers.
- Optional `pluginVersion` on `IAIProvidersService` (manifest version).
- Version-mismatch fallback settings tab now says AI Providers is **outdated**
  and shows required service API / recommended plugin version (`1.12.0+`) and
  the current API. The previous “please install” copy remains when AI Providers
  is missing.

### Compatibility
- Default `initAI` behaviour is unchanged: still requires service API 5 unless
  `minVersion` is lowered.
- Existing consumers that omit `reasoningMode` keep their request shape.
- Older SDKs (REQUIRED API 4) continue to work with AI Providers 1.12 / API 5.
