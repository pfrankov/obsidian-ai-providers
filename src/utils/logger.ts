type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
    private enabled: boolean;
    private chunkLoggingEnabled: boolean;

    constructor() {
        this.enabled = process.env.NODE_ENV === 'development';
        this.chunkLoggingEnabled = false;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    isChunkLoggingEnabled(): boolean {
        return this.chunkLoggingEnabled;
    }

    setEnabled(value: boolean): void {
        this.enabled = value;
    }

    setChunkLoggingEnabled(value: boolean): void {
        this.chunkLoggingEnabled = value;
    }

    configure(options: { enabled: boolean; chunkLoggingEnabled?: boolean }) {
        this.enabled = options.enabled;
        this.chunkLoggingEnabled = options.chunkLoggingEnabled ?? false;
    }

    private log(level: LogLevel, ...args: unknown[]) {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        const prefix = `[AI Providers ${level.toUpperCase()}] ${timestamp}:`;

        switch (level) {
            case 'debug':
                console.log(prefix, ...args);
                break;
            case 'info':
                console.info(prefix, ...args);
                break;
            case 'warn':
                console.warn(prefix, ...args);
                break;
            case 'error':
                console.error(prefix, ...args);
                break;
        }
    }

    debug(...args: unknown[]) {
        this.log('debug', ...args);
    }

    debugChunk(...args: unknown[]) {
        if (!this.chunkLoggingEnabled) {
            return;
        }
        this.log('debug', ...args);
    }

    info(...args: unknown[]) {
        this.log('info', ...args);
    }

    warn(...args: unknown[]) {
        this.log('warn', ...args);
    }

    error(...args: unknown[]) {
        this.log('error', ...args);
    }
}

export const logger = new Logger();
