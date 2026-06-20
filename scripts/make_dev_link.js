/*
 * Creates a symbolic link from the SiYuan plugins directory to dist/.
 * Usage: node scripts/make_dev_link.js
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { pluginName, resolveSiyuanDataDir } from './siyuan_paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const siyuanDataDir = resolveSiyuanDataDir();
const pluginsDir = path.join(siyuanDataDir, 'plugins');
const targetDir = path.join(pluginsDir, pluginName);
const distDir = path.join(__dirname, '..', 'dist');

function main() {
    console.log(`Plugin name: ${pluginName}`);
    console.log(`SiYuan data directory: ${siyuanDataDir}`);

    if (!fs.existsSync(pluginsDir)) {
        console.error(`ERROR: SiYuan plugins directory not found: ${pluginsDir}`);
        process.exit(1);
    }
    if (!fs.existsSync(distDir)) {
        console.error(`ERROR: dist/ directory not found: ${distDir}`);
        console.error('Run "npm run build" first.');
        process.exit(1);
    }

    if (fs.existsSync(targetDir)) {
        const stat = fs.lstatSync(targetDir);
        if (stat.isSymbolicLink()) {
            fs.unlinkSync(targetDir);
            console.log(`Removed existing symlink: ${targetDir}`);
        } else {
            console.error(`ERROR: ${targetDir} already exists and is not a symlink.`);
            console.error('Use npm run deploy:siyuan -- --apply for safe file-copy deployment.');
            process.exit(1);
        }
    }

    try {
        fs.symlinkSync(distDir, targetDir, os.platform() === 'win32' ? 'junction' : 'dir');
        console.log(`Created symlink: ${targetDir} -> ${distDir}`);
    } catch (err) {
        console.error(`Failed to create symlink: ${err.message}`);
        process.exit(1);
    }
}

main();
