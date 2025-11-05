import { injectable } from '@theia/core/shared/inversify';
import { Emitter, Event as TheiaEvent } from '@theia/core/lib/common/event';
import { Coordinate } from 'ol/coordinate';
import { MapGeocache } from './map-layer-manager';

/**
 * Interface pour l'état de la vue de la carte
 */
export interface MapViewState {
    center: Coordinate;
    zoom: number;
}

/**
 * Interface pour une géocache sélectionnée
 */
export interface SelectedGeocache {
    id: number;
    gc_code: string;
    name: string;
    latitude: number;
    longitude: number;
    cache_type: string;
}

export interface DetectedCoordinateHighlight {
    latitude: number;
    longitude: number;
    formatted?: string;
    gcCode?: string;
    pluginName?: string;
    autoSaved?: boolean;
    replaceExisting?: boolean;
    waypointTitle?: string;
    waypointNote?: string;
    sourceResultText?: string;
    interactionType?: string; // Added interactionType property
    interactionData?: any; // Added interactionData property
}

interface DetectedCoordinateHighlightEventDetail {
    gcCode?: string;
    pluginName?: string;
    coordinates?: {
        latitude?: number;
        longitude?: number;
        formatted?: string;
    };
    autoSaved?: boolean;
    replaceExisting?: boolean;
    waypointTitle?: string;
    waypointNote?: string;
    sourceResultText?: string;
    interactionType?: string; // Added interactionType property
    interactionData?: any; // Added interactionData property
}

/**
 * Service singleton pour gérer l'état partagé de la carte
 * 
 * Ce service permet la synchronisation entre :
 * - Le tableau des géocaches
 * - La carte dans le Bottom Layer
 * - Les autres widgets qui interagissent avec la carte
 */
@injectable()
export class MapService {
    // Événements pour la sélection de géocaches
    private readonly onDidSelectGeocacheEmitter = new Emitter<SelectedGeocache>();
    readonly onDidSelectGeocache: TheiaEvent<SelectedGeocache> = this.onDidSelectGeocacheEmitter.event;

    // Événements pour la désélection
    private readonly onDidDeselectGeocacheEmitter = new Emitter<void>();
    readonly onDidDeselectGeocache: TheiaEvent<void> = this.onDidDeselectGeocacheEmitter.event;

    // Événements pour le changement de vue
    private readonly onDidChangeViewEmitter = new Emitter<MapViewState>();
    readonly onDidChangeView: TheiaEvent<MapViewState> = this.onDidChangeViewEmitter.event;

    // Événements pour le chargement de géocaches
    private readonly onDidLoadGeocachesEmitter = new Emitter<MapGeocache[]>();
    readonly onDidLoadGeocaches: TheiaEvent<MapGeocache[]> = this.onDidLoadGeocachesEmitter.event;

    // Événements pour le changement de fond de carte
    private readonly onDidChangeTileProviderEmitter = new Emitter<string>();
    readonly onDidChangeTileProvider: TheiaEvent<string> = this.onDidChangeTileProviderEmitter.event;

    // Événement pour mettre en avant une coordonnée détectée (Plugin Executor → Carte)
    private readonly onDidHighlightCoordinateEmitter = new Emitter<DetectedCoordinateHighlight | undefined>();
    readonly onDidHighlightCoordinate: TheiaEvent<DetectedCoordinateHighlight | undefined> = this.onDidHighlightCoordinateEmitter.event;

