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

    protected tool: 'select' | 'draw' | 'text' = 'select';
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

    constructor() {
        super();
        this.id = GeocacheImageEditorWidget.ID;
        this.title.label = 'Image Editor';
        this.title.caption = 'Éditeur d\'image';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-image';
        this.addClass('theia-geocache-image-editor-widget');
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

    override dispose(): void {
        this.disposeFabric();
        super.dispose();
    }

    protected disposeFabric(): void {
        if (this.fabricCanvas) {
            this.fabricCanvas.dispose();
            this.fabricCanvas = null;
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
                void this.loadRemoteEditorStateIfAny();
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
            this.setBackgroundImageFromCurrentImage();
        }
    }

    protected setBackgroundImageFromCurrentImage(): void {
        if (!this.fabricCanvas || !this.canvasElement || !this.image) {
            return;
        }

        const src = this.resolveImageUrl(this.image.url);
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

                img.set({ selectable: false, evented: false });
                const scaleX = this.fabricCanvas.getWidth() / (img.width || 1);
                const scaleY = this.fabricCanvas.getHeight() / (img.height || 1);
                const scale = Math.min(scaleX, scaleY);
                img.scale(scale);
                this.fabricCanvas.setBackgroundImage(img, this.fabricCanvas.renderAll.bind(this.fabricCanvas));

                if (!this.undoStack.length) {
                    this.undoStack = [JSON.stringify(this.fabricCanvas.toJSON())];
                    this.redoStack = [];
                    this.update();
                }
            },
            { crossOrigin: 'anonymous' }
        );
    }

    protected applyTool(tool: 'select' | 'draw' | 'text'): void {
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
            this.setBackgroundImageFromCurrentImage();
            this.isRestoringHistory = false;
            this.update();
        });
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
            const endpoint = isDerived
                ? `${this.backendBaseUrl}/api/geocache-images/${this.imageId}/edits`
                : `${this.backendBaseUrl}/api/geocache-images/${this.imageId}/edits`;
            const method = isDerived ? 'PUT' : 'POST';

            const res = await fetch(endpoint, {
                method,
                credentials: 'include',
                body: form,
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;

            this.image = updated;
            this.imageId = updated.id;
            this.didApplyRemoteEditorState = false;
            this.undoStack = [];
            this.redoStack = [];
            this.setContext({
                backendBaseUrl: this.backendBaseUrl,
                geocacheId: updated.geocache_id,
                imageId: updated.id,
                imageTitle: (updated.title || '').trim() || undefined,
            });

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
        const activeAny = this.fabricCanvas?.getActiveObject?.();
        const canGroup = Boolean(activeAny && activeAny.type === 'activeSelection');
        const canUngroup = Boolean(activeAny && activeAny.type === 'group');

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
