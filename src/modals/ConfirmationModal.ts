import { App, Modal, Setting } from 'obsidian';
import { I18n } from '../i18n';

export class ConfirmationModal extends Modal {
    private onConfirm: () => void;
    private onCancel: () => void;
    private settled = false;

    constructor(
        app: App,
        private message: string,
        onConfirm: () => void,
        onCancel: () => void = () => {}
    ) {
        super(app);
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
    }

    onOpen() {
        this.settled = false;
        const { contentEl } = this;

        contentEl.createEl('p', { text: this.message });

        new Setting(contentEl)
            .addButton(button =>
                button
                    .setButtonText(I18n.t('modals.confirm'))
                    .setWarning()
                    .onClick(() => {
                        if (this.settled) return;
                        this.settled = true;
                        this.onConfirm();
                        this.close();
                    })
            )
            .addButton(button =>
                button.setButtonText(I18n.t('modals.cancel')).onClick(() => {
                    this.close();
                })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        if (!this.settled) {
            this.settled = true;
            this.onCancel();
        }
    }
}
