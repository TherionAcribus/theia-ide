import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Feature } from 'ol';
import { Point } from 'ol/geom';
import Map from 'ol/Map';
import { createClusterSource } from './map-clustering';
import { createClusterStyle } from './map-geocache-style';
import { createGeocacheStyleFromSprite, createWaypointStyleFromSprite, createDetectedCoordinateStyle, GeocacheFeatureProperties } from './map-geocache-style-sprite';
import { lonLatToMapCoordinate } from './map-utils';
import { createTileLayer, DEFAULT_PROVIDER_ID } from './map-tile-providers';
import { DetectedCoordinateHighlight } from './map-service';

/**
 * Interface pour un waypoint de géocache
 */
export interface MapWaypoint {
    id: number;
    prefix: string | null;
    lookup: string | null;
    name: string | null;
    type: string | null;
    latitude: number | null;
    longitude: number | null;
    gc_coords: string | null;
    note: string | null;
}

/**
 * Interface pour une géocache à afficher sur la carte
 */
export interface MapGeocache {
    id: number;
    gc_code: string;
    name: string;
    cache_type: string;
    latitude: number;
    longitude: number;
    difficulty?: number;
    terrain?: number;
    found?: boolean;
    is_corrected?: boolean;
    original_latitude?: number;
    original_longitude?: number;
    waypoints?: MapWaypoint[];
}

/**
 * Gestionnaire des couches de la carte
 * Gère les couches de tuiles (fond de carte) et les couches vectorielles (géocaches, waypoints)
 */
export class MapLayerManager {
    private map: Map;
    private tileLayer: any;
    private geocacheVectorSource: VectorSource<Feature<Point>>;
    private geocacheClusterSource: any;
    private geocacheLayer: any;
    private waypointVectorSource: VectorSource<Feature<Point>>;
    private waypointLayer: any;
    private detectedCoordinateSource: VectorSource<Feature<Point>>;
    private detectedCoordinateLayer: any;
    private currentTileProviderId: string;

    constructor(map: Map) {
        this.map = map;
        this.currentTileProviderId = DEFAULT_PROVIDER_ID;

        // Initialiser la couche de tuiles (fond de carte)
        this.tileLayer = createTileLayer(this.currentTileProviderId);
        this.map.addLayer(this.tileLayer);

        // Initialiser la couche vectorielle pour les géocaches
        this.geocacheVectorSource = new VectorSource<Feature<Point>>();
        this.geocacheClusterSource = createClusterSource(this.geocacheVectorSource);
        
        // Par défaut, afficher les géocaches individuellement (sans clustering)
        this.geocacheLayer = new VectorLayer({
            source: this.geocacheVectorSource as any,
            style: createGeocacheStyleFromSprite,
            properties: {
                name: 'geocaches'
            },
            zIndex: 10
        });
        this.map.addLayer(this.geocacheLayer);

        // Initialiser la couche pour les waypoints (pour usage futur)
        this.waypointVectorSource = new VectorSource<Feature<Point>>();
        this.waypointLayer = new VectorLayer({
            source: this.waypointVectorSource,
            style: createWaypointStyleFromSprite,
            properties: {
                name: 'waypoints'
            },
            zIndex: 20
        });
        this.map.addLayer(this.waypointLayer);

        // Couche pour une coordonnée détectée temporaire
        this.detectedCoordinateSource = new VectorSource<Feature<Point>>();
        this.detectedCoordinateLayer = new VectorLayer({
            source: this.detectedCoordinateSource,
            style: createDetectedCoordinateStyle,
            properties: {
                name: 'detected-coordinate'
            },
            zIndex: 30
        });
        this.map.addLayer(this.detectedCoordinateLayer);
    }

    /**
     * Change le fournisseur de tuiles (fond de carte)
     */
    changeTileProvider(providerId: string): void {
        if (providerId === this.currentTileProviderId) {
            return;
        }

        this.currentTileProviderId = providerId;
        this.map.removeLayer(this.tileLayer);
        this.tileLayer = createTileLayer(providerId);
        this.map.getLayers().insertAt(0, this.tileLayer);
    }

    /**
     * Récupère l'ID du fournisseur de tuiles actuel
     */
    getCurrentTileProvider(): string {
        return this.currentTileProviderId;
    }

    /**
     * Ajoute une géocache à la carte
     */
    addGeocache(geocache: MapGeocache): Feature<Point> {
        const coordinate = lonLatToMapCoordinate(geocache.longitude, geocache.latitude);
        
        const feature = new Feature({
            geometry: new Point(coordinate)
        });

        feature.setId(geocache.id);
        feature.setProperties({
            id: geocache.id,
            gc_code: geocache.gc_code,
            name: geocache.name,
            cache_type: geocache.cache_type,
            difficulty: geocache.difficulty,
            terrain: geocache.terrain,
            found: geocache.found,
            selected: false
        } as GeocacheFeatureProperties);

        this.geocacheVectorSource.addFeature(feature);
        return feature;
    }

