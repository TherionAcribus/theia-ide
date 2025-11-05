import * as React from 'react';
import { injectable, inject } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { ApplicationShell, ConfirmDialog } from '@theia/core/lib/browser';
import { getAttributeIconUrl } from './geocache-attributes-icons-data';
import { PluginExecutorContribution } from '@mysterai/theia-plugins/lib/browser/plugins-contribution';
import { GeocacheContext } from '@mysterai/theia-plugins/lib/browser/plugin-executor-widget';

interface PluginAddWaypointDetail {
    gcCoords: string;
    pluginName?: string;
    geocache?: {
        gcCode: string;
        name?: string;
    };
    sourceResultText?: string;
    waypointTitle?: string;
    waypointNote?: string;
    autoSave?: boolean;
    decimalLatitude?: number;
    decimalLongitude?: number;
}

interface WaypointPrefillPayload {
    coords?: string;
    title?: string;
    note?: string;
}

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
    onDeleteWaypoint: (id: number, name: string) => Promise<void>;
    onSetAsCorrectedCoords: (waypointId: number, waypointName: string) => Promise<void>;
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
 * Wrapper pour WaypointsEditor qui expose le callback startEdit
 */
interface WaypointsEditorWrapperProps extends WaypointsEditorProps {
    onRegisterCallback: (callback: (prefill?: WaypointPrefillPayload) => void) => void;
}

const WaypointsEditorWrapper: React.FC<WaypointsEditorWrapperProps> = (props) => {
    const { onRegisterCallback, ...editorProps } = props;
    const startEditRef = React.useRef<((waypoint?: GeocacheWaypoint, prefill?: WaypointPrefillPayload) => void) | null>(null);

    // Enregistrer le callback au montage
    React.useEffect(() => {
        if (startEditRef.current) {
            onRegisterCallback((prefill?: WaypointPrefillPayload) => {
                if (startEditRef.current) {
                    startEditRef.current(undefined, prefill);
                }
            });
        }
    }, [onRegisterCallback]);

    // Créer une version modifiée du WaypointsEditor avec accès à startEdit
    return (
        <WaypointsEditorWithRef
            {...editorProps}
            onStartEditRef={(fn) => { startEditRef.current = fn; }}
        />
    );
};

/**
 * Version modifiée de WaypointsEditor qui expose startEdit via une ref
 */
interface WaypointsEditorWithRefProps extends WaypointsEditorProps {
    onStartEditRef: (fn: (waypoint?: GeocacheWaypoint, prefill?: WaypointPrefillPayload) => void) => void;
}

