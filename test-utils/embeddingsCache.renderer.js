import { unwrap } from 'idb';
import { CachedEmbeddingsService } from '../src/cache/CachedEmbeddingsService';
import { EmbeddingsCache, embeddingsCache } from '../src/cache/EmbeddingsCache';

const provider = {
    id: 'synthetic-provider',
    name: 'Synthetic fixture',
    type: 'openai',
    url: 'https://fixture.invalid/v1',
    model: 'synthetic-model',
};
const vault = 'synthetic-cache-smoke';
const vectors = { alpha: [1, 0], beta: [0, 1], shared: [1, 1] };

function equal(actual, expected, label) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
            `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
        );
    }
}

function deferred() {
    let resolve;
    const promise = new Promise(done => {
        resolve = done;
    });
    return { promise, resolve };
}

function embed(service, chunks) {
    return service.embedWithCache({ provider, input: chunks, chunks });
}

function item(contents) {
    return {
        providerId: provider.id,
        providerModel: provider.model,
        chunks: contents.map(content => ({
            content,
            embedding: vectors[content],
        })),
    };
}

async function checkCompletionOrder(first) {
    await embeddingsCache.clearEmbeddings();
    const started = [deferred(), deferred()];
    const release = [deferred(), deferred()];
    let calls = 0;
    const service = new CachedEmbeddingsService(async ({ input }) => {
        calls++;
        const index = input.includes('alpha') ? 0 : 1;
        equal(
            input,
            index === 0 ? ['alpha', 'shared'] : ['beta', 'shared'],
            'missing texts are unique'
        );
        started[index].resolve();
        await release[index].promise;
        return input.map(content => vectors[content]);
    });
    const requests = [
        ['alpha', 'shared', 'alpha'],
        ['beta', 'shared'],
    ];
    const pending = requests.map(chunks => embed(service, chunks));
    // Both calls must have read the empty cache before either provider finishes.
    await Promise.all(started.map(gate => gate.promise));
    for (const index of [first, 1 - first]) {
        release[index].resolve();
        equal(
            await pending[index],
            requests[index].map(content => vectors[content]),
            'original result'
        );
    }
    equal(calls, 2, 'initial provider calls');
    const records = await embeddingsCache.db.getAll('embeddings');
    equal(records.length, 1, 'single cache record');
    equal(
        records[0].chunks.map(chunk => chunk.content).sort(),
        ['alpha', 'beta', 'shared'],
        `union after call ${first} finishes first`
    );

    let misses = 0;
    const hitsOnly = new CachedEmbeddingsService(async () => {
        misses++;
        throw new Error('Unexpected provider call');
    });
    for (const chunks of requests) {
        equal(
            await embed(hitsOnly, chunks),
            chunks.map(content => vectors[content]),
            'repeat cache hit'
        );
    }
    await embeddingsCache.close();
    await embeddingsCache.init(vault);
    equal(
        await embed(hitsOnly, ['beta', 'shared', 'alpha']),
        [vectors.beta, vectors.shared, vectors.alpha],
        'reopened cache hit'
    );
    equal(misses, 0, 'zero provider calls for repeat and reopened reads');
    console.log(
        `Completion order ${first}, ${1 - first}: union and reopened hits passed`
    );
}

export async function run() {
    const unhandled = [];
    globalThis.addEventListener('unhandledrejection', event =>
        unhandled.push(String(event.reason))
    );
    equal(
        typeof globalThis.require,
        'undefined',
        'renderer has no Node integration'
    );
    await embeddingsCache.init(vault);
    equal(embeddingsCache.isInitialized(), true, 'native cache initialized');
    equal(
        unwrap(embeddingsCache.db).constructor.name,
        'IDBDatabase',
        'real IndexedDB database'
    );
    try {
        await checkCompletionOrder(0);
        await checkCompletionOrder(1);
        {
            await embeddingsCache.clearEmbeddings();
            // TypeScript's private constructor is erased; this second cache owns a real,
            // independently opened connection rather than sharing the singleton's db.
            const second = new EmbeddingsCache();
            await second.init(vault);
            try {
                equal(
                    unwrap(embeddingsCache.db) === unwrap(second.db),
                    false,
                    'independent IDB connections'
                );
                await Promise.all([
                    embeddingsCache.setEmbeddings(
                        'independent',
                        item(['alpha', 'shared'])
                    ),
                    second.setEmbeddings(
                        'independent',
                        item(['beta', 'shared'])
                    ),
                ]);
                const stored = await second.getEmbeddings('independent');
                equal(
                    stored.chunks.map(chunk => chunk.content).sort(),
                    ['alpha', 'beta', 'shared'],
                    'concurrent connection union'
                );
                equal(
                    stored,
                    await embeddingsCache.getEmbeddings('independent'),
                    'both connections see committed union'
                );
            } finally {
                await second.close();
            }
            console.log(
                'Independent native database connections: concurrent merge passed'
            );
        }
        {
            await embeddingsCache.clearEmbeddings();
            let calls = 0;
            const service = new CachedEmbeddingsService(async ({ input }) => {
                calls++;
                return input.map(content => vectors[content]);
            });
            await embed(service, ['alpha']);
            const database = embeddingsCache.db;
            let putSucceeded = false;
            let abortObserved = false;
            let doneSettled = false;
            // Keep every operation native. Only abort the real transaction immediately
            // after its put request succeeds, before the transaction can commit.
            embeddingsCache.db = {
                get: (...args) => database.get(...args),
                transaction(...args) {
                    const transaction = database.transaction(...args);
                    unwrap(transaction).addEventListener('abort', () => {
                        abortObserved = true;
                    });
                    return {
                        get done() {
                            return transaction.done.finally(() => {
                                doneSettled = true;
                            });
                        },
                        store: {
                            get: key => transaction.store.get(key),
                            async put(value, key) {
                                const result = await transaction.store.put(
                                    value,
                                    key
                                );
                                putSucceeded = true;
                                transaction.abort();
                                return result;
                            },
                        },
                    };
                },
            };
            try {
                equal(
                    await embed(service, ['alpha', 'beta']),
                    [vectors.alpha, vectors.beta],
                    'aborted persistence fails open'
                );
            } finally {
                embeddingsCache.db = database;
            }
            equal(putSucceeded, true, 'native put succeeded before abort');
            equal(doneSettled, true, 'write waited for transaction completion');
            const records = await database.getAll('embeddings');
            equal(
                abortObserved,
                true,
                'native transaction abort was dispatched'
            );
            equal(
                records[0].chunks,
                item(['alpha']).chunks,
                'aborted write rolled back'
            );
            equal(
                await embed(service, ['alpha', 'beta']),
                [vectors.alpha, vectors.beta],
                'later write recovers'
            );
            equal(calls, 3, 'rolled-back chunk is fetched again');
            await embed(service, ['beta', 'alpha']);
            equal(calls, 3, 'recovered write is cached');
            console.log(
                'Native put-success then abort: rollback, fail-open and recovery passed'
            );
        }
    } finally {
        await embeddingsCache.close();
    }
    // Let rejection events dispatch after all transactions have finished.
    await new Promise(resolve => setTimeout(resolve, 0));
    equal(unhandled, [], 'no unhandled transaction rejections');
    return 'Electron embeddings cache smoke passed: both completion orders, independent connections, reopen, abort rollback and recovery';
}
