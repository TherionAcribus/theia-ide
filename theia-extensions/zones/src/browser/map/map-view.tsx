import * as React from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import { defaults as defaultControls, ScaleLine, FullScreen } from 'ol/control';
import { defaults as defaultInteractions } from 'ol/interaction';
import Overlay from 'ol/Overlay';
import 'ol/ol.css';
import { MapLayerManager, MapGeocache } from './map-layer-manager';
import { MapService } from './map-service';
import { lonLatToMapCoordinate, calculateExtent, mapCoordinateToLonLat, formatGeocachingCoordinates } from './map-utils';
import { TILE_PROVIDERS } from './map-tile-providers';
import { fromLonLat } from 'ol/proj';
import { GeocacheFeatureProperties } from './map-geocache-style-sprite';
import { ContextMenu, ContextMenuItem } from '../context-menu';

export interface MapViewProps {
    mapService: MapService;
    geocaches: MapGeocache[];  // ✅ Données propres à cette carte
    onMapReady?: (map: Map) => void;
    onAddWaypoint?: (gcCoords: string) => void;  // ✅ Callback pour ajouter un waypoint
    onDeleteWaypoint?: (waypointId: number) => void;  // ✅ Callback pour supprimer un waypoint
    onSetWaypointAsCorrectedCoords?: (waypointId: number) => void;  // ✅ Callback pour définir comme coordonnées corrigées
}

/**
 * Composant React qui affiche la carte OpenLayers
 */
