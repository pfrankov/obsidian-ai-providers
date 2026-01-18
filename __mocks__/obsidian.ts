export class App {
    workspace: Workspace;
    vault: Vault;
    appId = 'test-vault-id';
    
    constructor() {
        this.workspace = new Workspace();
        this.vault = new Vault();
    }
}

export class Workspace {
    onLayoutReady(callback: () => void): void {
        // In tests, execute callback immediately
        callback();
    }
}

export class TFile {
    path: string;
    name: string;

    constructor(path: string, name: string) {
        this.path = path;
        this.name = name;
    }
}

export class Vault {
    getMarkdownFiles(): TFile[] {
        // Return mock markdown files for testing
        return [
            new TFile('note1.md', 'Note 1'),
            new TFile('note2.md', 'Note 2'),
            new TFile('folder/note3.md', 'Note 3'),
        ];
    }

    getAbstractFileByPath(path: string): TFile | null {
        const files = this.getMarkdownFiles();
        return files.find(file => file.path === path) || null;
    }

    async read(file: TFile): Promise<string> {
        return `Mock content for ${file.name}`;
    }
}
export class Notice {
    constructor(_message: string) {}
}

export function addIcon(_name: string, _icon: string) {}

export function setIcon(el: HTMLElement, name: string) {
    el.setAttribute('data-icon', name);
}

export class Plugin {
    app: App;
    manifest: any;
    settingTabs: PluginSettingTab[] = [];

    constructor(app: App, manifest: any) {
        this.app = app;
        this.manifest = manifest;
    }

    addSettingTab(tab: PluginSettingTab): void {
        this.settingTabs.push(tab);
    }

    loadData(): Promise<any> {
        return Promise.resolve({});
    }

    saveData(_data: any): Promise<void> {
        return Promise.resolve();
    }
}

export class PluginSettingTab {
    app: App;
    plugin: Plugin;
    containerEl: HTMLElement;

    constructor(app: App, plugin: Plugin) {
        this.app = app;
        this.plugin = plugin;
        this.containerEl = document.createElement('div');
        this.containerEl.empty = function() {
            while (this.firstChild) {
                this.removeChild(this.firstChild);
            }
        };
        this.containerEl.createEl = function(
            tag: string,
            attrs?: { text?: string }
        ): HTMLElement {
            const el = document.createElement(tag);
            if (attrs?.text) {
                el.textContent = attrs.text;
            }
            this.appendChild(el as unknown as Node);
            return el;
        };
        this.containerEl.createDiv = function(
            className?: string
        ): HTMLElement {
            const div = document.createElement('div');
            if (className) {
                div.className = className;
            }
            this.appendChild(div as unknown as Node);
            return div;
        };
    }

    display(): void {
        // Implement in child class
    }

    hide(): void {
        // Implement in child class
    }
}

export class Setting {
    nameEl: HTMLElement;
    descEl: HTMLElement;
    controlEl: HTMLElement;
    settingEl: HTMLElement;
    onChange: ((value: string) => any) | undefined;
    
    constructor(containerEl: HTMLElement) {
        this.settingEl = containerEl.createDiv('setting-item');
        this.nameEl = this.settingEl.createDiv('setting-item-name');
        this.descEl = this.settingEl.createDiv('setting-item-description');
        this.controlEl = this.settingEl.createDiv('setting-item-control');
        
        (this.settingEl as any).__setting = this;
    }

    setName(name: string): this {
        this.nameEl.textContent = name;
        return this;
    }

    setHeading() {
        this.nameEl.classList.add('setting-item-heading');
        return this;
    }
    
    setClass(className: string): this {
        this.nameEl.classList.add(className);
        return this;
    }

    setDesc(desc: string): this {
        this.descEl.textContent = desc;
        return this;
    }

    addButton(cb: (button: ButtonComponent) => any): this {
        const button = new ButtonComponent(this.controlEl);
        cb(button);
        return this;
    }

