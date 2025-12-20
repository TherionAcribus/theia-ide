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

            const updateHistory = (): void => {
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

            this.fabricCanvas.on('object:added', updateHistory);
            this.fabricCanvas.on('object:modified', updateHistory);
            this.fabricCanvas.on('object:removed', updateHistory);
            this.fabricCanvas.on('path:created', updateHistory);

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

    protected addText(): void {
        if (!this.fabricCanvas) {
            return;
        }

        const text = new fabric.IText('Texte', {
            left: 50,
            top: 50,
            fill: '#ffffff',
            fontSize: 28,
            backgroundColor: 'rgba(0,0,0,0.4)',
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
                        className='theia-button secondary'
                        onClick={() => this.addText()}
                    >
                        Texte
                    </button>

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
