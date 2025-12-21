import { logger } from './logger';

describe('logger', () => {
    let originalEnabled: boolean;

    beforeEach(() => {
        originalEnabled = logger.isEnabled();
        vi.restoreAllMocks();
    });

    afterEach(() => {
        logger.setEnabled(originalEnabled);
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
});
