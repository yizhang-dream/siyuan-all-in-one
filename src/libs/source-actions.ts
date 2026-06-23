import { openTab, showMessage } from 'siyuan';
import type { SourceRef } from './types/concept';
import {
    formatSourceLabel,
    formatSourceText,
    getSourceAction,
    sourceLocatorText,
    sourceTypeLabel,
} from './source-refs';

export {
    formatSourceLabel,
    formatSourceText,
    getSourceAction,
    sourceLocatorText,
    sourceTypeLabel,
};

export interface SourceActivationOptions {
}

export async function activateSourceRef(
    ref: Partial<SourceRef>,
    app?: any,
    options: SourceActivationOptions = {}
): Promise<boolean> {
    const action = getSourceAction(ref);
    if (action.kind === 'open-url' && action.target) {
        window.open(action.target, '_blank', 'noopener,noreferrer');
        return true;
    }

    if (action.kind === 'open-siyuan-block' && action.target) {
        if (app) {
            openTab({ app, doc: { id: action.target } });
        } else {
            window.location.href = `siyuan://blocks/${encodeURIComponent(action.target)}`;
        }
        return true;
    }

    if (action.kind === 'open-rag') {
        await copyText(action.copyText || sourceLocatorText(ref));
        showMessage('已复制 RAG 来源定位');
        return true;
    }

    if (action.kind === 'copy-locator') {
        await copyText(action.copyText || sourceLocatorText(ref));
        showMessage('已复制来源定位');
        return true;
    }

    return false;
}

async function copyText(text: string): Promise<void> {
    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}
