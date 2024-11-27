type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
    private enabled: boolean;

    constructor() {
        this.enabled = process.env.NODE_ENV === 'development';
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    setEnabled(value: boolean): void {
        this.enabled = value;
    }

    private log(level: LogLevel, ...args: any[]) {
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

    debug(...args: any[]) {
        this.log('debug', ...args);
    }

    info(...args: any[]) {
        this.log('info', ...args);
    }

    warn(...args: any[]) {
        this.log('warn', ...args);
    }

    error(...args: any[]) {
        this.log('error', ...args);
    }

    time(label: string) {
        if (!this.enabled) return;
        console.time(`[AI Providers] ${label}`);
    }

    timeEnd(label: string) {
        if (!this.enabled) return;
        console.timeEnd(`[AI Providers] ${label}`);
    }
}

export const logger = new Logger(); 