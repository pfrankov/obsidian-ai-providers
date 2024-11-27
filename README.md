# Obsidian AI Providers [NOT USABLE, WRONG DESCRIPTION]

⚠️ Important Note:
This plugin is a configuration tool - it helps you manage your AI settings in one place.

Think of it like a control panel where you can:
- Store your API keys and settings for AI services
- Share these settings with other Obsidian plugins
- Avoid entering the same AI settings multiple times

**The plugin itself doesn't do any AI processing - it just helps other plugins connect to AI services more easily.**

## Supported providers
- Ollama
- OpenAI compatible API

## Features
- Fully encapsulated API for working with AI providers
- Develop AI plugins faster without dealing directly with provider-specific APIs
- Easily extend support for additional AI providers in your plugin
- Available in 4 languages: English, Chinese, German, and Russian (more languages coming soon)

## Required by plugins
- [Local GPT](https://github.com/pfrankov/obsidian-local-gpt) (soon)

## For developers
You must check if AI Providers plugin is ready before calling AI providers.

### Checking if AI Providers plugin is ready and if it is compatible version
```typescript
const aiProvidersReady = () => {
  try {
    // AI Providers plugin API version: 2
    // Local GPT required API version: 1

    this.app.aiProviders.version // 2
    if (this.app.aiProviders.version > 1) {
      
    }

    this.app.aiProviders.checkCompatibility(1); // 1 is the version of the required plugin API. Can be found by calling this.app.aiProviders.version while developing your plugin.
  } catch (error) {
    // You may ignore this error. It will be shown to the user in a notification.
  }
}

if ((this.app as any).aiProviders) {
  aiProvidersReady();
} else {
  // Make sure that AI Providers plugin is ready
  this.app.workspace.on('ai-providers-ready', aiProvidersReady);
}
```

### Getting list of AI providers
```typescript
const aiProvidersReady = () => {
    const providers = (this.app as any).aiProviders.providers;

    // [
    //   {
    //     id: "1234567890",
    //     name: "OpenAI GPT-4",
    //     type: "openai", 
    //     url: "https://api.openai.com/v1",
    //     apiKey: "sk-...",
    //     model: {
    //       id: "gpt-4"
    //     }
    //   },
    //   {
    //     id: "0987654321", 
    //     name: "Local Llama",
    //     type: "ollama",
    //     url: "http://localhost:11434",
    //     apiKey: "",
    //     model: {
    //       id: "llama2"
    //     }
    //   }
    // ]
}
```

### Calling AI providers
```typescript
// Make sure that AI Providers plugin is ready
const aiProvidersReady = () => {
  const providers = (this.app as any).aiProviders.providers;

  // Select provider in your plugin
  const selectedProviderInYourPlugin = providers[0];

  // Call AI provider
  const handler = await (this.app as any).aiProviders.execute({
    prompt: "Hello, how are you?",
    provider: selectedProviderInYourPlugin,
  });

  // Handle response
  handler.onData((chunk: string, accumulatedText: string) => {
    // Handle chunk
  });
  handler.onEnd((fullText: string) => {
    // Handle full response
  });
  handler.onError((error: Error) => {
    // Handle error
  });

  // Abort request
  setTimeout(() => {
      handler.abort();
  }, 30000);
};
```

## Roadmap
- [ ] Gemini Provider support
- [ ] Anthropic Provider support
- [ ] Groq Provider support
- [ ] Image processing support
- [ ] Shared embeddings to avoid re-embedding the same documents multiple times
- [ ] Spanish, Italian, French, Dutch, Portuguese, Japanese, Korean translations
- [ ] Incapsulated basic RAG search with optional BM25 search

## My other Obsidian plugins
- [Local GPT](https://github.com/pfrankov/obsidian-local-gpt) that assists with local AI for maximum privacy and offline access.
- [Colored Tags](https://github.com/pfrankov/obsidian-colored-tags) that colorizes tags in distinguishable colors. 
