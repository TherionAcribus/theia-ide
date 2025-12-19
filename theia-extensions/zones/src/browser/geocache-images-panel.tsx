/**
 * UI panel for browsing geocache images and editing their metadata (OCR/QR/notes).
 */

import * as React from 'react';

export type GeocacheImageV2Dto = {
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

export interface GeocacheImagesPanelProps {
    backendBaseUrl: string;
    geocacheId: number;
    storageDefaultMode?: 'never' | 'prompt' | 'always';
    onConfirmStoreAll?: (options: { geocacheId: number; pendingCount: number }) => Promise<boolean>;
}

export const GeocacheImagesPanel: React.FC<GeocacheImagesPanelProps> = ({
    backendBaseUrl,
    geocacheId,
    storageDefaultMode = 'prompt',
    onConfirmStoreAll,
}) => {
    const [images, setImages] = React.useState<GeocacheImageV2Dto[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [selectedId, setSelectedId] = React.useState<number | null>(null);
    const [isSaving, setIsSaving] = React.useState(false);

    const didApplyDefaultStorageRef = React.useRef<Record<number, boolean>>({});

    const selected = React.useMemo(() => images.find(i => i.id === selectedId) ?? null, [images, selectedId]);

    const [draftTitle, setDraftTitle] = React.useState('');
    const [draftNote, setDraftNote] = React.useState('');
    const [draftQr, setDraftQr] = React.useState('');
    const [draftOcr, setDraftOcr] = React.useState('');

    const resolveImageUrl = React.useCallback((url: string) => {
        if (!url) {
            return url;
        }
        if (url.startsWith('/')) {
            return `${backendBaseUrl}${url}`;
        }
        return url;
    }, [backendBaseUrl]);

    const loadImages = React.useCallback(async () => {
        if (!geocacheId) {
            return;
        }
        setIsLoading(true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/images`, { credentials: 'include' });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = (await res.json()) as GeocacheImageV2Dto[];
            setImages(Array.isArray(data) ? data : []);
            if (data?.length) {
                setSelectedId(prev => (prev && data.some(x => x.id === prev) ? prev : data[0].id));
            } else {
                setSelectedId(null);
            }
        } catch (e) {
            console.error('[GeocacheImagesPanel] load images error', e);
            setImages([]);
            setSelectedId(null);
        } finally {
            setIsLoading(false);
        }
    }, [backendBaseUrl, geocacheId]);

    React.useEffect(() => {
        void loadImages();
    }, [loadImages]);

    React.useEffect(() => {
        if (!selected) {
            setDraftTitle('');
            setDraftNote('');
            setDraftQr('');
            setDraftOcr('');
            return;
        }
        setDraftTitle(selected.title ?? '');
        setDraftNote(selected.note ?? '');
        setDraftQr(selected.qr_payload ?? '');
        setDraftOcr(selected.ocr_text ?? '');
    }, [selectedId]);

    const saveMetadata = async () => {
        if (!selected) {
            return;
        }
        setIsSaving(true);
        try {
            const payload = {
                title: draftTitle,
                note: draftNote,
                qr_payload: draftQr,
                ocr_text: draftOcr
            };
            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${selected.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;
            setImages(prev => prev.map(i => (i.id === updated.id ? updated : i)));
        } catch (e) {
            console.error('[GeocacheImagesPanel] save metadata error', e);
        } finally {
            setIsSaving(false);
        }
    };

    const storeSelected = async () => {
        if (!selected) {
            return;
        }
        setIsSaving(true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${selected.id}/store`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;
            setImages(prev => prev.map(i => (i.id === updated.id ? updated : i)));
        } catch (e) {
            console.error('[GeocacheImagesPanel] store image error', e);
        } finally {
            setIsSaving(false);
        }
    };

    const storeAll = async () => {
        setIsSaving(true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/images/store`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            await loadImages();
        } catch (e) {
            console.error('[GeocacheImagesPanel] store all images error', e);
        } finally {
            setIsSaving(false);
        }
    };

    const applyDefaultStorageMode = React.useCallback(async () => {
        if (!geocacheId) {
            return;
        }

        if (didApplyDefaultStorageRef.current[geocacheId]) {
            return;
        }

        if (!images.length) {
            return;
        }

        const pendingCount = images.filter(i => !i.stored).length;
        if (pendingCount <= 0) {
            didApplyDefaultStorageRef.current[geocacheId] = true;
            return;
        }

        if (storageDefaultMode === 'never') {
            didApplyDefaultStorageRef.current[geocacheId] = true;
            return;
        }

        if (storageDefaultMode === 'always') {
            didApplyDefaultStorageRef.current[geocacheId] = true;
            await storeAll();
            return;
        }

        // prompt
        didApplyDefaultStorageRef.current[geocacheId] = true;

        if (!onConfirmStoreAll) {
            return;
        }

        try {
            const shouldStore = await onConfirmStoreAll({ geocacheId, pendingCount });
            if (shouldStore) {
                await storeAll();
            }
        } catch (e) {
            console.error('[GeocacheImagesPanel] confirm store all error', e);
        }
    }, [geocacheId, images, onConfirmStoreAll, storageDefaultMode]);

    React.useEffect(() => {
        if (isLoading || isSaving) {
            return;
        }
        void applyDefaultStorageMode();
    }, [applyDefaultStorageMode, isLoading, isSaving]);

    const renderBadges = (img: GeocacheImageV2Dto) => {
        const hasNote = Boolean((img.note || '').trim());
        const hasQr = Boolean((img.qr_payload || '').trim());
        const hasOcr = Boolean((img.ocr_text || '').trim());
        const isDerived = Boolean(img.parent_image_id);

        const badges: { label: string; className: string }[] = [];
        if (img.stored) {
            badges.push({ label: 'LOCAL', className: 'bg-emerald-600/30 text-emerald-200 border-emerald-700/60' });
        }
        if (hasNote) {
            badges.push({ label: 'NOTE', className: 'bg-sky-600/30 text-sky-200 border-sky-700/60' });
        }
        if (hasQr) {
            badges.push({ label: 'QR', className: 'bg-purple-600/30 text-purple-200 border-purple-700/60' });
        }
        if (hasOcr) {
            badges.push({ label: 'OCR', className: 'bg-amber-600/30 text-amber-200 border-amber-700/60' });
        }
        if (isDerived) {
            badges.push({ label: 'DERIVED', className: 'bg-slate-600/30 text-slate-200 border-slate-700/60' });
        }

        if (!badges.length) {
            return null;
        }

        return (
            <div className='mt-1 flex flex-wrap gap-1'>
                {badges.map(b => (
                    <span key={b.label} className={`text-[10px] px-1.5 py-0.5 rounded border ${b.className}`}>
                        {b.label}
                    </span>
                ))}
            </div>
        );
    };

    if (isLoading) {
        return <div className='opacity-70'>Chargement des images…</div>;
    }

    if (!images.length) {
        return <div className='opacity-70 italic'>Aucune image</div>;
    }

    return (
        <div className='grid gap-3'>
            <div className='flex items-center justify-between'>
                <div className='font-semibold'>Images</div>
                <button className='theia-button secondary' onClick={storeAll} disabled={isSaving}>
                    Stocker tout
                </button>
            </div>

            <div className='flex gap-3'>
                <div className='w-64 shrink-0'>
                    <div className='flex gap-2 overflow-x-auto pb-2'>
                        {images.map(img => (
                            <button
                                key={img.id}
                                type='button'
                                className={`shrink-0 rounded border ${img.id === selectedId ? 'border-sky-500' : 'border-[var(--theia-panel-border)]'} p-1`}
                                onClick={() => setSelectedId(img.id)}
                                title={img.source_url}
                            >
                                <img className='h-16 w-24 rounded object-cover' src={resolveImageUrl(img.url)} alt='' />
                                {renderBadges(img)}
                            </button>
                        ))}
                    </div>
                </div>

                <div className='min-w-0 flex-1'>
                    {selected && (
                        <div className='grid gap-3 rounded border border-[var(--theia-panel-border)] bg-[var(--theia-editor-background)] p-3'>
                            <div className='flex items-start justify-between gap-3'>
                                <div className='min-w-0'>
                                    <div className='truncate font-semibold'>Image #{selected.id}</div>
                                    <div className='truncate text-xs opacity-70'>{selected.source_url}</div>
                                </div>
                                <div className='flex gap-2'>
                                    {!selected.stored && (
                                        <button className='theia-button secondary' onClick={storeSelected} disabled={isSaving}>
                                            Stocker
                                        </button>
                                    )}
                                    <button className='theia-button' onClick={saveMetadata} disabled={isSaving}>
                                        Sauvegarder
                                    </button>
                                </div>
                            </div>

                            <img className='max-h-72 w-full rounded object-contain bg-black/20' src={resolveImageUrl(selected.url)} alt='' />

                            <div className='grid gap-2'>
                                <div>
                                    <label className='block text-xs opacity-70'>Titre</label>
                                    <input className='theia-input w-full' value={draftTitle} onChange={e => setDraftTitle(e.target.value)} />
                                </div>

                                <div>
                                    <label className='block text-xs opacity-70'>Note</label>
                                    <textarea
                                        className='theia-input w-full resize-y'
                                        rows={4}
                                        value={draftNote}
                                        onChange={e => setDraftNote(e.target.value)}
                                    />
                                </div>

                                <div>
                                    <label className='block text-xs opacity-70'>QR payload</label>
                                    <textarea
                                        className='theia-input w-full resize-y'
                                        rows={3}
                                        value={draftQr}
                                        onChange={e => setDraftQr(e.target.value)}
                                    />
                                </div>

                                <div>
                                    <label className='block text-xs opacity-70'>OCR</label>
                                    <textarea
                                        className='theia-input w-full resize-y'
                                        rows={5}
                                        value={draftOcr}
                                        onChange={e => setDraftOcr(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
