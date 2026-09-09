/**
 * Sizing rules for Ollama's `num_ctx` window.
 *
 * `num_ctx` bounds the prompt *and* the generated answer, so the window is
 * sized from the estimated prompt length times a user-configurable scale, plus
 * a fixed reserve that keeps room for the response itself.
 */

/** Multiplier applied to the estimated prompt size. */
export const DEFAULT_CONTEXT_SCALE = 2;
export const MIN_CONTEXT_SCALE = 1;
export const MAX_CONTEXT_SCALE = 4;
export const CONTEXT_SCALE_STEP = 0.5;

/** Tokens held back for the model's answer on chat/tool calls. */
export const OUTPUT_RESERVE_TOKENS = 2048;

export const DEFAULT_CONTEXT_LENGTH = 2048;
export const EMBEDDING_CONTEXT_LENGTH = 2048;

/**
 * Upper bound used only when the model's real context length is unknown
 * (`ollama.show()` failed or reported no *.context_length). Falling back to
 * DEFAULT_CONTEXT_LENGTH here would silently cap every request at 2048.
 */
export const FALLBACK_MAX_CONTEXT_LENGTH = 8192;
