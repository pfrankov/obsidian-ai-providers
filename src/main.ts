import { Plugin } from 'obsidian';
import { IAIProvidersPluginSettings } from './types';
import { DEFAULT_SETTINGS, AIProvidersSettingTab } from './settings';
import { AIProvidersService } from './AIProvidersService';
import { logger } from './utils/logger';

export default class AIProvidersPlugin extends Plugin {
	settings: IAIProvidersPluginSettings;
	aiProviders: AIProvidersService;

	async onload() {
		await this.loadSettings();

		const settingTab = new AIProvidersSettingTab(this.app, this);
		this.exposeAIProviders();
		this.app.workspace.trigger('ai-providers-ready');

		this.addSettingTab(settingTab);
	}

	onunload() {
		delete (this.app as any).aiProviders;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		logger.setEnabled(this.settings.debugLogging ?? false);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.exposeAIProviders();
	}

	exposeAIProviders() {
		this.aiProviders = new AIProvidersService(this.app, this);
		(this.app as any).aiProviders = this.aiProviders;
	}
}
