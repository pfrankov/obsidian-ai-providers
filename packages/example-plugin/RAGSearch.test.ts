import { App, TFile } from 'obsidian';
import { RAGSearchComponent } from './RAGSearchComponent';
import { IAIProvidersService, IAIProvider } from '@obsidian-ai-providers/sdk';

jest.mock('obsidian', () => ({
    ...jest.requireActual('obsidian'),
    Notice: jest.fn(),
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
            fetchModels: jest.fn(),
            embed: jest.fn(),
            execute: jest.fn(),
            checkCompatibility: jest.fn(),
            migrateProvider: jest.fn(),
            retrieve: jest.fn().mockResolvedValue([]),
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