    addText(cb: (text: TextComponent) => any): this {
        const text = new TextComponent(this.controlEl);
        cb(text);
        this.onChange = (value: string) => {
            if (text.inputEl) {
                text.setValue(value);
                const event = new Event('input');
                text.inputEl.dispatchEvent(event);
            }
        };
        return this;
    }

    addDropdown(cb: (dropdown: DropdownComponent) => any): this {
        const dropdown = new DropdownComponent(this.controlEl);
        cb(dropdown);
        return this;
    }

    addExtraButton(cb: (button: ButtonComponent) => any): this {
        const button = new ButtonComponent(this.controlEl);
        cb(button);
        return this;
    }
    addToggle(cb: (toggle: ToggleComponent) => any): this {
        const toggle = new ToggleComponent(this.controlEl);
        cb(toggle);
        return this;
    }
}

export class ButtonComponent {
    buttonEl: HTMLButtonElement;
    extraSettingsEl: HTMLElement;

    constructor(containerEl: HTMLElement) {
        this.buttonEl = document.createElement('button');
        this.extraSettingsEl = this.buttonEl;
        
        this.buttonEl.addClass = function(className: string) {
            this.classList.add(className);
        };
        this.buttonEl.removeClass = function(className: string) {
            this.classList.remove(className);
        };
        
        containerEl.appendChild(this.buttonEl as any);
    }

    setButtonText(text: string): this {
        this.buttonEl.textContent = text;
        return this;
    }

    onClick(cb: () => any): this {
        this.buttonEl.addEventListener('click', cb);
        return this;
    }

    setIcon(icon: string): this {
        this.buttonEl.setAttribute('aria-label', icon);
        return this;
    }

    setTooltip(tooltip: string): this {
        this.buttonEl.setAttribute('aria-label', tooltip);
        return this;
    }

    setCta(): this {
        return this;
    }

    setWarning() {
        return this;
    }

    setDisabled(disabled: boolean): this {
        this.buttonEl.disabled = disabled;
        return this;
    }
}

export class TextComponent {
    inputEl: HTMLInputElement;

    constructor(containerEl: HTMLElement) {
        this.inputEl = document.createElement('input');
        this.inputEl.type = 'text';
        containerEl.appendChild(this.inputEl as any);
    }

    setValue(value: string): this {
        this.inputEl.value = value;
        return this;
    }

    getValue(): string {
        return this.inputEl.value;
    }

    onChange(cb: (value: string) => any): this {
        this.inputEl.addEventListener('input', () => cb(this.inputEl.value));
        return this;
    }

    setPlaceholder(placeholder: string): this {
        this.inputEl.placeholder = placeholder;
        return this;
    }

    setDisabled(disabled: boolean): this {
        this.inputEl.disabled = disabled;
        return this;
    }
}

export class SearchComponent {
    inputEl: HTMLInputElement;
    clearButtonEl: HTMLElement;

    constructor(containerEl: HTMLElement) {
        const wrapper = containerEl.createDiv('search-input-container');
        this.inputEl = document.createElement('input');
        this.inputEl.type = 'search';
        wrapper.appendChild(this.inputEl as any);

        this.clearButtonEl = document.createElement('button');
        wrapper.appendChild(this.clearButtonEl as any);

        this.clearButtonEl.addEventListener('click', () => {
            this.inputEl.value = '';
            this.inputEl.dispatchEvent(new Event('input'));
        });
    }

    setValue(value: string): this {
        this.inputEl.value = value;
        return this;
    }

    getValue(): string {
        return this.inputEl.value;
    }

    onChange(cb: (value: string) => any): this {
        this.inputEl.addEventListener('input', () => cb(this.inputEl.value));
        return this;
    }

    setPlaceholder(placeholder: string): this {
        this.inputEl.placeholder = placeholder;
        return this;
    }

