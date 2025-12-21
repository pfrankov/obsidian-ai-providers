import { normalizeHeaders } from './normalizeHeaders';

describe('normalizeHeaders', () => {
    it('returns empty object for undefined headers', () => {
        expect(normalizeHeaders()).toEqual({});
    });

    it('normalizes Headers instances', () => {
        const headers = new Headers({ 'x-test': 'value' });
        expect(normalizeHeaders(headers)).toEqual({ 'x-test': 'value' });
    });

    it('normalizes tuple arrays', () => {
        const headers: HeadersInit = [
            ['x-one', '1'],
            ['x-two', '2'],
        ];
        expect(normalizeHeaders(headers)).toEqual({
            'x-one': '1',
            'x-two': '2',
        });
    });

    it('normalizes plain objects', () => {
        expect(normalizeHeaders({ Authorization: 'Bearer token' })).toEqual({
            Authorization: 'Bearer token',
        });
    });
});
