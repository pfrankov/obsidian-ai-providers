/*
Deterministic retrieval benchmark for RAG.

Usage:
  1) Create benchmarks/retrieve.config.json based on retrieve.config.example.json
  2) Run:
       npm run bench:retrieve            # full cycle (uses full limits from config)
       npm run bench:retrieve:simple     # simplified cycle (uses simple limits from config)

This script:
  - Loads documents (from directory) and queries (from dataset JSON)
  - Runs deterministic retrieval using OpenAI-like embeddings
  - Asks an OpenAI-like model to evaluate results with a structured numeric score
  - Aggregates scores and saves a report JSON and markdown in benchmarks/reports
*/

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AIProvidersService } from '../src/AIProvidersService';
// no extra SDK types needed
import { IAIDocument, IAIProvider, IAIProvidersPluginSettings, IAIProvidersExecuteParams } from '@obsidian-ai-providers/sdk';
import type { App } from 'obsidian';
import type AIProvidersPlugin from '../src/main';

type ProviderEndpointConfig = {
    baseURL?: string;
    apiKey?: string;
    model: string;
};

type ProviderConfig = {
    // New preferred shape: separate endpoints for embedding/completion/evaluation
    embedding?: ProviderEndpointConfig;
    completion?: ProviderEndpointConfig;
    evaluation?: ProviderEndpointConfig; // used when evaluation.method = 'llm'

    // Legacy fallback fields (kept for backwards compatibility)
    baseURL?: string;
    apiKey?: string;
    embeddingModel?: string;
    completionModel?: string;
};

type BenchmarkConfig = {
    provider: ProviderConfig;
    input: {
        documentsDir: string; // directory with .md/.txt files
        datasetFile: string; // JSON with queries
    };
    retrieval: {
        topK: number;
    };
    evaluation?: {
        method?: 'embedding' | 'llm';
        llmModel?: string;
    };
    simple?: {
        maxDocs?: number;
        maxQueries?: number;
        topK?: number;
    };
    concurrency?: number;
    outputDir?: string; // default: benchmarks/reports
    skipLLM?: boolean; // Skip LLM completion to test only retrieval quality
    verboseLogging?: boolean; // Enable detailed logging (default: true when LLM enabled, false when skipLLM)
};

type DocumentRecord = {
    id: string;
    content: string;
    meta?: Record<string, unknown>;
};

type QueryRecord = {
    id: string;
    query: string;
    reference?: string; // expected answer or reference passage (optional but recommended)
    contexts?: { filename: string; text: string }[]; // optional per-query contexts (new format)
};

type DatasetFile = {
    queries: QueryRecord[];
};

type NewDatasetEntry = {
    id: string;
    question: string;
    answer?: string;
    is_impossible?: boolean;
    contexts: { filename: string; text: string }[];
};

type RetrievedChunk = {
    content: string;
    docId: string;
    score: number;
};

type QueryResult = {
    queryId: string;
    query: string;
    topK: number;
    retrieved: RetrievedChunk[];
    llm: {
        model: string;
        answer: string;
        reference?: string;
    };
    eval: {
        score: number; // 0..100 derived from evaluation method
        answerSimilarity: number; // cosine similarity 0..1 (always reported)
        answerDistance: number; // 1 - similarity
        method: 'embedding' | 'llm';
    };
    timings: {
        retrievalMs: number;
        completionMs: number;
        evaluationMs: number;
        totalMs: number;
    };
    retrievalMetrics?: {
        precisionAtK?: number;
        hitAtK?: boolean;
    };
    error?: string;
};

type Report = {
    mode: 'full' | 'simple';
    topK: number;
    embeddingModel: string;
    completionModel: string;
    evaluationMethod: 'embedding' | 'llm';
    totals: {
        numDocuments: number;
        numQueries: number;
        sumScore: number;
        meanScore: number;
    };
    metrics?: {
        meanPrecisionAtK?: number;
        hitRate?: number;
        meanRetrievalMs: number;
        meanCompletionMs: number;
        meanEvaluationMs: number;
        meanTotalMs: number;
    };
    results: QueryResult[];
};

// Compact report types for saving
type SavedQueryResult = Omit<QueryResult, 'retrieved'> & {
    retrieved: Array<{ docId: string; score: number }>;
};
type SavedReport = Omit<Report, 'results'> & { results: SavedQueryResult[] };

// ---------- Shared helpers ----------

function formatMs(ms: number): string {
    return `${ms.toFixed(1)} ms`;
}

