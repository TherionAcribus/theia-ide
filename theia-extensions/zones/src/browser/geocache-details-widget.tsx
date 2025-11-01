import * as React from 'react';
import { injectable, inject } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { ApplicationShell } from '@theia/core/lib/browser';

type GeocacheAttribute = { name: string; is_negative?: boolean; base_filename?: string };
type GeocacheImage = { url: string };
type GeocacheWaypoint = {
    id?: number;
    prefix?: string;
    lookup?: string;
    name?: string;
    type?: string;
    latitude?: number;
    longitude?: number;
    gc_coords?: string;
    note?: string;
};
type GeocacheChecker = { id?: number; name?: string; url?: string };

/**
 * Props pour le composant WaypointsEditor
 */
interface WaypointsEditorProps {
    waypoints?: GeocacheWaypoint[];
    geocacheId?: number;
    geocacheData?: GeocacheDto;
    backendBaseUrl: string;
    onUpdate: () => Promise<void>;
    messages: MessageService;
}

/**
 * Calcule l'antipode d'une coordonnée
 */
function calculateAntipode(lat: number, lon: number): { lat: number; lon: number } {
    return {
        lat: -lat,
        lon: lon > 0 ? lon - 180 : lon + 180
    };
}

/**
 * Calcule une projection géographique
 */
function calculateProjection(lat: number, lon: number, distance: number, bearing: number): { lat: number; lon: number } {
    const R = 6371000; // Rayon de la Terre en mètres
    const φ1 = lat * Math.PI / 180;
    const λ1 = lon * Math.PI / 180;
    const θ = bearing * Math.PI / 180;

    const φ2 = Math.asin(
        Math.sin(φ1) * Math.cos(distance / R) +
        Math.cos(φ1) * Math.sin(distance / R) * Math.cos(θ)
    );

    const λ2 = λ1 + Math.atan2(
        Math.sin(θ) * Math.sin(distance / R) * Math.cos(φ1),
        Math.cos(distance / R) - Math.sin(φ1) * Math.sin(φ2)
    );

    return {
        lat: φ2 * 180 / Math.PI,
        lon: λ2 * 180 / Math.PI
    };
}

/**
 * Convertit des coordonnées décimales en format Geocaching (N 48° 51.402)
 */
function toGCFormat(lat: number, lon: number): { gcLat: string; gcLon: string } {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    const absLat = Math.abs(lat);
    const absLon = Math.abs(lon);
    const latDeg = Math.floor(absLat);
    const lonDeg = Math.floor(absLon);
    const latMin = ((absLat - latDeg) * 60).toFixed(3);
    const lonMin = ((absLon - lonDeg) * 60).toFixed(3);
    return {
        gcLat: `${latDir} ${latDeg}° ${latMin}`,
        gcLon: `${lonDir} ${lonDeg}° ${lonMin}`
    };
}

/**
 * Parse les coordonnées au format Geocaching
 */
function parseGCCoords(gcLat: string, gcLon: string): { lat: number; lon: number } | null {
    const latMatch = gcLat.match(/([NS])\s*(\d+)°\s*([\d.]+)/);
    const lonMatch = gcLon.match(/([EW])\s*(\d+)°\s*([\d.]+)/);
    if (!latMatch || !lonMatch) { return null; }
    const lat = (parseInt(latMatch[2]) + parseFloat(latMatch[3]) / 60) * (latMatch[1] === 'S' ? -1 : 1);
    const lon = (parseInt(lonMatch[2]) + parseFloat(lonMatch[3]) / 60) * (lonMatch[1] === 'W' ? -1 : 1);
    return { lat, lon };
}

/**
 * Composant fonctionnel pour l'édition des waypoints
 */