    /**
     * Ajoute plusieurs géocaches à la carte
     */
    addGeocaches(geocaches: MapGeocache[]): void {
        console.log('[MapLayerManager] addGeocaches appelé avec:', geocaches.length, 'géocaches');
        
        // Effacer les waypoints existants
        this.clearWaypoints();
        
        const features = geocaches.map(geocache => {
            const coordinate = lonLatToMapCoordinate(geocache.longitude, geocache.latitude);
            console.log(`[MapLayerManager] Géocache ${geocache.gc_code}: lon=${geocache.longitude}, lat=${geocache.latitude} -> coord=`, coordinate);
            
            const feature = new Feature({
                geometry: new Point(coordinate)
            });

            feature.setId(geocache.id);
            feature.setProperties({
                id: geocache.id,
                gc_code: geocache.gc_code,
                name: geocache.name,
                cache_type: geocache.cache_type,
                difficulty: geocache.difficulty,
                terrain: geocache.terrain,
                found: geocache.found,
                selected: false
            } as GeocacheFeatureProperties);

            return feature;
        });

        console.log('[MapLayerManager] Features créées:', features.length);
        this.geocacheVectorSource.addFeatures(features);
        console.log('[MapLayerManager] Features ajoutées à la source vectorielle');
        console.log('[MapLayerManager] Nombre total de features dans la source:', this.geocacheVectorSource.getFeatures().length);
        
        // Ajouter les waypoints et coordonnées originales
        geocaches.forEach(geocache => {
            // Ajouter les coordonnées originales si la cache est corrigée
            if (geocache.is_corrected && 
                geocache.original_latitude !== null && 
                geocache.original_latitude !== undefined &&
                geocache.original_longitude !== null && 
                geocache.original_longitude !== undefined) {
                this.addWaypoint(
                    `orig_${geocache.id}`,
                    `${geocache.gc_code} - Original`,
                    geocache.original_longitude,
                    geocache.original_latitude
                );
            }
            
            // Ajouter les waypoints
            if (geocache.waypoints && geocache.waypoints.length > 0) {
                geocache.waypoints.forEach(waypoint => {
                    if (waypoint.latitude !== null && 
                        waypoint.latitude !== undefined &&
                        waypoint.longitude !== null && 
                        waypoint.longitude !== undefined) {
                        this.addWaypoint(
                            waypoint.id,
                            waypoint.name || waypoint.lookup || `WP${waypoint.id}`,
                            waypoint.longitude,
                            waypoint.latitude
                        );
                    }
                });
            }
        });
    }

    /**
     * Supprime une géocache de la carte par son ID
     */
    removeGeocache(geocacheId: number): void {
        const feature = this.geocacheVectorSource.getFeatureById(geocacheId);
        if (feature) {
            this.geocacheVectorSource.removeFeature(feature);
        }
    }

    /**
     * Supprime toutes les géocaches de la carte
     */
    clearGeocaches(): void {
        this.geocacheVectorSource.clear();
    }

    /**
     * Récupère une feature géocache par son ID
     */
    getGeocacheFeature(geocacheId: number): Feature<Point> | null {
        return this.geocacheVectorSource.getFeatureById(geocacheId) as Feature<Point> | null;
    }

    /**
     * Récupère toutes les features géocaches
     */
    getAllGeocacheFeatures(): Feature<Point>[] {
        return this.geocacheVectorSource.getFeatures();
    }

    /**
     * Met en surbrillance une géocache (la sélectionne visuellement)
     */
    selectGeocache(geocacheId: number): void {
        // Désélectionner toutes les géocaches
        this.geocacheVectorSource.getFeatures().forEach(feature => {
            feature.set('selected', false);
        });

        // Sélectionner la géocache demandée
        const feature = this.geocacheVectorSource.getFeatureById(geocacheId);
        if (feature) {
            feature.set('selected', true);
            // Forcer le recalcul du style
            feature.changed();
        }
    }

    /**
     * Désélectionne toutes les géocaches
     */
    deselectAllGeocaches(): void {
        this.geocacheVectorSource.getFeatures().forEach(feature => {
            feature.set('selected', false);
            feature.changed();
        });
    }

    /**
     * Ajoute un waypoint
     */
    addWaypoint(id: number | string, name: string, lon: number, lat: number): Feature<Point> {
        const coordinate = lonLatToMapCoordinate(lon, lat);
        
        const feature = new Feature({
            geometry: new Point(coordinate)
        });

        feature.setId(`waypoint_${id}`);
        feature.setProperties({
            id: id,
            name: name,
            type: 'waypoint',
            selected: false,
            isWaypoint: true,  // ✅ Marquer comme waypoint pour le menu contextuel
            waypointId: typeof id === 'number' ? id : undefined  // ✅ ID numérique du waypoint (pas pour les waypoints "orig_")
        });

        this.waypointVectorSource.addFeature(feature);
        return feature;
    }

    /**
     * Supprime tous les waypoints
     */
    clearWaypoints(): void {
        this.waypointVectorSource.clear();
    }