function formatETA(ms: number): string {
    if (!isFinite(ms) || ms <= 0) return '0 s';
    const totalSeconds = Math.round(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const remAfterDays = totalSeconds % 86400;
    const hours = Math.floor(remAfterDays / 3600);
    const remAfterHours = remAfterDays % 3600;
    const minutes = Math.floor(remAfterHours / 60);
    const seconds = remAfterHours % 60;
    const pad2 = (n: number) => String(n).padStart(2, '0');
    if (days > 0) return `${days}d ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
    if (minutes > 0) return `${minutes}:${pad2(seconds)}`;
    return `${seconds} s`;
}

function fmt(n: number, digits = 2): string {
    return isFinite(n) ? n.toFixed(digits) : '0.00';
}

function ms(n: number): string {
    return `${fmt(n, 1)} ms`;
}

function numbers(arr: number[]): number[] {
    return arr.filter(x => typeof x === 'number' && isFinite(x));
}

function percentile(arr: number[], p: number): number {
    const a = numbers(arr).slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    if (p <= 0) return a[0];
    if (p >= 1) return a[a.length - 1];
    const idx = (a.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const w = idx - lo;
    if (hi === lo) return a[lo];
    return a[lo] * (1 - w) + a[hi] * w;
}

function compactReport(report: Report): SavedReport {
    return {
        ...report,
        results: report.results.map(r => ({
            ...r,
            retrieved: r.retrieved.map(rc => ({ docId: rc.docId, score: rc.score })),
        })),
    };
}

function rateScore(value: number): string {
    const emoji = { excellent: '🟢', good: '🟡', fair: '🟠', poor: '🔴' } as const;
    if (value >= 90) return `${emoji.excellent} Excellent`;
    if (value >= 75) return `${emoji.good} Good`;
    if (value >= 50) return `${emoji.fair} Fair`;
    return `${emoji.poor} Poor`;
}

function ratePrecision(value: number | undefined): string | undefined {
    const emoji = { excellent: '🟢', good: '🟡', fair: '🟠', poor: '🔴' } as const;
    if (value === undefined) return undefined;
    if (value >= 0.8) return `${emoji.excellent} Excellent`;
    if (value >= 0.6) return `${emoji.good} Good`;
    if (value >= 0.4) return `${emoji.fair} Fair`;
    return `${emoji.poor} Poor`;
}

function rateHit(value: number | undefined): string | undefined {
    const emoji = { excellent: '🟢', good: '🟡', fair: '🟠', poor: '🔴' } as const;
    if (value === undefined) return undefined;
    if (value >= 0.95) return `${emoji.excellent} Excellent`;
    if (value >= 0.8) return `${emoji.good} Good`;
    if (value >= 0.6) return `${emoji.fair} Fair`;
    return `${emoji.poor} Poor`;
}

function rateTime(stage: 'retrieval' | 'completion' | 'evaluation' | 'total', msValue: number): string {
    const emoji = { excellent: '🟢', good: '🟡', fair: '🟠', poor: '🔴' } as const;
    const s = msValue / 1000;
    if (stage === 'retrieval') {
        if (msValue < 50) return `${emoji.excellent} Excellent`;
        if (msValue < 150) return `${emoji.good} Good`;
        if (msValue < 300) return `${emoji.fair} Fair`;
        return `${emoji.poor} Poor`;
    }
    if (stage === 'completion') {
        if (s < 1) return `${emoji.excellent} Excellent`;
        if (s < 3) return `${emoji.good} Good`;
        if (s < 6) return `${emoji.fair} Fair`;
        return `${emoji.poor} Poor`;
    }
    if (stage === 'evaluation') {
        if (s < 0.5) return `${emoji.excellent} Excellent`;
        if (s < 1.5) return `${emoji.good} Good`;
        if (s < 3) return `${emoji.fair} Fair`;
        return `${emoji.poor} Poor`;
    }
    if (s < 2) return `${emoji.excellent} Excellent`;
    if (s < 5) return `${emoji.good} Good`;
    if (s < 10) return `${emoji.fair} Fair`;
    return `${emoji.poor} Poor`;
}

function generateMarkdownReport(report: Report, queries: QueryRecord[], skipLLM: boolean): string {
    const mdLines: string[] = [];
    const scores = report.results.map(r => r.eval.score);
    const tRetrieval = report.results.map(r => r.timings.retrievalMs);
    const tCompletion = report.results.map(r => r.timings.completionMs);
    const tEvaluation = report.results.map(r => r.timings.evaluationMs);
    const tTotal = report.results.map(r => r.timings.totalMs);

    const emoji = { excellent: '🟢', good: '🟡', fair: '🟠', poor: '🔴' } as const;

    mdLines.push('# Retrieval Benchmark Report');
    mdLines.push('');
    mdLines.push('### Overview');
    mdLines.push('');
    mdLines.push('| Item | Value |');
    mdLines.push('| --- | --- |');
    mdLines.push(`| Mode | ${report.mode} |`);
    mdLines.push(`| TopK | ${report.topK} |`);
    mdLines.push(`| Embedding Model | ${report.embeddingModel} |`);
    mdLines.push(`| Completion Model | ${report.completionModel} |`);
    mdLines.push(`| Evaluation Method | ${report.evaluationMethod} |`);
    mdLines.push(`| Documents | ${report.totals.numDocuments} |`);
    mdLines.push(`| Queries | ${report.totals.numQueries} |`);
    if (!skipLLM) {
        mdLines.push(`| Sum Score | ${fmt(report.totals.sumScore)} |`);
        mdLines.push(`| Mean Score | ${fmt(report.totals.meanScore)} (${rateScore(report.totals.meanScore)}) |`);
    }
    if (report.metrics?.meanPrecisionAtK !== undefined) mdLines.push(`| Mean Precision@K | ${fmt(report.metrics.meanPrecisionAtK, 4)} (${ratePrecision(report.metrics.meanPrecisionAtK)}) |`);
    if (report.metrics?.hitRate !== undefined) mdLines.push(`| Hit@K | ${fmt(report.metrics.hitRate, 4)} (${rateHit(report.metrics.hitRate)}) |`);
    mdLines.push('');

    mdLines.push('### Score Statistics');
    mdLines.push('');
    mdLines.push('| Metric | Value |');
    mdLines.push('| --- | --- |');
    mdLines.push(`| Min | ${fmt(Math.min(...scores))} |`);
    mdLines.push(`| Median | ${fmt(percentile(scores, 0.5))} |`);
    mdLines.push(`| P90 | ${fmt(percentile(scores, 0.9))} |`);
    mdLines.push(`| Max | ${fmt(Math.max(...scores))} |`);
    mdLines.push('');

    mdLines.push('### Time Statistics');
    mdLines.push('');
    mdLines.push('| Stage | Mean | Rating | Median | P90 |');
    mdLines.push('| --- | ---:| :--: | ---:| ---:|');
    mdLines.push(`| Retrieval | ${ms(report.metrics?.meanRetrievalMs || 0)} | ${rateTime('retrieval', report.metrics?.meanRetrievalMs || 0)} | ${ms(percentile(tRetrieval, 0.5))} | ${ms(percentile(tRetrieval, 0.9))} |`);
    if (!skipLLM) {
        mdLines.push(`| Completion | ${ms(report.metrics?.meanCompletionMs || 0)} | ${rateTime('completion', report.metrics?.meanCompletionMs || 0)} | ${ms(percentile(tCompletion, 0.5))} | ${ms(percentile(tCompletion, 0.9))} |`);
        mdLines.push(`| Evaluation | ${ms(report.metrics?.meanEvaluationMs || 0)} | ${rateTime('evaluation', report.metrics?.meanEvaluationMs || 0)} | ${ms(percentile(tEvaluation, 0.5))} | ${ms(percentile(tEvaluation, 0.9))} |`);
    }
    mdLines.push(`| Total | ${ms(report.metrics?.meanTotalMs || 0)} | ${rateTime('total', report.metrics?.meanTotalMs || 0)} | ${ms(percentile(tTotal, 0.5))} | ${ms(percentile(tTotal, 0.9))} |`);
    mdLines.push('');

    if (!skipLLM) {
        const best = [...report.results].sort((a, b) => b.eval.score - a.eval.score).slice(0, Math.min(3, report.results.length));
        const worst = [...report.results].sort((a, b) => a.eval.score - b.eval.score).slice(0, Math.min(3, report.results.length));
        mdLines.push('### Highlights');
        mdLines.push('');
        if (best.length) {
            mdLines.push('- Best queries:');
            best.forEach(r => mdLines.push(`  - \`${r.queryId}\`: score=${r.eval.score}, sim=${fmt(r.eval.answerSimilarity, 3)}, method=${r.eval.method}`));
        }
        if (worst.length) {
            mdLines.push('- Lowest queries:');
            worst.forEach(r => mdLines.push(`  - \`${r.queryId}\`: score=${r.eval.score}, sim=${fmt(r.eval.answerSimilarity, 3)}, method=${r.eval.method}`));
        }
        mdLines.push('');
    }

    mdLines.push('### Per-Query Results');
    for (const r of report.results) {
        if (skipLLM) {
            mdLines.push(`#### ${r.queryId} — retrieval only`);
        } else {
            mdLines.push(`#### ${r.queryId} — score ${r.eval.score} (method: ${r.eval.method})`);
        }
        mdLines.push('');
        mdLines.push(`- Query: ${r.query}`);
        if (r.llm.reference) mdLines.push(`- Reference: ${r.llm.reference}`);
        mdLines.push('');

        if (skipLLM) {
            mdLines.push('| Retrieval | Total |');
            mdLines.push('| ---:| ---:|');
            mdLines.push(`| ${ms(r.timings.retrievalMs)} | ${ms(r.timings.totalMs)} |`);
        } else {
            mdLines.push('| Similarity | Sim Rating | Distance | Retrieval | Completion | Evaluation | Total |');
            mdLines.push('| ---:| :--: | ---:| ---:| ---:| ---:| ---:|');
            const simRating = r.eval.answerSimilarity >= 0.8 ? `${emoji.excellent} Excellent` : r.eval.answerSimilarity >= 0.6 ? `${emoji.good} Good` : r.eval.answerSimilarity >= 0.4 ? `${emoji.fair} Fair` : `${emoji.poor} Poor`;
            mdLines.push(`| ${fmt(r.eval.answerSimilarity, 4)} | ${simRating} | ${fmt(r.eval.answerDistance, 4)} | ${ms(r.timings.retrievalMs)} | ${ms(r.timings.completionMs)} | ${ms(r.timings.evaluationMs)} | ${ms(r.timings.totalMs)} |`);
        }
        if (r.error) {
            mdLines.push('');
            mdLines.push(`> Error: ${r.error}`);
        }
        if (r.retrievalMetrics?.precisionAtK !== undefined) {
            mdLines.push('');
            mdLines.push(`> Retrieval metrics: Precision@K=${fmt(r.retrievalMetrics.precisionAtK, 4)}, Hit=${r.retrievalMetrics.hitAtK ? 'yes' : 'no'}`);
        }
        if (r.retrieved.length) {
            mdLines.push('');
            mdLines.push(`Retrieved (top ${r.retrieved.length}):`);
            mdLines.push('');
            mdLines.push('| # | docId | retrieval_score |');
            mdLines.push('| ---:| --- | ---:|');
            r.retrieved.forEach((c, idx) => {
                mdLines.push(`| ${idx + 1} | ${c.docId} | ${fmt(c.score, 4)} |`);
            });
        }
        const originalQuery = queries.find(q => q.id === r.queryId);
        if (originalQuery?.contexts?.length) {
            mdLines.push('');
            mdLines.push('Expected (from contexts):');
            mdLines.push('');
            mdLines.push('| filename | hit |');
            mdLines.push('| --- | :--: |');
            const got = new Set(r.retrieved.map(x => x.docId.toLowerCase()));
            originalQuery.contexts.forEach(c => {
                const bn = path.basename(String(c.filename));
                const hit = got.has(bn.toLowerCase()) ? 'yes' : 'no';
                mdLines.push(`| ${bn} | ${hit} |`);
            });
        }
        mdLines.push('');
    }

    mdLines.push('');
    mdLines.push('### Legend & Targets');
    mdLines.push('');
    if (!skipLLM) {
        mdLines.push('- Score (0-100): 90-100 — 🟢 Excellent, 75-89 — 🟡 Good, 50-74 — 🟠 Fair, 0-49 — 🔴 Poor');
        mdLines.push('- Similarity (cosine, -1..1; typically 0..1): ≥0.80 — 🟢, ≥0.60 — 🟡, ≥0.40 — 🟠, lower — 🔴');
        mdLines.push('- Completion time: <1s — 🟢, <3s — 🟡, <6s — 🟠, ≥6s — 🔴');
        mdLines.push('- Evaluation time: <0.5s — 🟢, <1.5s — 🟡, <3s — 🟠, ≥3s — 🔴');
    }
    mdLines.push('- Precision@K / Hit@K (0-1): ≥0.80 / ≥0.95 — 🟢 Excellent, ≥0.60 / ≥0.80 — 🟡 Good, ≥0.40 / ≥0.60 — 🟠 Fair, lower — 🔴 Poor');
    mdLines.push('- Retrieval time: <50ms — 🟢, <150ms — 🟡, <300ms — 🟠, ≥300ms — 🔴');
    mdLines.push('- Total time: <2s — 🟢, <5s — 🟡, <10s — 🟠, ≥10s — 🔴');

    return mdLines.join('\n');
}

