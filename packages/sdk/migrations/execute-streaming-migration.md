# Migration: execute() Streaming Change (IChunkHandler → Promise + onProgress) *(since SDK 1.5.0)*

Introduced in **@obsidian-ai-providers/sdk 1.5.0** with service API version **3**. Earlier versions returned an `IChunkHandler` unconditionally. From 1.5.0 (API v3) the default return value is a `Promise<string>`; the legacy handler is only produced when no streaming / abort params are provided (deprecated path).

This migration explains the change to `execute()`: it now returns a `Promise<string>` (final text) directly instead of a chainable `IChunkHandler`. Streaming is provided inline via the `onProgress` parameter; cancellation uses an `AbortController`.

Old pattern (before):
- Call `execute()` → receive `IChunkHandler` object
- Register `onData`, `onEnd`, `onError` callbacks
- Call `abort()` on handler to cancel

New pattern (now):
- Call `execute()` → receive `Promise<string>`
- Pass `onProgress` for partial chunks
- Use `AbortController` (`abortController.abort()`) to cancel
- Use `await` / `.then()` for completion, `try/catch` / `.catch()` for errors

`IChunkHandler` is deprecated and only returned if you call `execute()` without `onProgress` and without `abortController`. Migrate soon; the compatibility branch will be removed in a future major version.

## Translation Table
| Old | New |
|-----|-----|
| `handler.onData(cb)` | `onProgress: (chunk, full) => {}` |
| `handler.onEnd(cb)` | Promise resolve (`await`) |
| `handler.onError(cb)` | Promise reject (`try/catch`) |
| `handler.abort()` | `abortController.abort()` |

## 1. Basic Replacement
Old:
```ts
const handler = await aiProviders.execute({ provider, prompt: "Explain quantum tunneling" });
handler.onData((chunk, full) => console.log(full));
handler.onEnd(full => console.log('DONE:', full));
handler.onError(err => console.error(err));
```
New:
```ts
const full = await aiProviders.execute({
  provider,
  prompt: "Explain quantum tunneling",
  onProgress: (_chunk, accumulated) => console.log(accumulated)
});
console.log('DONE:', full);
```

## 2. Error Handling
Old:
```ts
const handler = await aiProviders.execute({ provider, prompt: "Test" });
handler.onError(err => console.error(err));
```
New:
```ts
try {
  await aiProviders.execute({ provider, prompt: "Test" });
} catch (err) {
  console.error(err);
}
```

## 3. Cancellation / Abort
Old:
```ts
const handler = await aiProviders.execute({ provider, prompt: "Stream long text" });
handler.onData((_c, full) => { if (full.length > 200) handler.abort(); });
```
New:
```ts
const abortController = new AbortController();
try {
  await aiProviders.execute({
    provider,
    prompt: "Stream long text",
    abortController,
    onProgress: (_c, full) => { if (full.length > 200) abortController.abort(); }
  });
} catch (e) {
  if ((e as Error).message === 'Aborted') console.log('Aborted intentionally');
  else console.error(e);
}
```

## 4. Chat Messages
Old:
```ts
const handler = await aiProviders.execute({
  provider,
  messages: [
    { role: 'system', content: 'You are concise.' },
    { role: 'user', content: 'Summarize gravity.' }
  ]
});
handler.onData((_c, full) => render(full));
```
New:
```ts
const final = await aiProviders.execute({
  provider,
  messages: [
    { role: 'system', content: 'You are concise.' },
    { role: 'user', content: 'Summarize gravity.' }
  ],
  onProgress: (_c, full) => render(full)
});
```

## 5. Non-Streaming Simplicity
Old (needed onEnd to get final text):
```ts
const handler = await aiProviders.execute({ provider, prompt: 'Plain request' });
handler.onEnd(full => use(full));
```
New:
```ts
const full = await aiProviders.execute({ provider, prompt: 'Plain request' });
use(full);
```

## 6. Incremental Migration Steps
1. Convert each `onEnd` usage to `await` the returned promise.
2. Wrap in `try/catch` instead of `onError`.
3. Inline each `onData` callback as `onProgress` parameter.
4. Replace `handler.abort()` with an `AbortController` passed in params.
5. Remove `IChunkHandler` type references/imports.

## 7. Locate Legacy Code
Search for these tokens: `onData(`, `onEnd(`, `onError(`, `abort()` (on handler instances). Each match needs updating.

## Summary Snippet
```ts
await aiProviders.execute({ provider, prompt, onProgress, abortController });
```
- Final text: promise result
- Streaming: `onProgress`
- Cancel: `abortController.abort()`
- Abort error text: exactly `Aborted`

You are migrated once no code depends on `onData/onEnd/onError` or handler.abort().
