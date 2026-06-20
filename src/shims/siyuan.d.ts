declare module 'siyuan' {
    export type TProtyleAction = string;

    export interface DialogOptions {
        title?: string;
        content: string;
        width?: string;
        height?: string;
        destroyCallback?: () => void;
        [key: string]: any;
    }

    export class Dialog {
        element: HTMLElement;
        constructor(options: DialogOptions);
        destroy(options?: any): void;
    }

    export abstract class Plugin {
        app: any;
        i18n: Record<string, any>;
        readonly name: string;
        addTab(options: {
            type: string;
            init?: (this: any) => void;
            destroy?: (this: any) => void;
            resize?: (this: any) => void;
            update?: (this: any) => void;
            beforeDestroy?: (this: any) => void;
        }): () => any;
        addTopBar(options: {
            icon: string;
            title: string;
            position?: 'right' | 'left';
            callback: (event: MouseEvent) => void;
        }): HTMLElement;
        loadData(storageName: string): Promise<any>;
        saveData(storageName: string, content: any): Promise<void>;
        removeData(storageName: string): Promise<any>;
        openSetting(): void;
    }

    export function getFrontend(): 'desktop' | 'desktop-window' | 'mobile' | 'browser-desktop' | 'browser-mobile';

    export function openTab(options: {
        app: any;
        doc?: {
            id: string;
            action?: TProtyleAction[];
            zoomIn?: boolean;
        };
        custom?: {
            id: string;
            icon: string;
            title: string;
            data?: any;
        };
        position?: 'right' | 'bottom';
        keepCursor?: boolean;
        removeCurrentTab?: boolean;
        openNewTab?: boolean;
        afterOpen?: () => void;
        [key: string]: any;
    }): Promise<any>;

    export function fetchSyncPost(url: string, data?: any): Promise<any>;
    export function showMessage(text: string, timeout?: number, type?: 'info' | 'error', id?: string): void;
    export function confirm(
        title: string,
        text: string,
        confirmCallback?: (dialog: Dialog) => void,
        cancelCallback?: (dialog: Dialog) => void
    ): void;
}
