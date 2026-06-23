/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * 插件入口。装配层：加载配置 → 注册 Tab/TopBar → 零业务逻辑。
 */

import { Plugin, getFrontend, openTab, Dialog } from 'siyuan';
import './index.scss';

import { AIO_ICONS } from './icons';
import App from './App.svelte';
import SettingsPanel from './panels/Settings.svelte';
import { AIO_ICONS } from './icons';
import { CardStore } from './libs/store';
import { MindmapStore } from './libs/mindmap-store';
import { ConceptStore } from './libs/store/concept-store';
import { SourceStore } from './libs/source-store';
import type { AppConfig } from './libs/types';
import { DEFAULT_CONFIG, cleanConfig } from './libs/config';
import { setAppConfig } from './libs/config-helper';

const TAB_TYPE = 'siyuan-all-in-one-tab';
const STORAGE_CONFIG = 'config';

export default class SiYuanAllInOne extends Plugin {
    private cardStore!: CardStore;
    private mindmapStore!: MindmapStore;
    private conceptStore!: ConceptStore;
    private sourceStore!: SourceStore;
    private appInstance: any = null;
    private settingsDialog: Dialog | null = null;
    private settingsApp: any = null;
    private appConfig: AppConfig = { ...DEFAULT_CONFIG };
    private typoObserver: MutationObserver | null = null;
    private typoTimer: number | null = null;

    async onload() {
        console.debug('[all-in-one] loading...');
        (this as any).addIcons(AIO_ICONS);

        this.cardStore = new CardStore(this);
        await this.cardStore.load();
        this.mindmapStore = new MindmapStore(this);
        await this.mindmapStore.load();
        this.conceptStore = new ConceptStore(this);
        await this.conceptStore.load();
        this.sourceStore = new SourceStore(this);
        await this.sourceStore.load();
        await this.migrateSourceRefs();
        await this.loadConfig();

        // 同步 SiYuan 字号/字体到插件 CSS 变量
        this.syncSiyuanTypography();

        // 注册中心 Tab。init 回调中 this 指向 Custom 实例。
        // 用闭包变量捕获 plugin 引用，避免 this 歧义。
        const plugin = this;
        this.addTab({
            type: TAB_TYPE,
            init() {
                const el = this.element as HTMLElement;
                el.style.display = 'flex';
                el.style.flexDirection = 'column';
                el.style.height = '100%';
                // 在 init 中直接挂载 Svelte（init 在 Tab 首次渲染时调用，元素已就绪）
                if (!plugin.appInstance) {
                    plugin.appInstance = new App({
                        target: el,
                        props: {
                            plugin: plugin,
                            cardStore: plugin.cardStore,
                            mindmapStore: plugin.mindmapStore,
                            conceptStore: plugin.conceptStore,
                            sourceStore: plugin.sourceStore,
                            config: plugin.getConfig(),
                        },
                    });
                }
            },
            destroy() {
                plugin.appInstance?.$destroy();
                plugin.appInstance = null;
            },
        });

        // 顶栏图标
        this.addTopBar({
            icon: 'iconAioRiffCard',
            title: this.i18n.pluginName || '知识闪卡 All-in-One',
            position: 'right',
            callback: () => {
                this.openMainTab();
            },
        });

        console.debug('[all-in-one] loaded');
    }

    async onLayoutReady() {
        // 布局就绪后：首次同步 + 启动实时监听
        this.syncSiyuanTypography();
        this.startTypoObserver();
    }

    /**
     * 从 SiYuan 运行时 DOM 读取实际字号/字体/行高，注入到 :root CSS 变量。
     * SiYuan 的用户字号设置（conf.json fontSize）通过 JS 动态注入到 .protyle-wysiwyg，
     * 不在 CSS 变量 --b3-font-size 里（那个固定 14px），所以必须从 DOM 实时读取。
     */
    private syncSiyuanTypography() {
        try {
            const root = document.documentElement;
            // 优先从 .protyle-wysiwyg 读取（受用户字号设置影响）
            const target = (document.querySelector('.protyle-wysiwyg') ||
                            document.querySelector('.b3-typography') ||
                            document.body) as HTMLElement;
            if (target) {
                const computed = window.getComputedStyle(target);
                const fontSize = computed.fontSize;
                const fontFamily = computed.fontFamily;
                const lineHeight = computed.lineHeight;
                if (fontSize) root.style.setProperty('--aio-fs-live', fontSize);
                if (fontFamily) root.style.setProperty('--aio-ff-live', fontFamily);
                if (lineHeight) root.style.setProperty('--aio-lh-live', lineHeight);
            }
        } catch (e) {
            console.warn('[all-in-one] 同步字号失败', e);
        }
    }