function saveReports(report: Report, runDir: string, skipLLM: boolean, queries: QueryRecord[]): { jsonPath: string; mdPath: string } {
    const jsonPath = path.join(runDir, 'report.json');
    const mdPath = path.join(runDir, 'report.md');
    const reportForSave = compactReport(report);
    fs.writeFileSync(jsonPath, JSON.stringify(reportForSave, null, 2), 'utf-8');
    const md = generateMarkdownReport(report, queries, skipLLM);
    fs.writeFileSync(mdPath, md, 'utf-8');
    return { jsonPath, mdPath };
}

function readJsonFile<T>(filePath: string): T {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
}

function discoverFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
                files.push(path.join(dir, entry.name));
            }
        }
    }
    // Stable order
    files.sort();
    return files;
}

async function readDocuments(dir: string): Promise<DocumentRecord[]> {
    const filePaths = discoverFiles(dir);
    const documents: DocumentRecord[] = [];
    for (const filePath of filePaths) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const id = path.relative(dir, filePath);
        documents.push({ id, content, meta: { filePath } });
    }
    return documents;
}

function toIAIDocuments(documents: DocumentRecord[]): IAIDocument[] {
    // Keep meta.id stable for chunk-to-document mapping in service, add normalized filename
    return documents.map(d => ({
        content: d.content,
        meta: {
            id: d.id,
            filename: path.basename(typeof d.meta?.filePath === 'string' ? d.meta?.filePath as string : d.id),
            ...d.meta,
        },
    }));
}

function getDocumentBaseName(meta: Record<string, unknown> | undefined): string {
    const m = meta as { filename?: unknown; id?: unknown; filePath?: unknown } | undefined;
    const raw = m && (typeof m.filename === 'string'
        ? m.filename
        : typeof m.id === 'string'
        ? m.id
        : typeof m.filePath === 'string'
        ? m.filePath
        : '');
    return path.basename(String(raw));
}

// Per-query contexts are intentionally ignored in benchmarking mode to ensure
// consistent retrieval across the full corpus.

//

function createAIProvidersService(_config: BenchmarkConfig): AIProvidersService {
    // Minimal app/plugin to satisfy constructor; we don't call initEmbeddingsCache here
    const fakeApp = { appId: 'benchmark-app-id' } as unknown as App;
    const settings: IAIProvidersPluginSettings = {
        providers: [],
        _version: 1,
        debugLogging: false,
        useNativeFetch: true, // force native fetch to avoid Obsidian/electron fetch paths
    };
    const fakePlugin = { settings, saveSettings: async () => {} } as unknown as AIProvidersPlugin;
    const service = new AIProvidersService(fakeApp, fakePlugin);
    
    return service;
}

function installMockHandlersIfRequested(): void {
    if (process.env.BENCH_MOCK_HANDLERS !== '1') return;
    try {
        // Dynamically import to avoid bundling issues when not used
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { OpenAIHandler } = require('../src/handlers/OpenAIHandler');

        // SHA256 hash function for better cache key generation
        const sha256Hash = (text: string): string => {
            return crypto.createHash('sha256').update(text).digest('hex');
        };

        const toUnit = (v: number[]): number[] => {
            const mag = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
            return v.map(x => x / mag);
        };
        
        const textToEmbedding = (text: string, dim = 64): number[] => {
            const out = new Array(dim).fill(0);
            
            // Use SHA256 hash for more deterministic and diverse embeddings
            const textHash = sha256Hash(text);
            const hashBytes = Buffer.from(textHash, 'hex');
            
            // Generate embedding based on SHA256 hash
            for (let i = 0; i < dim; i++) {
                // Use different bytes from hash for each dimension
                const byteIndex = i % hashBytes.length;
                const byte = hashBytes[byteIndex];
                
                // Add position-based variation
                const posFactor = (i * 31) % 997;
                
                // Combine hash byte with position for diversity
                out[i] = (byte * posFactor) % 1000;
            }
            
            // Add text length influence
            const lengthFactor = text.length % 1000;
            for (let i = 0; i < Math.min(dim, 5); i++) {
                out[i] += lengthFactor;
            }
            
            return toUnit(out.map(v => Math.sin(v)));
        };

        OpenAIHandler.prototype.embed = async function (params: { input: string | string[] }): Promise<number[][]> {
            const p = params as unknown as { input: string | string[] };
            const inputs = Array.isArray(p.input) ? p.input : [p.input];
            const embeddings = inputs.map((t: string) => textToEmbedding(String(t)));
            
            // Debug logging removed for simplicity
            
            return embeddings;
        };

        OpenAIHandler.prototype.execute = async function (params: { prompt?: string; messages?: unknown }): Promise<string> {
            const unsafe = params as unknown as { prompt?: string };
            if (unsafe.prompt) {
                const p = String(unsafe.prompt);
                const idx = p.indexOf('Answer:');
                const tail = idx >= 0 ? p.slice(idx + 7).trim() : p;
                return `Mock answer based on context (${Math.min(200, tail.length)} chars).`;
            }
            return 'Mock answer';
        };

        // Optional: make model listing work if invoked
        OpenAIHandler.prototype.fetchModels = async function () {
            return ['mock-embedding', 'mock-chat'];
        };
        console.log('[RAG Benchmark] Installed mock handlers');
    } catch (e) {
        console.log('[RAG Benchmark] Failed to install mock handlers:', e instanceof Error ? e.message : String(e));
    }
}

function toEmbeddingProvider(config: BenchmarkConfig): IAIProvider {
    const emb = config.provider.embedding;
    const url = emb?.baseURL || config.provider.baseURL;
    const apiKey = emb?.apiKey || process.env.OPENAI_API_KEY || config.provider.apiKey || '';
    const model = emb?.model || config.provider.embeddingModel || '';
    return {
        id: 'benchmark-embedding-provider',
        name: 'Benchmark Embeddings',
        type: 'openai',
        url,
        apiKey,
        model,
    };
}

function toCompletionProvider(config: BenchmarkConfig): IAIProvider {
    const cmp = config.provider.completion;
    const url = cmp?.baseURL || config.provider.baseURL;
    const apiKey = cmp?.apiKey || process.env.OPENAI_API_KEY || config.provider.apiKey || '';
    const model = cmp?.model || config.provider.completionModel || 'gpt-4o-mini';
    return {
        id: 'benchmark-completion-provider',
        name: 'Benchmark Completion',
        type: 'openai',
        url,
        apiKey,
        model,
    };
}

