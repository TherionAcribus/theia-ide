import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { ApplicationShell, ConfirmDialog, StatefulWidget } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core';
import { ChatAgent, ChatAgentLocation, ChatAgentService, ChatService, ChatSession, isSessionDeletedEvent } from '@theia/ai-chat';
import { DEFAULT_CHAT_AGENT_PREF } from '@theia/ai-chat/lib/common/ai-chat-preferences';
import { LanguageModelRegistry, LanguageModelService } from '@theia/ai-core';
import { getAttributeIconUrl } from './geocache-attributes-icons-data';
import { PluginExecutorContribution } from '@mysterai/theia-plugins/lib/browser/plugins-contribution';
import { GeocacheContext } from '@mysterai/theia-plugins/lib/browser/plugin-executor-widget';
import { FormulaSolverSolveFromGeocacheCommand } from '@mysterai/theia-formula-solver/lib/browser/formula-solver-contribution';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { GeocacheImagesPanel } from './geocache-images-panel';

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

interface GeocacheChatMetadata {
    geocacheId: number;
    geocacheCode?: string;
    geocacheName?: string;
    lastUpdatedIso: string;
}

interface SerializedGeocacheDetailsState {
    geocacheId?: number;
}

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

function rot13(value: string): string {
    return value.replace(/[a-zA-Z]/g, (char) => {
        const base = char <= 'Z' ? 65 : 97;
        const code = char.charCodeAt(0) - base;
        return String.fromCharCode(((code + 13) % 26) + base);
    });
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
    hints_decoded?: string;
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
export class GeocacheDetailsWidget extends ReactWidget implements StatefulWidget {
    static readonly ID = 'geocache.details.widget';

    protected backendBaseUrl = 'http://127.0.0.1:8000';
    protected geocacheId?: number;
    protected data?: GeocacheDto;
    protected isLoading = false;
    protected notesCount: number | undefined;
    protected waypointEditorCallback?: (prefill?: WaypointPrefillPayload) => void;
    protected isSavingWaypoint = false;
    protected interactionTimerId: number | undefined;

    private readonly displayDecodedHintsPreferenceKey = 'geoApp.geocache.hints.displayDecoded';
    private readonly imagesStorageDefaultModePreferenceKey = 'geoApp.images.storage.defaultMode';
    private readonly imagesGalleryThumbnailSizePreferenceKey = 'geoApp.images.gallery.thumbnailSize';
    private readonly imagesGalleryHiddenDomainsPreferenceKey = 'geoApp.images.gallery.hiddenDomains';
    private readonly ocrDefaultEnginePreferenceKey = 'geoApp.ocr.defaultEngine';
    private readonly ocrDefaultLanguagePreferenceKey = 'geoApp.ocr.defaultLanguage';
    private readonly ocrLmstudioBaseUrlPreferenceKey = 'geoApp.ocr.lmstudio.baseUrl';
    private readonly ocrLmstudioModelPreferenceKey = 'geoApp.ocr.lmstudio.model';

    private readonly handleContentClick = (): void => {
        this.emitInteraction('click');
    };

    private readonly handleContentScroll = (): void => {
        this.emitInteraction('scroll');
    };

    // Map pour stocker les métadonnées GeoApp des sessions de chat
    protected static geocacheChatSessions = new Map<string, GeocacheChatMetadata>();

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(PluginExecutorContribution) protected readonly pluginExecutorContribution: PluginExecutorContribution,
        @inject(CommandService) protected readonly commandService: CommandService,
        @inject(ChatService) protected readonly chatService: ChatService,
        @inject(ChatAgentService) protected readonly chatAgentService: ChatAgentService,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(LanguageModelRegistry) protected readonly languageModelRegistry: LanguageModelRegistry,
        @inject(LanguageModelService) protected readonly languageModelService: LanguageModelService
    ) {
        super();
        this.id = GeocacheDetailsWidget.ID;
        this.title.label = 'Géocache';
        this.title.caption = 'Détails Géocache';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-map-marker';
        this.addClass('theia-geocache-details-widget');

        this.node.tabIndex = 0;
    }

    @postConstruct()
    initialize(): void {
        // Nettoyer les métadonnées des sessions supprimées
        this.chatService.onSessionEvent(event => {
            if (isSessionDeletedEvent(event)) {
                GeocacheDetailsWidget.geocacheChatSessions.delete(event.sessionId);
            }
        });
    }

    protected onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
        this.addEventListeners();
        this.addInteractionListeners();
    }

    protected onBeforeDetach(msg: any): void {
        this.removeInteractionListeners();
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

    private addInteractionListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        this.node.addEventListener('click', this.handleContentClick, true);
        this.node.addEventListener('scroll', this.handleContentScroll, true);
    }

    private removeInteractionListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        this.node.removeEventListener('click', this.handleContentClick, true);
        this.node.removeEventListener('scroll', this.handleContentScroll, true);
        this.clearMinOpenTimeTimer();
    }

    /**
     * Ouvre le formulaire d'ajout de waypoint avec des coordonnées pré-remplies
     * Méthode publique appelable depuis d'autres widgets (ex: carte)
     */
    public addWaypointWithCoordinates(gcCoords: string, options?: { title?: string; note?: string; autoSave?: boolean }): void {
        if (options?.autoSave) {
            void this.autoSaveWaypoint(gcCoords, options.title, options.note);
            return;
        }

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

    private emitInteraction(type: 'click' | 'scroll' | 'min-open-time'): void {
        if (typeof window === 'undefined') {
            return;
        }
        window.dispatchEvent(new CustomEvent('geoapp-geocache-tab-interaction', {
            detail: {
                widgetId: this.id,
                geocacheId: this.geocacheId,
                type
            }
        }));
    }

    private setupMinOpenTimeTimer(): void {
        this.clearMinOpenTimeTimer();

        if (typeof window === 'undefined') {
            return;
        }

        const enabled = this.preferenceService.get('geoApp.ui.tabs.smartReplace.interaction.minOpenTimeEnabled', true) as boolean;
        if (!enabled) {
            return;
        }

        const timeoutSeconds = this.preferenceService.get('geoApp.ui.tabs.smartReplaceTimeout', 30) as number;
        if (!timeoutSeconds || timeoutSeconds <= 0) {
            return;
        }

        this.interactionTimerId = window.setTimeout(() => {
            this.emitInteraction('min-open-time');
        }, timeoutSeconds * 1000);
    }

    private clearMinOpenTimeTimer(): void {
        if (this.interactionTimerId !== undefined) {
            window.clearTimeout(this.interactionTimerId);
            this.interactionTimerId = undefined;
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
     * Ouvre le Formula Solver avec la géocache actuelle
     */
    protected solveFormula = async (): Promise<void> => {
        if (!this.data || !this.geocacheId) {
            this.messages.warn('Aucune géocache chargée');
            return;
        }

        try {
            await this.commandService.executeCommand(
                FormulaSolverSolveFromGeocacheCommand.id,
                this.geocacheId
            );
        } catch (error) {
            console.error('Erreur lors de l\'ouverture du Formula Solver:', error);
            this.messages.error('Impossible d\'ouvrir le Formula Solver');
        }
    };

    /**
     * Ouvre le Plugin Executor avec le contexte de la géocache actuelle
     */
    protected analyzeWithPlugins = (): void => {
        if (!this.data) {
            this.messages.warn('Aucune géocache chargée');
            return;
        }

        // Créer le contexte de la géocache pour le plugin executor
        console.log('[GeocacheDetailsWidget] 🔍 ANALYZE WITH PLUGINS DEBUG');
        console.log('[GeocacheDetailsWidget] Raw description_html length:', this.data.description_html?.length);
        
        // Comme demandé, on passe le HTML brut pour analyse (commentaires, attributs cachés, etc.)
        const descriptionHtml = this.data.description_html || '';

        const coordinatesRaw = this.data.coordinates_raw || this.data.original_coordinates_raw;
        let contextCoordinates: GeocacheContext['coordinates'] = undefined;
        if (coordinatesRaw) {
            let lat = this.data.latitude;
            let lon = this.data.longitude;

            if (lat === undefined || lat === null || lon === undefined || lon === null) {
                const raw = coordinatesRaw.replace(',', ' ');
                const parts = raw.match(/([NS].*?)([EW].*)/i);
                if (parts?.[1] && parts?.[2]) {
                    const parsed = parseGCCoords(parts[1].trim(), parts[2].trim());
                    if (parsed) {
                        lat = parsed.lat;
                        lon = parsed.lon;
                    }
                }
            }

            if (lat !== undefined && lat !== null && lon !== undefined && lon !== null) {
                contextCoordinates = {
                    latitude: lat,
                    longitude: lon,
                    coordinatesRaw
                };
            }
        }

        const context: GeocacheContext = {
            geocacheId: this.data.id,
            gcCode: this.data.gc_code || `GC${this.data.id}`,
            name: this.data.name,
            coordinates: contextCoordinates,
            description: descriptionHtml,
            hint: this.getDecodedHints(this.data),
            difficulty: this.data.difficulty,
            terrain: this.data.terrain,
            waypoints: this.data.waypoints, // Ajout des waypoints
            images: this.data.images,
            checkers: this.data.checkers
        };
        
        console.log('[GeocacheDetailsWidget] Context sent to executor:', context);

        // Ouvrir le Plugin Executor avec ce contexte
        this.pluginExecutorContribution.openWithContext(context);
    };

    /**
     * Ouvre le Plugin Executor spécifiquement pour l'analyse de page (analysis_web_page)
     */
    protected analyzePage = (): void => {
        if (!this.data) {
            this.messages.warn('Aucune géocache chargée');
            return;
        }

        const descriptionHtml = this.data.description_html || '';

        const coordinatesRaw = this.data.coordinates_raw || this.data.original_coordinates_raw;
        let contextCoordinates: GeocacheContext['coordinates'] = undefined;
        if (coordinatesRaw) {
            let lat = this.data.latitude;
            let lon = this.data.longitude;

            if (lat === undefined || lat === null || lon === undefined || lon === null) {
                const raw = coordinatesRaw.replace(',', ' ');
                const parts = raw.match(/([NS].*?)([EW].*)/i);
                if (parts?.[1] && parts?.[2]) {
                    const parsed = parseGCCoords(parts[1].trim(), parts[2].trim());
                    if (parsed) {
                        lat = parsed.lat;
                        lon = parsed.lon;
                    }
                }
            }

            if (lat !== undefined && lat !== null && lon !== undefined && lon !== null) {
                contextCoordinates = {
                    latitude: lat,
                    longitude: lon,
                    coordinatesRaw
                };
            }
        }

        const context: GeocacheContext = {
            geocacheId: this.data.id,
            gcCode: this.data.gc_code || `GC${this.data.id}`,
            name: this.data.name,
            coordinates: contextCoordinates,
            description: descriptionHtml,
            hint: this.getDecodedHints(this.data),
            difficulty: this.data.difficulty,
            terrain: this.data.terrain,
            waypoints: this.data.waypoints,
            images: this.data.images,
            checkers: this.data.checkers
        };

        // Ouvrir directement avec analysis_web_page et exécution automatique
        this.pluginExecutorContribution.openWithContext(context, 'analysis_web_page', true);
    };

    setGeocache(context: { geocacheId: number; name?: string }): void {
        this.geocacheId = context.geocacheId;
        this.notesCount = undefined;
        if (context.name) {
            this.title.label = `Géocache - ${context.name}`;
        } else if (this.data?.name) {
            this.title.label = `Géocache - ${this.data.name}`;
        } else {
            this.title.label = `Géocache - ${this.geocacheId}`;
        }
        this.setupMinOpenTimeTimer();
        this.update();
        this.load();
    }

    /**
     * Appelé quand le widget devient actif
     * Réactive automatiquement la carte correspondante
     */
    protected onActivateRequest(msg: any): void {
        super.onActivateRequest(msg);
        this.node.focus();
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
        this.removeInteractionListeners();
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

    protected getGcPersonalNoteAutoSyncMode(): 'manual' | 'onNotesOpen' | 'onDetailsOpen' {
        const raw = this.preferenceService.get('geoApp.notes.gcPersonalNote.autoSyncMode', 'manual') as string;
        if (raw === 'onNotesOpen' || raw === 'onDetailsOpen' || raw === 'manual') {
            return raw;
        }
        return 'manual';
    }

    protected async autoSyncGcPersonalNoteFromDetailsIfEnabled(): Promise<void> {
        if (!this.geocacheId) {
            return;
        }
        const mode = this.getGcPersonalNoteAutoSyncMode();
        if (mode !== 'onDetailsOpen') {
            return;
        }
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/notes/sync-from-geocaching`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!res.ok) {
                // Ne pas notifier l'utilisateur en auto, seulement loguer
                console.error('[GeocacheDetailsWidget] Auto-sync note Geocaching.com échouée');
            }
        } catch (err) {
            console.error('[GeocacheDetailsWidget] Auto-sync note Geocaching.com échouée:', err);
        }
    }

    protected async loadNotesCount(): Promise<void> {
        if (!this.geocacheId) {
            this.notesCount = undefined;
            return;
        }
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/notes`, { credentials: 'include' });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = await res.json();
            this.notesCount = Array.isArray(data.notes) ? data.notes.length : 0;
        } catch (e) {
            console.error('[GeocacheDetailsWidget] Failed to load notes count', e);
            this.notesCount = undefined;
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

    storeState(): object | undefined {
        if (!this.geocacheId) {
            return undefined;
        }
        const state: SerializedGeocacheDetailsState = {
            geocacheId: this.geocacheId
        };
        return state;
    }

    restoreState(oldState: object): void {
        const state = oldState as Partial<SerializedGeocacheDetailsState> | undefined;
        if (!state || typeof state.geocacheId !== 'number') {
            return;
        }
        this.setGeocache({ geocacheId: state.geocacheId });
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
            await this.loadNotesCount();
            void this.autoSyncGcPersonalNoteFromDetailsIfEnabled();
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

    private openGeocacheAIChat = async (): Promise<void> => {
        if (!this.geocacheId || !this.data) {
            this.messages.warn('Aucune géocache sélectionnée pour ouvrir le chat IA.');
            return;
        }

        const metadata: GeocacheChatMetadata = {
            geocacheId: this.geocacheId,
            geocacheCode: this.data.gc_code,
            geocacheName: this.data.name,
            lastUpdatedIso: new Date().toISOString()
        };

        try {
            const existingSession = this.findGeocacheChatSession(this.geocacheId);
            if (existingSession) {
                existingSession.pinnedAgent = this.resolveDefaultChatAgent();
                this.setSessionGeocacheMetadata(existingSession, metadata);
                this.chatService.setActiveSession(existingSession.id, { focus: true });
                this.messages.info('Chat IA rouvert pour cette géocache.');
                return;
            }

            const pinnedAgent = this.resolveDefaultChatAgent();
            console.log('[GeocacheDetailsWidget] Opening chat session with pinned agent:', pinnedAgent?.id, pinnedAgent?.name);
            const session = this.chatService.createSession(ChatAgentLocation.Panel, { focus: true }, pinnedAgent);
            this.setSessionGeocacheMetadata(session, metadata);
            session.title = `CHAT IA - ${this.data.gc_code ?? this.data.name}`;

            const prompt = this.buildGeocachePrompt(this.data);
            await this.chatService.sendRequest(session.id, { text: prompt });
            this.messages.info('Chat IA lancé pour cette géocache.');
        } catch (error) {
            console.error('[GeocacheDetailsWidget] openGeocacheAIChat error', error);
            this.messages.error('Impossible d\'ouvrir le chat IA pour cette géocache.');
        }
    };

    private resolveDefaultChatAgent(): ChatAgent | undefined {
        const available = this.chatAgentService.getAgents();

        const isClaudeCode = (agent: ChatAgent): boolean => {
            const id = (agent.id || '').toLowerCase();
            const name = (agent.name || '').toLowerCase();
            return id === 'claudecode' || name === 'claudecode' || id.includes('claude') || name.includes('claude');
        };

        const geoApp = available.find(a => (a.id || '').toLowerCase() === 'geoapp' || (a.name || '').toLowerCase() === 'geoapp');
        if (geoApp) {
            return geoApp;
        }

        const universal = available.find(a => (a.id || '').toLowerCase().includes('universal') || (a.name || '').toLowerCase().includes('universal'));
        if (universal) {
            return universal;
        }

        const configuredId = this.preferenceService.get(DEFAULT_CHAT_AGENT_PREF, undefined) as string | undefined;
        const configured = configuredId ? this.chatAgentService.getAgent(configuredId) : undefined;
        if (configured && !isClaudeCode(configured)) {
            return configured;
        }

        return available.find(a => !isClaudeCode(a)) ?? available[0];
    }

    /**
     * Ouvre le widget des logs pour cette géocache dans le panneau droit
     */
    private openLogs = (): void => {
        if (!this.geocacheId || !this.data) {
            this.messages.warn('Aucune géocache sélectionnée pour voir les logs.');
            return;
        }

        // Émettre un événement pour ouvrir le widget des logs
        const event = new CustomEvent('open-geocache-logs', {
            detail: {
                geocacheId: this.geocacheId,
                gcCode: this.data.gc_code,
                name: this.data.name
            }
        });
        window.dispatchEvent(event);
    };

    /**
     * Ouvre le widget des notes pour cette géocache dans le panneau droit
     */
    private openNotes = (): void => {
        if (!this.geocacheId || !this.data) {
            this.messages.warn('Aucune géocache sélectionnée pour voir les notes.');
            return;
        }

        const event = new CustomEvent('open-geocache-notes', {
            detail: {
                geocacheId: this.geocacheId,
                gcCode: this.data.gc_code,
                name: this.data.name
            }
        });
        window.dispatchEvent(event);
    };

    private findGeocacheChatSession(geocacheId: number): ChatSession | undefined {
        return this.chatService.getSessions()
            .find(session => GeocacheDetailsWidget.geocacheChatSessions.get(session.id)?.geocacheId === geocacheId);
    }

    private setSessionGeocacheMetadata(session: ChatSession, metadata: GeocacheChatMetadata): void {
        GeocacheDetailsWidget.geocacheChatSessions.set(session.id, metadata);
    }

    private buildGeocachePrompt(data: GeocacheDto): string {
        const gcCode = (data.gc_code ?? '').trim();
        const certitudeCheckerUrl = data.checkers?.find(c => (c.url || '').toLowerCase().includes('certitudes.org'))?.url;
        const certitudeUrl = certitudeCheckerUrl;
        const geocachingCheckerUrl = data.checkers?.find(c => (c.name || '').toLowerCase().includes('geocaching'))?.url;

        const lines: string[] = [
            `Nom : ${data.name}`,
            `ID : ${data.id}`,
            `Code : ${data.gc_code ?? 'Inconnu'} • Type : ${data.type ?? 'Inconnu'} • Taille : ${data.size ?? 'N/A'}`,
            `Difficulté / Terrain : ${data.difficulty ?? '?'} / ${data.terrain ?? '?'}`,
            `Propriétaire : ${data.owner ?? 'Inconnu'} • Statut : ${data.status ?? 'Inconnu'}`,
            `Coordonnées affichées : ${data.coordinates_raw ?? data.original_coordinates_raw ?? 'Non renseignées'}`,
            data.original_coordinates_raw && data.coordinates_raw && data.original_coordinates_raw !== data.coordinates_raw
                ? `Coordonnées originales : ${data.original_coordinates_raw}`
                : undefined,
            data.placed_at ? `Placée le : ${data.placed_at}` : undefined,
            `Favoris : ${data.favorites_count ?? 0} • Logs : ${data.logs_count ?? 0}`,
            data.waypoints?.length ? `Waypoints (${data.waypoints.length}) : ${this.buildWaypointsSummary(data.waypoints)}` : undefined,
            data.checkers?.length
                ? `Checkers : ${data.checkers
                    .map(c => (c.url ? `${c.name || 'Checker'}: ${c.url}` : (c.name || 'Checker')))
                    .join(' • ')}`
                : undefined
        ].filter((value): value is string => Boolean(value));

        const descriptionSnippet = this.sanitizeRichText(data.description_html, 1500);
        if (descriptionSnippet) {
            lines.push('', 'Description (extrait) :', descriptionSnippet);
        }

        const decodedHints = this.getDecodedHints(data);
        if (decodedHints) {
            lines.push('', 'Indices (extrait) :', this.truncate(decodedHints.trim(), 600));
        }

        if (data.waypoints?.length) {
            lines.push('', 'Waypoints (détails) :', ...this.buildWaypointsDetails(data.waypoints));
        }

        return [
            "Tu es un assistant IA spécialisé dans la résolution d'énigmes de géocaching.",
            'Rappels stricts :',
            '1. Ne propose jamais de coordonnées inventées.',
            "2. Limite ta réponse à 3 pistes ou plans d'action structurés maximum.",
            '3. Cite les outils, calculs ou vérifications nécessaires.',
            '4. Demande des précisions avant de conclure si les données sont insuffisantes.',
            '5. Ne JAMAIS inventer une URL de checker. Utilise uniquement celles fournies dans "Checkers".',
            '',
            ...(certitudeUrl
                ? [
                    'Certitude (checker) :',
                    certitudeUrl,
                    ...(gcCode
                        ? [
                            `Pour Certitude, si tu appelles run_checker et que l'URL n'a pas de ?wp=..., passe aussi wp="${gcCode}".`,
                            `Pour une éventuelle session Certitude: ensure_checker_session(provider="certitudes", wp="${gcCode}").`,
                        ]
                        : []),
                    ''
                ]
                : []),
            'Tools disponibles (GeoApp) :',
            '~geoapp.checkers.run',
            '~geoapp.checkers.session.ensure',
            '~geoapp.checkers.session.login',
            '~geoapp.checkers.session.reset',
            '',
            'Vérification (checkers) :',
            '- Pour valider une réponse, appelle run_checker en mode tool-driven avec geocache_id (recommandé) : run_checker(geocache_id, candidate). Le tool résout automatiquement le bon checker, l\'URL et wp.',
            "- Si un checker est fourni (ex: Certitude) et que tu proposes une réponse textuelle, valide-la en appelant le tool run_checker(url, candidate) AVANT de conclure.",
            "- Si le checker nécessite une session (ex: Geocaching.com), appelle d'abord ensure_checker_session(provider=\"geocaching\"). Si logged_in=false, propose login_checker_session(provider=\"geocaching\") puis réessaie.",
            ...(geocachingCheckerUrl && geocachingCheckerUrl.toLowerCase().includes('#solution-checker') && gcCode
                ? [
                    `Note: le checker Geocaching peut être stocké comme ancre (${geocachingCheckerUrl}). Dans ce cas, lors de l'appel à run_checker, passe aussi wp=\"${gcCode}\" pour que l'app reconstruise l'URL Geocaching correcte.`,
                    ''
                ]
                : []),
            '',
            '--- CONTEXTE GÉOCACHE ---',
            ...lines,
            '',
            '--- OBJECTIF ---',
            "Analyse l'énigme, propose un plan d'action clair (max 3 pistes) et précise comment vérifier chaque hypothèse avant d'estimer la position finale."
        ].join('\n');
    }

    private buildWaypointsDetails(waypoints: GeocacheWaypoint[]): string[] {
        return waypoints.map(w => {
            const labelParts: string[] = [];
            if (w.prefix) {
                labelParts.push(w.prefix);
            }
            if (w.lookup) {
                labelParts.push(w.lookup);
            }

            const label = labelParts.join(' / ');
            const name = (w.name || '').trim();
            const title = [label || undefined, name || undefined].filter(Boolean).join(' • ') || 'Waypoint';
            const type = (w.type || '').trim();

            let coords = (w.gc_coords || '').trim();
            if (!coords && w.latitude !== undefined && w.longitude !== undefined) {
                const gcFormat = toGCFormat(w.latitude, w.longitude);
                coords = `${gcFormat.gcLat}, ${gcFormat.gcLon}`;
            }

            const decimalCoords = (w.latitude !== undefined && w.longitude !== undefined)
                ? `${w.latitude.toFixed(5)}, ${w.longitude.toFixed(5)}`
                : undefined;

            const note = (w.note || '').trim();
            const notePreview = note ? this.truncate(note.replace(/\s+/g, ' '), 220) : undefined;

            const parts: string[] = [
                `- ${title}${type ? ` (${type})` : ''}`,
                ...(coords ? [`  Coordonnées : ${coords}`] : []),
                ...(decimalCoords ? [`  Décimal : ${decimalCoords}`] : []),
                ...(notePreview ? [`  Note : ${notePreview}`] : []),
            ];

            return parts.join('\n');
        });
    }

    private buildWaypointsSummary(waypoints: GeocacheWaypoint[]): string {
        const preview = waypoints
            .slice(0, 3)
            .map(w => {
                const label = w.name || w.prefix || 'WP';
                const coords = w.gc_coords || (w.latitude !== undefined && w.longitude !== undefined
                    ? `${w.latitude.toFixed(5)}, ${w.longitude.toFixed(5)}`
                    : undefined);
                return coords ? `${label} (${coords})` : label;
            })
            .join(' • ');
        const remaining = waypoints.length > 3 ? ` … (+${waypoints.length - 3})` : '';
        return `${preview}${remaining}`;
    }

    private sanitizeRichText(value?: string, maxLength = 1500): string {
        if (!value) {
            return '';
        }
        const text = this.stripHtml(value).replace(/\s+/g, ' ').trim();
        return this.truncate(text, maxLength);
    }

    private stripHtml(value: string): string {
        if (typeof document !== 'undefined') {
            const temp = document.createElement('div');
            temp.innerHTML = value;
            return (temp.textContent || temp.innerText || '').trim();
        }
        return value.replace(/<[^>]+>/g, ' ').trim();
    }

    private getDecodedHints(data: GeocacheDto): string | undefined {
        if (data.hints_decoded) {
            return data.hints_decoded;
        }
        if (!data.hints) {
            return undefined;
        }
        return rot13(data.hints);
    }

    private toggleHintsDisplayMode = async (): Promise<void> => {
        const current = this.preferenceService.get(this.displayDecodedHintsPreferenceKey, false) as boolean;
        await this.preferenceService.set(this.displayDecodedHintsPreferenceKey, !current, PreferenceScope.User);
        this.update();
    };

    private truncate(value: string, maxLength: number): string {
        if (value.length <= maxLength) {
            return value;
        }
        return `${value.substring(0, maxLength).trim()}…`;
    }

    private async confirmStoreAllImages(options: { geocacheId: number; pendingCount: number }): Promise<boolean> {
        const dialog = new ConfirmDialog({
            title: 'Stockage local des images',
            msg: `Stocker localement ${options.pendingCount} image(s) pour cette géocache ?`,
        });
        const confirmed = await dialog.open();
        return Boolean(confirmed);
    }

    private getImagesStorageDefaultMode(): 'never' | 'prompt' | 'always' {
        const raw = this.preferenceService.get(this.imagesStorageDefaultModePreferenceKey, 'prompt') as string;
        if (raw === 'never' || raw === 'prompt' || raw === 'always') {
            return raw;
        }
        return 'prompt';
    }

    private getImagesGalleryThumbnailSize(): 'small' | 'medium' | 'large' {
        const raw = this.preferenceService.get(this.imagesGalleryThumbnailSizePreferenceKey, 'small') as string;
        if (raw === 'small' || raw === 'medium' || raw === 'large') {
            return raw;
        }
        return 'small';
    }

    private async setImagesGalleryThumbnailSize(size: 'small' | 'medium' | 'large'): Promise<void> {
        await this.preferenceService.set(this.imagesGalleryThumbnailSizePreferenceKey, size, PreferenceScope.User);
        this.update();
    }

    private getImagesGalleryHiddenDomainsText(): string {
        const raw = this.preferenceService.get(this.imagesGalleryHiddenDomainsPreferenceKey, '') as unknown;
        if (typeof raw === 'string') {
            return raw;
        }
        if (Array.isArray(raw)) {
            return raw.filter((v): v is string => typeof v === 'string').join('\n');
        }
        return '';
    }

    private async setImagesGalleryHiddenDomainsText(value: string): Promise<void> {
        await this.preferenceService.set(this.imagesGalleryHiddenDomainsPreferenceKey, value ?? '', PreferenceScope.User);
        this.update();
    }

    private getOcrDefaultEngine(): 'easyocr_ocr' | 'vision_ocr' {
        const raw = this.preferenceService.get(this.ocrDefaultEnginePreferenceKey, 'easyocr_ocr') as string;
        if (raw === 'vision_ocr' || raw === 'easyocr_ocr') {
            return raw;
        }
        return 'easyocr_ocr';
    }

    private getOcrDefaultLanguage(): string {
        const raw = this.preferenceService.get(this.ocrDefaultLanguagePreferenceKey, 'auto') as string;
        return (raw || 'auto').toString();
    }

    private getOcrLmstudioBaseUrl(): string {
        const raw = this.preferenceService.get(this.ocrLmstudioBaseUrlPreferenceKey, 'http://localhost:1234') as string;
        return (raw || 'http://localhost:1234').toString();
    }

    private getOcrLmstudioModel(): string {
        const raw = this.preferenceService.get(this.ocrLmstudioModelPreferenceKey, '') as string;
        return (raw || '').toString();
    }

    private getImagesGalleryHiddenDomains(): string[] {
        const raw = this.preferenceService.get(this.imagesGalleryHiddenDomainsPreferenceKey, '') as unknown;
        if (Array.isArray(raw)) {
            return raw
                .filter((v): v is string => typeof v === 'string')
                .map(v => v.trim().toLowerCase())
                .filter(v => Boolean(v));
        }

        if (typeof raw !== 'string') {
            return [];
        }

        return raw
            .split(/[\n\r,;]+/g)
            .map(v => v.trim().toLowerCase())
            .filter(v => Boolean(v));
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
        const displayDecodedHints = this.preferenceService.get(this.displayDecodedHintsPreferenceKey, false) as boolean;
        const decodedHints = d ? this.getDecodedHints(d) : undefined;
        const rawHints = d?.hints;
        const hasHints = Boolean(rawHints) || Boolean(d?.hints_decoded);
        const displayedHints = hasHints
            ? (displayDecodedHints ? (decodedHints || rawHints) : (rawHints || decodedHints))
            : undefined;
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
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button
                                        className='theia-button secondary'
                                        onClick={this.solveFormula}
                                        style={{ fontSize: 12, padding: '4px 12px' }}
                                        title='Ouvrir le Formula Solver'
                                    >
                                        🧮 Résoudre formule
                                    </button>
                                    <button
                                        className='theia-button secondary'
                                        onClick={this.analyzePage}
                                        style={{ fontSize: 12, padding: '4px 12px' }}
                                        title='Lancer l analyse complète de la page'
                                    >
                                        🔍 Analyse Page
                                    </button>
                                    <button
                                        className='theia-button secondary'
                                        onClick={this.analyzeWithPlugins}
                                        style={{ fontSize: 12, padding: '4px 12px' }}
                                        title='Analyser cette géocache avec les plugins'
                                    >
                                        🔌 Analyser avec plugins
                                    </button>
                                    <button
                                        className='theia-button'
                                        onClick={this.openGeocacheAIChat}
                                        style={{ fontSize: 12, padding: '4px 12px' }}
                                        title='Ouvrir un chat IA dédié à cette géocache'
                                    >
                                        🤖 Chat IA
                                    </button>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button
                                            className='theia-button secondary'
                                            onClick={this.openLogs}
                                            style={{ fontSize: 12, padding: '4px 12px' }}
                                            title='Voir les logs de cette géocache'
                                        >
                                            💬 Logs
                                        </button>
                                        <button
                                            className='theia-button secondary'
                                            onClick={this.openNotes}
                                            style={{ fontSize: 12, padding: '4px 12px' }}
                                            title='Voir les notes de cette géocache'
                                        >
                                            📝 Notes{this.notesCount && this.notesCount > 0 ? ` (${this.notesCount})` : ''}
                                        </button>
                                    </div>
                                </div>
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

                        {displayedHints ? (
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 12 }}>
                                    <h4 style={{ margin: '8px 0' }}>Indices</h4>
                                    <button
                                        className='theia-button'
                                        onClick={() => { void this.toggleHintsDisplayMode(); }}
                                        title={displayDecodedHints ? 'Coder (ROT13)' : 'Décoder (ROT13)'}
                                    >
                                        {displayDecodedHints ? 'Coder' : 'Décoder'}
                                    </button>
                                </div>
                                <div style={{ whiteSpace: 'pre-wrap', opacity: 0.9 }}>{displayedHints}</div>
                            </div>
                        ) : undefined}

                        {this.geocacheId ? (
                            <GeocacheImagesPanel
                                backendBaseUrl={this.backendBaseUrl}
                                geocacheId={this.geocacheId}
                                storageDefaultMode={this.getImagesStorageDefaultMode()}
                                onConfirmStoreAll={async (opts) => this.confirmStoreAllImages(opts)}
                                thumbnailSize={this.getImagesGalleryThumbnailSize()}
                                onThumbnailSizeChange={async (size) => this.setImagesGalleryThumbnailSize(size)}
                                hiddenDomains={this.getImagesGalleryHiddenDomains()}
                                hiddenDomainsText={this.getImagesGalleryHiddenDomainsText()}
                                onHiddenDomainsTextChange={async (value: string) => this.setImagesGalleryHiddenDomainsText(value)}
                                ocrDefaultEngine={this.getOcrDefaultEngine()}
                                ocrDefaultLanguage={this.getOcrDefaultLanguage()}
                                ocrLmstudioBaseUrl={this.getOcrLmstudioBaseUrl()}
                                ocrLmstudioModel={this.getOcrLmstudioModel()}
                                messages={this.messages}
                                languageModelRegistry={this.languageModelRegistry}
                                languageModelService={this.languageModelService}
                            />
                        ) : undefined}

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


