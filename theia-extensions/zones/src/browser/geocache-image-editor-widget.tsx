/**
 * Theia widget that displays and (later) edits a geocache image in a dedicated tab.
 */

import * as React from 'react';
import { injectable } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { fabric } from 'fabric';

type GeocacheImageV2Dto = {
    id: number;
    geocache_id: number;
    url: string;
    source_url: string;
    stored: boolean;
    parent_image_id?: number | null;
    derivation_type?: string;
    title?: string | null;
    note?: string | null;
    qr_payload?: string | null;
    ocr_text?: string | null;
    ocr_language?: string | null;
    detected_features?: Record<string, unknown> | null;
};

export interface GeocacheImageEditorContext {
    backendBaseUrl: string;
    geocacheId: number;
    imageId: number;
    imageTitle?: string;
}

@injectable()
export class GeocacheImageEditorWidget extends ReactWidget {
    static readonly ID = 'geocache.image.editor.widget';

    protected backendBaseUrl = 'http://127.0.0.1:8000';
    protected geocacheId?: number;
    protected imageId?: number;

    protected isLoading = false;
    protected error: string | null = null;
    protected image: GeocacheImageV2Dto | null = null;
    protected isSaving = false;
    protected didApplyRemoteEditorState = false;

    protected canvasElement: HTMLCanvasElement | null = null;
    protected fabricCanvas: any | null = null;

    protected baseImageObjectUrl: string | null = null;
    protected baseImageObjectUrlPendingRevoke: string | null = null;

    protected tool: 'select' | 'draw' | 'text' | 'image' = 'select';
    protected isRestoringHistory = false;
    protected undoStack: string[] = [];
    protected redoStack: string[] = [];

    protected textFill = '#ffffff';
    protected textFontSize = 28;
    protected textBold = false;
    protected textItalic = false;

    protected textBackgroundEnabled = true;
    protected textBackgroundFill = '#000000';
    protected textBackgroundOpacity = 0.4;

    protected drawBrushType: 'pen' | 'highlighter' | 'eraser' = 'pen';
    protected drawBrushSize = 6;
    protected drawColor = '#ffcc00';
    protected drawOpacity = 0.85;
    protected drawLineCap: 'round' | 'butt' | 'square' = 'round';
    protected drawLineJoin: 'round' | 'bevel' | 'miter' = 'round';
    protected drawDecimate = 0.4;

    protected selectionCount = 0;
    protected selectionOpacity = 1;
    protected selectionLocked = false;

    protected imageZoom = 1;
    protected imageCanvasWidth = 0;
    protected imageCanvasHeight = 0;

    protected imageBaseScale = 1;
    protected imageScale = 1;

    protected imageBrightness = 0;
    protected imageContrast = 0;
    protected imageSaturation = 0;
    protected imageHueRotationDeg = 0;
    protected imageBlur = 0;
    protected imageGrayscale = false;
    protected imageSepia = false;
    protected imageInvert = false;

    constructor() {
        super();
        this.id = GeocacheImageEditorWidget.ID;
        this.title.label = 'Image Editor';
        this.title.caption = 'Éditeur d\'image';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-image';
        this.addClass('theia-geocache-image-editor-widget');

        this.node.tabIndex = 0;
    }

    setContext(context: GeocacheImageEditorContext): void {
        this.backendBaseUrl = context.backendBaseUrl;
        this.geocacheId = context.geocacheId;
        this.imageId = context.imageId;
        this.didApplyRemoteEditorState = false;
        const label = context.imageTitle ? `Image Editor - ${context.imageTitle}` : `Image Editor - #${context.imageId}`;
        this.title.label = label;
        this.update();
        void this.load();
    }

    protected override onBeforeDetach(msg: any): void {
        this.disposeFabric();
        super.onBeforeDetach(msg);
    }

    protected override onActivateRequest(msg: any): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    override dispose(): void {
        this.disposeFabric();
        super.dispose();
    }

    protected disposeFabric(): void {
        if (this.fabricCanvas) {
            this.fabricCanvas.dispose();
            this.fabricCanvas = null;
        }
        if (this.baseImageObjectUrl) {
            URL.revokeObjectURL(this.baseImageObjectUrl);
            this.baseImageObjectUrl = null;
        }
        if (this.baseImageObjectUrlPendingRevoke) {
            URL.revokeObjectURL(this.baseImageObjectUrlPendingRevoke);
            this.baseImageObjectUrlPendingRevoke = null;
        }
        this.canvasElement = null;
    }

    protected resolveImageUrl(url: string): string {
        if (!url) {
            return url;
        }
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        if (url.startsWith('/')) {
            return `${this.backendBaseUrl}${url}`;
        }
        return `${this.backendBaseUrl}/${url}`;
    }

    protected async resolveImageUrlForCanvas(url: string): Promise<string> {
        const resolved = this.resolveImageUrl(url);
        if (!resolved) {
            return resolved;
        }

        if (resolved.startsWith(this.backendBaseUrl)) {
            try {
                const res = await fetch(resolved, { credentials: 'include' });
                if (!res.ok) {
                    return resolved;
                }
                const blob = await res.blob();
                const nextUrl = URL.createObjectURL(blob);
                if (this.baseImageObjectUrl && this.baseImageObjectUrl !== nextUrl) {
                    this.baseImageObjectUrlPendingRevoke = this.baseImageObjectUrl;
                }
                this.baseImageObjectUrl = nextUrl;
                return nextUrl;
            } catch {
                return resolved;
            }
        }

        return resolved;
    }

