/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Global config accessor for modules that cannot import the plugin class.
 * The plugin main file (src/index.ts) calls setAppConfig() after loading.
 */

import type { AppConfig } from './types';
import { DEFAULT_CONFIG } from './config';

let _appConfig: AppConfig = { ...DEFAULT_CONFIG };

export function getAppConfig(): AppConfig {
    return _appConfig;
}

export function setAppConfig(cfg: AppConfig): void {
    _appConfig = cfg;
}