    setDisabled(disabled: boolean): this {
        this.inputEl.disabled = disabled;
        return this;
    }
}

export class PopoverSuggest<T> {
    app: App;
    scope: any;
    protected suggestEl: HTMLElement;

    constructor(app: App, _scope?: any) {
        this.app = app;
        this.suggestEl = document.createElement('div');
        this.suggestEl.className = 'suggestion-container';
        this.suggestEl.hidden = true;
    }

    open(): void {
        this.suggestEl.hidden = false;
    }

    close(): void {
        this.suggestEl.hidden = true;
    }

    renderSuggestion(_value: T, _el: HTMLElement): void {
        // Implement in subclasses
    }

    selectSuggestion(_value: T, _evt: MouseEvent | KeyboardEvent): void {
        // Implement in subclasses
    }
}

export abstract class AbstractInputSuggest<T> extends PopoverSuggest<T> {
    limit = 100;
    private textInputEl: HTMLInputElement | HTMLDivElement;
    private onSelectCallbacks: Array<
        (value: T, evt: MouseEvent | KeyboardEvent) => any
    > = [];

    constructor(app: App, textInputEl: HTMLInputElement | HTMLDivElement) {
        super(app);
        this.textInputEl = textInputEl;

        const container = textInputEl.parentElement || document.body;
        container.appendChild(this.suggestEl as any);

        this.textInputEl.addEventListener('input', () => {
            this.renderSuggestions();
        });
    }

    setValue(value: string): void {
        if (this.textInputEl instanceof HTMLInputElement) {
            this.textInputEl.value = value;
        }
    }

    getValue(): string {
        if (this.textInputEl instanceof HTMLInputElement) {
            return this.textInputEl.value;
        }
        return '';
    }

    onSelect(
        callback: (value: T, evt: MouseEvent | KeyboardEvent) => any
    ): this {
        this.onSelectCallbacks.push(callback);
        return this;
    }

    selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
        this.setValue(String(value));
        this.onSelectCallbacks.forEach(cb => cb(value, evt));
        this.close();
    }

    protected abstract getSuggestions(query: string): T[] | Promise<T[]>;

    private async renderSuggestions() {
        this.suggestEl.empty();
        const suggestions = await this.getSuggestions(this.getValue());
        if (suggestions.length === 0) {
            this.close();
            return;
        }
        this.open();
        suggestions.forEach(value => {
            const itemEl = this.suggestEl.createDiv('suggestion-item');
            this.renderSuggestion(value, itemEl);
            itemEl.addEventListener('mousedown', event => {
                event.preventDefault();
                this.selectSuggestion(value, event);
            });
        });
    }
}

export class DropdownComponent {
    selectEl: HTMLSelectElement;

    constructor(containerEl: HTMLElement) {
        this.selectEl = document.createElement('select');
        containerEl.appendChild(this.selectEl as any);
    }

    addOption(value: string, text: string): this {
        const option = document.createElement('option');
        option.value = value;
        option.text = text;
        this.selectEl.appendChild(option as any);
        return this;
    }

    addOptions(options: { [key: string]: string }): this {
        Object.entries(options).forEach(([value, text]) => {
            this.addOption(value, text);
        });
        return this;
    }

    setValue(value: string): this {
        this.selectEl.value = value;
        return this;
    }

    onChange(callback: (value: string) => any): this {
        this.selectEl.addEventListener('change', (e) => {
            callback((e.target as HTMLSelectElement).value);
        });
        return this;
    }

    setDisabled(disabled: boolean): this {
        this.selectEl.disabled = disabled;
        return this;
    }
}

export class ToggleComponent {
    toggleEl: HTMLInputElement;
    

    constructor(containerEl: HTMLElement) {
        this.toggleEl = document.createElement('input');
        this.toggleEl.type = 'checkbox';
        containerEl.appendChild(this.toggleEl as any);
    }

    setDisabled(disabled: boolean): this {
        this.toggleEl.disabled = disabled;
        return this;
    }

