import { App } from 'obsidian';
import { RAGSearchComponent } from './RAGSearchComponent';
import { IAIProvidersService, IAIProvider } from '@obsidian-ai-providers/sdk';

vi.mock('obsidian', async () => ({
    ...(await vi.importActual<typeof import('obsidian')>('obsidian')),
    Notice: vi.fn(),
}));

const createMockApp = (): App => {
    const app = new App();
    (app as any).vault = { getMarkdownFiles: () => [] };
    return app;
};

describe('RAGSearchComponent', () => {
    let component: RAGSearchComponent;
    let mockProvider: IAIProvider;
    let mockAIProviders: IAIProvidersService;

    beforeEach(() => {
        component = new RAGSearchComponent(createMockApp());
        mockProvider = { id: 'test', name: 'Test', type: 'openai' as const };
        mockAIProviders = {
            version: 2,
            providers: [],
            fetchModels: vi.fn(),
            embed: vi.fn(),
            execute: vi.fn(),
            checkCompatibility: vi.fn(),
            migrateProvider: vi.fn(),
            retrieve: vi.fn().mockResolvedValue([]),
        };
    });

    it('should initialize with empty state', () => {
        expect(component.getState().selectedFiles.size).toBe(0);
        expect(component.getState().searchQuery).toBe('');
    });

    it('should manage state correctly', () => {
        component.setState(new Set(['note1.md']), 'test query');
        const state = component.getState();
        expect(state.selectedFiles.has('note1.md')).toBe(true);
        expect(state.searchQuery).toBe('test query');
    });

    it('should render basic UI elements', () => {
        const container = document.createElement('div');
        component.render(container, mockAIProviders, mockProvider);

        expect(container.querySelector('h3')?.textContent).toBe(
            '🔍 RAG Search Demo'
        );
        expect(container.querySelector('input[type="text"]')).toBeTruthy();
        expect(container.textContent).toContain('Search Documents');
    });
});