function toEvaluationProvider(config: BenchmarkConfig): IAIProvider {
    const ev = config.provider.evaluation;
    const url = ev?.baseURL || config.provider.baseURL;
    const apiKey = ev?.apiKey || process.env.OPENAI_API_KEY || config.provider.apiKey || '';
    const model = ev?.model || config.evaluation?.llmModel || config.provider.completionModel || 'gpt-4o-mini';
    return {
        id: 'benchmark-evaluation-provider',
        name: 'Benchmark Evaluation',
        type: 'openai',
        url,
        apiKey,
        model,
    };
}

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// SHA256-based cache management for embeddings
// Removed cache clearing helpers for simplicity

// Removed getCacheKeyForText helper (was used only in debug paths)

function nowStamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        d.getFullYear() +
        '-' +
        pad(d.getMonth() + 1) +
        '-' +
        pad(d.getDate()) +
        '_' +
        pad(d.getHours()) +
        '-' +
        pad(d.getMinutes()) +
        '-' +
        pad(d.getSeconds())
    );
}

function loadConfig(configPath: string): BenchmarkConfig {
    const resolved = path.resolve(configPath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`Config file not found: ${resolved}`);
    }
    return readJsonFile<BenchmarkConfig>(resolved);
}

function validateConfig(config: BenchmarkConfig): void {
    const embeddingModel = config?.provider?.embedding?.model || config?.provider?.embeddingModel;
    if (!embeddingModel) {
        throw new Error('provider.embedding.model (or legacy provider.embeddingModel) is required');
    }
    if (!config?.input?.datasetFile) {
        throw new Error('input.datasetFile is required');
    }
    const datasetPath = path.resolve(config.input.datasetFile);
    if (!fs.existsSync(datasetPath)) {
        throw new Error(`Dataset file not found: ${datasetPath}`);
    }
    if (!config?.input?.documentsDir) {
        throw new Error('input.documentsDir is required');
    }
    const docsDir = path.resolve(config.input.documentsDir);
    if (!fs.existsSync(docsDir)) {
        throw new Error(`Documents directory not found: ${docsDir}`);
    }
}

// --- File-based embeddings cache (benchmark-only) ---
// Legacy type no longer needed with per-item cache