    // État interne
    private selectedGeocache: SelectedGeocache | null = null;
    private currentView: MapViewState | null = null;
    private loadedGeocaches: MapGeocache[] = [];
    private currentTileProvider: string = 'osm';
    private lastHighlightedCoordinate: DetectedCoordinateHighlight | undefined;

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('geoapp-map-highlight-coordinate', this.handleHighlightCoordinateEvent as EventListener);
            window.addEventListener('geoapp-map-highlight-clear', this.handleHighlightClearEvent as EventListener);
        }
    }

    private handleHighlightCoordinateEvent = (event: Event): void => {
        const customEvent = event as CustomEvent<DetectedCoordinateHighlightEventDetail>;
        const detail = customEvent.detail;

        if (!detail?.coordinates) {
            console.warn('[MapService] Highlight event ignoré: detail.coordinates absent', detail);
            return;
        }

        const { latitude, longitude, formatted } = detail.coordinates;
        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
            console.warn('[MapService] Highlight event ignoré: latitude/longitude non numériques', detail.coordinates);
            return;
        }

        console.log('[MapService] Reçu geoapp-map-highlight-coordinate', {
            gcCode: detail.gcCode,
            pluginName: detail.pluginName,
            coordinates: detail.coordinates,
            autoSaved: detail.autoSaved,
            waypointTitle: detail.waypointTitle,
            waypointNote: detail.waypointNote
        });

        this.highlightDetectedCoordinate({
            latitude,
            longitude,
            formatted,
            gcCode: detail.gcCode,
            pluginName: detail.pluginName,
            autoSaved: detail.autoSaved,
            replaceExisting: detail.replaceExisting,
            waypointTitle: detail.waypointTitle,
            waypointNote: detail.waypointNote,
            sourceResultText: detail.sourceResultText
        });
    };

    private handleHighlightClearEvent = (): void => {
        console.log('[MapService] Reçu geoapp-map-highlight-clear');
        this.clearHighlightedCoordinate();
    };

    /**
     * Sélectionne une géocache et notifie tous les écouteurs
     */
    selectGeocache(geocache: SelectedGeocache): void {
        this.selectedGeocache = geocache;
        this.onDidSelectGeocacheEmitter.fire(geocache);
    }

    /**
     * Désélectionne la géocache actuelle
     */
    deselectGeocache(): void {
        this.selectedGeocache = null;
        this.onDidDeselectGeocacheEmitter.fire();
    }

    /**
     * Récupère la géocache actuellement sélectionnée
     */
    getSelectedGeocache(): SelectedGeocache | null {
        return this.selectedGeocache;
    }

    /**
     * Met à jour l'état de la vue de la carte
     */
    updateView(center: Coordinate, zoom: number): void {
        this.currentView = { center, zoom };
        this.onDidChangeViewEmitter.fire(this.currentView);
    }

    /**
     * Récupère l'état actuel de la vue
     */
    getCurrentView(): MapViewState | null {
        return this.currentView;
    }

    /**
     * Charge une liste de géocaches et notifie les écouteurs
     */
    loadGeocaches(geocaches: MapGeocache[]): void {
        console.log('[MapService] loadGeocaches appelé avec:', geocaches.length, 'géocaches');
        console.log('[MapService] Première géocache:', geocaches[0]);
        this.loadedGeocaches = geocaches;
        this.onDidLoadGeocachesEmitter.fire(geocaches);
        console.log('[MapService] Event onDidLoadGeocaches émis');
    }

    /**
     * Ajoute une géocache à la liste actuelle
     */
    addGeocache(geocache: MapGeocache): void {
        this.loadedGeocaches.push(geocache);
        this.onDidLoadGeocachesEmitter.fire(this.loadedGeocaches);
    }

    /**
     * Supprime une géocache de la liste actuelle
     */
    removeGeocache(geocacheId: number): void {
        this.loadedGeocaches = this.loadedGeocaches.filter(gc => gc.id !== geocacheId);
        this.onDidLoadGeocachesEmitter.fire(this.loadedGeocaches);
    }

    /**
     * Récupère toutes les géocaches chargées
     */
    getLoadedGeocaches(): MapGeocache[] {
        return [...this.loadedGeocaches];
    }

    /**
     * Efface toutes les géocaches chargées
     */
    clearGeocaches(): void {
        this.loadedGeocaches = [];
        this.onDidLoadGeocachesEmitter.fire([]);
    }

    /**
     * Change le fournisseur de tuiles (fond de carte)
     */
    changeTileProvider(providerId: string): void {
        this.currentTileProvider = providerId;
        this.onDidChangeTileProviderEmitter.fire(providerId);
    }

    /**
     * Récupère le fournisseur de tuiles actuel
     */
    getCurrentTileProvider(): string {
        return this.currentTileProvider;
    }

    /**
     * Met en évidence une coordonnée détectée sur la carte et notifie les listeners.
     */
    highlightDetectedCoordinate(coordinate: DetectedCoordinateHighlight): void {
        this.lastHighlightedCoordinate = coordinate;
        console.log('[MapService] Highlight coordonnée mise à jour', coordinate);
        this.onDidHighlightCoordinateEmitter.fire(coordinate);
    }

    /**
     * Efface la coordonnée détectée actuellement mise en évidence.
     */
    clearHighlightedCoordinate(): void {
        this.lastHighlightedCoordinate = undefined;
        console.log('[MapService] Highlight coordonnée effacée');
        this.onDidHighlightCoordinateEmitter.fire(undefined);
    }

    /**
     * Récupère la dernière coordonnée détectée mise en évidence (si disponible).
     */
    getLastHighlightedCoordinate(): DetectedCoordinateHighlight | undefined {
        return this.lastHighlightedCoordinate;
    }

    /**
     * Centre la carte sur une géocache spécifique
     * Cette méthode est utilisée par le tableau pour centrer la carte
     */
    centerOnGeocache(geocache: SelectedGeocache, zoom?: number): void {
        this.selectGeocache(geocache);
        
        // Si un zoom est spécifié, mettre à jour la vue
        if (zoom !== undefined) {
            const coordinate: Coordinate = [geocache.longitude, geocache.latitude];
            this.updateView(coordinate, zoom);
        }
    }

    /**
     * Centre la carte sur un ensemble de géocaches (calcul de l'étendue optimale)
     */
    centerOnGeocaches(geocaches: SelectedGeocache[]): void {
        if (geocaches.length === 0) {
            return;
        }

        if (geocaches.length === 1) {
            this.centerOnGeocache(geocaches[0], 15);
            return;
        }

        // Pour plusieurs géocaches, on va simplement centrer sur la première
        // Le MapView calculera l'étendue optimale
        this.loadGeocaches(geocaches.map(gc => ({
            id: gc.id,
            gc_code: gc.gc_code,
            name: gc.name,
            cache_type: gc.cache_type,
            latitude: gc.latitude,
            longitude: gc.longitude
        })));
    }

    /**
     * Nettoie les ressources
     */
    dispose(): void {
        this.onDidSelectGeocacheEmitter.dispose();
        this.onDidDeselectGeocacheEmitter.dispose();
        this.onDidChangeViewEmitter.dispose();
        this.onDidLoadGeocachesEmitter.dispose();
        this.onDidChangeTileProviderEmitter.dispose();

        if (typeof window !== 'undefined') {
            window.removeEventListener('geoapp-map-highlight-coordinate', this.handleHighlightCoordinateEvent as EventListener);
            window.removeEventListener('geoapp-map-highlight-clear', this.handleHighlightClearEvent as EventListener);
        }
    }
}