    /**
     * Affiche une coordonnée détectée temporaire sur la carte.
     */
    showDetectedCoordinate(highlight: DetectedCoordinateHighlight): void {
        console.log('[MapLayerManager] showDetectedCoordinate called', highlight);
        
        const shouldClear = highlight.replaceExisting !== true;
        if (shouldClear) {
            console.log('[MapLayerManager] Clearing previous detected coordinates');
            this.detectedCoordinateSource.clear();
        }

        if (highlight.latitude === undefined || highlight.longitude === undefined) {
            console.log('[MapLayerManager] Invalid coordinates, skipping');
            return;
        }

        const coordinate = lonLatToMapCoordinate(highlight.longitude, highlight.latitude);
        console.log('[MapLayerManager] Creating feature at coordinate', coordinate);
        
        const feature = new Feature({
            geometry: new Point(coordinate)
        });

        feature.setProperties({
            isDetectedCoordinate: true,
            formatted: highlight.formatted,
            pluginName: highlight.pluginName,
            autoSaved: highlight.autoSaved,
            gcCode: highlight.gcCode,
            latDecimal: highlight.latitude,
            lonDecimal: highlight.longitude,
            replaceExisting: highlight.replaceExisting,
            waypointTitle: highlight.waypointTitle,
            waypointNote: highlight.waypointNote,
            sourceResultText: highlight.sourceResultText,
            gc_code: highlight.gcCode || 'Point détecté',
            name: highlight.waypointTitle || highlight.pluginName || highlight.formatted || 'Coordonnée détectée',
            cache_type: 'Coordonnée détectée',
            note: highlight.waypointNote || highlight.sourceResultText || highlight.formatted || '',
            coordinatesFormatted: highlight.formatted
        });

        this.detectedCoordinateSource.addFeature(feature);
        console.log('[MapLayerManager] Feature added to detectedCoordinateSource, total features:', this.detectedCoordinateSource.getFeatures().length);
    }

    /**
     * Affiche plusieurs coordonnées détectées simultanément (pour brute force)
     */
    showMultipleDetectedCoordinates(highlights: DetectedCoordinateHighlight[]): void {
        console.log('[MapLayerManager] showMultipleDetectedCoordinates called', highlights.length);
        
        // Effacer les points précédents
        this.detectedCoordinateSource.clear();
        
        // Ajouter chaque point
        for (const highlight of highlights) {
            if (highlight.latitude === undefined || highlight.longitude === undefined) {
                console.warn('[MapLayerManager] Skipping invalid coordinate', highlight);
                continue;
            }

            const coordinate = lonLatToMapCoordinate(highlight.longitude, highlight.latitude);
            
            const feature = new Feature({
                geometry: new Point(coordinate)
            });

            feature.setProperties({
                isDetectedCoordinate: true,
                formatted: highlight.formatted,
                pluginName: highlight.pluginName,
                autoSaved: highlight.autoSaved,
                gcCode: highlight.gcCode,
                latDecimal: highlight.latitude,
                lonDecimal: highlight.longitude,
                replaceExisting: highlight.replaceExisting,
                waypointTitle: highlight.waypointTitle,
                waypointNote: highlight.waypointNote,
                sourceResultText: highlight.sourceResultText,
                gc_code: highlight.gcCode || 'Point détecté',
                name: highlight.waypointTitle || highlight.pluginName || highlight.formatted || 'Coordonnée détectée',
                cache_type: 'Coordonnée détectée',
                note: highlight.waypointNote || highlight.sourceResultText || highlight.formatted || '',
                coordinatesFormatted: highlight.formatted
            });

            this.detectedCoordinateSource.addFeature(feature);
        }
        
        console.log('[MapLayerManager] Added', highlights.length, 'features to detectedCoordinateSource, total:', this.detectedCoordinateSource.getFeatures().length);
    }

    clearDetectedCoordinate(): void {
        this.detectedCoordinateSource.clear();
    }

    /**
     * Récupère la source vectorielle des géocaches (pour interactions avancées)
     */
    getGeocacheVectorSource(): VectorSource<Feature<Point>> {
        return this.geocacheVectorSource;
    }

    /**
     * Récupère la source de clustering (pour interactions avancées)
     */
    getGeocacheClusterSource(): any {
        return this.geocacheClusterSource;
    }

    /**
     * Active ou désactive le clustering
     */
    setClusteringEnabled(enabled: boolean): void {
        if (enabled) {
            this.geocacheLayer.setSource(this.geocacheClusterSource);
            this.geocacheLayer.setStyle(createClusterStyle);
        } else {
            this.geocacheLayer.setSource(this.geocacheVectorSource as any);
            this.geocacheLayer.setStyle(createGeocacheStyleFromSprite);
        }
    }

    /**
     * Nettoie toutes les couches
     */
    dispose(): void {
        this.clearGeocaches();
        this.clearWaypoints();
        this.clearDetectedCoordinate();
    }
}