const WaypointsEditorWithRef: React.FC<WaypointsEditorWithRefProps> = ({ onStartEditRef, ...props }) => {
    const { waypoints, geocacheId, geocacheData, backendBaseUrl, onUpdate, messages, onDeleteWaypoint, onSetAsCorrectedCoords } = props;
    const [editingId, setEditingId] = React.useState<number | 'new' | null>(null);
    const [editForm, setEditForm] = React.useState<Partial<GeocacheWaypoint>>({});
    const [projectionParams, setProjectionParams] = React.useState({ distance: 100, unit: 'm', bearing: 0 });
    const [calculatedCoords, setCalculatedCoords] = React.useState<string>('');

    const startEdit = React.useCallback((waypoint?: GeocacheWaypoint, prefill?: WaypointPrefillPayload) => {
        if (waypoint) {
            setEditingId(waypoint.id ?? null);
            setEditForm({ ...waypoint });
        } else {
            setEditingId('new');
            setEditForm({
                prefix: '',
                lookup: '',
                name: prefill?.title || '',
                type: '',
                latitude: undefined,
                longitude: undefined,
                gc_coords: prefill?.coords || geocacheData?.coordinates_raw || '',
                note: prefill?.note || ''
            });
        }
        setCalculatedCoords('');
    }, [geocacheData?.coordinates_raw]);

    // Exposer startEdit via le callback
    React.useEffect(() => {
        onStartEditRef(startEdit);
    }, [startEdit, onStartEditRef]);

    // Copier tout le reste du code de WaypointsEditor...
    const duplicateWaypoint = (waypoint: GeocacheWaypoint) => {
        setEditingId('new');
        setEditForm({
            prefix: waypoint.prefix,
            lookup: waypoint.lookup,
            name: waypoint.name ? `${waypoint.name} copy` : 'copy',
            type: waypoint.type,
            latitude: undefined,
            longitude: undefined,
            gc_coords: waypoint.gc_coords,
            note: waypoint.note
        });
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
            const dataToSave = {
                prefix: editForm.prefix,
                lookup: editForm.lookup,
                name: editForm.name,
                type: editForm.type,
                gc_coords: editForm.gc_coords,
                note: editForm.note
            };
            
            console.log('[WaypointsEditor] 🔍 SAVE WAYPOINT');
            console.log('[WaypointsEditor] Données à envoyer:', dataToSave);
            console.log('[WaypointsEditor] gc_coords:', dataToSave.gc_coords);
            
            const url = editingId === 'new'
                ? `${backendBaseUrl}/api/geocaches/${geocacheId}/waypoints`
                : `${backendBaseUrl}/api/geocaches/${geocacheId}/waypoints/${editingId}`;
            const method = editingId === 'new' ? 'POST' : 'PUT';
            
            console.log('[WaypointsEditor] URL:', url);
            console.log('[WaypointsEditor] Method:', method);
            
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(dataToSave)
            });
            if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
            
            const result = await res.json();
            console.log('[WaypointsEditor] ✅ Réponse du serveur:', result);
            console.log('[WaypointsEditor] ✅ Coordonnées calculées par le backend:', result.latitude, result.longitude);
            
            await onUpdate();
            cancelEdit();
            messages.info('Waypoint sauvegardé');
        } catch (e) {
            console.error('[WaypointsEditor] ❌ Save waypoint error', e);
            messages.error('Erreur lors de la sauvegarde du waypoint');
        }
    };

    const deleteWaypoint = async (waypoint: GeocacheWaypoint) => {
        if (!waypoint.id) { return; }
        await onDeleteWaypoint(waypoint.id, waypoint.name || 'ce waypoint');
    };

    const setAsCorrectedCoords = async (waypoint: GeocacheWaypoint) => {
        if (!waypoint.id) { return; }
        await onSetAsCorrectedCoords(waypoint.id, waypoint.name || 'ce waypoint');
    };

    const setCurrentFormAsCorrectedCoords = async () => {
        if (!editForm.gc_coords) {
            messages.error('Veuillez saisir des coordonnées');
            return;
        }
        const tempWaypoint: GeocacheWaypoint = {
            id: editingId === 'new' ? undefined : editingId as number,
            gc_coords: editForm.gc_coords,
            name: editForm.name
        };
        
        if (editingId === 'new') {
            messages.info('Sauvegarde du waypoint en cours...');
            await saveWaypoint();
            messages.info('Veuillez maintenant cliquer sur le bouton 📍 du waypoint créé');
        } else if (tempWaypoint.id) {
            await onSetAsCorrectedCoords(tempWaypoint.id, tempWaypoint.name || 'ce waypoint');
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

    // Retourner le même JSX que WaypointsEditor
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
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                        <button 
                            className='theia-button secondary'
                            onClick={setCurrentFormAsCorrectedCoords}
                            title='Définir ces coordonnées comme coordonnées corrigées de la géocache'
                            style={{ fontSize: 12 }}
                        >
                            📍 Définir comme coords corrigées
                        </button>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button className='theia-button secondary' onClick={cancelEdit}>Annuler</button>
                            <button className='theia-button' onClick={saveWaypoint}>Sauvegarder</button>
                        </div>
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
                                            onClick={() => duplicateWaypoint(w)}
                                            disabled={editingId !== null}
                                            style={{ padding: '2px 8px', fontSize: 11 }}
                                            title='Dupliquer'
                                        >
                                            📋
                                        </button>
                                        <button
                                            className='theia-button secondary'
                                            onClick={() => setAsCorrectedCoords(w)}
                                            disabled={editingId !== null}
                                            style={{ padding: '2px 8px', fontSize: 11 }}
                                            title='Définir comme coordonnées corrigées'
                                        >
                                            📍
                                        </button>
                                        <button
                                            className='theia-button secondary'
                                            onClick={() => deleteWaypoint(w)}
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

/**
 * Props pour le composant CoordinatesEditor
 */
interface CoordinatesEditorProps {
    geocacheData: GeocacheDto;
    geocacheId: number;
    backendBaseUrl: string;
    onUpdate: () => Promise<void>;
    messages: MessageService;
}

/**
 * Composant pour afficher et éditer les coordonnées d'une géocache
 */
const CoordinatesEditor: React.FC<CoordinatesEditorProps> = ({ geocacheData, geocacheId, backendBaseUrl, onUpdate, messages }) => {
    const [isEditing, setIsEditing] = React.useState(false);
    const [editedCoords, setEditedCoords] = React.useState('');
    const [solvedStatus, setSolvedStatus] = React.useState<'not_solved' | 'in_progress' | 'solved'>(
        geocacheData.solved || 'not_solved'
    );

    // Déterminer les coordonnées à afficher
    const displayCoords = geocacheData.coordinates_raw || geocacheData.original_coordinates_raw || '';
    const originalCoords = geocacheData.original_coordinates_raw || '';
    const isCorrected = geocacheData.is_corrected === true;

    // Mettre à jour le statut quand les données changent
    React.useEffect(() => {
        setSolvedStatus(geocacheData.solved || 'not_solved');
    }, [geocacheData.solved]);

    // Initialiser le formulaire d'édition
    const startEdit = () => {
        setEditedCoords(displayCoords);
        setIsEditing(true);
    };

    const cancelEdit = () => {
        setIsEditing(false);
        setEditedCoords('');
    };

    const saveCoordinates = async () => {
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/coordinates`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ coordinates_raw: editedCoords })
            });
            if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
            
            await onUpdate();
            setIsEditing(false);
            messages.info('Coordonnées mises à jour');
        } catch (e) {
            console.error('Save coordinates error', e);
            messages.error('Erreur lors de la mise à jour des coordonnées');
        }
    };

    const resetToOriginal = async () => {
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/reset-coordinates`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
            
            await onUpdate();
            setIsEditing(false);
            messages.info('Coordonnées réinitialisées');
        } catch (e) {
            console.error('Reset coordinates error', e);
            messages.error('Erreur lors de la réinitialisation des coordonnées');
        }
    };

    const updateSolvedStatus = async (newStatus: 'not_solved' | 'in_progress' | 'solved') => {
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/solved-status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ solved_status: newStatus })
            });
            if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
            
            setSolvedStatus(newStatus);
            messages.info('Statut mis à jour');
        } catch (e) {
            console.error('Update solved status error', e);
            messages.error('Erreur lors de la mise à jour du statut');
        }
    };

    return (
        <div style={{ display: 'grid', gap: 12 }}>
            {/* Affichage des coordonnées */}
            {!isEditing && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <strong>Coordonnées {isCorrected && '(corrigées)'}</strong>
                        <button
                            onClick={startEdit}
                            style={{
                                padding: '4px 12px',
                                backgroundColor: 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: 4,
                                cursor: 'pointer'
                            }}
                        >
                            {isCorrected ? 'Modifier' : 'Corriger les coordonnées'}
                        </button>
                    </div>
                    <div style={{ 
                        padding: 8, 
                        backgroundColor: 'var(--theia-editor-background)', 
                        borderRadius: 4,
                        fontFamily: 'monospace',
                        fontSize: 14
                    }}>
                        {displayCoords || 'Aucune coordonnée'}
                    </div>
                    
                    {/* Coordonnées originales si différentes */}
                    {isCorrected && originalCoords && originalCoords !== displayCoords && (
                        <div style={{ marginTop: 8 }}>
                            <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Coordonnées originales</div>
                            <div style={{ 
                                padding: 8, 
                                backgroundColor: 'var(--theia-editor-background)', 
                                borderRadius: 4,
                                fontFamily: 'monospace',
                                fontSize: 13,
                                opacity: 0.8
                            }}>
                                {originalCoords}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Formulaire d'édition */}
            {isEditing && (
                <div>
                    <div style={{ marginBottom: 8 }}>
                        <strong>Modifier les coordonnées</strong>
                    </div>
                    <input
                        type="text"
                        value={editedCoords}
                        onChange={(e) => setEditedCoords(e.target.value)}
                        placeholder="N 48° 51.402 E 002° 21.048"
                        style={{
                            width: '100%',
                            padding: 8,
                            backgroundColor: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            border: '1px solid var(--theia-input-border)',
                            borderRadius: 4,
                            fontFamily: 'monospace',
                            fontSize: 14
                        }}
                    />
                    
                    {/* Coordonnées originales en référence */}
                    {originalCoords && (
                        <div style={{ marginTop: 8 }}>
                            <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Coordonnées originales (référence)</div>
                            <div style={{ 
                                padding: 8, 
                                backgroundColor: 'var(--theia-editor-background)', 
                                borderRadius: 4,
                                fontFamily: 'monospace',
                                fontSize: 13,
                                opacity: 0.8
                            }}>
                                {originalCoords}
                            </div>
                        </div>
                    )}
                    
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button
                            onClick={saveCoordinates}
                            style={{
                                padding: '6px 16px',
                                backgroundColor: 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: 4,
                                cursor: 'pointer'
                            }}
                        >
                            Enregistrer
                        </button>
                        <button
                            onClick={cancelEdit}
                            style={{
                                padding: '6px 16px',
                                backgroundColor: 'var(--theia-secondaryButton-background)',
                                color: 'var(--theia-secondaryButton-foreground)',
                                border: 'none',
                                borderRadius: 4,
                                cursor: 'pointer'
                            }}
                        >
                            Annuler
                        </button>
                        {isCorrected && originalCoords && (
                            <button
                                onClick={resetToOriginal}
                                style={{
                                    padding: '6px 16px',
                                    backgroundColor: 'var(--theia-editorWarning-foreground)',
                                    color: 'var(--theia-editor-background)',
                                    border: 'none',
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                    marginLeft: 'auto'
                                }}
                            >
                                Revenir aux coordonnées originales
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Statut de résolution */}
            <div>
                <div style={{ marginBottom: 8 }}>
                    <strong>Statut de résolution</strong>
                </div>
                <select
                    value={solvedStatus}
                    onChange={(e) => updateSolvedStatus(e.target.value as any)}
                    style={{
                        width: '100%',
                        padding: 8,
                        backgroundColor: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: 4
                    }}
                >
                    <option value="not_solved">Non résolu</option>
                    <option value="in_progress">En cours</option>
                    <option value="solved">Résolu</option>
                </select>
            </div>
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
    original_coordinates_raw?: string;  // Coordonnées originales au format Geocaching
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
    solved?: 'not_solved' | 'in_progress' | 'solved';
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
    protected waypointEditorCallback?: (prefill?: WaypointPrefillPayload) => void;
    protected isSavingWaypoint = false;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(PluginExecutorContribution) protected readonly pluginExecutorContribution: PluginExecutorContribution
    ) {
        super();
        this.id = GeocacheDetailsWidget.ID;
        this.title.label = 'Géocache';
        this.title.caption = 'Détails Géocache';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-map-marker';
        this.addClass('theia-geocache-details-widget');
    }

    protected onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
        this.addEventListeners();
    }

    protected onBeforeDetach(msg: any): void {
        this.removeEventListeners();
        super.onBeforeDetach(msg);
    }

    private handlePluginAddWaypointEvent = (event: CustomEvent<PluginAddWaypointDetail>): void => {
        if (!event.detail?.gcCoords) {
            return;
        }

        // Vérifier que l'événement concerne bien cette géocache (si info fournie)
        const eventGcCode = event.detail.geocache?.gcCode;
        if (eventGcCode && this.data?.gc_code && eventGcCode !== this.data.gc_code) {
            return;
        }

        const title = event.detail.waypointTitle || (event.detail.pluginName ? `Résultat ${event.detail.pluginName}` : undefined);
        const note = event.detail.waypointNote || event.detail.sourceResultText;

        if (event.detail.autoSave) {
            this.autoSaveWaypoint(event.detail.gcCoords, title, note).catch(error => {
                console.error('[GeocacheDetailsWidget] autoSaveWaypoint error', error);
            });
            return;
        }

        this.addWaypointWithCoordinates(event.detail.gcCoords, {
            title,
            note
        });
        const source = event.detail.pluginName ? ` (plugin ${event.detail.pluginName})` : '';
        this.messages.info(`Waypoint prérempli depuis le Plugin Executor${source}`);
    };

    private addEventListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }

        window.removeEventListener('geoapp-plugin-add-waypoint', this.handlePluginAddWaypointEvent as EventListener);
        window.addEventListener('geoapp-plugin-add-waypoint', this.handlePluginAddWaypointEvent as EventListener);
    }

    private removeEventListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }

        window.removeEventListener('geoapp-plugin-add-waypoint', this.handlePluginAddWaypointEvent as EventListener);
    }

    /**
     * Ouvre le formulaire d'ajout de waypoint avec des coordonnées pré-remplies
     * Méthode publique appelable depuis d'autres widgets (ex: carte)
     */
    public addWaypointWithCoordinates(gcCoords: string, options?: { title?: string; note?: string }): void {
        if (this.waypointEditorCallback) {
            // Activer le widget pour le rendre visible
            this.shell.activateWidget(this.id);
            // Ouvrir le formulaire d'ajout de waypoint
            this.waypointEditorCallback({
                coords: gcCoords,
                title: options?.title,
                note: options?.note
            });
        } else {
            this.messages.warn('Le formulaire de waypoint n\'est pas encore chargé');
        }
    }

    private async autoSaveWaypoint(gcCoords: string, title?: string, note?: string): Promise<void> {
        if (!this.geocacheId) {
            this.messages.error('Aucune géocache chargée pour créer le waypoint');
            return;
        }
        if (this.isSavingWaypoint) {
            this.messages.warn('Création de waypoint déjà en cours');
            return;
        }

        this.isSavingWaypoint = true;
        try {
            const payload = {
                name: title || 'Waypoint détecté',
                gc_coords: gcCoords,
                note: note || ''
            };

            const response = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/waypoints`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            await this.load();
            this.messages.info('Waypoint créé automatiquement depuis le plugin');
        } catch (error) {
            console.error('[GeocacheDetailsWidget] autoSaveWaypoint failed', error);
            this.messages.error('Impossible de créer automatiquement le waypoint');
        } finally {
            this.isSavingWaypoint = false;
        }
    }

    /**
     * Supprime un waypoint depuis un autre widget (ex: carte)
     * Méthode publique appelable depuis d'autres widgets
     */
    public async deleteWaypointById(waypointId: number): Promise<void> {
        if (!this.data?.waypoints) {
            this.messages.error('Aucune donnée de géocache chargée');
            return;
        }

        const waypoint = this.data.waypoints.find(w => w.id === waypointId);
        if (!waypoint) {
            this.messages.error('Waypoint introuvable');
            return;
        }

        await this.deleteWaypoint(waypointId, waypoint.name || 'ce waypoint');
    }

    /**
     * Définit un waypoint comme coordonnées corrigées depuis un autre widget (ex: carte)
     * Méthode publique appelable depuis d'autres widgets
     */
    public async setWaypointAsCorrectedCoords(waypointId: number): Promise<void> {
        if (!this.data?.waypoints) {
            this.messages.error('Aucune donnée de géocache chargée');
            return;
        }

        const waypoint = this.data.waypoints.find(w => w.id === waypointId);
        if (!waypoint) {
            this.messages.error('Waypoint introuvable');
            return;
        }

        await this.setAsCorrectedCoords(waypointId, waypoint.name || 'ce waypoint');
    }

    /**
     * Ouvre le Plugin Executor avec le contexte de la géocache actuelle
     */
    protected analyzeWithPlugins = (): void => {
        if (!this.data) {
            this.messages.warn('Aucune géocache chargée');
            return;
        }

        // Créer le contexte de la géocache pour le plugin executor
        const context: GeocacheContext = {
            gcCode: this.data.gc_code || `GC${this.data.id}`,
            name: this.data.name,
            coordinates: this.data.latitude && this.data.longitude ? {
                latitude: this.data.latitude,
                longitude: this.data.longitude,
                coordinatesRaw: this.data.coordinates_raw
            } : undefined,
            description: this.data.description_html,
            hint: this.data.hints,
            difficulty: this.data.difficulty,
            terrain: this.data.terrain
        };

        // Ouvrir le Plugin Executor avec ce contexte
        this.pluginExecutorContribution.openWithContext(context);
    };

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
        this.removeEventListeners();
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

    /**
     * Supprime un waypoint après confirmation
     */
    protected deleteWaypoint = async (waypointId: number, waypointName: string): Promise<void> => {
        if (!this.geocacheId || !this.data) { return; }
        
        const dialog = new ConfirmDialog({
            title: 'Supprimer le waypoint',
            msg: `Voulez-vous vraiment supprimer le waypoint "${waypointName}" ?`,
            ok: 'Supprimer',
            cancel: 'Annuler'
        });
        
        const confirmed = await dialog.open();
        if (!confirmed) { return; }
        
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/waypoints/${waypointId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
            
            // ✅ Mettre à jour uniquement la liste des waypoints sans recharger toute la page
            if (this.data.waypoints) {
                this.data.waypoints = this.data.waypoints.filter(w => w.id !== waypointId);
            }
            
            // ✅ Rafraîchir la carte avec les waypoints mis à jour
            await this.refreshAssociatedMap();
            
            // ✅ Re-render le composant sans perdre la position de scroll
            this.update();
            
            this.messages.info(`Waypoint "${waypointName}" supprimé`);
        } catch (e) {
            console.error('Delete waypoint error', e);
            this.messages.error('Erreur lors de la suppression du waypoint');
        }
    };

    /**
     * Définit les coordonnées d'un waypoint comme coordonnées corrigées de la géocache
     */
    protected setAsCorrectedCoords = async (waypointId: number, waypointName: string): Promise<void> => {
        if (!this.geocacheId || !this.data) { return; }
        
        const dialog = new ConfirmDialog({
            title: 'Définir comme coordonnées corrigées',
            msg: `Voulez-vous définir les coordonnées du waypoint "${waypointName}" comme coordonnées corrigées de la géocache ?`,
            ok: 'Confirmer',
            cancel: 'Annuler'
        });
        
        const confirmed = await dialog.open();
        if (!confirmed) { return; }
        
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/set-corrected-coords/${waypointId}`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
            
            // Recharger les données pour afficher les nouvelles coordonnées corrigées
            await this.load();
            
            this.messages.info(`Coordonnées corrigées mises à jour depuis "${waypointName}"`);
        } catch (e) {
            console.error('Set corrected coords error', e);
            this.messages.error('Erreur lors de la mise à jour des coordonnées corrigées');
        }
    };

    protected renderRow(label: string, value?: React.ReactNode): React.ReactNode {
        if (value === undefined || value === null || value === '') { return undefined; }
        return (
            <tr>
                <td style={{ opacity: 0.7, paddingRight: 8 }}>{label}</td>
                <td>{value}</td>
            </tr>
        );
    }

    protected getAttributeIconUrlFromAttribute(attribute: GeocacheAttribute): string | undefined {
        // base_filename contient déjà le suffixe -yes ou -no
        const iconFilename = attribute.base_filename || `${attribute.name.toLowerCase().replace(/\s+/g, '')}-${attribute.is_negative ? 'no' : 'yes'}`;
        const iconUrl = getAttributeIconUrl(iconFilename);
        
        if (!iconUrl) {
            console.warn(`Attribute icon not found: ${iconFilename}.png`);
        }
        
        return iconUrl;
    }

    /**
     * Affiche les étoiles de notation (difficulté ou terrain)
     */
    protected renderStars(rating?: number, color: string = 'gold'): React.ReactNode {
        if (!rating) { return undefined; }
        const fullStars = Math.floor(rating);
        const hasHalfStar = rating % 1 >= 0.5;
        const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
        
        return (
            <span style={{ color, fontSize: 16 }}>
                {'★'.repeat(fullStars)}
                {hasHalfStar && '◐'}
                {emptyStars > 0 && <span style={{ opacity: 0.3 }}>{'☆'.repeat(emptyStars)}</span>}
            </span>
        );
    }

    protected renderAttributes(attrs?: GeocacheAttribute[]): React.ReactNode {
        if (!attrs || attrs.length === 0) { return undefined; }
        return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {attrs.map((a, idx) => {
                    const iconUrl = this.getAttributeIconUrlFromAttribute(a);
                    const tooltipText = `${a.is_negative ? 'No ' : ''}${a.name}`;
                    
                    if (!iconUrl) {
                        // Fallback si l'image n'est pas trouvée
                        return (
                            <span key={idx} style={{
                                border: '1px solid var(--theia-foreground)',
                                borderRadius: 4,
                                padding: '2px 6px',
                                fontSize: 12,
                                opacity: a.is_negative ? 0.7 : 1
                            }} title={tooltipText}>
                                {a.is_negative ? 'No ' : ''}{a.name}
                            </span>
                        );
                    }
                    
                    return (
                        <img 
                            key={idx}
                            src={iconUrl}
                            alt={tooltipText}
                            title={tooltipText}
                            style={{
                                width: 24,
                                height: 24,
                                opacity: a.is_negative ? 0.7 : 1,
                                cursor: 'help'
                            }}
                        />
                    );
                })}
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
                        {/* En-tête */}
                        <div style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                <h3 style={{ margin: 0 }}>{d.name}</h3>
                                <button
                                    className='theia-button secondary'
                                    onClick={this.analyzeWithPlugins}
                                    style={{ fontSize: 12, padding: '4px 12px' }}
                                    title='Analyser cette géocache avec les plugins'
                                >
                                    🔌 Analyser avec plugins
                                </button>
                            </div>
                            <div style={{ display: 'flex', gap: 16, opacity: 0.7, fontSize: 14 }}>
                                <span>{d.gc_code}</span>
                                <span>•</span>
                                <span>{d.type}</span>
                                <span>•</span>
                                <span>Par {d.owner || 'Inconnu'}</span>
                            </div>
                        </div>

                        {/* Informations principales : 2 colonnes */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            {/* Colonne gauche : Statistiques */}
                            <div style={{ 
                                background: 'var(--theia-editor-background)', 
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: 6, 
                                padding: 16 
                            }}>
                                <h4 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Statistiques</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                    <div>
                                        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Difficulté</div>
                                        <div>{this.renderStars(d.difficulty, '#fbbf24')}</div>
                                    </div>
                                    <div>
                                        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Terrain</div>
                                        <div>{this.renderStars(d.terrain, '#10b981')}</div>
                                    </div>
                                    <div>
                                        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Taille</div>
                                        <div style={{ color: '#60a5fa' }}>{d.size || 'N/A'}</div>
                                    </div>
                                    <div>
                                        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Favoris</div>
                                        <div style={{ color: '#a78bfa' }}>{d.favorites_count || 0}</div>
                                    </div>
                                </div>
                                
                                {/* Attributs */}
                                {d.attributes && d.attributes.length > 0 && (
                                    <div style={{ marginTop: 16 }}>
                                        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 8 }}>Attributs</div>
                                        {this.renderAttributes(d.attributes)}
                                    </div>
                                )}
                            </div>

                            {/* Colonne droite : Coordonnées */}
                            <div style={{ 
                                background: 'var(--theia-editor-background)', 
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: 6, 
                                padding: 16 
                            }}>
                                <h4 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Coordonnées</h4>
                                <CoordinatesEditor
                                    geocacheData={d}
                                    geocacheId={this.geocacheId!}
                                    backendBaseUrl={this.backendBaseUrl}
                                    onUpdate={() => this.load()}
                                    messages={this.messages}
                                />
                            </div>
                        </div>

                        {/* Informations supplémentaires (table) */}
                        <details style={{ 
                            background: 'var(--theia-editor-background)', 
                            border: '1px solid var(--theia-panel-border)',
                            borderRadius: 6, 
                            padding: 16 
                        }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 'bold', marginBottom: 8 }}>Informations détaillées</summary>
                            <table className='theia-table' style={{ width: '100%', marginTop: 8 }}>
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
                        </details>

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
                            <WaypointsEditorWrapper
                                waypoints={d.waypoints}
                                geocacheId={this.geocacheId}
                                geocacheData={d}
                                backendBaseUrl={this.backendBaseUrl}
                                onUpdate={() => this.load()}
                                messages={this.messages}
                                onDeleteWaypoint={this.deleteWaypoint}
                                onSetAsCorrectedCoords={this.setAsCorrectedCoords}
                                onRegisterCallback={(callback) => { this.waypointEditorCallback = callback; }}
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


