# Obsidian AI Providers SDK
This SDK is used to interact with the [AI Providers](https://github.com/obsidian-ai-providers/obsidian-ai-providers) plugin.

Take a look at the [example plugin](../example-plugin/main.ts) to see how to use the SDK.

## Installation
Install the SDK in your Obsidian plugin.

```bash
npm install @obsidian-ai-providers/sdk
```

## Usage

### 1. Wait for AI Providers plugin in your plugin
Any plugin can not be loaded instantly, so you need to wait for AI Providers plugin to be loaded.
```typescript
import { waitForAI } from '@obsidian-ai-providers/sdk';

const aiResolver = await waitForAI();
const aiProviders = await aiResolver.promise;

// Object with all available AI providers
aiProviders.providers;
/*
[
    {
        id: "1732815722182",
        model: "smollm2:135m",
        name: "Ollama local",
        type: "ollama",
        url: "http://localhost:11434",
        apiKey: "sk-1234567890",
        availableModels: ['smollm2:135m', 'llama2:latest'],
    },
    ...
]
*/

// Every time in any async code you have to call `waitForAI` to get the current instance of AI Providers.
// It will be changed when the user changes the AI Provider in settings.
```

### 2. Show fallback settings tab
Before AI Providers plugin is loaded and activated, you need to show fallback settings tab.  
`initAI` function takes care of showing fallback settings tab and runs callback when AI Providers plugin is loaded and activated.

```typescript
import { initAI } from '@obsidian-ai-providers/sdk';

export default class SamplePlugin extends Plugin {
	...

	async onload() {
        // Wrap your onload code in initAI callback. Do not `await` it.
        initAI(this.app, this, async ()=>{
            this.addSettingTab(new SampleSettingTab(this.app, this));
		});
	}
}
```

#### Disable fallback settings tab
If you want to disable the fallback settings tab (for example, if your plugin has its own fallback UI), you can use the `disableFallback` option:

```typescript
// Initialize without showing fallback settings tab
initAI(this.app, this, async ()=>{
    this.addSettingTab(new SampleSettingTab(this.app, this));
}, { disableFallback: true });
```

### 3. Import SDK styles
Don't forget to import the SDK styles for fallback settings tab in your plugin.
```css
@import '@obsidian-ai-providers/sdk/style.css';
```
Make sure that there is loader for `.css` files in your esbuild config.
```typescript
export default {
    ...
    loader: {
		".ts": "ts",
		".css": "css"
	},
}
```
Alternatively you can use the content of `@obsidian-ai-providers/sdk/style.css` in your plugin.

### 4. Migrate existing provider
If you want to add providers to the AI Providers plugin, you can use the `migrateProvider` method.
It will show a confirmation dialog and if the user confirms, it will add the provider to the plugin settings.

```typescript
// The migrateProvider method takes an IAIProvider object and returns a promise
// that resolves to the migrated (or existing matching) provider, or false if migration was canceled
const migratedOrExistingProvider = await aiProviders.migrateProvider({
    id: "any-unique-string",
    name: "Ollama local",
    type: "ollama",
    url: "http://localhost:11434",
    apiKey: "sk-1234567890",
    model: "smollm2:135m",
});

// If a provider with matching `type`, `apiKey`, `url`, and `model` fields already exists,
// it will return that existing provider instead of creating a duplicate
// If the user cancels the migration, it will return false

if (migratedOrExistingProvider === false) {
    // Migration was canceled by the user
    console.log("User canceled the migration");
} else {
    // Provider was added or already existed
    console.log("Provider available:", migratedOrExistingProvider);
}
```

### Execute prompt
You can use just the list of providers and selected models but you can also make requests to AI Providers using `execute` method.

```typescript
// Simple prompt-based request
const chunkHandler = await aiProviders.execute({
    provider: aiProviders.providers[0],
    prompt: "What is the capital of Great Britain?",
});

// Using messages format (more flexible, allowing multiple messages and different roles)
const chunkHandlerWithMessages = await aiProviders.execute({
    provider: aiProviders.providers[0],
    messages: [
        { role: "system", content: "You are a helpful geography assistant." },
        { role: "user", content: "What is the capital of Great Britain?" }
    ]
});

// Working with images (basic approach)
const chunkHandlerWithImage = await aiProviders.execute({
    provider: aiProviders.providers[0],
    prompt: "Describe what you see in this image",
    images: ["data:image/jpeg;base64,/9j/4AAQSkZ..."] // Base64 encoded image
});

// Working with images using messages format
const chunkHandlerWithContentBlocks = await aiProviders.execute({
    provider: aiProviders.providers[0],
    messages: [
        { role: "system", content: "You are a helpful image analyst." },
        { 
            role: "user", 
            content: [
                { type: "text", text: "Describe what you see in this image" },
                { type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/4AAQSkZ..." } }
            ]
        }
    ]
});

// Handle chunk in stream mode
chunkHandler.onData((chunk, accumulatedText) => {
    console.log(accumulatedText);
});

// Handle end of stream
chunkHandler.onEnd((fullText) => {
    console.log(fullText);
});

// Handle error
chunkHandler.onError((error) => {
    console.error(error);
});

// Abort request if you need to
chunkHandler.abort();
```

### Embed text
```typescript
const embeddings = await aiProviders.embed({
    provider: aiProviders.providers[0],
    input: "What is the capital of Great Britain?",  // Use 'input' parameter
});

// embeddings is just an array of numbers
embeddings; // [0.1, 0.2, 0.3, ...]
```

#### Progress tracking for embeddings
You can track the progress of embedding generation, especially useful when processing multiple text chunks:

```typescript
const embeddings = await aiProviders.embed({
    provider: aiProviders.providers[0],
    input: ["Text 1", "Text 2", "Text 3", "Text 4"],  // Multiple inputs
    onProgress: (processedChunks) => {
        console.log(`Processing: ${processedChunks.length} chunks processed`);
		
        // Access processed chunks if needed
        console.log('Latest processed chunks:', processedChunks);
    }
});
```

### Retrieve relevant documents
The `retrieve` method performs semantic search to find the most relevant text chunks from a collection of documents based on a query. This is useful for implementing RAG (Retrieval-Augmented Generation) functionality.

```typescript
// Reading documents from Obsidian vault
const markdownFiles = this.app.vault.getMarkdownFiles();
const documents = [];

// Read content from multiple files
for (const file of markdownFiles.slice(0, 10)) { // Limit for demo
    try {
        const content = await this.app.vault.read(file);
        if (content.trim()) {
            documents.push({
                content: content,
                meta: {
                    filename: file.name,
                    path: file.path,
                    size: content.length,
                    modified: file.stat.mtime,
					// Any other meta
                }
            });
        }
    } catch (error) {
        console.warn(`Failed to read ${file.path}:`, error);
    }
}

// Perform semantic search with progress tracking
const results = await aiProviders.retrieve({
    query: "machine learning algorithms",
    documents: documents,
    embeddingProvider: aiProviders.providers[0],
    onProgress: (progress) => {
        const chunksPercentage = (progress.processedChunks.length / progress.totalChunks) * 100;
        const docsPercentage = (progress.processedDocuments.length / progress.totalDocuments) * 100;
        
        console.log(`Processing chunks: ${progress.processedChunks.length}/${progress.totalChunks} (${chunksPercentage.toFixed(1)}%)`);
        console.log(`Processing documents: ${progress.processedDocuments.length}/${progress.totalDocuments} (${docsPercentage.toFixed(1)}%)`);
    }
});

// Results are sorted by relevance score (highest first)
results.forEach(result => {
    console.log(`Score: ${result.score}`);
    console.log(`File: ${result.document.meta?.filename}`);
    console.log(`Content preview: ${result.content.substring(0, 100)}...`);
    console.log(`Path: ${result.document.meta?.path}`);
});

/*
Output example:
Score: 0.92
File: ML-Notes.md
Content preview: Machine learning algorithms can be categorized into supervised, unsupervised, and reinforcement...
Path: Notes/ML-Notes.md

Score: 0.78
File: AI-Research.md
Content preview: Recent advances in neural networks have shown promising results in various applications...
Path: Research/AI-Research.md
*/
```

#### Basic example with static documents
```typescript
// Simple example with predefined documents
const documents = [
    {
        content: "London is the capital city of England and the United Kingdom. It is located on the River Thames.",
        meta: { source: "geography.txt", category: "cities" }
    },
    {
        content: "Paris is the capital and most populous city of France. It is situated on the Seine River.",
        meta: { source: "geography.txt", category: "cities" }
    }
];

const results = await aiProviders.retrieve({
    query: "What is the capital of England?",
    documents: documents,
    embeddingProvider: aiProviders.providers[0]
});
```

#### Working with large documents
The `retrieve` method automatically splits large documents into smaller chunks for better search accuracy:

```typescript
const largeDocuments = [
    {
        content: `
            Chapter 1: Introduction to Machine Learning
            Machine learning is a subset of artificial intelligence that focuses on algorithms and statistical models.
            
            Chapter 2: Types of Machine Learning
            There are three main types: supervised learning, unsupervised learning, and reinforcement learning.
            
            Chapter 3: Neural Networks
            Neural networks are computing systems inspired by biological neural networks.
        `,
        meta: { title: "ML Textbook", chapter: "1-3" }
    }
];

const mlResults = await aiProviders.retrieve({
    query: "What are the types of machine learning?",
    documents: largeDocuments,
    embeddingProvider: aiProviders.providers[0]
});

// The method will find the most relevant chunk about ML types
console.log(mlResults[0].content);
// "There are three main types: supervised learning, unsupervised learning, and reinforcement learning."
```

### Fetch models
There is no need to fetch models manually, but you can do it if you want to.
You can fetch models for any provider using `fetchModels` method.

```typescript
// Makes request to the provider and returns list of models
// Also updates the list of available models in the provider object
const models = await aiProviders.fetchModels(aiProviders.providers[0]);

console.log(models); // ['smollm2:135m', 'llama2:latest']
console.log(aiProviders.providers[0].availableModels) // ['smollm2:135m', 'llama2:latest']
```

### Error handling
All methods throw errors if something goes wrong.  
In most cases it shows a Notice in the Obsidian UI.

```typescript
try {
    await aiProviders.embed({
        provider: aiProviders.providers[0],
        input: "What is the capital of Great Britain?",
    });
} catch (error) {
    // You should handle errors in your plugin
    console.error(error);
}
```

```typescript
// Error handling for retrieve method
try {
    const results = await aiProviders.retrieve({
        query: "search query",
        documents: documents,
        embeddingProvider: aiProviders.providers[0]
    });
} catch (error) {
    // Handle retrieval errors (e.g., provider issues, invalid documents)
    console.error("Retrieval failed:", error);
}
```

```typescript
const chunkHandler = await aiProviders.execute({
    provider: aiProviders.providers[0],
    prompt: "What is the capital of Great Britain?",
});

// Only `execute` method passes errors to the onError callback
chunkHandler.onError((error) => {
    console.error(error);
});
```

If you have any questions, please contact me via Telegram [@pavel_frankov](https://t.me/pavel_frankov).