    protected async load(): Promise<void> {
        if (!this.geocacheId || !this.imageId) {
            return;
        }
        if (this.isLoading) {
            return;
        }

        this.isLoading = true;
        this.error = null;
        this.update();

        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/images`, {
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const images = (await res.json()) as GeocacheImageV2Dto[];
            this.image = images.find(i => i.id === this.imageId) ?? null;
            if (!this.image) {
                this.error = 'Image introuvable';
            }
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] load error', e);
            this.error = 'Impossible de charger l\'image';
        } finally {
            this.isLoading = false;
            this.update();

            if (!this.error && this.image) {
                this.ensureFabricReady();
                await this.loadRemoteEditorStateIfAny();
                void this.refreshBaseImageSource();
            }
        }
    }

    protected async loadRemoteEditorStateIfAny(): Promise<void> {
        if (!this.imageId || !this.fabricCanvas) {
            return;
        }
        if (this.didApplyRemoteEditorState) {
            return;
        }

        this.didApplyRemoteEditorState = true;

        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocache-images/${this.imageId}/editor-state`, {
                credentials: 'include',
            });
            if (!res.ok) {
                return;
            }
            const data = (await res.json()) as { editor_state_json?: string | null };
            const json = (data?.editor_state_json || '').trim();
            if (!json) {
                return;
            }
            this.restoreFromJson(json);
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] load editor state error', e);
        }
    }

    protected readonly setCanvasRef = (el: HTMLCanvasElement | null): void => {
        this.canvasElement = el;
        this.ensureFabricReady();
    };

    protected ensureFabricReady(): void {
        if (!this.canvasElement || !this.image || this.isLoading || this.error) {
            return;
        }

        if (!this.fabricCanvas) {
            this.fabricCanvas = new fabric.Canvas(this.canvasElement, {
                preserveObjectStacking: true,
                selection: true,
            });

            this.fabricCanvas.on('object:added', this.recordHistorySnapshot);
            this.fabricCanvas.on('object:modified', this.recordHistorySnapshot);
            this.fabricCanvas.on('object:removed', this.recordHistorySnapshot);
            this.fabricCanvas.on('path:created', this.recordHistorySnapshot);

            this.fabricCanvas.on('selection:created', this.onSelectionChanged);
            this.fabricCanvas.on('selection:updated', this.onSelectionChanged);
            this.fabricCanvas.on('selection:cleared', this.onSelectionChanged);

            this.applyTool('select');
        }

        if (this.fabricCanvas && this.fabricCanvas.getObjects().length === 0) {
            this.ensureBaseImageObject();
        }
    }

    protected applyTool(tool: 'select' | 'draw' | 'text' | 'image'): void {
        this.tool = tool;
        if (!this.fabricCanvas) {
            this.update();
            return;
        }

        if (tool === 'draw') {
            this.fabricCanvas.isDrawingMode = true;
            this.applyDrawOptions();
        } else {
            this.fabricCanvas.isDrawingMode = false;
        }

        this.update();
    }

    protected getBaseImageObject(): any | null {
        if (!this.fabricCanvas) {
            return null;
        }
        const objects = this.fabricCanvas.getObjects?.() ?? [];
        const base = objects.find((o: any) => o && o.type === 'image' && o.selectable === false);
        return base ?? null;
    }

    protected ensureBaseImageObject(): void {
        if (!this.fabricCanvas || !this.canvasElement || !this.image) {
            return;
        }

        if (this.getBaseImageObject()) {
            return;
        }

        void this.resolveImageUrlForCanvas(this.image.url).then(src => {
            fabric.Image.fromURL(
                src,
            (img: any) => {
                if (!this.fabricCanvas || !img) {
                    return;
                }

                const container = this.canvasElement?.parentElement;
                const containerWidth = container?.clientWidth ?? 900;
                const containerHeight = Math.min(window.innerHeight * 0.7, 700);
                this.fabricCanvas.setWidth(Math.max(300, containerWidth - 16));
                this.fabricCanvas.setHeight(Math.max(300, containerHeight));

                this.imageCanvasWidth = this.fabricCanvas.getWidth();
                this.imageCanvasHeight = this.fabricCanvas.getHeight();

                img.set({
                    selectable: false,
                    evented: false,
                    hasControls: false,
                    hoverCursor: 'default',
                    lockMovementX: true,
                    lockMovementY: true,
                    lockScalingX: true,
                    lockScalingY: true,
                    lockRotation: true,
                });

                const scaleX = this.fabricCanvas.getWidth() / (img.width || 1);
                const scaleY = this.fabricCanvas.getHeight() / (img.height || 1);
                const scale = Math.min(scaleX, scaleY);
                img.scale(scale);
                img.set({ left: 0, top: 0, originX: 'left', originY: 'top' });

                this.imageBaseScale = scale;
                this.imageScale = 1;

                this.fabricCanvas.add(img);
                this.fabricCanvas.sendToBack(img);
                this.fabricCanvas.requestRenderAll?.();

                if (!this.undoStack.length) {
                    this.undoStack = [JSON.stringify(this.fabricCanvas.toJSON())];
                    this.redoStack = [];
                    this.update();
                }
            },
            { crossOrigin: 'anonymous' }
            );
        });
    }

    protected async refreshBaseImageSource(): Promise<void> {
        if (!this.fabricCanvas || !this.image) {
            return;
        }
        const base = this.getBaseImageObject();
        if (!base) {
            this.ensureBaseImageObject();
            return;
        }

        const src = await this.resolveImageUrlForCanvas(this.image.url);
        if (!src) {
            return;
        }

        if (typeof base.setSrc === 'function') {
            const pendingRevoke = this.baseImageObjectUrlPendingRevoke;
            base.setSrc(src, () => {
                if (!this.fabricCanvas) {
                    return;
                }
                const w = this.fabricCanvas.getWidth();
                const h = this.fabricCanvas.getHeight();
                const scaleX = w / (base.width || 1);
                const scaleY = h / (base.height || 1);
                this.imageBaseScale = Math.min(scaleX, scaleY);
                base.scale(this.imageBaseScale * this.imageScale);
                base.set({ left: 0, top: 0, originX: 'left', originY: 'top' });
                base.setCoords?.();
                this.fabricCanvas.sendToBack(base);
                this.fabricCanvas.requestRenderAll?.();
                if (pendingRevoke) {
                    try {
                        URL.revokeObjectURL(pendingRevoke);
                    } finally {
                        if (this.baseImageObjectUrlPendingRevoke === pendingRevoke) {
                            this.baseImageObjectUrlPendingRevoke = null;
                        }
                    }
                }
            }, { crossOrigin: 'anonymous' });
        } else {
            try {
                this.fabricCanvas.remove(base);
            } catch {
                // ignore
            }
            this.ensureBaseImageObject();
        }
    }

    protected rgbaFromHex(hex: string, alpha: number): string {
        const rgb = this.hexToRgb(hex);
        const a = this.clamp(alpha, 0, 1);
        if (!rgb) {
            return `rgba(255,204,0,${a})`;
        }
        return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
    }

    protected applyDrawOptions(): void {
        if (!this.fabricCanvas) {
            return;
        }

        const canvas = this.fabricCanvas;
        let brush: any = canvas.freeDrawingBrush;

        const FabricAny = fabric as any;

        if (this.drawBrushType === 'eraser') {
            if (FabricAny.EraserBrush) {
                brush = new FabricAny.EraserBrush(canvas);
            } else {
                brush = new fabric.PencilBrush(canvas);
                brush.color = '#000000';
                brush.globalCompositeOperation = 'destination-out';
            }
        } else {
            brush = new fabric.PencilBrush(canvas);
            brush.globalCompositeOperation = 'source-over';
        }

        brush.width = this.drawBrushSize;

        if (this.drawBrushType === 'highlighter') {
            brush.color = this.rgbaFromHex(this.drawColor, this.clamp(this.drawOpacity, 0, 1) * 0.35);
        } else if (this.drawBrushType === 'pen') {
            brush.color = this.rgbaFromHex(this.drawColor, this.drawOpacity);
        }

        brush.strokeLineCap = this.drawLineCap;
        brush.strokeLineJoin = this.drawLineJoin;
        brush.decimate = this.clamp(this.drawDecimate, 0, 1);

        canvas.freeDrawingBrush = brush;
        canvas.isDrawingMode = true;
        canvas.requestRenderAll?.();
    }

    protected readonly recordHistorySnapshot = (): void => {
        if (this.isRestoringHistory || !this.fabricCanvas) {
            return;
        }
        try {
            const snapshot = JSON.stringify(this.fabricCanvas.toJSON());
            const last = this.undoStack[this.undoStack.length - 1];
            if (snapshot !== last) {
                this.undoStack.push(snapshot);
                if (this.undoStack.length > 30) {
                    this.undoStack.shift();
                }
                this.redoStack = [];
                this.update();
            }
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] history snapshot error', e);
        }
    };

    protected readonly onSelectionChanged = (): void => {
        const selectedObjects = this.getSelectedObjects();
        this.selectionCount = selectedObjects.length;
        if (selectedObjects.length) {
            const opacities = selectedObjects.map(o => (typeof o.opacity === 'number' ? o.opacity : 1));
            this.selectionOpacity = opacities[0];
            this.selectionLocked = selectedObjects.every(o => o.selectable === false);
        }

        const active = this.getActiveTextObject();
        if (active) {
            const fill = (active.fill ?? '') as string;
            if (typeof fill === 'string' && fill.startsWith('#')) {
                this.textFill = fill;
            }
            const fontSize = active.fontSize as number | undefined;
            if (typeof fontSize === 'number' && Number.isFinite(fontSize) && fontSize > 0) {
                this.textFontSize = fontSize;
            }
            const fontWeight = (active.fontWeight ?? '') as string;
            this.textBold = String(fontWeight).toLowerCase() === 'bold';
            const fontStyle = (active.fontStyle ?? '') as string;
            this.textItalic = String(fontStyle).toLowerCase() === 'italic';

            const bg = (active.backgroundColor ?? '') as string;
            const parsed = this.parseRgbaBackground(bg);
            if (parsed) {
                this.textBackgroundEnabled = true;
                this.textBackgroundFill = parsed.hex;
                this.textBackgroundOpacity = parsed.alpha;
            } else {
                this.textBackgroundEnabled = false;
            }
        }
        this.update();
    };

    protected clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    protected hexToRgb(hex: string): { r: number; g: number; b: number } | null {
        const normalized = hex.trim().replace('#', '');
        if (normalized.length !== 6) {
            return null;
        }
        const r = Number.parseInt(normalized.slice(0, 2), 16);
        const g = Number.parseInt(normalized.slice(2, 4), 16);
        const b = Number.parseInt(normalized.slice(4, 6), 16);
        if ([r, g, b].some(v => Number.isNaN(v))) {
            return null;
        }
        return { r, g, b };
    }

    protected rgbToHex(r: number, g: number, b: number): string {
        const toHex = (v: number): string => this.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    protected parseRgbaBackground(value: string): { hex: string; alpha: number } | null {
        const v = (value || '').trim();
        if (!v) {
            return null;
        }
        const rgba = v.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/i);
        if (!rgba) {
            return null;
        }
        const r = Number(rgba[1]);
        const g = Number(rgba[2]);
        const b = Number(rgba[3]);
        const a = Number(rgba[4]);
        if (![r, g, b, a].every(n => Number.isFinite(n))) {
            return null;
        }
        return {
            hex: this.rgbToHex(r, g, b),
            alpha: this.clamp(a, 0, 1),
        };
    }

    protected getActiveTextObject(): any | null {
        if (!this.fabricCanvas) {
            return null;
        }
        const obj = this.fabricCanvas.getActiveObject?.();
        if (!obj) {
            return null;
        }
        if (obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'text') {
            return obj;
        }
        return null;
    }

    protected getSelectedObjects(): any[] {
        if (!this.fabricCanvas) {
            return [];
        }
        const active = this.fabricCanvas.getActiveObject?.();
        if (!active) {
            return [];
        }
        if (active.type === 'activeSelection' && typeof active.getObjects === 'function') {
            return active.getObjects();
        }
        return [active];
    }

    protected setSelectionOpacity(value: number): void {
        if (!this.fabricCanvas) {
            return;
        }
        const v = this.clamp(value, 0, 1);
        const objects = this.getSelectedObjects();
        if (!objects.length) {
            return;
        }
        objects.forEach(obj => {
            obj.set({ opacity: v });
        });
        this.selectionOpacity = v;
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.update();
    }

    protected toggleSelectionLock(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const objects = this.getSelectedObjects();
        if (!objects.length) {
            return;
        }
        const nextLocked = !this.selectionLocked;
        objects.forEach(obj => {
            obj.set({
                selectable: !nextLocked,
                evented: !nextLocked,
                lockMovementX: nextLocked,
                lockMovementY: nextLocked,
                lockScalingX: nextLocked,
                lockScalingY: nextLocked,
                lockRotation: nextLocked,
            });
        });
        this.selectionLocked = nextLocked;
        if (nextLocked) {
            this.fabricCanvas.discardActiveObject?.();
        }
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.update();
    }

    protected bringToFront(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const objects = this.getSelectedObjects();
        objects.forEach(obj => {
            this.fabricCanvas.bringToFront(obj);
        });
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
    }

    protected sendToBack(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const objects = this.getSelectedObjects();
        objects.forEach(obj => {
            this.fabricCanvas.sendToBack(obj);
        });
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
    }

    protected bringForward(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const objects = this.getSelectedObjects();
        objects.forEach(obj => {
            this.fabricCanvas.bringForward(obj);
        });
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
    }

    protected sendBackwards(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const objects = this.getSelectedObjects();
        objects.forEach(obj => {
            this.fabricCanvas.sendBackwards(obj);
        });
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
    }

    protected async duplicateSelection(): Promise<void> {
        if (!this.fabricCanvas) {
            return;
        }
        const canvas = this.fabricCanvas;
        const active = canvas.getActiveObject?.();
        if (!active) {
            return;
        }

        const clones: any[] = [];
        const cloneOne = (obj: any) => new Promise<any>((resolve) => {
            obj.clone((cloned: any) => resolve(cloned));
        });

        if (active.type === 'activeSelection') {
            const objects = active.getObjects?.() ?? [];
            for (const obj of objects) {
                const cloned = await cloneOne(obj);
                cloned.set({ left: (obj.left ?? 0) + 12, top: (obj.top ?? 0) + 12 });
                canvas.add(cloned);
                clones.push(cloned);
            }
        } else {
            const cloned = await cloneOne(active);
            cloned.set({ left: (active.left ?? 0) + 12, top: (active.top ?? 0) + 12 });
            canvas.add(cloned);
            clones.push(cloned);
        }

        if (clones.length > 1 && (fabric as any).ActiveSelection) {
            const sel = new (fabric as any).ActiveSelection(clones, { canvas });
            canvas.setActiveObject(sel);
        } else if (clones.length === 1) {
            canvas.setActiveObject(clones[0]);
        }

        canvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.onSelectionChanged();
    }

    protected groupSelection(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const active = this.fabricCanvas.getActiveObject?.();
        if (!active || active.type !== 'activeSelection') {
            return;
        }
        if (typeof active.toGroup === 'function') {
            const group = active.toGroup();
            this.fabricCanvas.setActiveObject(group);
            this.fabricCanvas.requestRenderAll?.();
            this.recordHistorySnapshot();
            this.onSelectionChanged();
        }
    }

    protected ungroupSelection(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const active = this.fabricCanvas.getActiveObject?.();
        if (!active || active.type !== 'group') {
            return;
        }
        if (typeof active.toActiveSelection === 'function') {
            const sel = active.toActiveSelection();
            this.fabricCanvas.setActiveObject(sel);
            this.fabricCanvas.requestRenderAll?.();
            this.recordHistorySnapshot();
            this.onSelectionChanged();
        }
    }

    protected alignSelection(kind: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void {
        if (!this.fabricCanvas) {
            return;
        }
        const active = this.fabricCanvas.getActiveObject?.();
        if (!active || active.type !== 'activeSelection') {
            return;
        }

        const objects = active.getObjects?.() ?? [];
        if (objects.length < 2) {
            return;
        }

        active.setCoords?.();
        const bounds = active.getBoundingRect?.(true, true) ?? { left: 0, top: 0, width: 0, height: 0 };
        const left = bounds.left;
        const right = bounds.left + bounds.width;
        const top = bounds.top;
        const bottom = bounds.top + bounds.height;
        const cx = bounds.left + bounds.width / 2;
        const cy = bounds.top + bounds.height / 2;

        objects.forEach((obj: any) => {
            obj.setCoords?.();
            const r = obj.getBoundingRect?.(true, true) ?? { left: obj.left ?? 0, top: obj.top ?? 0, width: 0, height: 0 };
            switch (kind) {
                case 'left':
                    obj.set({ left: (obj.left ?? 0) + (left - r.left) });
                    break;
                case 'center':
                    obj.set({ left: (obj.left ?? 0) + (cx - (r.left + r.width / 2)) });
                    break;
                case 'right':
                    obj.set({ left: (obj.left ?? 0) + (right - (r.left + r.width)) });
                    break;
                case 'top':
                    obj.set({ top: (obj.top ?? 0) + (top - r.top) });
                    break;
                case 'middle':
                    obj.set({ top: (obj.top ?? 0) + (cy - (r.top + r.height / 2)) });
                    break;
                case 'bottom':
                    obj.set({ top: (obj.top ?? 0) + (bottom - (r.top + r.height)) });
                    break;
            }
            obj.setCoords?.();
        });

        active.setCoords?.();
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
    }

    protected applyTextOptionsToSelection(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const active = this.getActiveTextObject();
        if (!active) {
            return;
        }

        const bg = this.textBackgroundEnabled
            ? (() => {
                const rgb = this.hexToRgb(this.textBackgroundFill);
                const alpha = this.clamp(this.textBackgroundOpacity, 0, 1);
                if (!rgb) {
                    return `rgba(0,0,0,${alpha})`;
                }
                return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
            })()
            : null;

        active.set({
            fill: this.textFill,
            fontSize: this.textFontSize,
            fontWeight: this.textBold ? 'bold' : 'normal',
            fontStyle: this.textItalic ? 'italic' : 'normal',
            backgroundColor: bg,
        });
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
    }

    protected addText(): void {
        if (!this.fabricCanvas) {
            return;
        }

        const rgb = this.hexToRgb(this.textBackgroundFill);
        const alpha = this.clamp(this.textBackgroundOpacity, 0, 1);
        const backgroundColor = this.textBackgroundEnabled
            ? (rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})` : `rgba(0,0,0,${alpha})`)
            : null;

        const text = new fabric.IText('Texte', {
            left: 50,
            top: 50,
            fill: this.textFill,
            fontSize: this.textFontSize,
            fontWeight: this.textBold ? 'bold' : 'normal',
            fontStyle: this.textItalic ? 'italic' : 'normal',
            backgroundColor,
        });
        this.fabricCanvas.add(text);
        this.fabricCanvas.setActiveObject(text);
        this.fabricCanvas.renderAll();
    }

    protected deleteSelection(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const active = this.fabricCanvas.getActiveObject?.();
        if (!active) {
            return;
        }

        if (active.type === 'activeSelection') {
            const objects = active.getObjects?.() ?? [];
            objects.forEach((obj: any) => {
                this.fabricCanvas.remove(obj);
            });
            this.fabricCanvas.discardActiveObject?.();
        } else {
            this.fabricCanvas.remove(active);
            this.fabricCanvas.discardActiveObject?.();
        }

        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
    }

    protected undo(): void {
        if (!this.fabricCanvas || this.undoStack.length <= 1) {
            return;
        }

        const current = this.undoStack.pop();
        if (current) {
            this.redoStack.push(current);
        }
        const previous = this.undoStack[this.undoStack.length - 1];
        if (!previous) {
            return;
        }

        this.restoreFromJson(previous);
    }

    protected redo(): void {
        if (!this.fabricCanvas || !this.redoStack.length) {
            return;
        }

        const next = this.redoStack.pop();
        if (!next) {
            return;
        }

        this.undoStack.push(next);
        this.restoreFromJson(next);
    }

    protected restoreFromJson(json: string): void {
        if (!this.fabricCanvas) {
            return;
        }

        this.isRestoringHistory = true;
        this.fabricCanvas.loadFromJSON(json, () => {
            if (!this.fabricCanvas) {
                return;
            }
            this.fabricCanvas.renderAll();
            if (!this.getBaseImageObject()) {
                this.ensureBaseImageObject();
            }
            void this.refreshBaseImageSource();
            this.isRestoringHistory = false;
            this.update();
        });
    }

    protected getActiveImageObject(): any | null {
        if (!this.fabricCanvas) {
            return null;
        }
        const obj = this.fabricCanvas.getActiveObject?.();
        if (obj && obj.type === 'image') {
            return obj;
        }
        return this.getBaseImageObject();
    }

    protected applyImageFilters(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const img = this.getActiveImageObject();
        if (!img) {
            return;
        }

        const filters: any[] = [];
        const F: any = (fabric as any).Image?.filters ?? (fabric as any).ImageFilters;

        if (F?.Brightness && this.imageBrightness !== 0) {
            filters.push(new F.Brightness({ brightness: this.clamp(this.imageBrightness, -1, 1) }));
        }
        if (F?.Contrast && this.imageContrast !== 0) {
            filters.push(new F.Contrast({ contrast: this.clamp(this.imageContrast, -1, 1) }));
        }
        if (F?.Saturation && this.imageSaturation !== 0) {
            filters.push(new F.Saturation({ saturation: this.clamp(this.imageSaturation, -1, 1) }));
        }
        if (F?.HueRotation && this.imageHueRotationDeg !== 0) {
            const rad = (this.imageHueRotationDeg * Math.PI) / 180;
            filters.push(new F.HueRotation({ rotation: rad }));
        }
        if (F?.Blur && this.imageBlur !== 0) {
            filters.push(new F.Blur({ blur: this.clamp(this.imageBlur, 0, 1) }));
        }
        if (F?.Grayscale && this.imageGrayscale) {
            filters.push(new F.Grayscale());
        }
        if (F?.Sepia && this.imageSepia) {
            filters.push(new F.Sepia());
        }
        if (F?.Invert && this.imageInvert) {
            filters.push(new F.Invert());
        }

        img.filters = filters;

        const afterApply = () => {
            this.fabricCanvas?.requestRenderAll?.();
            this.recordHistorySnapshot();
        };

        if (typeof img.applyFilters !== 'function') {
            afterApply();
            return;
        }

        let applied = false;

        try {
            img.applyFilters();
            applied = true;
        } catch {
            // Ignore; we'll try other call signatures below.
        }

        if (!applied) {
            try {
                img.applyFilters(filters);
                applied = true;
            } catch {
                // Ignore; we'll log once below.
            }
        }

        if (applied) {
            afterApply();
            return;
        }

        try {
            // Last resort: some Fabric builds accept (filters, callback).
            img.applyFilters(filters, afterApply);
            return;
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] applyImageFilters error', e);
            this.fabricCanvas?.requestRenderAll?.();
        }
    }

    protected resetImageEdits(): void {
        this.imageBrightness = 0;
        this.imageContrast = 0;
        this.imageSaturation = 0;
        this.imageHueRotationDeg = 0;
        this.imageBlur = 0;
        this.imageGrayscale = false;
        this.imageSepia = false;
        this.imageInvert = false;
        this.imageZoom = 1;

        const img = this.getActiveImageObject();
        if (img) {
            img.set({ angle: 0, flipX: false, flipY: false });
            img.scale(this.imageBaseScale);
            img.set({ left: 0, top: 0 });
            img.setCoords?.();
        }
        this.imageScale = 1;
        this.applyImageFilters();
        this.applyZoom();
        this.update();
    }

    protected applyZoom(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const z = this.clamp(this.imageZoom, 0.1, 6);
        this.imageZoom = z;
        this.fabricCanvas.setViewportTransform([z, 0, 0, z, 0, 0]);
        this.fabricCanvas.requestRenderAll?.();
    }

    protected applyImageScale(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const base = this.getBaseImageObject();
        if (!base) {
            return;
        }
        const scale = this.imageBaseScale * this.clamp(this.imageScale, 0.1, 10);
        base.scale(scale);
        base.set({ left: 0, top: 0 });
        base.setCoords?.();
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.update();
    }

    protected resizeCanvas(width: number, height: number): void {
        if (!this.fabricCanvas) {
            return;
        }
        const w = Math.max(100, Math.floor(width));
        const h = Math.max(100, Math.floor(height));
        this.fabricCanvas.setWidth(w);
        this.fabricCanvas.setHeight(h);
        this.imageCanvasWidth = w;
        this.imageCanvasHeight = h;

        const base = this.getBaseImageObject();
        if (base) {
            const scaleX = w / (base.width || 1);
            const scaleY = h / (base.height || 1);
            const scale = Math.min(scaleX, scaleY);
            this.imageBaseScale = scale;
            base.scale(this.imageBaseScale * this.imageScale);
            base.set({ left: 0, top: 0 });
        }
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.update();
    }

    protected rotateImage(deg: number): void {
        this.rotateCanvasContent(deg);
    }

    protected flipImage(axis: 'x' | 'y'): void {
        const img = this.getActiveImageObject();
        if (!this.fabricCanvas || !img) {
            return;
        }
        const center = typeof img.getCenterPoint === 'function'
            ? img.getCenterPoint()
            : {
                x: (img.left ?? 0) + (typeof img.getScaledWidth === 'function' ? img.getScaledWidth() / 2 : 0),
                y: (img.top ?? 0) + (typeof img.getScaledHeight === 'function' ? img.getScaledHeight() / 2 : 0),
            };
        if (axis === 'x') {
            img.set({ flipX: !img.flipX });
        } else {
            img.set({ flipY: !img.flipY });
        }
        if (typeof img.setPositionByOrigin === 'function') {
            img.setPositionByOrigin(center, 'center', 'center');
        } else if (typeof img.getCenterPoint === 'function') {
            const nextCenter = img.getCenterPoint();
            const dx = center.x - nextCenter.x;
            const dy = center.y - nextCenter.y;
            img.set({ left: (img.left ?? 0) + dx, top: (img.top ?? 0) + dy });
        }
        img.setCoords?.();
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.update();
    }

    protected rotateCanvasContent(deg: number): void {
        if (!this.fabricCanvas) {
            return;
        }
        const base = this.getBaseImageObject();
        if (!base) {
            return;
        }

        const rad = (deg * Math.PI) / 180;
        const pivot = typeof base.getCenterPoint === 'function'
            ? base.getCenterPoint()
            : {
                x: (base.left ?? 0) + (typeof base.getScaledWidth === 'function' ? base.getScaledWidth() / 2 : 0),
                y: (base.top ?? 0) + (typeof base.getScaledHeight === 'function' ? base.getScaledHeight() / 2 : 0),
            };

        this.fabricCanvas.discardActiveObject?.();

        const objects = this.fabricCanvas.getObjects?.() ?? [];
        for (const obj of objects) {
            if (!obj) {
                continue;
            }

            const center = typeof obj.getCenterPoint === 'function'
                ? obj.getCenterPoint()
                : {
                    x: (obj.left ?? 0) + (typeof obj.getScaledWidth === 'function' ? obj.getScaledWidth() / 2 : 0),
                    y: (obj.top ?? 0) + (typeof obj.getScaledHeight === 'function' ? obj.getScaledHeight() / 2 : 0),
                };

            const dx = center.x - pivot.x;
            const dy = center.y - pivot.y;
            const nx = pivot.x + (dx * Math.cos(rad) - dy * Math.sin(rad));
            const ny = pivot.y + (dx * Math.sin(rad) + dy * Math.cos(rad));

            const currentAngle = (obj.angle ?? 0) as number;
            obj.set({ angle: currentAngle + deg });

            if (typeof obj.setPositionByOrigin === 'function') {
                obj.setPositionByOrigin({ x: nx, y: ny }, 'center', 'center');
            } else {
                obj.set({ left: nx, top: ny, originX: 'center', originY: 'center' });
            }
            obj.setCoords?.();
        }

        this.fabricCanvas.sendToBack(base);
        this.normalizeCanvasToBaseImageBounds();
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.update();
    }

    protected normalizeCanvasToBaseImageBounds(): void {
        if (!this.fabricCanvas) {
            return;
        }

        const base = this.getBaseImageObject();
        if (!base || typeof base.getBoundingRect !== 'function') {
            return;
        }

        const objects = this.fabricCanvas.getObjects?.() ?? [];
        if (!objects.length) {
            return;
        }

        const previousVpt = Array.isArray(this.fabricCanvas.viewportTransform)
            ? [...this.fabricCanvas.viewportTransform]
            : null;

        if (previousVpt) {
            this.fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        }

        const baseRect = base.getBoundingRect(true, true);
        if (![baseRect.left, baseRect.top, baseRect.width, baseRect.height].every(v => Number.isFinite(v))) {
            if (previousVpt) {
                this.fabricCanvas.setViewportTransform(previousVpt);
            }
            return;
        }

        const shiftX = -baseRect.left;
        const shiftY = -baseRect.top;

        for (const obj of objects) {
            if (!obj) {
                continue;
            }
            obj.set({ left: (obj.left ?? 0) + shiftX, top: (obj.top ?? 0) + shiftY });
            obj.setCoords?.();
        }

        const nextW = Math.max(100, Math.ceil(baseRect.width));
        const nextH = Math.max(100, Math.ceil(baseRect.height));
        this.fabricCanvas.setWidth(nextW);
        this.fabricCanvas.setHeight(nextH);
        this.imageCanvasWidth = nextW;
        this.imageCanvasHeight = nextH;

        if (previousVpt) {
            this.fabricCanvas.setViewportTransform(previousVpt);
        }
    }

    protected async save(): Promise<void> {
        if (!this.fabricCanvas || !this.imageId || !this.geocacheId || !this.image) {
            return;
        }
        if (this.isSaving) {
            return;
        }

        this.isSaving = true;
        this.update();

        try {
            const editorStateJson = JSON.stringify(this.fabricCanvas.toJSON());
            const dataUrl = this.fabricCanvas.toDataURL({ format: 'png' });
            const renderedBlob = await fetch(dataUrl).then(r => r.blob());

            const form = new FormData();
            form.append('rendered_file', renderedBlob, 'edited.png');
            form.append('editor_state_json', editorStateJson);
            form.append('mime_type', 'image/png');
            if (this.image.title) {
                form.append('title', this.image.title);
            }

            const isDerived = Boolean(this.image.parent_image_id);
            const initialEndpoint = `${this.backendBaseUrl}/api/geocache-images/${this.imageId}/edits`;
            const initialMethod = isDerived ? 'PUT' : 'POST';

            let res = await fetch(initialEndpoint, {
                method: initialMethod,
                credentials: 'include',
                body: form,
            });

            if (res.status === 409 && initialMethod === 'POST') {
                const conflictPayload = await res.json().catch(() => null);
                let existingId = conflictPayload?.existing_image_id;
                if (typeof existingId !== 'number') {
                    const listRes = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/images`, {
                        method: 'GET',
                        credentials: 'include',
                    });
                    if (listRes.ok) {
                        const images = (await listRes.json()) as GeocacheImageV2Dto[];
                        const match = images.find(i => i.parent_image_id === this.imageId && i.derivation_type === 'edited');
                        if (match) {
                            existingId = match.id;
                        }
                    }
                }

                if (typeof existingId === 'number') {
                    res = await fetch(`${this.backendBaseUrl}/api/geocache-images/${existingId}/edits`, {
                        method: 'PUT',
                        credentials: 'include',
                        body: form,
                    });
                }
            }

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;

            this.image = updated;
            this.imageId = updated.id;
            this.geocacheId = updated.geocache_id;
            this.didApplyRemoteEditorState = true;

            const label = (updated.title || '').trim()
                ? `Image Editor - ${(updated.title || '').trim()}`
                : `Image Editor - #${updated.id}`;
            this.title.label = label;
            await this.refreshBaseImageSource();

            window.dispatchEvent(new CustomEvent('geoapp-geocache-images-updated', {
                detail: { geocacheId: updated.geocache_id }
            }));
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] save error', e);
            this.error = 'Impossible de sauvegarder l\'image';
        } finally {
            this.isSaving = false;
            this.update();
        }
    }

    protected renderBadges(img: GeocacheImageV2Dto): React.ReactNode {
        const badges: { label: string; className: string }[] = [];
        if (img.stored) {
            badges.push({ label: 'LOCAL', className: 'bg-emerald-600/30 text-emerald-200 border-emerald-700/60' });
        }
        if (img.parent_image_id) {
            badges.push({ label: 'DERIVED', className: 'bg-slate-600/30 text-slate-200 border-slate-700/60' });
        }
        if (!badges.length) {
            return null;
        }
        return (
            <div className='flex flex-wrap gap-1'>
                {badges.map(b => (
                    <span key={b.label} className={`text-[10px] px-1.5 py-0.5 rounded border ${b.className}`}>
                        {b.label}
                    </span>
                ))}
            </div>
        );
    }

    protected override render(): React.ReactNode {
        if (!this.geocacheId || !this.imageId) {
            return <div className='p-3 opacity-70'>Aucune image sélectionnée.</div>;
        }

        if (this.isLoading) {
            return <div className='p-3 opacity-70'>Chargement…</div>;
        }

        if (this.error) {
            return <div className='p-3 text-[var(--theia-errorForeground)]'>{this.error}</div>;
        }

        if (!this.image) {
            return <div className='p-3 opacity-70'>Aucune donnée.</div>;
        }

        const img = this.image;

        const canUndo = this.undoStack.length > 1;
        const canRedo = this.redoStack.length > 0;

        const activeText = this.getActiveTextObject();
        const showTextControls = this.tool === 'text' || Boolean(activeText);
        const showDrawControls = this.tool === 'draw';
        const showSelectControls = this.tool === 'select' && this.selectionCount > 0;
        const showImageControls = this.tool === 'image';
        const activeAny = this.fabricCanvas?.getActiveObject?.();
        const canGroup = Boolean(activeAny && activeAny.type === 'activeSelection');
        const canUngroup = Boolean(activeAny && activeAny.type === 'group');

        const baseImage = this.getBaseImageObject();
        const canEditImage = Boolean(baseImage);

        return (
            <div className='p-3 grid gap-3'>
                <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                        <div className='font-semibold truncate'>Image #{img.id}</div>
                        <div className='text-xs opacity-70 truncate'>{img.source_url}</div>
                    </div>
                    {this.renderBadges(img)}
                </div>

                <div className='flex flex-wrap items-center gap-2'>
                    <button
                        type='button'
                        className={`theia-button secondary ${this.tool === 'select' ? 'border border-sky-500' : ''}`}
                        onClick={() => this.applyTool('select')}
                    >
                        Sélection
                    </button>

                    {showSelectControls ? (
                        <div className='flex flex-wrap items-center gap-2 ml-2'>
                            <span className='text-xs opacity-70'>
                                {this.selectionCount} sélectionné(s)
                            </span>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => { void this.duplicateSelection(); }}
                            >
                                Dupliquer
                            </button>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.deleteSelection()}
                            >
                                Supprimer
                            </button>

                            <button
                                type='button'
                                className={`theia-button secondary ${this.selectionLocked ? 'border border-sky-500' : ''}`}
                                onClick={() => this.toggleSelectionLock()}
                            >
                                {this.selectionLocked ? 'Déverrouiller' : 'Verrouiller'}
                            </button>

                            <label className='text-xs opacity-70'>
                                Opacité
                                <input
                                    type='number'
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={this.selectionOpacity}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.setSelectionOpacity(next);
                                        }
                                    }}
                                />
                            </label>

                            <button type='button' className='theia-button secondary' onClick={() => this.bringToFront()}>
                                Avant
                            </button>
                            <button type='button' className='theia-button secondary' onClick={() => this.bringForward()}>
                                Monter
                            </button>
                            <button type='button' className='theia-button secondary' onClick={() => this.sendBackwards()}>
                                Descendre
                            </button>
                            <button type='button' className='theia-button secondary' onClick={() => this.sendToBack()}>
                                Arrière
                            </button>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.groupSelection()}
                                disabled={!canGroup}
                            >
                                Grouper
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.ungroupSelection()}
                                disabled={!canUngroup}
                            >
                                Dégrouper
                            </button>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.alignSelection('left')}
                                disabled={!canGroup}
                            >
                                Aligner gauche
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.alignSelection('center')}
                                disabled={!canGroup}
                            >
                                Centrer H
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.alignSelection('right')}
                                disabled={!canGroup}
                            >
                                Aligner droite
                            </button>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.alignSelection('top')}
                                disabled={!canGroup}
                            >
                                Aligner haut
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.alignSelection('middle')}
                                disabled={!canGroup}
                            >
                                Centrer V
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.alignSelection('bottom')}
                                disabled={!canGroup}
                            >
                                Aligner bas
                            </button>
                        </div>
                    ) : null}
                    <button
                        type='button'
                        className={`theia-button secondary ${this.tool === 'draw' ? 'border border-sky-500' : ''}`}
                        onClick={() => this.applyTool('draw')}
                    >
                        Dessin
                    </button>

                    <button
                        type='button'
                        className={`theia-button secondary ${this.tool === 'image' ? 'border border-sky-500' : ''}`}
                        onClick={() => {
                            this.applyTool('image');
                            this.ensureBaseImageObject();
                        }}
                        disabled={!canEditImage && !this.image}
                    >
                        Image
                    </button>

                    {showImageControls ? (
                        <div className='flex flex-wrap items-center gap-2 ml-2'>
                            <span className='text-xs opacity-70'>Ajustements image</span>

                            <label className='text-xs opacity-70'>
                                Zoom
                                <input
                                    type='number'
                                    min={0.1}
                                    max={6}
                                    step={0.1}
                                    value={this.imageZoom}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageZoom = this.clamp(next, 0.1, 6);
                                            this.applyZoom();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => {
                                    this.imageZoom = 1;
                                    this.applyZoom();
                                    this.update();
                                }}
                            >
                                100%
                            </button>

                            <label className='text-xs opacity-70'>
                                Échelle image
                                <input
                                    type='number'
                                    min={0.1}
                                    max={10}
                                    step={0.1}
                                    value={this.imageScale}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageScale = this.clamp(next, 0.1, 10);
                                            this.applyImageScale();
                                        }
                                    }}
                                />
                            </label>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.rotateImage(-90)}
                            >
                                ↺ 90°
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.rotateImage(90)}
                            >
                                ↻ 90°
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.flipImage('x')}
                            >
                                Flip X
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.flipImage('y')}
                            >
                                Flip Y
                            </button>

                            <label className='text-xs opacity-70'>
                                Canvas W
                                <input
                                    type='number'
                                    min={100}
                                    max={8000}
                                    value={this.imageCanvasWidth || (this.fabricCanvas?.getWidth?.() ?? 0)}
                                    className='ml-2 w-24 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next) && next > 0) {
                                            this.imageCanvasWidth = Math.floor(next);
                                            this.update();
                                        }
                                    }}
                                />
                            </label>
                            <label className='text-xs opacity-70'>
                                H
                                <input
                                    type='number'
                                    min={100}
                                    max={8000}
                                    value={this.imageCanvasHeight || (this.fabricCanvas?.getHeight?.() ?? 0)}
                                    className='ml-2 w-24 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next) && next > 0) {
                                            this.imageCanvasHeight = Math.floor(next);
                                            this.update();
                                        }
                                    }}
                                />
                            </label>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.resizeCanvas(this.imageCanvasWidth, this.imageCanvasHeight)}
                            >
                                Appliquer taille
                            </button>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.resetImageEdits()}
                            >
                                Reset image
                            </button>

                            <div className='w-full' />

                            <label className='text-xs opacity-70'>
                                Luminosité
                                <input
                                    type='number'
                                    min={-1}
                                    max={1}
                                    step={0.05}
                                    value={this.imageBrightness}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageBrightness = this.clamp(next, -1, 1);
                                            this.applyImageFilters();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Contraste
                                <input
                                    type='number'
                                    min={-1}
                                    max={1}
                                    step={0.05}
                                    value={this.imageContrast}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageContrast = this.clamp(next, -1, 1);
                                            this.applyImageFilters();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Saturation
                                <input
                                    type='number'
                                    min={-1}
                                    max={1}
                                    step={0.05}
                                    value={this.imageSaturation}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageSaturation = this.clamp(next, -1, 1);
                                            this.applyImageFilters();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Hue (°)
                                <input
                                    type='number'
                                    min={-180}
                                    max={180}
                                    step={1}
                                    value={this.imageHueRotationDeg}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageHueRotationDeg = this.clamp(next, -180, 180);
                                            this.applyImageFilters();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Flou
                                <input
                                    type='number'
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={this.imageBlur}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageBlur = this.clamp(next, 0, 1);
                                            this.applyImageFilters();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70 flex items-center gap-2'>
                                N&B
                                <input
                                    type='checkbox'
                                    checked={this.imageGrayscale}
                                    onChange={e => {
                                        this.imageGrayscale = e.target.checked;
                                        this.applyImageFilters();
                                        this.update();
                                    }}
                                />
                            </label>
                            <label className='text-xs opacity-70 flex items-center gap-2'>
                                Sépia
                                <input
                                    type='checkbox'
                                    checked={this.imageSepia}
                                    onChange={e => {
                                        this.imageSepia = e.target.checked;
                                        this.applyImageFilters();
                                        this.update();
                                    }}
                                />
                            </label>
                            <label className='text-xs opacity-70 flex items-center gap-2'>
                                Inverser
                                <input
                                    type='checkbox'
                                    checked={this.imageInvert}
                                    onChange={e => {
                                        this.imageInvert = e.target.checked;
                                        this.applyImageFilters();
                                        this.update();
                                    }}
                                />
                            </label>
                        </div>
                    ) : null}

                    {showDrawControls ? (
                        <div className='flex flex-wrap items-center gap-2 ml-2'>
                            <label className='text-xs opacity-70'>
                                Mode
                                <select
                                    className='ml-2 theia-input'
                                    value={this.drawBrushType}
                                    onChange={e => {
                                        this.drawBrushType = e.target.value as any;
                                        this.applyDrawOptions();
                                        this.update();
                                    }}
                                >
                                    <option value='pen'>Pinceau</option>
                                    <option value='highlighter'>Surligneur</option>
                                    <option value='eraser'>Gomme</option>
                                </select>
                            </label>

                            <label className='text-xs opacity-70'>
                                Taille
                                <input
                                    type='number'
                                    min={1}
                                    max={200}
                                    value={this.drawBrushSize}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next) && next > 0) {
                                            this.drawBrushSize = this.clamp(next, 1, 200);
                                            this.applyDrawOptions();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70 flex items-center gap-2'>
                                Couleur
                                <input
                                    type='color'
                                    value={this.drawColor}
                                    className='h-7 w-10 bg-transparent'
                                    disabled={this.drawBrushType === 'eraser'}
                                    onChange={e => {
                                        this.drawColor = e.target.value;
                                        this.applyDrawOptions();
                                        this.update();
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Opacité
                                <input
                                    type='number'
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={this.drawOpacity}
                                    disabled={this.drawBrushType === 'eraser'}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.drawOpacity = this.clamp(next, 0, 1);
                                            this.applyDrawOptions();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Cap
                                <select
                                    className='ml-2 theia-input'
                                    value={this.drawLineCap}
                                    onChange={e => {
                                        this.drawLineCap = e.target.value as any;
                                        this.applyDrawOptions();
                                        this.update();
                                    }}
                                >
                                    <option value='round'>Round</option>
                                    <option value='butt'>Butt</option>
                                    <option value='square'>Square</option>
                                </select>
                            </label>

                            <label className='text-xs opacity-70'>
                                Join
                                <select
                                    className='ml-2 theia-input'
                                    value={this.drawLineJoin}
                                    onChange={e => {
                                        this.drawLineJoin = e.target.value as any;
                                        this.applyDrawOptions();
                                        this.update();
                                    }}
                                >
                                    <option value='round'>Round</option>
                                    <option value='bevel'>Bevel</option>
                                    <option value='miter'>Miter</option>
                                </select>
                            </label>

                            <label className='text-xs opacity-70'>
                                Lissage
                                <input
                                    type='number'
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={this.drawDecimate}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.drawDecimate = this.clamp(next, 0, 1);
                                            this.applyDrawOptions();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.deleteSelection()}
                            >
                                Supprimer sélection
                            </button>
                        </div>
                    ) : null}
                    <button
                        type='button'
                        className={`theia-button secondary ${this.tool === 'text' ? 'border border-sky-500' : ''}`}
                        onClick={() => {
                            this.applyTool('text');
                            this.addText();
                        }}
                    >
                        Texte
                    </button>

                    {showTextControls ? (
                        <div className='flex flex-wrap items-center gap-2 ml-2'>
                            <label className='text-xs opacity-70'>
                                Taille
                                <input
                                    type='number'
                                    min={8}
                                    max={200}
                                    value={this.textFontSize}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next) && next > 0) {
                                            this.textFontSize = next;
                                            this.applyTextOptionsToSelection();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70 flex items-center gap-2'>
                                Couleur
                                <input
                                    type='color'
                                    value={this.textFill}
                                    className='h-7 w-10 bg-transparent'
                                    onChange={e => {
                                        this.textFill = e.target.value;
                                        this.applyTextOptionsToSelection();
                                        this.update();
                                    }}
                                />
                            </label>

                            <button
                                type='button'
                                className={`theia-button secondary ${this.textBold ? 'border border-sky-500' : ''}`}
                                onClick={() => {
                                    this.textBold = !this.textBold;
                                    this.applyTextOptionsToSelection();
                                    this.update();
                                }}
                            >
                                Gras
                            </button>

                            <button
                                type='button'
                                className={`theia-button secondary ${this.textItalic ? 'border border-sky-500' : ''}`}
                                onClick={() => {
                                    this.textItalic = !this.textItalic;
                                    this.applyTextOptionsToSelection();
                                    this.update();
                                }}
                            >
                                Italique
                            </button>

                            <label className='text-xs opacity-70 flex items-center gap-2 ml-2'>
                                Fond
                                <input
                                    type='checkbox'
                                    checked={this.textBackgroundEnabled}
                                    onChange={e => {
                                        this.textBackgroundEnabled = e.target.checked;
                                        this.applyTextOptionsToSelection();
                                        this.update();
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70 flex items-center gap-2'>
                                Couleur fond
                                <input
                                    type='color'
                                    value={this.textBackgroundFill}
                                    className='h-7 w-10 bg-transparent'
                                    disabled={!this.textBackgroundEnabled}
                                    onChange={e => {
                                        this.textBackgroundFill = e.target.value;
                                        this.applyTextOptionsToSelection();
                                        this.update();
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Opacité
                                <input
                                    type='number'
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={this.textBackgroundOpacity}
                                    disabled={!this.textBackgroundEnabled}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.textBackgroundOpacity = this.clamp(next, 0, 1);
                                            this.applyTextOptionsToSelection();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>
                        </div>
                    ) : null}

                    <div className='flex-1' />

                    <button
                        type='button'
                        className='theia-button'
                        onClick={() => { void this.save(); }}
                        disabled={this.isSaving}
                    >
                        {this.isSaving ? 'Sauvegarde…' : 'Enregistrer'}
                    </button>

                    <button
                        type='button'
                        className='theia-button secondary'
                        onClick={() => this.undo()}
                        disabled={!canUndo}
                    >
                        Undo
                    </button>
                    <button
                        type='button'
                        className='theia-button secondary'
                        onClick={() => this.redo()}
                        disabled={!canRedo}
                    >
                        Redo
                    </button>
                </div>

                <div className='rounded border border-[var(--theia-panel-border)] bg-[var(--theia-editor-background)] p-2'>
                    <canvas className='w-full rounded bg-black/20' ref={this.setCanvasRef} />
                </div>

                <div className='text-xs opacity-70'>
                    {img.title ? <div>Titre: {img.title}</div> : null}
                    {img.note ? <div>Note: {img.note}</div> : null}
                </div>
            </div>
        );
    }
}
