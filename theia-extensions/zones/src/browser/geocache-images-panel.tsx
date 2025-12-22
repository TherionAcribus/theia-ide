/**
 * UI panel for browsing geocache images and editing their metadata (OCR/QR/notes).
 */

import * as React from 'react';
import { ContextMenu, ContextMenuItem } from './context-menu';

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

export type GalleryThumbnailSize = 'small' | 'medium' | 'large';

type ThumbnailContextMenuState = {
    x: number;
    y: number;
    imageId: number;
};

export interface GeocacheImagesPanelProps {
    backendBaseUrl: string;
    geocacheId: number;
    storageDefaultMode?: 'never' | 'prompt' | 'always';
    onConfirmStoreAll?: (options: { geocacheId: number; pendingCount: number }) => Promise<boolean>;
    thumbnailSize?: GalleryThumbnailSize;
    onThumbnailSizeChange?: (size: GalleryThumbnailSize) => Promise<void> | void;
    hiddenDomains?: string[];
    hiddenDomainsText?: string;
    onHiddenDomainsTextChange?: (value: string) => Promise<void> | void;
}

export const GeocacheImagesPanel: React.FC<GeocacheImagesPanelProps> = ({
    backendBaseUrl,
    geocacheId,
    storageDefaultMode = 'prompt',
    onConfirmStoreAll,
    thumbnailSize = 'small',
    onThumbnailSizeChange,
    hiddenDomains = [],
    hiddenDomainsText,
    onHiddenDomainsTextChange,
}) => {
    const [images, setImages] = React.useState<GeocacheImageV2Dto[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [selectedId, setSelectedId] = React.useState<number | null>(null);
    const [isSaving, setIsSaving] = React.useState(false);

    const [hiddenDomainsDraft, setHiddenDomainsDraft] = React.useState(hiddenDomainsText ?? '');
    const [isSavingHiddenDomains, setIsSavingHiddenDomains] = React.useState(false);

    const [detailsMode, setDetailsMode] = React.useState<'hidden' | 'fields' | 'preview'>('hidden');

    const [contextMenu, setContextMenu] = React.useState<ThumbnailContextMenuState | null>(null);

    const [effectiveThumbnailSize, setEffectiveThumbnailSize] = React.useState<GalleryThumbnailSize>(thumbnailSize);

    const didApplyDefaultStorageRef = React.useRef<Record<number, boolean>>({});

    React.useEffect(() => {
        setEffectiveThumbnailSize(thumbnailSize);
    }, [thumbnailSize]);

    React.useEffect(() => {
        setHiddenDomainsDraft(hiddenDomainsText ?? '');
    }, [hiddenDomainsText]);

    const thumbnailImageClassName = React.useMemo(() => {
        switch (effectiveThumbnailSize) {
            case 'large':
                return 'h-24 w-36 rounded object-cover';
            case 'medium':
                return 'h-16 w-24 rounded object-cover';
            default:
                return 'h-12 w-16 rounded object-cover';
        }
    }, [effectiveThumbnailSize]);

    const thumbnailDimensions = React.useMemo(() => {
        switch (effectiveThumbnailSize) {
            case 'large':
                return { width: 144, height: 96 };
            case 'medium':
                return { width: 96, height: 64 };
            default:
                return { width: 64, height: 48 };
        }
    }, [effectiveThumbnailSize]);

    const sizeButtonClassName = (size: GalleryThumbnailSize): string => {
        const isActive = effectiveThumbnailSize === size;
        return `theia-button secondary ${isActive ? 'border border-sky-500' : ''}`;
    };

    const changeThumbnailSize = (size: GalleryThumbnailSize): void => {
        setEffectiveThumbnailSize(size);
        void Promise.resolve(onThumbnailSizeChange?.(size));
    };

    const normalizeDomainEntry = React.useCallback((entry: string): string | null => {
        const raw = (entry || '').trim();
        if (!raw) {
            return null;
        }

        const normalizeHost = (host: string): string | null => {
            const cleaned = (host || '').trim().toLowerCase().replace(/^www\./, '');
            if (!cleaned) {
                return null;
            }
            if (cleaned.includes('/')) {
                return cleaned.split('/')[0] || null;
            }
            return cleaned;
        };

        try {
            const url = new URL(raw);
            return normalizeHost(url.hostname);
        } catch {
        }

        const withoutProtocol = raw.replace(/^https?:\/\//i, '');
        const base = withoutProtocol.split(/[/?#]/)[0] || '';
        return normalizeHost(base);
    }, []);

    const normalizedHiddenDomains = React.useMemo(() => {
        return (hiddenDomains || [])
            .filter((d): d is string => typeof d === 'string')
            .map(d => normalizeDomainEntry(d))
            .filter((d): d is string => Boolean(d));
    }, [hiddenDomains, normalizeDomainEntry]);

    const isHiddenByDomain = React.useCallback((sourceUrl: string): boolean => {
        const trimmed = (sourceUrl || '').trim();
        if (!trimmed) {
            return false;
        }
        try {
            const host = new URL(trimmed).hostname.toLowerCase().replace(/^www\./, '');
            if (!host) {
                return false;
            }
            return normalizedHiddenDomains.some(domain => host === domain || host.endsWith(`.${domain}`));
        } catch {
            return false;
        }
    }, [normalizedHiddenDomains]);

    const visibleImages = React.useMemo(() => {
        if (!normalizedHiddenDomains.length) {
            return images;
        }
        return images.filter(img => !isHiddenByDomain(img.source_url));
    }, [images, isHiddenByDomain, normalizedHiddenDomains.length]);

    const selected = React.useMemo(() => visibleImages.find(i => i.id === selectedId) ?? null, [visibleImages, selectedId]);

    React.useEffect(() => {
        if (selectedId === null) {
            return;
        }
        const stillVisible = visibleImages.some(img => img.id === selectedId);
        if (!stillVisible) {
            setSelectedId(null);
            setDetailsMode('hidden');
        }
    }, [selectedId, visibleImages]);

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
            setSelectedId(prev => (prev && data.some(x => x.id === prev) ? prev : null));
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
        const handler = (event: Event): void => {
            const custom = event as CustomEvent<{ geocacheId?: number }>;
            const targetGeocacheId = custom.detail?.geocacheId;
            if (targetGeocacheId && targetGeocacheId === geocacheId) {
                void loadImages();
            }
        };
        window.addEventListener('geoapp-geocache-images-updated', handler);
        return () => {
            window.removeEventListener('geoapp-geocache-images-updated', handler);
        };
    }, [geocacheId, loadImages]);

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
    }, [selected]);

    const handleThumbnailClick = (imageId: number): void => {
        if (selectedId !== imageId) {
            setSelectedId(imageId);
            setDetailsMode('fields');
            return;
        }

        if (detailsMode === 'hidden') {
            setDetailsMode('fields');
            return;
        }

        if (detailsMode === 'fields') {
            setDetailsMode('preview');
            return;
        }

        setDetailsMode('fields');
    };

    const openThumbnailContextMenu = (e: React.MouseEvent, imageId: number): void => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            imageId,
        });
    };

    const duplicateImageById = async (imageId: number): Promise<void> => {
        setIsSaving(true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/duplicate`, {
                method: 'POST',
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const created = (await res.json()) as GeocacheImageV2Dto;
            window.dispatchEvent(new CustomEvent('geoapp-geocache-images-updated', {
                detail: { geocacheId }
            }));
            setSelectedId(created.id);
            setDetailsMode('fields');
        } catch (e) {
            console.error('[GeocacheImagesPanel] duplicate image error', e);
        } finally {
            setIsSaving(false);
        }
    };

    const patchImage = async (imageId: number, payload: Partial<GeocacheImageV2Dto>): Promise<GeocacheImageV2Dto | null> => {
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;
            setImages(prev => prev.map(i => (i.id === updated.id ? updated : i)));
            return updated;
        } catch (e) {
            console.error('[GeocacheImagesPanel] patch image error', e);
            return null;
        }
    };

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
            await patchImage(selected.id, payload);
        } catch (e) {
            console.error('[GeocacheImagesPanel] save metadata error', e);
        } finally {
            setIsSaving(false);
        }
    };

    const decodeQrFromImage = async (imageId: number): Promise<void> => {
        const img = visibleImages.find(i => i.id === imageId);
        if (!img) {
            return;
        }

        setIsSaving(true);
        try {
            const imageUrlForPlugin = resolveImageUrl(img.url);
            const res = await fetch(`${backendBaseUrl}/api/plugins/qr_code_detector/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    inputs: {
                        geocache_id: geocacheId,
                        images: [{ url: imageUrlForPlugin }],
                    }
                }),
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const result = await res.json() as any;
            const qrPayload: string | undefined = result?.qr_codes?.[0]?.data;
            if (!qrPayload || !String(qrPayload).trim()) {
                return;
            }

            setSelectedId(imageId);
            setDetailsMode('fields');
            await patchImage(imageId, { qr_payload: String(qrPayload) });
        } catch (e) {
            console.error('[GeocacheImagesPanel] decode qr error', e);
        } finally {
            setIsSaving(false);
        }
    };

    const copyQrPayload = async (imageId: number): Promise<void> => {
        const img = visibleImages.find(i => i.id === imageId);
        const payload = (img?.qr_payload || '').trim();
        if (!payload) {
            return;
        }
        try {
            await navigator.clipboard.writeText(payload);
        } catch (e) {
            console.error('[GeocacheImagesPanel] clipboard write error', e);
        }
    };

    const openImageEditor = (imageId: number): void => {
        const img = visibleImages.find(i => i.id === imageId);
        if (!img) {
            return;
        }

        window.dispatchEvent(new CustomEvent('open-geocache-image-editor', {
            detail: {
                backendBaseUrl,
                geocacheId,
                imageId,
                imageTitle: (img.title || '').trim() || undefined,
            }
        }));
    };

    const guessDownloadFilename = (img: GeocacheImageV2Dto): string => {
        const baseName = `image-${img.id}`;
        const tryExt = (value: string): string | null => {
            try {
                const url = new URL(value);
                const pathname = url.pathname || '';
                const match = pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
                if (match && match[1]) {
                    return `.${match[1].toLowerCase()}`;
                }
            } catch {
            }
            return null;
        };

        const ext = tryExt(img.source_url) || tryExt(img.url) || '.jpg';
        return `${baseName}${ext}`;
    };

    const downloadImageById = async (imageId: number): Promise<void> => {
        const img = visibleImages.find(i => i.id === imageId);
        if (!img) {
            return;
        }

        const downloadUrl = resolveImageUrl(img.url);
        const filename = guessDownloadFilename(img);

        try {
            const res = await fetch(downloadUrl, {
                method: 'GET',
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            try {
                const a = document.createElement('a');
                a.href = objectUrl;
                a.download = filename;
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        } catch (e) {
            console.error('[GeocacheImagesPanel] download image error', e);
            try {
                window.open(downloadUrl, '_blank', 'noopener,noreferrer');
            } catch {
            }
        }
    };

    const storeImageById = async (imageId: number): Promise<void> => {
        setIsSaving(true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/store`, {
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

    const unstoreImageById = async (imageId: number): Promise<void> => {
        setIsSaving(true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/unstore`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;
            setImages(prev => prev.map(i => (i.id === updated.id ? updated : i)));
        } catch (e) {
            console.error('[GeocacheImagesPanel] unstore image error', e);
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

        if (!visibleImages.length) {
            return;
        }

        const pendingCount = visibleImages.filter(i => !i.stored).length;
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
    }, [geocacheId, onConfirmStoreAll, storageDefaultMode, visibleImages]);

    const saveHiddenDomains = async (): Promise<void> => {
        if (!onHiddenDomainsTextChange) {
            return;
        }
        setIsSavingHiddenDomains(true);
        try {
            await Promise.resolve(onHiddenDomainsTextChange(hiddenDomainsDraft));
        } catch (e) {
            console.error('[GeocacheImagesPanel] save hidden domains error', e);
        } finally {
            setIsSavingHiddenDomains(false);
        }
    };

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

    if (!visibleImages.length) {
        return <div className='opacity-70 italic'>Aucune image</div>;
    }

    const selectedImage = selected;
    const showDetails = detailsMode !== 'hidden' && Boolean(selectedImage);
    const showPreview = detailsMode === 'preview' && Boolean(selectedImage);

    const contextMenuItems: ContextMenuItem[] = contextMenu ? [
        {
            label: 'Éditer l\'image…',
            action: () => { openImageEditor(contextMenu.imageId); },
            disabled: isSaving,
        },
        {
            label: 'Dupliquer l\'image',
            action: () => { void duplicateImageById(contextMenu.imageId); },
            disabled: isSaving,
        },
        {
            label: 'Télécharger l\'image',
            action: () => { void downloadImageById(contextMenu.imageId); },
            disabled: isSaving,
        },
        {
            separator: true,
        },
        {
            label: 'Décoder QR (plugin)',
            action: () => { void decodeQrFromImage(contextMenu.imageId); },
            disabled: isSaving,
        },
        {
            separator: true,
        },
        {
            label: 'Stocker localement',
            action: () => { void storeImageById(contextMenu.imageId); },
            disabled: isSaving || Boolean(visibleImages.find(i => i.id === contextMenu.imageId)?.stored),
        },
        {
            label: 'Supprimer stockage local',
            action: () => { void unstoreImageById(contextMenu.imageId); },
            disabled: isSaving || !Boolean(visibleImages.find(i => i.id === contextMenu.imageId)?.stored),
            danger: true,
        },
        {
            separator: true,
        },
        {
            label: 'Copier QR payload',
            action: () => { void copyQrPayload(contextMenu.imageId); },
            disabled: !Boolean((visibleImages.find(i => i.id === contextMenu.imageId)?.qr_payload || '').trim()),
        },
    ] : [];

    return (
        <div className='grid gap-3 relative'>
            <div className='flex items-center justify-between'>
                <div className='font-semibold'>Images</div>
                <div className='flex items-center gap-2'>
                    <div className='flex items-center gap-1'>
                        <button
                            className={sizeButtonClassName('small')}
                            onClick={() => changeThumbnailSize('small')}
                            disabled={isSaving}
                            title='Vignettes petites'
                            type='button'
                        >
                            S
                        </button>
                        <button
                            className={sizeButtonClassName('medium')}
                            onClick={() => changeThumbnailSize('medium')}
                            disabled={isSaving}
                            title='Vignettes moyennes'
                            type='button'
                        >
                            M
                        </button>
                        <button
                            className={sizeButtonClassName('large')}
                            onClick={() => changeThumbnailSize('large')}
                            disabled={isSaving}
                            title='Vignettes grandes'
                            type='button'
                        >
                            L
                        </button>
                    </div>

                    <button className='theia-button secondary' onClick={storeAll} disabled={isSaving}>
                        Stocker tout
                    </button>
                </div>
            </div>

            {onHiddenDomainsTextChange && (
                <details className='rounded border border-[var(--theia-panel-border)] bg-[var(--theia-editor-background)] p-2'>
                    <summary className='cursor-pointer select-none text-sm opacity-80'>
                        Domaines masqués (1 par ligne)
                    </summary>
                    <div className='mt-2 grid gap-2'>
                        <textarea
                            className='theia-input w-full resize-y'
                            rows={3}
                            value={hiddenDomainsDraft}
                            onChange={e => setHiddenDomainsDraft(e.target.value)}
                            placeholder={'geocheck.org\ncertitudes.org'}
                        />
                        <div className='flex items-center justify-end gap-2'>
                            <button
                                className='theia-button secondary'
                                type='button'
                                onClick={() => setHiddenDomainsDraft(hiddenDomainsText ?? '')}
                                disabled={isSavingHiddenDomains || isSaving}
                            >
                                Annuler
                            </button>
                            <button
                                className='theia-button'
                                type='button'
                                onClick={() => { void saveHiddenDomains(); }}
                                disabled={isSavingHiddenDomains || isSaving}
                            >
                                Enregistrer
                            </button>
                        </div>
                    </div>
                </details>
            )}

            {contextMenu && (
                <ContextMenu
                    items={contextMenuItems}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                />
            )}

            <div className='flex gap-3'>
                <div className={showDetails ? 'w-64 shrink-0' : 'min-w-0 flex-1'}>
                    <div className='flex gap-2 overflow-x-auto pb-2'>
                        {visibleImages.map(img => (
                            <button
                                key={img.id}
                                type='button'
                                className={`shrink-0 rounded border ${img.id === selectedId ? 'border-sky-500' : 'border-[var(--theia-panel-border)]'} p-1`}
                                onClick={() => handleThumbnailClick(img.id)}
                                onContextMenu={(e) => openThumbnailContextMenu(e, img.id)}
                                title={img.source_url}
                            >
                                <img
                                    className={thumbnailImageClassName}
                                    src={resolveImageUrl(img.url)}
                                    alt=''
                                    width={thumbnailDimensions.width}
                                    height={thumbnailDimensions.height}
                                />
                                {renderBadges(img)}
                            </button>
                        ))}
                    </div>
                </div>

                {showDetails && selectedImage && (
                    <div className='min-w-0 flex-1'>
                        <div className='grid gap-3 rounded border border-[var(--theia-panel-border)] bg-[var(--theia-editor-background)] p-3'>
                            <div className='flex items-start justify-between gap-3'>
                                <div className='min-w-0'>
                                    <div className='truncate font-semibold'>Image #{selectedImage.id}</div>
                                    <div className='truncate text-xs opacity-70'>{selectedImage.source_url}</div>
                                </div>
                                <div className='flex gap-2'>
                                    {!selectedImage.stored && (
                                        <button className='theia-button secondary' onClick={storeSelected} disabled={isSaving}>
                                            Stocker
                                        </button>
                                    )}
                                </div>
                            </div>

                            {showPreview && (
                                <img className='max-h-72 w-full rounded object-contain bg-black/20' src={resolveImageUrl(selectedImage.url)} alt='' />
                            )}

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

                                {Boolean((draftQr || '').trim()) && (
                                    <div>
                                        <label className='block text-xs opacity-70'>QR payload</label>
                                        <textarea
                                            className='theia-input w-full resize-y'
                                            rows={3}
                                            value={draftQr}
                                            onChange={e => setDraftQr(e.target.value)}
                                        />
                                    </div>
                                )}

                                {Boolean((draftOcr || '').trim()) && (
                                    <div>
                                        <label className='block text-xs opacity-70'>OCR</label>
                                        <textarea
                                            className='theia-input w-full resize-y'
                                            rows={5}
                                            value={draftOcr}
                                            onChange={e => setDraftOcr(e.target.value)}
                                        />
                                    </div>
                                )}
                            </div>

                            <div className='flex justify-end'>
                                <button className='theia-button' onClick={saveMetadata} disabled={isSaving}>
                                    Sauvegarder
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
