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
            if (this.fabricCanvas.freeDrawingBrush) {
                this.fabricCanvas.freeDrawingBrush.width = 3;
                this.fabricCanvas.freeDrawingBrush.color = '#ffcc00';
            }
        } else {
            this.fabricCanvas.isDrawingMode = false;
        }

        this.update();
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
                    <button
                        type='button'
                        className={`theia-button secondary ${this.tool === 'draw' ? 'border border-sky-500' : ''}`}
                        onClick={() => this.applyTool('draw')}
                    >
                        Dessin
                    </button>
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