    /**
     * 启动 MutationObserver 实时监听 SiYuan 字号/字体变化。
     * 用户在设置里改字号时，SiYuan 会修改 .protyle-wysiwyg 的 style 属性，
     * observer 检测到后立即同步到插件 CSS 变量。
     */
    private startTypoObserver() {
        if (this.typoObserver) this.typoObserver.disconnect();

        const doSync = () => {
            // 防抖：SiYuan 改字号时可能触发多次 mutation
            if (this.typoTimer) clearTimeout(this.typoTimer);
            this.typoTimer = window.setTimeout(() => this.syncSiyuanTypography(), 100);
        };

        this.typoObserver = new MutationObserver(doSync);

        // 观察整个 body 子树 style 变化（SiYuan 可能在多个元素上注入字号）
        this.typoObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['style', 'class'],
            subtree: true,
            childList: false,
        });

        // 兜底：每 2 秒轮询一次（防止 observer 遗漏某些变化）
        this.typoTimer = window.setInterval(doSync, 2000);
    }

    async onunload() {
        // 清理实时字号监听
        if (this.typoObserver) { this.typoObserver.disconnect(); this.typoObserver = null; }
        if (this.typoTimer) { clearInterval(this.typoTimer); clearTimeout(this.typoTimer); this.typoTimer = null; }

        await this.cardStore.save();
        await this.conceptStore.save();
        await this.vectorStore.save();
        this.appInstance?.$destroy();
        this.appInstance = null;
        this.settingsApp?.$destroy();
        this.settingsApp = null;
    }

    // ── 数据迁移 ──────────────────────────────────────────

    private async migrateSourceRefs() {
        const migrateRef = (ref: any) => {
            if (!ref || !ref.type) return ref;
            switch (ref.type) {
                case 'file': case 'url': case 'pdf': case 'rag': case 'opennotebook':
                    return { ...ref, type: 'source' };
                case 'siyuan': return { ...ref, type: 'siyuan-doc' };
                default: return ref;
            }
        };

        // Migrate cards
        try {
            const cards = await this.loadData('cards');
            if (Array.isArray(cards)) {
                let changed = false;
                for (const card of cards) {
                    if (Array.isArray(card.sourceRefs)) {
                        card.sourceRefs = card.sourceRefs.map(migrateRef);
                        changed = true;
                    }
                }
                if (changed) await this.saveData('cards', cards);
            }
        } catch {}

        // Migrate concepts + relations via ConceptStore
        try {
            if (typeof (this as any).conceptStore?.migrateSourceRefs === 'function') {
                await (this as any).conceptStore.migrateSourceRefs(migrateRef);
            }
        } catch {}
    }

    // ── 打开主工作台 Tab ──────────────────────────────────

    private openMainTab() {
        const tabId = this.name + TAB_TYPE;
        openTab({
            app: this.app,
            custom: {
                id: tabId,
                icon: 'iconAioRiffCard',
                title: this.i18n.pluginName || '知识闪卡',
                data: {},
            },
        });
    }

    // ── 配置管理 ──────────────────────────────────────────

    private async loadConfig() {
        try {
            const saved = await this.loadData(STORAGE_CONFIG);
            if (saved) {
                this.appConfig = { ...DEFAULT_CONFIG, ...cleanConfig(saved) };
            }
        } catch {
            this.appConfig = { ...DEFAULT_CONFIG };
        }
        setAppConfig(this.appConfig);
    }

    async saveConfig(config: AppConfig) {
        this.appConfig = { ...config };
        await this.saveData(STORAGE_CONFIG, cleanConfig(config));
        this.appInstance?.$set({ config: this.getConfig() });
        setAppConfig(config);
    }

    getConfig(): AppConfig {
        return { ...this.appConfig };
    }

    // ── 设置面板 ──────────────────────────────────────────

    openSetting(): void {
        if (this.settingsDialog) {
            this.settingsDialog.destroy();
            return;
        }

        this.settingsDialog = new Dialog({
            title: this.i18n.settingsTitle || '设置',
            content: '<div id="all-in-one-settings" style="height:100%;"></div>',
            width: '600px',
            height: '70%',
            destroyCallback: () => {
                this.settingsApp?.$destroy();
                this.settingsApp = null;
                this.settingsDialog = null;
            },
        });

        const container = this.settingsDialog.element.querySelector('#all-in-one-settings');
        if (container) {
            this.settingsApp = new SettingsPanel({
                target: container as HTMLElement,
                props: { plugin: this, config: this.getConfig() },
            });
        }
    }

    // ── 暴露给 Svelte ─────────────────────────────────────

    async saveCards(): Promise<void> {
        await this.cardStore.save();
    }

    getCardStore(): CardStore {
        return this.cardStore;
    }

    async saveConcepts(): Promise<void> {
        await this.conceptStore.save();
    }

    getConceptStore(): ConceptStore {
        return this.conceptStore;
    }

    getSourceStore(): SourceStore {
        return this.sourceStore;
    }
}