const WaypointsEditor: React.FC<WaypointsEditorProps> = ({ waypoints, geocacheId, geocacheData, backendBaseUrl, onUpdate, messages }) => {
    const [editingId, setEditingId] = React.useState<number | 'new' | null>(null);
    const [editForm, setEditForm] = React.useState<Partial<GeocacheWaypoint>>({});
    const [projectionParams, setProjectionParams] = React.useState({ distance: 100, unit: 'm', bearing: 0 });
    const [calculatedCoords, setCalculatedCoords] = React.useState<string>('');

    const startEdit = (waypoint?: GeocacheWaypoint) => {
        if (waypoint) {
            setEditingId(waypoint.id ?? null);
            setEditForm({ ...waypoint });
        } else {
            setEditingId('new');
            setEditForm({
                prefix: '',
                lookup: '',
                name: '',
                type: '',
                latitude: geocacheData?.latitude,
                longitude: geocacheData?.longitude,
                gc_coords: geocacheData?.coordinates_raw,
                note: ''
            });
        }
        setCalculatedCoords('');
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditForm({});
        setCalculatedCoords('');
    };

    const saveWaypoint = async () => {
        if (!geocacheId) { return; }
        try {
            const url = editingId === 'new'
                ? `${backendBaseUrl}/api/geocaches/${geocacheId}/waypoints`
                : `${backendBaseUrl}/api/geocaches/${geocacheId}/waypoints/${editingId}`;
            const method = editingId === 'new' ? 'POST' : 'PUT';
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(editForm)
            });
            if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
            await onUpdate();
            cancelEdit();
            messages.info('Waypoint sauvegardé');
        } catch (e) {
            console.error('Save waypoint error', e);
            messages.error('Erreur lors de la sauvegarde du waypoint');
        }
    };

    const deleteWaypoint = async (id?: number) => {
        if (!geocacheId || !id) { return; }
        if (!confirm('Supprimer ce waypoint ?')) { return; }
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/waypoints/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
            await onUpdate();
            messages.info('Waypoint supprimé');
        } catch (e) {
            console.error('Delete waypoint error', e);
            messages.error('Erreur lors de la suppression du waypoint');
        }
    };

    const handleCalculateAntipode = () => {
        const coords = editForm.gc_coords ? parseGCCoords(
            editForm.gc_coords.split(',')[0]?.trim() || '',
            editForm.gc_coords.split(',')[1]?.trim() || ''
        ) : (editForm.latitude !== undefined && editForm.longitude !== undefined
            ? { lat: editForm.latitude, lon: editForm.longitude }
            : null);
        if (!coords) {
            messages.error('Coordonnées invalides');
            return;
        }
        const antipode = calculateAntipode(coords.lat, coords.lon);
        const gcFormat = toGCFormat(antipode.lat, antipode.lon);
        setCalculatedCoords(`${gcFormat.gcLat}, ${gcFormat.gcLon}`);
    };

    const handleCalculateProjection = () => {
        const coords = editForm.gc_coords ? parseGCCoords(
            editForm.gc_coords.split(',')[0]?.trim() || '',
            editForm.gc_coords.split(',')[1]?.trim() || ''
        ) : (editForm.latitude !== undefined && editForm.longitude !== undefined
            ? { lat: editForm.latitude, lon: editForm.longitude }
            : null);
        if (!coords) {
            messages.error('Coordonnées invalides');
            return;
        }
        let distanceInMeters = projectionParams.distance;
        if (projectionParams.unit === 'km') { distanceInMeters *= 1000; }
        else if (projectionParams.unit === 'miles') { distanceInMeters *= 1609.34; }
        const projected = calculateProjection(coords.lat, coords.lon, distanceInMeters, projectionParams.bearing);
        const gcFormat = toGCFormat(projected.lat, projected.lon);
        setCalculatedCoords(`${gcFormat.gcLat}, ${gcFormat.gcLon}`);
    };

    const applyCalculatedCoords = () => {
        if (calculatedCoords) {
            const parsed = parseGCCoords(
                calculatedCoords.split(',')[0]?.trim() || '',
                calculatedCoords.split(',')[1]?.trim() || ''
            );
            if (parsed) {
                setEditForm({ ...editForm, gc_coords: calculatedCoords, latitude: parsed.lat, longitude: parsed.lon });
            }
        }
    };

    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0 }}>Waypoints</h4>
                <button
                    className='theia-button'
                    onClick={() => startEdit()}
                    disabled={editingId !== null}
                    style={{ padding: '4px 12px', fontSize: 13 }}
                >
                    + Ajouter un waypoint
                </button>
            </div>

            {editingId !== null && (
                <div style={{
                    border: '1px solid var(--theia-foreground)',
                    borderRadius: 4,
                    padding: 12,
                    background: 'var(--theia-editor-background)'
                }}>
                    <h5 style={{ marginTop: 0 }}>{editingId === 'new' ? 'Nouveau Waypoint' : 'Éditer Waypoint'}</h5>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 2 }}>Préfixe</label>
                            <input
                                type='text'
                                className='theia-input'
                                value={editForm.prefix || ''}
                                onChange={e => setEditForm({ ...editForm, prefix: e.target.value })}
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 2 }}>Lookup</label>
                            <input
                                type='text'
                                className='theia-input'
                                value={editForm.lookup || ''}
                                onChange={e => setEditForm({ ...editForm, lookup: e.target.value })}
                                style={{ width: '100%' }}
                            />
                        </div>
                    </div>
                    <div style={{ marginBottom: 8 }}>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 2 }}>Nom</label>
                        <input
                            type='text'
                            className='theia-input'
                            value={editForm.name || ''}
                            onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 2 }}>Type</label>
                        <input
                            type='text'
                            className='theia-input'
                            value={editForm.type || ''}
                            onChange={e => setEditForm({ ...editForm, type: e.target.value })}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 2 }}>Coordonnées (format GC)</label>
                        <input
                            type='text'
                            className='theia-input'
                            value={editForm.gc_coords || ''}
                            onChange={e => setEditForm({ ...editForm, gc_coords: e.target.value })}
                            placeholder='N 48° 51.402, E 002° 21.048'
                            style={{ width: '100%' }}
                        />
                    </div>

                    {/* Section calculs */}
                    <div style={{
                        border: '1px solid var(--theia-border)',
                        borderRadius: 4,
                        padding: 8,
                        marginBottom: 8,
                        background: 'var(--theia-panel-background)'
                    }}>
                        <h6 style={{ margin: '0 0 8px 0', fontSize: 13 }}>Calculs géographiques</h6>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                            <button
                                className='theia-button secondary'
                                onClick={handleCalculateAntipode}
                                style={{ flex: 1, fontSize: 12 }}
                            >
                                Calculer l'antipode
                            </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
                            <div>
                                <label style={{ display: 'block', fontSize: 11, opacity: 0.8, marginBottom: 2 }}>Distance</label>
                                <input
                                    type='number'
                                    className='theia-input'
                                    value={projectionParams.distance}
                                    onChange={e => setProjectionParams({ ...projectionParams, distance: parseFloat(e.target.value) })}
                                    style={{ width: '100%', fontSize: 12 }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: 11, opacity: 0.8, marginBottom: 2 }}>Unité</label>
                                <select
                                    className='theia-select'
                                    value={projectionParams.unit}
                                    onChange={e => setProjectionParams({ ...projectionParams, unit: e.target.value })}
                                    style={{ width: '100%', fontSize: 12 }}
                                >
                                    <option value='m'>mètres</option>
                                    <option value='km'>kilomètres</option>
                                    <option value='miles'>miles</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: 11, opacity: 0.8, marginBottom: 2 }}>Angle (0°=N)</label>
                                <input
                                    type='number'
                                    className='theia-input'
                                    value={projectionParams.bearing}
                                    onChange={e => setProjectionParams({ ...projectionParams, bearing: parseFloat(e.target.value) })}
                                    min={0}
                                    max={359}
                                    style={{ width: '100%', fontSize: 12 }}
                                />
                            </div>
                        </div>
                        <button
                            className='theia-button secondary'
                            onClick={handleCalculateProjection}
                            style={{ width: '100%', fontSize: 12, marginBottom: 8 }}
                        >
                            Calculer la projection
                        </button>
                        {calculatedCoords && (
                            <div style={{ marginTop: 8 }}>
                                <label style={{ display: 'block', fontSize: 11, opacity: 0.8, marginBottom: 2 }}>Résultat</label>
                                <div style={{ display: 'flex', gap: 4 }}>
                                    <input
                                        type='text'
                                        className='theia-input'
                                        value={calculatedCoords}
                                        readOnly
                                        style={{ flex: 1, fontSize: 12 }}
                                    />
                                    <button
                                        className='theia-button'
                                        onClick={applyCalculatedCoords}
                                        style={{ fontSize: 12 }}
                                    >
                                        Appliquer
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{ marginBottom: 8 }}>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 2 }}>Note</label>
                        <textarea
                            className='theia-input'
                            value={editForm.note || ''}
                            onChange={e => setEditForm({ ...editForm, note: e.target.value })}
                            rows={3}
                            style={{ width: '100%', resize: 'vertical' }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className='theia-button secondary' onClick={cancelEdit}>Annuler</button>
                        <button className='theia-button' onClick={saveWaypoint}>Sauvegarder</button>
                    </div>
                </div>
            )}

            {(!waypoints || waypoints.length === 0) && editingId === null ? (
                <div style={{ opacity: 0.6, fontStyle: 'italic' }}>Aucun waypoint</div>
            ) : (
                <table className='theia-table' style={{ width: '100%' }}>
                    <thead>
                        <tr>
                            <th>Préfixe</th>
                            <th>Lookup</th>
                            <th>Nom</th>
                            <th>Type</th>
                            <th>Coordonnées</th>
                            <th>Note</th>
                            <th style={{ width: 100 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {waypoints?.map((w, i) => (
                            <tr key={w.id ?? i}>
                                <td>{w.prefix}</td>
                                <td>{w.lookup}</td>
                                <td>{w.name}</td>
                                <td>{w.type}</td>
                                <td>{w.gc_coords || (w.latitude !== undefined && w.longitude !== undefined ? `${w.latitude}, ${w.longitude}` : '')}</td>
                                <td style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.note}</td>
                                <td>
                                    <div style={{ display: 'flex', gap: 4 }}>
                                        <button
                                            className='theia-button secondary'
                                            onClick={() => startEdit(w)}
                                            disabled={editingId !== null}
                                            style={{ padding: '2px 8px', fontSize: 11 }}
                                            title='Éditer'
                                        >
                                            ✏️
                                        </button>
                                        <button
                                            className='theia-button secondary'
                                            onClick={() => deleteWaypoint(w.id)}
                                            disabled={editingId !== null}
                                            style={{ padding: '2px 8px', fontSize: 11 }}
                                            title='Supprimer'
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};

type GeocacheDto = {
    id: number;
    gc_code?: string;
    name: string;
    url?: string;
    type?: string;
    size?: string;
    owner?: string;
    difficulty?: number;
    terrain?: number;
    latitude?: number;
    longitude?: number;
    coordinates_raw?: string;
    is_corrected?: boolean;
    original_latitude?: number;
    original_longitude?: number;
    placed_at?: string;
    status?: string;
    zone_id?: number;
    description_html?: string;
    hints?: string;
    attributes?: GeocacheAttribute[];
    favorites_count?: number;
    logs_count?: number;
    images?: GeocacheImage[];
    found?: boolean;
    found_date?: string;
    waypoints?: GeocacheWaypoint[];
    checkers?: GeocacheChecker[];
};

@injectable()
export class GeocacheDetailsWidget extends ReactWidget {
    static readonly ID = 'geocache.details.widget';

    protected backendBaseUrl = 'http://127.0.0.1:8000';
    protected geocacheId?: number;
    protected data?: GeocacheDto;
    protected isLoading = false;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell
    ) {
        super();
        this.id = GeocacheDetailsWidget.ID;
        this.title.label = 'Géocache';
        this.title.caption = 'Détails Géocache';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-map-marker';
        this.addClass('theia-geocache-details-widget');
    }

    setGeocache(context: { geocacheId: number; name?: string }): void {
        this.geocacheId = context.geocacheId;
        if (context.name) {
            this.title.label = `Géocache - ${context.name}`;
        } else if (this.data?.name) {
            this.title.label = `Géocache - ${this.data.name}`;
        } else {
            this.title.label = `Géocache - ${this.geocacheId}`;
        }
        this.update();
        this.load();
    }

    /**
     * Appelé quand le widget devient actif
     * Réactive automatiquement la carte correspondante
     */
    protected onActivateRequest(msg: any): void {
        super.onActivateRequest(msg);
        this.reactivateMap();
    }

    /**
     * Appelé quand le widget va être fermé
     * Ferme automatiquement la carte correspondante
     */
    protected onCloseRequest(msg: any): void {
        // Fermer la carte de géocache associée avant de fermer l'onglet
        this.closeAssociatedMap();

        // Appeler la méthode parente pour la fermeture normale
        super.onCloseRequest(msg);
    }

    /**
     * Ferme la carte associée à cette géocache
     */
    private closeAssociatedMap(): void {
        if (this.geocacheId && this.data?.gc_code) {
            const mapId = `geoapp-map-geocache-${this.geocacheId}`;
            const existingMap = this.shell.getWidgets('bottom').find(w => w.id === mapId);

            if (existingMap) {
                console.log('[GeocacheDetailsWidget] Fermeture de la carte géocache associée:', this.geocacheId);
                existingMap.close();
            }
        }
    }

    /**
     * Réactive la carte correspondante à cette géocache
     */
    private reactivateMap(): void {
        // Si on a une géocache chargée, réactiver sa carte
        if (this.geocacheId && this.data?.gc_code) {
            const mapId = `geoapp-map-geocache-${this.geocacheId}`;
            const existingMap = this.shell.getWidgets('bottom').find(w => w.id === mapId);
            
            if (existingMap) {
                console.log('[GeocacheDetailsWidget] Réactivation de la carte géocache:', this.geocacheId);
                this.shell.activateWidget(mapId);
            }
        }
    }

    /**
     * Rafraîchit la carte associée à cette géocache après modification des waypoints
     */
    private async refreshAssociatedMap(): Promise<void> {
        if (!this.geocacheId || !this.data?.gc_code) {
            return;
        }

        const mapId = `geoapp-map-geocache-${this.geocacheId}`;
        const existingMap = this.shell.getWidgets('bottom').find(w => w.id === mapId);
        
        if (existingMap && 'loadGeocaches' in existingMap) {
            console.log('[GeocacheDetailsWidget] Rafraîchissement de la carte géocache:', this.geocacheId);
            
            // Recharger les données de la géocache pour avoir les waypoints à jour
            try {
                const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}`, { credentials: 'include' });
                if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
                const updatedData = await res.json();
                
                // Mettre à jour la carte avec les nouvelles données
                const mapGeocache = {
                    id: updatedData.id,
                    gc_code: updatedData.gc_code,
                    name: updatedData.name,
                    latitude: updatedData.latitude,
                    longitude: updatedData.longitude,
                    cache_type: updatedData.type,
                    difficulty: updatedData.difficulty,
                    terrain: updatedData.terrain,
                    size: updatedData.size,
                    solved: 'not_solved',
                    found: updatedData.found || false,
                    favorites_count: updatedData.favorites_count || 0,
                    is_corrected: updatedData.is_corrected || false,
                    original_latitude: updatedData.original_latitude,
                    original_longitude: updatedData.original_longitude,
                    waypoints: updatedData.waypoints || []
                };
                
                // Appeler loadGeocaches avec la géocache mise à jour
                (existingMap as any).loadGeocaches([mapGeocache]);
            } catch (e) {
                console.error('[GeocacheDetailsWidget] Erreur lors du rafraîchissement de la carte:', e);
            }
        }
    }

    protected async load(): Promise<void> {
        if (!this.geocacheId) { return; }
        this.isLoading = true;
        this.update();
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}`, { credentials: 'include' });
            if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
            this.data = await res.json();
            this.title.label = `Géocache - ${this.data?.name ?? this.data?.gc_code ?? this.geocacheId}`;
            
            // Rafraîchir la carte associée avec les données à jour
            await this.refreshAssociatedMap();
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('GeocacheDetailsWidget: load error', e);
            this.messages.error('Impossible de charger la géocache');
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    protected renderRow(label: string, value?: React.ReactNode): React.ReactNode {
        if (value === undefined || value === null || value === '') { return undefined; }
        return (
            <tr>
                <td style={{ opacity: 0.7, paddingRight: 8 }}>{label}</td>
                <td>{value}</td>
            </tr>
        );
    }

    protected renderAttributes(attrs?: GeocacheAttribute[]): React.ReactNode {
        if (!attrs || attrs.length === 0) { return undefined; }
        return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {attrs.map((a, idx) => (
                    <span key={idx} style={{
                        border: '1px solid var(--theia-foreground)',
                        borderRadius: 4,
                        padding: '2px 6px',
                        fontSize: 12,
                        opacity: a.is_negative ? 0.7 : 1
                    }} title={a.base_filename || a.name}>
                        {a.is_negative ? 'No ' : ''}{a.name}
                    </span>
                ))}
            </div>
        );
    }

    protected renderImages(images?: GeocacheImage[]): React.ReactNode {
        if (!images || images.length === 0) { return undefined; }
        return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {images.map((img, i) => (
                    <a key={i} href={img.url} target='_blank' rel='noreferrer' title={img.url}>
                        <img src={img.url} style={{ maxWidth: 160, maxHeight: 120, objectFit: 'cover', borderRadius: 4 }} />
                    </a>
                ))}
            </div>
        );
    }

    protected renderCheckers(checkers?: GeocacheChecker[]): React.ReactNode {
        if (!checkers || checkers.length === 0) { return undefined; }
        return (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
                {checkers.map((c, i) => (
                    <li key={c.id ?? i}>
                        {c.url ? <a href={c.url} target='_blank' rel='noreferrer'>{c.name || c.url}</a> : (c.name || '')}
                    </li>
                ))}
            </ul>
        );
    }

    protected render(): React.ReactNode {
        const d = this.data;
        return (
            <div className='p-2'>
                {this.isLoading && <div>Chargement…</div>}
                {!this.isLoading && !d && <div style={{ opacity: 0.7 }}>Aucune donnée</div>}
                {!this.isLoading && d && (
                    <div style={{ display: 'grid', gap: 12 }}>
                        <h3 style={{ margin: 0 }}>{d.name}</h3>
                        <table className='theia-table' style={{ maxWidth: 860 }}>
                            <tbody>
                                {this.renderRow('Code', d.gc_code)}
                                {this.renderRow('Propriétaire', d.owner)}
                                {this.renderRow('Type', d.type)}
                                {this.renderRow('Taille', d.size)}
                                {this.renderRow('Difficulté', d.difficulty?.toString())}
                                {this.renderRow('Terrain', d.terrain?.toString())}
                                {this.renderRow('Favoris', d.favorites_count?.toString())}
                                {this.renderRow('Logs', d.logs_count?.toString())}
                                {this.renderRow('Placée le', d.placed_at)}
                                {this.renderRow('Statut', d.status)}
                                {this.renderRow('Lien', d.url ? <a href={d.url} target='_blank' rel='noreferrer'>{d.url}</a> : undefined)}
                            </tbody>
                        </table>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div>
                                <h4 style={{ margin: '8px 0' }}>Coordonnées</h4>
                                <table className='theia-table' style={{ maxWidth: 600 }}>
                                    <tbody>
                                        {this.renderRow('Affichées', d.coordinates_raw)}
                                        {this.renderRow('Latitude', d.latitude?.toString())}
                                        {this.renderRow('Longitude', d.longitude?.toString())}
                                        {this.renderRow('Corrigées', d.is_corrected ? 'Oui' : (d.is_corrected === false ? 'Non' : undefined))}
                                        {this.renderRow('Originales', (d.original_latitude !== undefined && d.original_longitude !== undefined) ? `${d.original_latitude}, ${d.original_longitude}` : undefined)}
                                    </tbody>
                                </table>
                            </div>
                            <div>
                                <h4 style={{ margin: '8px 0' }}>Attributs</h4>
                                {this.renderAttributes(d.attributes)}
                            </div>
                        </div>

                        <div>
                            <h4 style={{ margin: '8px 0' }}>Description</h4>
                            <div style={{ border: '1px solid var(--theia-foreground)', borderRadius: 4, padding: 8, maxWidth: 900 }}
                                dangerouslySetInnerHTML={{ __html: d.description_html || '' }} />
                        </div>

                        {d.hints ? (
                            <div>
                                <h4 style={{ margin: '8px 0' }}>Indices</h4>
                                <div style={{ whiteSpace: 'pre-wrap', opacity: 0.9 }}>{d.hints}</div>
                            </div>
                        ) : undefined}

                        {this.renderImages(d.images)}

                        <div>
                            <WaypointsEditor
                                waypoints={d.waypoints}
                                geocacheId={this.geocacheId}
                                geocacheData={d}
                                backendBaseUrl={this.backendBaseUrl}
                                onUpdate={() => this.load()}
                                messages={this.messages}
                            />
                        </div>

                        {d.checkers && d.checkers.length > 0 ? (
                            <div>
                                <h4 style={{ margin: '8px 0' }}>Checkers</h4>
                                {this.renderCheckers(d.checkers)}
                            </div>
                        ) : undefined}
                    </div>
                )}
            </div>
        );
    }
}