export const MapView: React.FC<MapViewProps> = ({ mapService, geocaches, onMapReady, onAddWaypoint, onDeleteWaypoint, onSetWaypointAsCorrectedCoords }) => {
    const mapRef = React.useRef<HTMLDivElement>(null);
    const popupRef = React.useRef<HTMLDivElement>(null);
    const mapInstanceRef = React.useRef<any>(null);
    const layerManagerRef = React.useRef<MapLayerManager | null>(null);
    const overlayRef = React.useRef<Overlay | null>(null);
    const [isInitialized, setIsInitialized] = React.useState(false);
    const [currentProvider, setCurrentProvider] = React.useState('osm');
    const [popupData, setPopupData] = React.useState<GeocacheFeatureProperties | null>(null);
    const [contextMenu, setContextMenu] = React.useState<{ items: ContextMenuItem[]; x: number; y: number } | null>(null);

    // Initialisation de la carte
    React.useEffect(() => {
        if (!mapRef.current || isInitialized) {
            return;
        }

        // Créer la carte OpenLayers
        const map = new Map({
            target: mapRef.current,
            controls: defaultControls({
                zoom: true,
                rotate: false
            }).extend([
                new ScaleLine(),
                new FullScreen()
            ]),
            interactions: defaultInteractions({
                doubleClickZoom: true,
                dragPan: true,
                mouseWheelZoom: true,
                pinchRotate: false,
                pinchZoom: true
            }),
            view: new View({
                center: fromLonLat([2.3522, 48.8566]), // Paris par défaut
                zoom: 6,
                minZoom: 3,
                maxZoom: 19
            })
        });

        // Créer le gestionnaire de couches
        const layerManager = new MapLayerManager(map);

        // Créer l'overlay pour le popup
        if (popupRef.current) {
            const overlay = new Overlay({
                element: popupRef.current,
                autoPan: {
                    animation: {
                        duration: 250,
                    },
                },
                positioning: 'bottom-center',
                stopEvent: false,
                offset: [0, -10]
            });
            map.addOverlay(overlay);
            overlayRef.current = overlay;
        }

        // Ajouter le gestionnaire de clic gauche
        map.on('click', (evt) => {
            const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f);
            if (feature) {
                const props = feature.getProperties() as GeocacheFeatureProperties;
                if (props.id !== undefined) {
                    setPopupData(props);
                    if (overlayRef.current) {
                        overlayRef.current.setPosition(evt.coordinate);
                    }
                }
            } else {
                setPopupData(null);
                if (overlayRef.current) {
                    overlayRef.current.setPosition(undefined);
                }
            }
        });

        // Ajouter le gestionnaire de clic droit (menu contextuel)
        const mapElement = mapRef.current;
        const handleContextMenu = (event: MouseEvent) => {
            event.preventDefault();
            
            // Obtenir les coordonnées du clic sur la carte
            const pixel = map.getEventPixel(event);
            const coordinate = map.getCoordinateFromPixel(pixel);
            
            // Vérifier si on a cliqué sur une feature (géocache ou waypoint)
            const feature = map.forEachFeatureAtPixel(pixel, (f) => f);
            
            if (feature) {
                const props = feature.getProperties() as GeocacheFeatureProperties;
                
                // Si c'est un waypoint, afficher un menu contextuel spécifique
                if (props.isWaypoint && props.waypointId !== undefined) {
                    const items: ContextMenuItem[] = [
                        {
                            label: `📌 Waypoint: ${props.name || 'Sans nom'}`,
                            disabled: true
                        },
                        { separator: true }
                    ];
                    
                    // Option pour définir comme coordonnées corrigées
                    if (onSetWaypointAsCorrectedCoords) {
                        items.push({
                            label: 'Définir comme coordonnées corrigées',
                            icon: '📍',
                            action: () => {
                                onSetWaypointAsCorrectedCoords(props.waypointId!);
                            }
                        });
                    }
                    
                    // Option pour supprimer le waypoint
                    if (onDeleteWaypoint) {
                        items.push({
                            label: 'Supprimer le waypoint',
                            icon: '🗑️',
                            action: () => {
                                onDeleteWaypoint(props.waypointId!);
                            }
                        });
                    }
                    
                    setContextMenu({
                        items,
                        x: event.clientX,
                        y: event.clientY
                    });
                    return;
                }
            }
            
            // Menu contextuel par défaut (coordonnées)
            if (coordinate) {
                const [lon, lat] = mapCoordinateToLonLat(coordinate);
                
                // Créer les items du menu contextuel
                const gcCoords = formatGeocachingCoordinates(lon, lat);
                const items: ContextMenuItem[] = [
                    {
                        label: '📍 Coordonnées',
                        disabled: true
                    },
                    { separator: true },
                    {
                        label: `Format GC: ${gcCoords}`,
                        icon: '🌍',
                        action: () => {
                            navigator.clipboard.writeText(gcCoords);
                            console.log('Coordonnées GC copiées');
                        }
                    },
                    {
                        label: `Décimal: ${lat.toFixed(6)}, ${lon.toFixed(6)}`,
                        icon: '🔢',
                        action: () => {
                            navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lon.toFixed(6)}`);
                            console.log('Coordonnées décimales copiées');
                        }
                    }
                ];
                
                // Ajouter l'option "Ajouter un waypoint" si le callback est disponible
                if (onAddWaypoint) {
                    items.push({ separator: true });
                    items.push({
                        label: 'Ajouter un waypoint',
                        icon: '📌',
                        action: () => {
                            onAddWaypoint(gcCoords);
                        }
                    });
                }
                
                setContextMenu({
                    items,
                    x: event.clientX,
                    y: event.clientY
                });
            }
        };
        
        mapElement.addEventListener('contextmenu', handleContextMenu);

        mapInstanceRef.current = map;
        layerManagerRef.current = layerManager;
        setIsInitialized(true);

        if (onMapReady) {
            onMapReady(map);
        }

        // Cleanup lors du démontage
        return () => {
            if (mapElement) {
                mapElement.removeEventListener('contextmenu', handleContextMenu);
            }
            if (layerManagerRef.current) {
                layerManagerRef.current.dispose();
            }
            if (mapInstanceRef.current) {
                mapInstanceRef.current.setTarget(undefined);
                mapInstanceRef.current = null;
            }
            setIsInitialized(false);
        };
    }, []);

    // Gestion du resize
    React.useEffect(() => {
        if (!mapInstanceRef.current) {
            return;
        }

        const handleResize = () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.updateSize();
            }
        };

        window.addEventListener('resize', handleResize);

        // Forcer un update après un court délai (pour les transitions CSS)
        const timeout = setTimeout(() => {
            handleResize();
        }, 100);

        return () => {
            window.removeEventListener('resize', handleResize);
            clearTimeout(timeout);
        };
    }, [isInitialized]);

    // Écoute des événements du MapService - Sélection de géocache
    React.useEffect(() => {
        if (!mapInstanceRef.current || !layerManagerRef.current) {
            return;
        }

        const disposable = mapService.onDidSelectGeocache(geocache => {
            if (!mapInstanceRef.current || !layerManagerRef.current) {
                return;
            }

            // Sélectionner visuellement la géocache
            layerManagerRef.current.selectGeocache(geocache.id);

            // Centrer la carte sur la géocache
            const coordinate = lonLatToMapCoordinate(geocache.longitude, geocache.latitude);
            const view = mapInstanceRef.current.getView();
            view.animate({
                center: coordinate,
                zoom: Math.max(view.getZoom() || 10, 15),
                duration: 500
            });
        });

        return () => disposable.dispose();
    }, [isInitialized, mapService]);

    // Écoute des événements du MapService - Désélection
    React.useEffect(() => {
        if (!layerManagerRef.current) {
            return;
        }

        const disposable = mapService.onDidDeselectGeocache(() => {
            if (layerManagerRef.current) {
                layerManagerRef.current.deselectAllGeocaches();
            }
        });

        return () => disposable.dispose();
    }, [isInitialized, mapService]);

    // ✅ Réagit aux changements de géocaches passées en props
    React.useEffect(() => {
        if (!mapInstanceRef.current || !layerManagerRef.current) {
            return;
        }

        console.log('[MapView] Géocaches reçues en props:', geocaches.length);
        
        // Effacer les géocaches existantes
        layerManagerRef.current.clearGeocaches();

        // Ajouter les nouvelles géocaches
        if (geocaches.length > 0) {
            console.log('[MapView] Ajout de', geocaches.length, 'géocaches à la carte');
            layerManagerRef.current.addGeocaches(geocaches);

            // Centrer la carte sur les géocaches
            const coordinates = geocaches.map(gc => 
                lonLatToMapCoordinate(gc.longitude, gc.latitude)
            );
            const extent = calculateExtent(coordinates);

            if (extent) {
                const view = mapInstanceRef.current.getView();
                view.fit(extent, {
                    padding: [50, 50, 50, 50],
                    maxZoom: 15,
                    duration: 500
                });
                console.log('[MapView] Vue ajustée aux géocaches');
            }
        }
    }, [geocaches, isInitialized]);

    // Écoute des événements du MapService - Changement de fond de carte
    React.useEffect(() => {
        if (!layerManagerRef.current) {
            return;
        }

        const disposable = mapService.onDidChangeTileProvider(providerId => {
            if (layerManagerRef.current) {
                layerManagerRef.current.changeTileProvider(providerId);
                setCurrentProvider(providerId);
            }
        });

        return () => disposable.dispose();
    }, [isInitialized, mapService]);

    // Interface de changement de fond de carte
    const handleProviderChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const providerId = event.target.value;
        mapService.changeTileProvider(providerId);
    };

    return (
        <div style={{ 
            width: '100%', 
            height: '100%', 
            position: 'relative',
            display: 'flex',
            flexDirection: 'column'
        }}>
            {/* Barre d'outils */}
            <div style={{
                padding: '8px',
                background: 'var(--theia-editor-background)',
                borderBottom: '1px solid var(--theia-panel-border)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
            }}>
                <label style={{ 
                    fontSize: '12px',
                    color: 'var(--theia-foreground)'
                }}>
                    Fond de carteszzzz:
                </label>
                <select 
                    value={currentProvider}
                    onChange={handleProviderChange}
                    style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        background: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: '2px',
                        cursor: 'pointer'
                    }}
                >
                    {TILE_PROVIDERS.map(provider => (
                        <option key={provider.id} value={provider.id}>
                            {provider.name}
                        </option>
                    ))}
                </select>
            </div>

            {/* Conteneur de la carte */}
            <div 
                ref={mapRef} 
                style={{ 
                    flex: 1,
                    width: '100%',
                    background: 'var(--theia-editor-background)',
                    position: 'relative'
                }}
            >
                {/* Popup d'information */}
                <div 
                    ref={popupRef}
                    style={{
                        display: popupData ? 'block' : 'none',
                        position: 'absolute',
                        background: 'var(--theia-editor-background)',
                        border: '2px solid var(--theia-focusBorder)',
                        borderRadius: '4px',
                        padding: '12px',
                        minWidth: '200px',
                        boxShadow: '0 3px 14px rgba(0,0,0,0.4)',
                        pointerEvents: 'none'
                    }}
                >
                    {popupData && (
                        <div style={{ color: 'var(--theia-foreground)' }}>
                            <div style={{ 
                                fontWeight: 'bold', 
                                fontSize: '14px',
                                marginBottom: '8px',
                                color: 'var(--theia-textLink-foreground)'
                            }}>
                                {popupData.gc_code}
                            </div>
                            <div style={{ marginBottom: '4px', fontSize: '13px' }}>
                                {popupData.name}
                            </div>
                            <div style={{ 
                                fontSize: '12px',
                                color: 'var(--theia-descriptionForeground)',
                                marginTop: '8px',
                                display: 'flex',
                                gap: '12px'
                            }}>
                                {popupData.difficulty !== undefined && (
                                    <span>D: {popupData.difficulty.toFixed(1)}</span>
                                )}
                                {popupData.terrain !== undefined && (
                                    <span>T: {popupData.terrain.toFixed(1)}</span>
                                )}
                            </div>
                            <div style={{ 
                                fontSize: '11px',
                                color: 'var(--theia-descriptionForeground)',
                                marginTop: '6px',
                                fontStyle: 'italic'
                            }}>
                                {popupData.cache_type}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Menu contextuel */}
            {contextMenu && (
                <ContextMenu
                    items={contextMenu.items}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
};

