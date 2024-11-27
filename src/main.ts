import { Plugin } from 'obsidian';
import { IAIProvidersPluginSettings, DEFAULT_SETTINGS, AIProvidersSettingTab } from './settings';
import { AIProvidersService } from './AIProvidersService';

export default class AIProvidersPlugin extends Plugin {
	settings: IAIProvidersPluginSettings;
	aiProviders: AIProvidersService;

	async onload() {
		await this.loadSettings();

		const settingTab = new AIProvidersSettingTab(this.app, this);
		this.aiProviders = new AIProvidersService(this.app, this.settings.providers);

		(this.app as any).aiProviders = this.aiProviders;
		this.app.workspace.trigger('ai-providers-ready');

		this.addSettingTab(settingTab);

		
		setTimeout(async () => {
			console.time('start');
			const chunkHandler = await this.aiProviders.execute({
				// @ts-ignore
				provider: this.settings?.providers[1],
				prompt: "Hello, how are you?"
			});
		
			chunkHandler.onData((chunk, accumulatedText) => {
				console.log(accumulatedText);
			});
			chunkHandler.onEnd((fullText) => {
				console.log('end', fullText);
			});
			console.timeEnd('start');
			setTimeout(() => {
				chunkHandler.abort();
				console.log('abort initiated' + Date.now());
			}, 1);
		}, 1);

		
	}

	onunload() {
		delete (this.app as any).aiProviders;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.aiProviders = new AIProvidersService(this.app, this.settings.providers);
		(this.app as any).aiProviders = this.aiProviders;
	}
}
