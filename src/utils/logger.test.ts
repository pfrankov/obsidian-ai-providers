import { logger } from './logger';

describe('logger', () => {
    let originalEnabled: boolean;
    let originalChunkLoggingEnabled: boolean;

    beforeEach(() => {
        originalEnabled = logger.isEnabled();
        originalChunkLoggingEnabled = logger.isChunkLoggingEnabled();
        vi.restoreAllMocks();
    });

    afterEach(() => {
        logger.setEnabled(originalEnabled);
        logger.setChunkLoggingEnabled(originalChunkLoggingEnabled);
    });

    it('skips logging when disabled', () => {
        logger.setEnabled(false);
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        logger.debug('test');
        logger.info('test');
        logger.warn('test');
        logger.error('test');

        expect(logSpy).not.toHaveBeenCalled();
        expect(infoSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('skips chunk logging unless chunk logging is enabled', () => {
        logger.setEnabled(true);
        logger.setChunkLoggingEnabled(false);
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        logger.debugChunk('chunk');
        expect(logSpy).not.toHaveBeenCalled();

        logger.setChunkLoggingEnabled(true);
        logger.debugChunk('chunk');
        expect(logSpy).toHaveBeenCalled();
    });

    it('logs to the correct console methods when enabled', () => {
        logger.setEnabled(true);
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        logger.debug('debug');
        logger.info('info');
        logger.warn('warn');
        logger.error('error');

        expect(logSpy).toHaveBeenCalled();
        expect(infoSpy).toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
    });

    it('configures both enabled and chunk logging states together', () => {
        logger.configure({ enabled: true, chunkLoggingEnabled: true });

        expect(logger.isEnabled()).toBe(true);
        expect(logger.isChunkLoggingEnabled()).toBe(true);
    });

    it('defaults chunk logging to false when omitted in configure', () => {
        logger.setChunkLoggingEnabled(true);

        logger.configure({ enabled: true });

        expect(logger.isChunkLoggingEnabled()).toBe(false);
    });
});
