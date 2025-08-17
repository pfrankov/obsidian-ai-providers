## RAG Retrieval Benchmark — Read the report like a pro (simple guide)

This benchmark checks how well a Retrieval-Augmented Generation (RAG) setup works.
It finds helpful text pieces (chunks), asks an AI model to answer, and then scores the answer.

**Smart filtering:** Automatically excludes documents that appear in the contexts of queries marked as `is_impossible: true` in the dataset. This improves retrieval quality by focusing only on relevant content.

You mainly need two things:
- How to run it (quick)
- How to read the report (super simple)

### How to run (quick)

```bash
cp benchmarks/retrieve.config.example.json benchmarks/retrieve.config.json
npm run bench:retrieve         # full run
npm run bench:retrieve:simple  # faster, small sample
```

Retrieval-only mode (no LLM calls): set `"skipLLM": true` in `benchmarks/retrieve.config.json`.

Reports appear in:
- JSON: `benchmarks/reports/retrieve_<timestamp>/report.json`
- Markdown: `benchmarks/reports/retrieve_<timestamp>/report.md`

### What you’ll see in the Markdown report

- Overview: settings and quick numbers (how many documents/queries, average score, etc.)
- Score Statistics: min / median / P90 / max of scores
- Time Statistics: how long each step takes on average (and medians/P90)
- Highlights: top 3 and bottom 3 queries by score
- Per-Query Results: a small table for every query with its score, similarity, and times

### Metrics (plain English)

These are the main things to read and what “good” looks like.

- Score (0–100) *(only when LLM is enabled)*
  - What: overall answer quality for the query
  - How it’s made:
    - embedding mode (default): roughly “similarity × 100”
    - llm mode: a judge-model gives a number from 0 to 100
  - Good vs needs work:
    - 90–100 = 🟢 Excellent
    - 75–89  = 🟡 Good
    - 50–74  = 🟠 Fair
    - 0–49   = 🔴 Poor

**Note:** When `skipLLM: true`, Score is always 0 and Similarity/Distance are not meaningful. Focus on Hit@K and Precision@K for retrieval quality.

- Similarity (0..1, higher is better) *(only when LLM is enabled)*
  - What: how close the model’s answer is to the reference (by embeddings)
  - Good vs needs work:
    - ≥ 0.80 = 🟢
    - ≥ 0.60 = 🟡
    - ≥ 0.40 = 🟠
    - lower  = 🔴

- Distance (lower is better) *(only when LLM is enabled)*
  - What: the opposite of similarity used inside scoring
  - Tip: you can mostly ignore it; just remember “lower = better”

- Precision@K (0..1, only if the dataset provides ground truth contexts)
  - What: of the top K retrieved chunks, how many were actually correct
  - Good vs needs work:
    - ≥ 0.80 = 🟢, ≥ 0.60 = 🟡, ≥ 0.40 = 🟠, lower = 🔴

- Hit@K (0..1, only if the dataset provides ground truth contexts)
  - What: for how many queries the top K included at least one correct chunk
  - Good vs needs work:
    - ≥ 0.95 = 🟢, ≥ 0.80 = 🟡, ≥ 0.60 = 🟠, lower = 🔴

- Timings (milliseconds; smaller is faster)
  - retrieval: finding and ranking chunks *(always measured)*
  - completion: generating the answer *(skipped when skipLLM: true)*
  - evaluation: scoring the answer *(skipped when skipLLM: true)*
  - total: end-to-end per query *(always measured)*
  - Good average targets:
    - Retrieval: < 50ms 🟢, < 150ms 🟡, < 300ms 🟠, ≥ 300ms 🔴 *(always relevant)*
    - Completion: < 1s 🟢, < 3s 🟡, < 6s 🟠, ≥ 6s 🔴 *(skipped when skipLLM: true)*
    - Evaluation: < 0.5s 🟢, < 1.5s 🟡, < 3s 🟠, ≥ 3s 🔴 *(skipped when skipLLM: true)*
    - Total: < 2s 🟢, < 5s 🟡, < 10s 🟠, ≥ 10s 🔴 *(always relevant)*

### How to read a single query’s block

**When LLM is enabled (default):**
- Look at Score first (0–100). Higher is better.
- Check Similarity (0..1). Higher usually means closer to the reference.
- Peek at timings to see where time is spent (retrieval / completion / evaluation / total).

**When skipLLM: true (retrieval-only mode):**
- Focus on Precision@K and Hit@K for retrieval quality
- Check retrieval time and total time
- Score, Similarity, and Distance will be 0/0/1 (not meaningful)

**Always relevant:**
- If you see Precision@K/Hit@K, that means the dataset has ground-truth contexts. Higher = better retrieval.
- The small “Retrieved” table shows which document IDs were picked and how well they matched (similarity).

That’s it — you can now understand the report quickly and spot wins and issues at a glance. ✅


### Configuration and environment

- Put all settings in `benchmarks/retrieve.config.json`. Important keys:
  - `provider.embedding|completion|evaluation`: `{ baseURL?, apiKey?, model }` (falls back to legacy `baseURL`, `embeddingModel`, `completionModel` if present)
  - `input`: `{ documentsDir, datasetFile }`
  - `retrieval`: `{ topK }`
  - `evaluation`: `{ method: "embedding" | "llm" }`
  - `simple` (used only when `MODE=simple`): `{ maxDocs?, maxQueries?, topK? }`
  - `concurrency`: number of parallel queries (default: 3)
  - `outputDir`: where reports are written (default `benchmarks/reports`)
  - `skipLLM`: `true` for retrieval-only benchmarking

Dataset formats supported:

```json
// New format (recommended): array of entries
[
  {
    "id": "q-0001",
    "question": "...",
    "answer": "...",                 // optional, used for similarity-based eval
    "is_impossible": false,           // if true, excluded; its contexts are also excluded from docs
    "contexts": [ { "filename": "doc1.md", "text": "..." } ]
  }
]
```

```json
// Legacy format: object with queries array
{
  "queries": [
    { "id": "q-0001", "query": "...", "reference": "...", "contexts": [ { "filename": "doc1.md", "text": "..." } ] }
  ]
}
```

Embeddings cache (benchmark-only):
- Stored under `benchmarks/.cache/embeddings/` per provider/model.
- Written incrementally, one file per input text (by SHA256 hash).
- To clear, delete the `benchmarks/.cache/embeddings` directory.

Recognized environment variables:
- `MODE=simple` to run the small-sample mode (used by `npm run bench:retrieve:simple`)
- `RETRIEVE_BENCH_CONFIG=/abs/path/to/config.json` to point to a different config file
- `OPENAI_API_KEY` as a fallback if a provider `apiKey` is not set in config
- `BENCH_MOCK_HANDLERS=1` to use a local mock of OpenAI-like providers (no network)

Optional debug flags (set to `1` to enable):
- `BENCH_DEBUG_DOCUMENTS` — log document array integrity checks before/after retrieval
- `BENCH_DEBUG_SIMILARITY` — detailed logs for embedding-based similarity calculation
- `BENCH_DEBUG_RETRIEVAL` — summary stats about retrieval score diversity per query


