import { App } from 'obsidian';
import { ConfirmationModal } from './ConfirmationModal';

jest.mock('../i18n', () => ({
    I18n: {
        t: (key: string) => key
    }
}));

describe('ConfirmationModal', () => {
    let app: App;
    let modal: ConfirmationModal;
    let onConfirmMock: jest.Mock;

    beforeEach(() => {
        app = new App();
        onConfirmMock = jest.fn();
        modal = new ConfirmationModal(app, 'Test message', onConfirmMock);
    });

    it('should render confirmation dialog', () => {
        modal.onOpen();

        const message = modal.contentEl.querySelector('p');
        const buttons = modal.contentEl.querySelectorAll('button');

        expect(message?.textContent).toBe('Test message');
        expect(buttons.length).toBe(2);
        expect(buttons[0].textContent).toBe('modals.confirm');
        expect(buttons[1].textContent).toBe('modals.cancel');
    });

    it('should call onConfirm when confirm button is clicked', () => {
        modal.onOpen();

        const confirmButton = modal.contentEl.querySelector('button');
        confirmButton?.click();

        expect(onConfirmMock).toHaveBeenCalled();
        expect(modal.contentEl.childNodes.length).toBe(0); // Modal should be closed
    });

    it('should close without calling onConfirm when cancel is clicked', () => {
        modal.onOpen();

        const buttons = modal.contentEl.querySelectorAll('button');
        const cancelButton = buttons[1];
        cancelButton?.click();

        expect(onConfirmMock).not.toHaveBeenCalled();
        expect(modal.contentEl.childNodes.length).toBe(0);
    });
}); 