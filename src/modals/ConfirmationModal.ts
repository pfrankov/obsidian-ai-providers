import { App, Modal, Setting } from 'obsidian';
import { I18n } from '../i18n';

export class ConfirmationModal extends Modal {
    private onConfirm: () => void;

    constructor(app: App, private message: string, onConfirm: () => void) {
        super(app);
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        
        contentEl.createEl('p', { text: this.message });
        
        new Setting(contentEl)
            .addButton(button => button
                .setButtonText(I18n.t('modals.confirm'))
                .setWarning()
                .onClick(() => {
                    this.onConfirm();
                    this.close();
                }))
            .addButton(button => button
                .setButtonText(I18n.t('modals.cancel'))
                .onClick(() => {
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
} 