function sha256(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function getProviderCacheKey(provider: IAIProvider): string {
    const base = [provider.type, provider.url || '', provider.model || ''].join('|');
    return sha256(base);
}

// Incremental, file-per-item cache to avoid huge JSON writes
function getProviderCacheDir(cacheFilePath: string): string {
    const baseDir = path.dirname(cacheFilePath);
    const fileName = path.basename(cacheFilePath, '.json');
    const providerDir = path.join(baseDir, fileName);
    ensureDir(providerDir);
    return providerDir;
}

function getItemPath(providerDir: string, hash: string): string {
    const bucket = hash.slice(0, 2);
    const bucketDir = path.join(providerDir, bucket);
    ensureDir(bucketDir);
    return path.join(bucketDir, `${hash}.json`);
}

function readCachedItem(providerDir: string, hash: string): { embedding: number[] } | null {
    try {
        const itemPath = getItemPath(providerDir, hash);
        if (fs.existsSync(itemPath)) {
            const raw = fs.readFileSync(itemPath, 'utf-8');
            const parsed = JSON.parse(raw) as { embedding: number[] };
            if (Array.isArray(parsed?.embedding)) return { embedding: parsed.embedding };
        }
    } catch {
        // ignore read/parse errors for individual items
    }
    return null;
}

function writeCachedItems(cacheFilePath: string, items: Record<string, { embedding: number[] }>): void {
    const providerDir = getProviderCacheDir(cacheFilePath);
    for (const [hash, value] of Object.entries(items)) {
        try {
            const itemPath = getItemPath(providerDir, hash);
            // Write atomically-ish by writing to temp then renaming
            const tmpPath = `${itemPath}.tmp`;
            fs.writeFileSync(tmpPath, JSON.stringify({ embedding: value.embedding }), 'utf-8');
            fs.renameSync(tmpPath, itemPath);
        } catch {
            // ignore individual write errors
        }
    }
}

function setupFileEmbeddingsCache(service: AIProvidersService, cacheRootDir: string): void {
    type EmbedFunction = (params: { provider: IAIProvider; input: string | string[]; onProgress?: (processed: string[]) => void; abortController?: AbortController }) => Promise<number[][]>;
    interface EmbedForceService {
        embed: EmbedFunction;
        embedForce?: EmbedFunction;
    }

    const svc = service as unknown as EmbedForceService;
    const originalEmbedForce = svc.embedForce?.bind(service);
    const originalEmbed = svc.embed.bind(service);

    // computeEmbeddings removed; incremental batching is implemented inline below

    (svc as EmbedForceService).embed = async (params: { provider: IAIProvider; input: string | string[]; onProgress?: (processed: string[]) => void; abortController?: AbortController }): Promise<number[][]> => {
        if (params.input === undefined || params.input === null) {
            throw new Error('Input is required for embedding');
        }
        const inputArray: string[] = Array.isArray(params.input) ? params.input : [params.input as string];
        const provider: IAIProvider = params.provider;
        const startedAt = Date.now();
        const totalChars = inputArray.reduce((sum, t) => sum + (t?.length || 0), 0);

        const providerKey = getProviderCacheKey(provider);
        const cacheFile = path.resolve(cacheRootDir, `${providerKey}.json`);
        const providerDir = getProviderCacheDir(cacheFile);

        const hashes = inputArray.map(t => sha256(t));
        const missingIndices: number[] = [];
        const result: (number[] | null)[] = new Array(inputArray.length).fill(null);
        let processedChars = 0; // will include cache hits + computed batches

        for (let i = 0; i < inputArray.length; i++) {
            const h = hashes[i];
            const rec = readCachedItem(providerDir, h);
            if (rec && Array.isArray(rec.embedding)) {
                result[i] = rec.embedding as number[];
                processedChars += inputArray[i]?.length || 0;
            } else {
                missingIndices.push(i);
            }
        }

        const cacheHits = inputArray.length - missingIndices.length;
        if (missingIndices.length === 0) {
            console.log(`[Embed cache] model=${provider.model} served ${cacheHits}/${inputArray.length} from cache`);
            // Report progress once with all processed inputs (matches service expectations)
            params.onProgress?.(inputArray);
            return result as number[][];
        }

        if (missingIndices.length > 0) {
            // Map hash -> queue of indices to fill (handles duplicated texts)
            const remainingByHash: Record<string, number[]> = {};
            for (const idx of missingIndices) {
                const h = hashes[idx];
                (remainingByHash[h] = remainingByHash[h] || []).push(idx);
            }

            const maxBatch = 64;
            for (let start = 0; start < missingIndices.length; start += maxBatch) {
                const batchIndices = missingIndices.slice(start, start + maxBatch);
                const batchTexts = batchIndices.map(i => inputArray[i]);

                // Run underlying embed for this batch
                const run: EmbedFunction | undefined = typeof originalEmbedForce === 'function' ? originalEmbedForce : originalEmbed;
                if (!run) throw new Error('Embed function is not available');
                const batchEmbeddings = await run({ provider, input: batchTexts, onProgress: params.onProgress, abortController: params.abortController });

                // Assign to result and write cache incrementally
                const toWrite: Record<string, { embedding: number[] }> = {};
                for (let j = 0; j < batchTexts.length; j++) {
                    const text = batchTexts[j];
                    const emb = batchEmbeddings[j];
                    const h = sha256(text);
                    toWrite[h] = { embedding: emb };
                    const list = remainingByHash[h];
                    if (list && list.length) {
                        const idx = list.shift() as number;
                        result[idx] = emb;
                    }
                }
                writeCachedItems(cacheFile, toWrite);

                // Progress logging
                const batchChars = batchTexts.reduce((s, t) => s + (t?.length || 0), 0);
                processedChars += batchChars;
                const remaining = Math.max(0, totalChars - processedChars);
                const elapsed = Date.now() - startedAt;
                const rate = processedChars > 0 && elapsed > 0 ? processedChars / elapsed : 0; // chars/ms
                const etaMs = rate > 0 ? remaining / rate : 0;
                const percent = totalChars > 0 ? (processedChars / totalChars) * 100 : 100;
                console.log(`[Embed] batch=${batchChars} chars, processed=${processedChars}/${totalChars} (${percent.toFixed(1)}%), remaining=${remaining} chars, ETA≈${formatETA(etaMs)}`);
            }
            console.log(`[Embed cache] model=${provider.model} served ${cacheHits}/${inputArray.length} from cache, computed ${missingIndices.length}`);
        }

        // Report progress once with all processed inputs (matches service expectations)
        params.onProgress?.(inputArray);

        // At this point result is fully populated
        return result as number[][];
    };
}

// getProviderCacheKey not needed without benchmark-level cache

// readCache not needed without benchmark-level cache

// writeCache not needed without benchmark-level cache

// No benchmark-level override of embeddings; use AIProvidersService + handlers chain

async function main() {
    const modeArg = process.env.MODE || 'full'; // 'full' | 'simple'
    const configPath = process.env.RETRIEVE_BENCH_CONFIG || path.join(process.cwd(), 'benchmarks', 'retrieve.config.json');
    const config = loadConfig(configPath);
    validateConfig(config);

    const mode = modeArg === 'simple' ? 'simple' : 'full';
    const topK = mode === 'simple' && config.simple?.topK ? config.simple.topK : config.retrieval.topK;
    const evaluationMethod: 'embedding' | 'llm' = (config.evaluation?.method || 'embedding');
    const concurrency = Math.max(1, Number(config.concurrency || 3));
    const skipLLM = Boolean(config.skipLLM);

    const outputRoot = path.resolve(config.outputDir || path.join('benchmarks', 'reports'));
    ensureDir(outputRoot);
    const runDir = path.join(outputRoot, `retrieve_${nowStamp()}`);
    ensureDir(runDir);

    // use shared formatMs helper
    console.log('[RAG Benchmark] Starting');
    console.log(`- Mode: ${mode}`);
    console.log(`- TopK: ${topK}`);
    console.log(`- Concurrency: ${concurrency}`);
    console.log(`- Evaluation: ${evaluationMethod}`);
    if (skipLLM) console.log(`- LLM Completion: SKIPPED (retrieval-only mode)`);
    // Verbose logging flag removed; keep output minimal
    console.log(`- Config: ${configPath}`);
    
    // Debug mode flags and cache clearing removed for simplicity

    const aiProviders = createAIProvidersService(config);
    // Install mock handler if requested to avoid network (keeps full chain intact)
    installMockHandlersIfRequested();
    const embeddingProvider = toEmbeddingProvider(config);
    const completionProvider = toCompletionProvider(config);
    const evaluationProvider = toEvaluationProvider(config);

    // Install file-based embeddings cache for benchmark runs
    const cacheRootDir = path.resolve('benchmarks', '.cache', 'embeddings');
    ensureDir(cacheRootDir);
    setupFileEmbeddingsCache(aiProviders, cacheRootDir);

    const datasetRaw = readJsonFile<unknown>(path.resolve(config.input.datasetFile));
    const usingNewFormat = Array.isArray(datasetRaw);

    // Collect impossible contexts to exclude their documents
    const impossibleContexts = new Set<string>();
    // In simple mode, we also collect the union of all required documents from query contexts
    // to reduce the corpus to only the necessary files
    const requiredContextBasenames = new Set<string>();
    
    // First pass: collect impossible contexts from dataset
    if (usingNewFormat) {
        const entries = datasetRaw as NewDatasetEntry[];
        entries.forEach(e => {
            if (e.is_impossible) {
                e.contexts.forEach(ctx => impossibleContexts.add(ctx.filename));
            }
        });
        // Build the union of required documents for possible queries
        entries.forEach(e => {
            if (!e.is_impossible) {
                e.contexts.forEach(ctx => requiredContextBasenames.add(path.basename(String(ctx.filename))));
            }
        });
        if (impossibleContexts.size > 0) {
            console.log(`[RAG Benchmark] Found ${impossibleContexts.size} documents to exclude from impossible queries`);
        }
    }

    // Always load documents from folder and use them for every query
    const allDocs = await readDocuments(path.resolve(config.input.documentsDir));
    
    // Filter out documents that are marked as impossible in the dataset
    let docs = allDocs;
    if (impossibleContexts.size > 0) {
        const originalCount = docs.length;
        docs = docs.filter(doc => {
            const filename = path.basename(doc.id);
            return !impossibleContexts.has(filename);
        });
        console.log(`[RAG Benchmark] Filtered documents: ${originalCount} -> ${docs.length} (excluded ${originalCount - docs.length} impossible docs)`);
    }
    
    // CRITICAL: Check allDocs array BEFORE maxDocs filtering
    if (process.env.BENCH_DEBUG_DOCUMENTS === '1') {
        console.log('[RAG Benchmark] allDocs array BEFORE maxDocs filtering:');
        console.log(`  - allDocs.length: ${allDocs.length}`);
        console.log(`  - allDocs[0]?.id: ${allDocs[0]?.id}`);
        console.log(`  - allDocs[0]?.content.length: ${allDocs[0]?.content.length}`);
        
        // Check if allDocs array is already damaged (compare with file count)
        const expectedFileCount = discoverFiles(path.resolve(config.input.documentsDir)).length;
        if (allDocs.length !== expectedFileCount) {
            console.log('[RAG Benchmark] CRITICAL: allDocs array already damaged before maxDocs filtering!');
            console.log(`  - Expected files: ${expectedFileCount}`);
            console.log(`  - Actual documents: ${allDocs.length}`);
            console.log(`  - Lost: ${expectedFileCount - allDocs.length} documents`);
        }
    }
    
    // In simple mode, reduce the corpus to the union of documents referenced in query contexts
    if (mode === 'simple') {
        if (requiredContextBasenames.size > 0) {
            const before = docs.length;
            const need = new Set(Array.from(requiredContextBasenames).map(s => s.toLowerCase()));
            const filtered = docs.filter(doc => need.has(path.basename(doc.id).toLowerCase()));
            if (filtered.length > 0) {
                docs = filtered;
                console.log(`[RAG Benchmark] Simple mode: reduced documents using contexts: ${before} -> ${docs.length}`);
            } else if (config.simple?.maxDocs) {
                docs = docs.slice(0, config.simple.maxDocs);
                console.log(`[RAG Benchmark] Simple mode: context-based reduction yielded 0 docs, using first ${config.simple.maxDocs} documents`);
            } else {
                console.log('[RAG Benchmark] Simple mode: context-based reduction yielded 0 docs, keeping full set');
            }
        } else if (config.simple?.maxDocs) {
            // Fallback to legacy behavior only if we have no contexts to base on
            docs = docs.slice(0, config.simple.maxDocs);
            console.log(`[RAG Benchmark] Simple mode: no contexts found, using first ${config.simple.maxDocs} documents`);
        }
    }
    
    // Pre-process documents once for all queries (major optimization)
    console.log('[RAG Benchmark] Pre-processing documents...');
    
    // CRITICAL: Check docs array BEFORE conversion
    if (process.env.BENCH_DEBUG_DOCUMENTS === '1') {
        console.log('[RAG Benchmark] Docs array BEFORE toIAIDocuments:');
        console.log(`  - docs.length: ${docs.length}`);
        console.log(`  - docs[0]?.id: ${docs[0]?.id}`);
        console.log(`  - docs[0]?.content.length: ${docs[0]?.content.length}`);
        
        // Check if docs array is already damaged
        if (docs.length !== allDocs.length) {
            console.log('[RAG Benchmark] CRITICAL: Docs array already damaged before conversion!');
            console.log(`  - allDocs.length: ${allDocs.length}`);
            console.log(`  - docs.length: ${docs.length}`);
            console.log(`  - Lost: ${allDocs.length - docs.length} documents`);
        }
    }
    
    const iaidocs = toIAIDocuments(docs);
    console.log(`[RAG Benchmark] Documents pre-processed: ${iaidocs.length} documents ready`);
    
    // PROTECTION: Create immutable copy to prevent mutations (for mutation detection only)
    const originalIaidocs = JSON.parse(JSON.stringify(iaidocs));
    
    // STRATEGY: Pass fresh copy of documents to each retrieve() call
    // This prevents AIProvidersService from mutating our original array
    // Each call gets its own copy, so mutations don't accumulate
    
    // Debug output disabled for simplicity
    if (false as boolean) {
        console.log('[RAG Benchmark] Sample document structure:');
        iaidocs.slice(0, 2).forEach((doc, i) => {
            console.log(`  Doc ${i}: id="${doc.meta?.id}", content length: ${doc.content.length}`);
            console.log(`  Doc ${i} content preview: "${doc.content.substring(0, 100)}..."`);
        });
        
        // CRITICAL: Check if array is already damaged
        console.log('[RAG Benchmark] Array integrity check:');
        console.log(`  - Total documents: ${iaidocs.length}`);
        console.log(`  - Expected documents: ${docs.length}`);
        console.log(`  - Documents lost during conversion: ${docs.length - iaidocs.length}`);
        
        if (iaidocs.length !== docs.length) {
            console.log('[RAG Benchmark] WARNING: Documents were lost during IAIDocument conversion!');
            console.log('[RAG Benchmark] This suggests the problem is in toIAIDocuments() or earlier');
        }
        
        // Test chunking on a sample document
        console.log('[RAG Benchmark] Testing chunking on sample document...');
        try {
            const sampleDoc = iaidocs[0];
            if (sampleDoc) {
                // Access the private method for testing
                const service = aiProviders as unknown as { splitByStrategy?: (text: string) => string[] };
                const split = service.splitByStrategy;
                if (typeof split === 'function') {
                    const chunks = split(sampleDoc.content);
                    console.log(`[RAG Benchmark] Sample document chunks: ${chunks.length}`);
                    chunks.slice(0, 3).forEach((chunk: string, i: number) => {
                        console.log(`  Chunk ${i}: length=${chunk.length}, preview="${chunk.substring(0, 80)}..."`);
                    });
                } else {
                    console.log('[RAG Benchmark] Cannot access splitByStrategy method');
                }
            }
        } catch (e) {
            console.log('[RAG Benchmark] Error testing chunking:', e);
        }
    }
    
    const queries: QueryRecord[] = (() => {
        if (usingNewFormat) {
            const entries = datasetRaw as NewDatasetEntry[];
            
            // Filter out impossible queries (contexts already collected above)
            const possibleEntries = entries.filter(e => !e.is_impossible);
            
            console.log(`[RAG Benchmark] Filtered out ${entries.length - possibleEntries.length} impossible queries`);
            
            const mapped: QueryRecord[] = possibleEntries.map(e => ({
                id: e.id,
                query: e.question,
                reference: e.answer,
                contexts: e.contexts,
            }));
            const sorted = mapped.sort((a, b) => a.id.localeCompare(b.id));
            if (mode === 'simple' && config.simple?.maxQueries) return sorted.slice(0, config.simple.maxQueries);
            return sorted;
        } else {
            const dataset = datasetRaw as DatasetFile;
            const sorted = [...dataset.queries].sort((a, b) => a.id.localeCompare(b.id));
            if (mode === 'simple' && config.simple?.maxQueries) return sorted.slice(0, config.simple.maxQueries);
            return sorted;
        }
    })();

    console.log('[RAG Benchmark] Dataset loaded');
    console.log(`- Documents: ${docs.length}`);
    console.log(`- Queries: ${queries.length}${mode === 'simple' ? ' (simple mode limits applied)' : ''}`);
    console.log(`- Embedding model: ${embeddingProvider.model}`);
    console.log(`- Completion model: ${completionProvider.model}`);
    if (evaluationMethod === 'llm') console.log(`- Evaluation model: ${evaluationProvider.model}`);

    // No manual pre-embedding; retrieval will handle chunking and embedding internally

    async function computeEmbeddingScore(answer: string, reference: string): Promise<{ score: number; similarity: number; distance: number; method: 'embedding' }> {
        const [answerEmb] = await aiProviders.embed({ provider: embeddingProvider, input: answer });
        const [refEmb] = await aiProviders.embed({ provider: embeddingProvider, input: reference || answer });
        const len = Math.min(Array.isArray(answerEmb) ? answerEmb.length : 0, Array.isArray(refEmb) ? refEmb.length : 0);
        if (!len) {
            return { score: 0, similarity: 0, distance: 1, method: 'embedding' };
        }
        let dot = 0;
        let sumA = 0;
        let sumB = 0;
        for (let i = 0; i < len; i++) {
            const a = Number(answerEmb[i]);
            const b = Number(refEmb[i]);
            if (!isFinite(a) || !isFinite(b)) continue;
            dot += a * b;
            sumA += a * a;
            sumB += b * b;
        }
        const magA = Math.sqrt(sumA);
        const magB = Math.sqrt(sumB);
        let similarity = magA > 0 && magB > 0 ? dot / (magA * magB) : 0;
        if (!isFinite(similarity)) similarity = 0;
        const clamped = Math.max(-1, Math.min(1, similarity));
        const distance = 1 - clamped;
        const rawScore = Math.round((1 - distance) * 100);
        const score = isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0;
        
        // Debug: log similarity computation details
        if (process.env.BENCH_DEBUG_SIMILARITY === '1') {
            console.log(`[Similarity Debug] answer: "${answer.substring(0, 100)}..." (${answer.length} chars)`);
            console.log(`[Similarity Debug] reference: "${reference.substring(0, 100)}..." (${reference.length} chars)`);
            console.log(`[Similarity Debug] dot: ${dot.toFixed(6)}, magA: ${magA.toFixed(6)}, magB: ${magB.toFixed(6)}`);
            console.log(`[Similarity Debug] raw similarity: ${similarity.toFixed(6)}, clamped: ${clamped.toFixed(6)}, score: ${score}`);
        }
        
        return { score, similarity: clamped, distance, method: 'embedding' };
    }

    function computeRetrievalMetrics(q: QueryRecord, retrieved: RetrievedChunk[]): { precisionAtK?: number; hitAtK?: boolean } | undefined {
        if (!q.contexts || q.contexts.length === 0) return undefined;
        const norm = (s: string) => path.basename(s).toLowerCase();
        const groundTruth = new Set(q.contexts.map(c => norm(String(c.filename))));
        const hits = retrieved.filter(r => groundTruth.has(norm(r.docId))).length;
        return {
            precisionAtK: retrieved.length > 0 ? hits / retrieved.length : 0,
            hitAtK: hits > 0,
        };
    }

    async function evaluateWithLLM(query: string, reference: string, answer: string): Promise<number> {
        const evalPrompt = [
            'You are a meticulous grader. Score the answer against the reference on a 0-100 scale.',
            '',
            `Question: ${query}`,
            `Reference answer: ${reference || '(empty reference)'}`,
            `Candidate answer: ${answer}`,
            '',
            'Scoring rubric:',
            '- 90-100: fully correct, complete, faithful to the reference',
            '- 70-89: mostly correct, minor omissions',
            '- 50-69: partially correct, notable gaps or inaccuracies',
            '- 30-49: largely incorrect or incomplete',
            '- 0-29: incorrect or irrelevant',
            '',
            'Output ONLY the numeric score (integer).'
        ].join('\n');
        const llmParams: IAIProvidersExecuteParams = {
            provider: evaluationProvider,
            prompt: evalPrompt,
            options: { temperature: 0 },
            abortController: new AbortController(),
        } as IAIProvidersExecuteParams;
        const raw = await aiProviders.execute(llmParams);
        const match = raw.match(/\d{1,3}/);
        if (!match) return 0;
        const num = Math.max(0, Math.min(100, parseInt(match[0], 10)));
        return num;
    }

    // Retrieval metrics based on per-query contexts are not used when benchmarking
    // against the entire corpus. Left here intentionally removed to avoid confusion.

    async function processSingleQuery(q: QueryRecord) {
        const t0 = Date.now();
        
        // MUTATION CHECK: Log array state before retrieval
        if (process.env.BENCH_DEBUG_DOCUMENTS === '1') {
            console.log(`[Q ${q.id}] Array state BEFORE retrieval:`);
            console.log(`  - iaidocs.length: ${iaidocs.length}`);
            console.log(`  - iaidocs[0]?.meta?.id: ${iaidocs[0]?.meta?.id}`);
            console.log(`  - iaidocs[0]?.content.length: ${iaidocs[0]?.content.length}`);
            
            // Verify array integrity (should not change now)
            const hasMutation = iaidocs.length !== originalIaidocs.length || 
                              iaidocs[0]?.meta?.id !== originalIaidocs[0]?.meta?.id;
            if (hasMutation) {
                console.log(`[Q ${q.id}] CRITICAL: Array mutation detected despite protection!`);
                console.log(`  - Original length: ${originalIaidocs.length}`);
                console.log(`  - Current length: ${iaidocs.length}`);
            } else {
                console.log(`[Q ${q.id}] Array integrity verified ✅`);
            }
        }
        
        try {
            // Use pre-processed docs (major optimization)
            const tR0 = Date.now();
            const serviceResults = await aiProviders.retrieve({
                query: q.query,
                documents: JSON.parse(JSON.stringify(iaidocs)), // PROTECTION: Fresh copy every time
                embeddingProvider,
                onProgress: (p: { processingType?: string; processedChunks?: unknown[]; totalChunks?: number }) => {
                    if (p?.processingType === 'embedding' && Array.isArray(p.processedChunks)) {
                        const done = p.processedChunks.length;
                        const total = p.totalChunks || 0;
                        // Smart logging: show progress but reduce frequency for performance
                        if (done === total || done % 5000 === 0) {
                            console.log(`[Q ${q.id}] Embedding progress: ${done}/${total} chunks`);
                        }
                    }
                },
            });
            const tR1 = Date.now();
            console.log(`[Q ${q.id}] Retrieved in ${formatMs(tR1 - tR0)}`);
            
            // MUTATION CHECK: Log array state after retrieval
            if (process.env.BENCH_DEBUG_DOCUMENTS === '1') {
                console.log(`[Q ${q.id}] Array state AFTER retrieval:`);
                console.log(`  - iaidocs.length: ${iaidocs.length}`);
                console.log(`  - iaidocs[0]?.meta?.id: ${iaidocs[0]?.meta?.id}`);
                
                // Verify array integrity after retrieval (should not change now)
                const wasMutated = iaidocs.length !== originalIaidocs.length || 
                                 iaidocs[0]?.meta?.id !== originalIaidocs[0]?.meta?.id;
                if (wasMutated) {
                    console.log(`[Q ${q.id}] CRITICAL: Array was mutated during retrieval!`);
                    console.log(`  - Original length: ${originalIaidocs.length}`);
                    console.log(`  - Current length: ${iaidocs.length}`);
                } else {
                    console.log(`[Q ${q.id}] Array integrity maintained after retrieval ✅`);
                }
            }
            
            const retrieved: RetrievedChunk[] = serviceResults.slice(0, topK).map(r => ({
                content: r.content,
                docId: getDocumentBaseName(r.document.meta as Record<string, unknown> | undefined),
                score: r.score,
            }));
            
            // Debug output disabled for simplicity
            if (false as boolean) {
                console.log(`[Q ${q.id}] Raw service results (first 3):`);
                serviceResults.slice(0, 3).forEach((r, i) => {
                    console.log(`  [${i}] score: ${r.score}, content: "${r.content.substring(0, 50)}..."`);
                    console.log(`  [${i}] document.meta:`, r.document.meta);
                });
                
                // Check for NaN scores in raw results
                const nanScores = serviceResults.filter(r => !isFinite(r.score));
                if (nanScores.length > 0) {
                    console.log(`[Q ${q.id}] WARNING: Found ${nanScores.length} results with NaN scores!`);
                    console.log(`[Q ${q.id}] First NaN result:`, {
                        score: nanScores[0].score,
                        contentLength: nanScores[0].content.length,
                        meta: nanScores[0].document.meta
                    });
                }
                
                // CRITICAL: Check if all results are identical (same document, same content)
                const uniqueDocs = new Set(serviceResults.map(r => r.document.meta?.id));
                const uniqueContents = new Set(serviceResults.map(r => r.content.substring(0, 100)));
                const uniqueScores = new Set(serviceResults.map(r => r.score.toFixed(6)));
                
                console.log(`[Q ${q.id}] Result diversity check:`);
                console.log(`  - Unique documents: ${uniqueDocs.size}/${serviceResults.length}`);
                console.log(`  - Unique content previews: ${uniqueContents.size}/${serviceResults.length}`);
                console.log(`  - Unique scores: ${uniqueScores.size}/${serviceResults.length}`);
                
                if (uniqueDocs.size === 1) {
                    console.log(`[Q ${q.id}] CRITICAL: All results from same document: ${Array.from(uniqueDocs)[0]}`);
                }
                if (uniqueContents.size === 1) {
                    console.log(`[Q ${q.id}] CRITICAL: All results have identical content previews!`);
                }
                if (uniqueScores.size === 1) {
                    console.log(`[Q ${q.id}] CRITICAL: All results have identical scores: ${Array.from(uniqueScores)[0]}`);
                }
                
                // Debug output disabled for simplicity
                if (false as boolean) {
                    console.log(`[Q ${q.id}] Attempting to debug embeddings...`);
                    try {
                        // Try to access embeddings directly from the service
                        const queryEmb = await aiProviders.embed({ 
                            provider: embeddingProvider, 
                            input: q.query 
                        });
                        console.log(`[Q ${q.id}] Query embedding: ${queryEmb[0]?.length || 'undefined'} dimensions`);
                        if (queryEmb[0]) {
                            console.log(`[Q ${q.id}] Query embedding sample: ${queryEmb[0].slice(0, 5).map(v => v.toFixed(6)).join(', ')}`);
                        }
                        
                        // Check if embeddings are valid
                        const hasNaN = queryEmb[0]?.some(v => !isFinite(v));
                        if (hasNaN) {
                            console.log(`[Q ${q.id}] WARNING: Query embedding contains NaN values!`);
                        }
                        
                        // Try to get a sample chunk embedding to compare
                        try {
                            const sampleChunk = serviceResults[0]?.content;
                            if (sampleChunk) {
                                const chunkEmb = await aiProviders.embed({ 
                                    provider: embeddingProvider, 
                                    input: sampleChunk 
                                });
                                console.log(`[Q ${q.id}] Sample chunk embedding: ${chunkEmb[0]?.length || 'undefined'} dimensions`);
                                if (chunkEmb[0]) {
                                    console.log(`[Q ${q.id}] Chunk embedding sample: ${chunkEmb[0].slice(0, 5).map(v => v.toFixed(6)).join(', ')}`);
                                    
                                    // Check chunk embedding validity
                                    const chunkHasNaN = chunkEmb[0]?.some(v => !isFinite(v));
                                    if (chunkHasNaN) {
                                        console.log(`[Q ${q.id}] WARNING: Chunk embedding contains NaN values!`);
                                    }
                                }
                            }
                        } catch (e) {
                            console.log(`[Q ${q.id}] Error accessing chunk embeddings:`, e);
                        }
                    } catch (e) {
                        console.log(`[Q ${q.id}] Error accessing embeddings:`, e);
                    }
                }
            }
            
            // Debug: check retrieval scores diversity
            if (process.env.BENCH_DEBUG_RETRIEVAL === '1') {
                const uniqueScores = new Set(retrieved.map(r => r.score.toFixed(6)));
                const scoreRange = {
                    min: Math.min(...retrieved.map(r => r.score)),
                    max: Math.max(...retrieved.map(r => r.score)),
                    mean: retrieved.reduce((sum, r) => sum + r.score, 0) / retrieved.length
                };
                
                console.log(`[Q ${q.id}] Retrieval scores: ${uniqueScores.size} unique, range: ${scoreRange.min.toFixed(6)} to ${scoreRange.max.toFixed(6)}, mean: ${scoreRange.mean.toFixed(6)}`);
                
                if (uniqueScores.size < Math.min(5, retrieved.length)) {
                    console.log(`[Q ${q.id}] WARNING: Low score diversity!`);
                    console.log(`[Q ${q.id}] All scores: ${retrieved.map(r => r.score.toFixed(6)).join(', ')}`);
                }
                
                // Additional debug: check if scores are actually NaN
                const nanCount = retrieved.filter(r => !isFinite(r.score)).length;
                if (nanCount > 0) {
                    console.log(`[Q ${q.id}] CRITICAL: ${nanCount}/${retrieved.length} scores are NaN!`);
                    console.log(`[Q ${q.id}] Sample scores:`, retrieved.slice(0, 5).map(r => ({ score: r.score, isNaN: !isFinite(r.score) })));
                }
            }
            const contextBlock = retrieved.map((c, i) => `[#${i + 1} from ${c.docId}]\n${c.content}`).join('\n\n');
            
            let llmAnswer = '';
            let tC0 = 0, tC1 = 0;
            
            if (!skipLLM) {
                const prompt = [
                    'You are a helpful assistant. Use ONLY the provided context to answer the user question.',
                    'If the answer cannot be found in the context, say you do not know.',
                    '',
                    'Context:',
                    contextBlock,
                    '',
                    `Question: ${q.query}`,
                    '',
                    'Answer:',
                ].join('\n');
                tC0 = Date.now();
                llmAnswer = await aiProviders.execute({
                    provider: completionProvider,
                    prompt,
                    options: { temperature: 0 },
                    abortController: new AbortController(),
                } as IAIProvidersExecuteParams);
                tC1 = Date.now();
                console.log(`[Q ${q.id}] Generated in ${formatMs(tC1 - tC0)}`);
            } else {
                console.log(`[Q ${q.id}] LLM completion skipped`);
            }

            let score = 0;
            let similarity = 0;
            let distance = 1;
            let methodUsed: 'embedding' | 'llm' = 'embedding';
            const tE0 = Date.now();
            const referenceText = q.reference || '';
            
            if (skipLLM) {
                // In retrieval-only mode, skip all evaluation logic for speed
                score = 0;
                similarity = 0;
                distance = 1;
                methodUsed = 'embedding';
                console.log(`[Q ${q.id}] Evaluation skipped (retrieval-only mode)`);
            } else if (evaluationMethod === 'llm' && referenceText) {
                const llmScore = await evaluateWithLLM(q.query, referenceText, llmAnswer);
                score = llmScore;
                const emb = await computeEmbeddingScore(llmAnswer, referenceText);
                similarity = emb.similarity;
                distance = emb.distance;
                methodUsed = 'llm';
            } else {
                const emb = await computeEmbeddingScore(llmAnswer, referenceText);
                score = emb.score;
                similarity = emb.similarity;
                distance = emb.distance;
                methodUsed = 'embedding';
            }
            const tE1 = Date.now();
            if (!skipLLM) {
                console.log(`[Q ${q.id}] Evaluated (${methodUsed}) score=${score}, sim=${similarity.toFixed(3)} in ${formatMs(tE1 - tC0)}`);
            }

            const t1 = Date.now();
            const retrievalMetrics = computeRetrievalMetrics(q, retrieved);
            const result: QueryResult = {
                queryId: q.id,
                query: q.query,
                topK,
                retrieved,
                llm: { model: completionProvider.model || '', answer: llmAnswer.trim(), reference: q.reference },
                eval: { score, answerSimilarity: similarity, answerDistance: distance, method: methodUsed },
                timings: { retrievalMs: tR1 - tR0, completionMs: tC1 - tC0, evaluationMs: tE1 - tE0, totalMs: t1 - t0 },
                retrievalMetrics,
            };
            return result;
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            const t1 = Date.now();
            console.log(`[Q ${q.id}] Error: ${errMsg}`);
            const result: QueryResult = {
                queryId: q.id,
                query: q.query,
                topK,
                retrieved: [],
                llm: { model: completionProvider.model || '', answer: '', reference: q.reference },
                eval: { score: 0, answerSimilarity: 0, answerDistance: 1, method: evaluationMethod as 'embedding' | 'llm' },
                timings: { retrievalMs: 0, completionMs: 0, evaluationMs: 0, totalMs: t1 - t0 },
                error: errMsg,
            };
            return result;
        }
    }

    async function runWithConcurrency(items: QueryRecord[], limit: number) {
        const out: QueryResult[] = new Array(items.length);
        let next = 0;
        const workers: Promise<void>[] = [];
        async function worker() {
            while (next < items.length) {
                const i = next++;
                out[i] = await processSingleQuery(items[i]);
            }
        }
        const c = Math.min(limit, items.length || 1);
        for (let i = 0; i < c; i++) workers.push(worker());
        await Promise.all(workers);
        return out;
    }

    console.log(`[RAG Benchmark] Processing ${queries.length} queries with concurrency=${concurrency}...`);
    const results = await runWithConcurrency(queries, concurrency);

    const sumScore = results.reduce((acc, r) => acc + r.eval.score, 0);
    const report: Report = {
        mode: mode === 'simple' ? 'simple' : 'full',
        topK,
        embeddingModel: (config.provider.embedding?.model || config.provider.embeddingModel || ''),
        completionModel: skipLLM ? 'SKIPPED' : (completionProvider.model || ''),
        evaluationMethod: skipLLM ? 'embedding' : evaluationMethod,
        totals: {
            numDocuments: docs.length,
            numQueries: results.length,
            sumScore,
            meanScore: results.length ? sumScore / results.length : 0,
        },
        metrics: (() => {
            const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
            const withRetrieval = results.filter(r => r.retrievalMetrics !== undefined);
            const precisions = withRetrieval
                .map(r => r.retrievalMetrics?.precisionAtK)
                .filter((v): v is number => typeof v === 'number');
            const hitVals = withRetrieval
                .map(r => (r.retrievalMetrics?.hitAtK ? 1 : 0));
            return {
                meanPrecisionAtK: precisions.length ? mean(precisions) : undefined,
                hitRate: hitVals.length ? mean(hitVals) : undefined,
                meanRetrievalMs: mean(results.map(r => r.timings.retrievalMs)),
                meanCompletionMs: skipLLM ? 0 : mean(results.map(r => r.timings.completionMs)),
                meanEvaluationMs: skipLLM ? 0 : mean(results.map(r => r.timings.evaluationMs)),
                meanTotalMs: mean(results.map(r => r.timings.totalMs)),
            };
        })(),
        results,
    };

    const { jsonPath } = saveReports(report, runDir, skipLLM, queries);

    // Console summary
    console.log('[RAG Benchmark] Finished');
    console.log(`- Report: ${jsonPath}`);
    console.log('- Summary:');
    console.log(`  • Documents: ${report.totals.numDocuments}`);
    console.log(`  • Queries:   ${report.totals.numQueries}`);
    if (!skipLLM) {
        console.log(`  • Mean score: ${report.totals.meanScore.toFixed(2)}`);
    }
    if (report.metrics?.meanPrecisionAtK !== undefined) console.log(`  • Mean Precision@K: ${report.metrics.meanPrecisionAtK.toFixed(4)}`);
    if (report.metrics?.hitRate !== undefined) console.log(`  • Hit@K: ${report.metrics.hitRate.toFixed(4)}`);
    if (skipLLM) {
        console.log(`  • Mean times: retrieval=${formatMs(report.metrics?.meanRetrievalMs || 0)}, total=${formatMs(report.metrics?.meanTotalMs || 0)} (LLM skipped)`);
    } else {
        console.log(
            `  • Mean times: retrieval=${formatMs(report.metrics?.meanRetrievalMs || 0)}, completion=${formatMs(report.metrics?.meanCompletionMs || 0)}, evaluation=${formatMs(report.metrics?.meanEvaluationMs || 0)}, total=${formatMs(report.metrics?.meanTotalMs || 0)}`
        );
    }
    if (!skipLLM) {
        const worstConsole = [...report.results].sort((a, b) => a.eval.score - b.eval.score).slice(0, Math.min(3, report.results.length));
        if (worstConsole.length) {
            console.log('  • Lowest scores:');
            worstConsole.forEach(w => {
                console.log(`    - ${w.queryId}: score=${w.eval.score}, sim=${w.eval.answerSimilarity.toFixed(3)}, method=${w.eval.method}`);
            });
        }
    }
}

// Run main, exit with proper code on failure
main().catch(err => {
    console.error(err);
    process.exit(1);
});