    getValue(): boolean {
        return this.toggleEl.checked;
    }

    setValue(on: boolean): this {
        this.toggleEl.checked = on;
        return this;
    }

    setTooltip(tooltip: string, _options?: any): this {
        this.toggleEl.setAttribute('aria-label', tooltip);
        return this;
    }

    onClick(): this {
        return this;
    }

    onChange(callback: (value: boolean) => any): this {
        this.toggleEl.addEventListener('change', () => callback(this.toggleEl.checked));
        return this;
    }
}

export class Modal {
    app: App;
    contentEl: HTMLElement;
    
    constructor(app: App) {
        this.app = app;
        this.contentEl = document.createElement('div');
        // Apply Obsidian methods to contentEl
        (this.contentEl as any).empty = HTMLElement.prototype.empty;
        (this.contentEl as any).createEl = HTMLElement.prototype.createEl;
        (this.contentEl as any).createDiv = HTMLElement.prototype.createDiv;
        (this.contentEl as any).createSpan = HTMLElement.prototype.createSpan;
        (this.contentEl as any).addClass = HTMLElement.prototype.addClass;
    }

    open(): void {
        // Mock for opening modal window
        this.onOpen();
    }

    close(): void {
        // Clear content when closing
        this.onClose();
    }

    onOpen(): void {
        // To be overridden in subclasses
    }

    onClose(): void {
        // To be overridden in subclasses
    }
}

export interface SearchResult {
    score: number;
    matches: [number, number][];
}

export function prepareFuzzySearch(query: string) {
    const normalizedQuery = query.toLowerCase();
    return (text: string): SearchResult | null => {
        const normalizedText = text.toLowerCase();
        const index = normalizedText.indexOf(normalizedQuery);
        if (index === -1) {
            return null;
        }
        return {
            score: normalizedQuery.length,
            matches: [[index, index + normalizedQuery.length]],
        };
    };
}

// Add helper methods for HTMLElement
declare global {
    interface HTMLElement {
        createDiv(className?: string): HTMLElement;
        empty(): void;
        createEl(tag: string, attrs?: { text?: string }, cls?: string): HTMLElement;
        createSpan(className?: string): HTMLElement;
        addClass(className: string): void;
        appendText(val: string): void;
    }
}

// Add global createSpan function
(global as any).createSpan = function(attrs?: { cls?: string }): HTMLElement {
    const span = document.createElement('span');
    if (attrs?.cls) {
        span.className = attrs.cls;
    }
    return span;
};

HTMLElement.prototype.createDiv = function(className?: string): HTMLElement {
    const div = document.createElement('div');
    if (className) {
        div.className = className;
    }
    this.appendChild(div as unknown as Node);
    return div;
};

HTMLElement.prototype.empty = function(): void {
    while (this.firstChild) {
        this.removeChild(this.firstChild);
    }
};

HTMLElement.prototype.createEl = function(tag: string, attrs?: {text?: string}, cls?: string) {
    const el = document.createElement(tag);
    if (attrs?.text) {
        el.textContent = attrs.text;
    }
    if (cls) {
        el.className = cls;
    }
    this.appendChild(el as unknown as Node);
    return el;
};

HTMLElement.prototype.createSpan = function(cls?: string) {
    const span = document.createElement('span');
    if (cls) {
        span.className = cls;
    }
    this.appendChild(span as unknown as Node);
    return span;
};

HTMLElement.prototype.appendText = function(text: string): void {
    this.appendChild(document.createTextNode(text));
};

// Add addClass method to HTMLElement prototype
HTMLElement.prototype.addClass = function(className: string): void {
    this.classList.add(className);
};

export function sanitizeHTMLToDom(html: string): DocumentFragment {
    const template = document.createElement('template');
    template.innerHTML = html;
    
    // If we need to test mode switching, we'll do it through the isTextMode property directly
    return template.content;
} 
