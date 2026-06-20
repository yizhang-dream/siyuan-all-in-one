/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * i18n 辅助：从 Plugin 实例获取翻译函数。
 */

/**
 * 返回绑定到 plugin.i18n 的翻译函数。
 * 用法：const t = getT(plugin); t('reviewTab')
 * 缺失 key 时返回 key 本身。
 */
export function getT(plugin: any): (key: string) => string {
    return (key: string): string => {
        return plugin?.i18n?.[key] ?? key;
    };
}

export type TFunc = ReturnType<typeof getT>;
