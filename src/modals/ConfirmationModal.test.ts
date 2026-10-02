import type { Mock } from 'vitest';
import { App } from 'obsidian';
import { ConfirmationModal } from './ConfirmationModal';

vi.mock('../i18n', () => ({
    I18n: {
        t: (key: string) => key,
    },
}));

describe('ConfirmationModal', () => {
    let app: App;
    let modal: ConfirmationModal;
    let onConfirmMock: Mock;
    let onCancelMock: Mock;

    beforeEach(() => {
        app = new App();
        onConfirmMock = vi.fn();
        onCancelMock = vi.fn();
        modal = new ConfirmationModal(
            app,
            'Test message',
            onConfirmMock,
            onCancelMock
        );
    });

    it('should render confirmation dialog', () => {
        modal.open();

        const message = modal.contentEl.querySelector('p');
        const buttons = modal.contentEl.querySelectorAll('button');

        expect(message?.textContent).toBe('Test message');
        expect(buttons.length).toBe(2);
        expect(buttons[0].textContent).toBe('modals.confirm');
        expect(buttons[1].textContent).toBe('modals.cancel');
    });

    it('should call onConfirm when confirm button is clicked', () => {
        modal.open();

        const confirmButton = modal.contentEl.querySelector('button');
        confirmButton?.click();

        expect(onConfirmMock).toHaveBeenCalledTimes(1);
        expect(onCancelMock).not.toHaveBeenCalled();
        expect(modal.contentEl.childNodes.length).toBe(0); // Modal should be closed
    });

    it('cancels once when the cancel button and close are repeated', () => {
        modal.open();

        const buttons = modal.contentEl.querySelectorAll('button');
        const cancelButton = buttons[1];
        cancelButton.click();
        cancelButton.click();
        modal.close();
        buttons[0].click();

        expect(onConfirmMock).not.toHaveBeenCalled();
        expect(onCancelMock).toHaveBeenCalledTimes(1);
        expect(modal.contentEl.childNodes.length).toBe(0);
    });

    it('cancels once on external close, even when onCancel closes again', () => {
        modal.open();
        const confirmButton = modal.contentEl.querySelector('button')!;
        onCancelMock.mockImplementationOnce(() => {
            expect(modal.contentEl.childNodes.length).toBe(0);
            modal.close();
        });

        modal.close();
        modal.close();
        confirmButton.click();

        expect(onCancelMock).toHaveBeenCalledTimes(1);
        expect(onConfirmMock).not.toHaveBeenCalled();
        expect(modal.contentEl.childNodes.length).toBe(0);
    });

    it('confirms once through repeated clicks and reentrant close without canceling', () => {
        modal.open();
        const [confirmButton, cancelButton] =
            modal.contentEl.querySelectorAll('button');
        onConfirmMock.mockImplementationOnce(() => {
            expect(modal.contentEl.querySelector('p')?.textContent).toBe(
                'Test message'
            );
            confirmButton.dispatchEvent(new MouseEvent('click'));
            modal.close();
        });

        confirmButton.click();
        confirmButton.click();
        cancelButton.click();
        modal.close();

        expect(onConfirmMock).toHaveBeenCalledTimes(1);
        expect(onCancelMock).not.toHaveBeenCalled();
        expect(modal.contentEl.childNodes.length).toBe(0);
    });

    it('can be dismissed without an onCancel callback', () => {
        modal = new ConfirmationModal(app, 'Test message', onConfirmMock);
        modal.open();
        modal.close();
        modal.close();

        modal.open();
        modal.contentEl.querySelectorAll('button')[1].click();

        expect(onConfirmMock).not.toHaveBeenCalled();
        expect(modal.contentEl.childNodes.length).toBe(0);
    });

    it('settles independently each time the modal is reopened', () => {
        modal.open();
        modal.close();

        modal.open();
        modal.contentEl.querySelector('button')!.click();

        modal.open();
        modal.close();
        modal.close();

        expect(onConfirmMock).toHaveBeenCalledTimes(1);
        expect(onCancelMock).toHaveBeenCalledTimes(2);
        expect(modal.contentEl.childNodes.length).toBe(0);
    });
});
