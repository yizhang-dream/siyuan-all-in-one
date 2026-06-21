/**
 * 图片遮挡 Canvas 渲染器 — 编辑器模式 + 复习模式。
 * 编辑器：加载图片、绘制/拖动遮挡矩形、保存到 Card.occlusion。
 * 复习模式：显示图片，遮挡区域默认隐藏，点击/按键揭示。
 */

import type { ImageOcclusionCard, ImageOcclusionRegion } from './types';

/** 在 canvas 上绘制图片遮挡编辑状态 */
export function drawOcclusionEditor(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    regions: ImageOcclusionRegion[],
    selectedRegionId?: string
): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(image, 0, 0, w, h);

    for (const region of regions) {
        const rx = (region.x / 100) * w;
        const ry = (region.y / 100) * h;
        const rw = (region.w / 100) * w;
        const rh = (region.h / 100) * h;

        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = region.id === selectedRegionId ? '#ff4444' : '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, rw, rh);
        if (region.label) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px sans-serif';
            ctx.fillText(region.label, rx + 4, ry + 16);
        }
    }
}

/** 在 canvas 上绘制复习视图（遮挡区域默认隐藏，revealed 的显示） */
export function drawOcclusionReview(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    regions: ImageOcclusionRegion[],
    revealedIds: Set<string>
): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(image, 0, 0, w, h);

    for (const region of regions) {
        if (revealedIds.has(region.id)) continue; // 已揭示 → 不遮挡
        const rx = (region.x / 100) * w;
        const ry = (region.y / 100) * h;
        const rw = (region.w / 100) * w;
        const rh = (region.h / 100) * h;
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1;
        ctx.strokeRect(rx, ry, rw, rh);
    }
}

/** 检测 canvas 上的点击命中哪个遮挡区域 */
export function hitTestOcclusion(
    canvasX: number,
    canvasY: number,
    canvasWidth: number,
    canvasHeight: number,
    regions: ImageOcclusionRegion[]
): string | null {
    for (const region of regions) {
        const rx = (region.x / 100) * canvasWidth;
        const ry = (region.y / 100) * canvasHeight;
        const rw = (region.w / 100) * canvasWidth;
        const rh = (region.h / 100) * canvasHeight;
        if (canvasX >= rx && canvasX <= rx + rw && canvasY >= ry && canvasY <= ry + rh) {
            return region.id;
        }
    }
    return null;
}

/** 在图像上添加一个新遮挡矩形（百分比坐标） */
export function addOcclusionRegion(
    canvasX: number,
    canvasY: number,
    canvasWidth: number,
    canvasHeight: number,
    regions: ImageOcclusionRegion[]
): ImageOcclusionRegion {
    const margin = 4; // 百分比 margin
    const region: ImageOcclusionRegion = {
        id: `occl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        x: Math.max(0, (canvasX / canvasWidth) * 100 - margin / 2),
        y: Math.max(0, (canvasY / canvasHeight) * 100 - margin / 2),
        w: Math.min(100, 8),
        h: Math.min(100, 6),
    };
    return region;
}

/** 加载图片为 HTMLImageElement（支持 base64 data URL 和普通 URL） */
export function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = src;
    });
}

/** 将上传文件转为 base64 data URL */
export function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

/** 检查所有遮挡是否已揭示 */
export function allRevealed(regions: ImageOcclusionRegion[], revealed: Set<string>): boolean {
    return regions.every((region) => revealed.has(region.id));
}

/** 缩放到适合 canvas 的最大尺寸，保持宽高比 */
export function fitImageToCanvas(
    imgW: number, imgH: number, maxW: number, maxH: number
): { width: number; height: number } {
    const scale = Math.min(maxW / imgW, maxH / imgH, 1);
    return { width: Math.round(imgW * scale), height: Math.round(imgH * scale) };
}
