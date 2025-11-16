import { Style, Circle, Fill, Stroke, Text, Icon } from 'ol/style';
import { Feature } from 'ol';
import { Geometry } from 'ol/geom';
import { getIconByCacheType, GEOCACHE_SPRITE_CONFIG } from '../geocache-icon-config';

/**
 * Interface pour les propriétés d'une feature géocache
 */
export interface GeocacheFeatureProperties {
    id: number;
    gc_code: string;
    name: string;
    cache_type: string;
    difficulty?: number;
    terrain?: number;
    found?: boolean;
    selected?: boolean;
    isWaypoint?: boolean;  // ✅ Indique si c'est un waypoint
    waypointId?: number;   // ✅ ID du waypoint (si isWaypoint = true)
    bruteForceId?: string; // ✅ ID pour les points brute force (suppression)
}

/**
 * Options pour le style des géocaches
 */
export interface GeocacheStyleOptions {
    opacity?: number;
    scale?: number;
}

/**
 * Crée le style pour une feature géocache individuelle en utilisant le sprite sheet
 */
export function createGeocacheStyleFromSprite(feature: Feature<Geometry>, resolution: number, options?: GeocacheStyleOptions): Style | Style[] {
    const properties = feature.getProperties() as GeocacheFeatureProperties;
    const isSelected = properties.selected === true;
    
    // Récupérer l'icône correspondant au type de cache
    const iconDef = getIconByCacheType(properties.cache_type || 'Unknown Cache');
    
    if (!iconDef) {
        // Fallback vers un style par défaut si le type n'est pas trouvé
        return createFallbackStyle(isSelected, properties.found, options);
    }

    const baseScale = isSelected ? 1.0 : 0.8;
    const scale = options?.scale ? baseScale * options.scale : baseScale;
    const baseOpacity = properties.found ? 0.6 : 1.0;
    const opacity = options?.opacity !== undefined ? baseOpacity * options.opacity : baseOpacity;

    const style = new Style({
        image: new Icon({
            src: GEOCACHE_SPRITE_CONFIG.url,
            size: [iconDef.w, iconDef.h],
            offset: [iconDef.x, iconDef.y],
            scale: scale,
            opacity: opacity,
            anchor: [0.5, 1], // Ancre au bas de l'icône (comme un pin)
        }),
        zIndex: isSelected ? 1000 : 1
    });

    // Si sélectionné, ajouter un cercle de surbrillance
    if (isSelected) {
        return [
            new Style({
                image: new Circle({
                    radius: 30,
                    fill: new Fill({
                        color: 'rgba(0, 122, 255, 0.2)'
                    }),
                    stroke: new Stroke({
                        color: 'rgba(0, 122, 255, 0.8)',
                        width: 3
                    })
                }),
                zIndex: 999
            }),
            style
        ];
    }

    return style;
}

/**
 * Style de secours si le type de cache n'est pas trouvé
 */
function createFallbackStyle(isSelected: boolean, found?: boolean, options?: GeocacheStyleOptions): Style {
    const baseRadius = isSelected ? 10 : 8;
    const radius = options?.scale ? baseRadius * options.scale : baseRadius;
    const baseOpacity = found ? 0.6 : 1.0;
    const opacity = options?.opacity !== undefined ? baseOpacity * options.opacity : baseOpacity;

    return new Style({
        image: new Circle({
            radius: radius,
            fill: new Fill({
                color: `rgba(255, 140, 0, ${opacity})` // Orange
            }),
            stroke: new Stroke({
                color: isSelected ? 'rgba(0, 122, 255, 1)' : 'rgba(255, 255, 255, 0.8)',
                width: isSelected ? 3 : 2
            })
        }),
        zIndex: isSelected ? 1000 : 1
    });
}

/**
 * Style pour les waypoints (à utiliser dans le futur)
 */
export function createWaypointStyleFromSprite(feature: Feature<Geometry>, resolution: number): Style {
    const properties = feature.getProperties();
    const isSelected = properties.selected === true;

    return new Style({
        image: new Circle({
            radius: isSelected ? 8 : 6,
            fill: new Fill({
                color: 'rgba(76, 175, 80, 0.8)' // Vert
            }),
            stroke: new Stroke({
                color: isSelected ? 'rgba(0, 122, 255, 1)' : 'rgba(255, 255, 255, 0.8)',
                width: isSelected ? 3 : 2
            })
        }),
        text: new Text({
            text: properties.name || 'WP',
            offsetY: -15,
            fill: new Fill({
                color: '#333'
            }),
            stroke: new Stroke({
                color: '#fff',
                width: 3
            }),
            font: '12px sans-serif'
        }),
        zIndex: isSelected ? 1000 : 5
    });
}

/**
 * Style mis en évidence pour une coordonnée détectée par un plugin
 */
export function createDetectedCoordinateStyle(feature: Feature<Geometry>): Style[] {
    const isAutoSaved = feature.get('autoSaved') === true;
    const formatted = feature.get('formatted') as string | undefined;
    const pluginName = feature.get('pluginName') as string | undefined;

    const baseColor = isAutoSaved ? 'rgba(46, 204, 113, 0.85)' : 'rgba(52, 152, 219, 0.85)';
    const borderColor = isAutoSaved ? '#2ecc71' : '#3498db';

    return [
        new Style({
            image: new Circle({
                radius: 18,
                stroke: new Stroke({
                    color: borderColor,
                    width: 4
                })
            }),
            zIndex: 1900
        }),
        new Style({
            image: new Circle({
                radius: 10,
                fill: new Fill({
                    color: baseColor
                }),
                stroke: new Stroke({
                    color: '#ffffff',
                    width: 2
                })
            }),
            zIndex: 2000
        }),
        new Style({
            text: new Text({
                text: pluginName ? `🔍 ${pluginName}` : formatted || 'Coordonnée détectée',
                offsetY: -24,
                font: '12px "Fira Sans", sans-serif',
                fill: new Fill({
                    color: '#1a1a1a'
                }),
                stroke: new Stroke({
                    color: '#ffffff',
                    width: 3
                }),
                backgroundFill: new Fill({
                    color: 'rgba(255, 255, 255, 0.9)'
                }),
                backgroundStroke: new Stroke({
                    color: borderColor,
                    width: 1
                }),
                padding: [2, 6, 2, 6]
            }),
            zIndex: 2100
        })
    ];
}
