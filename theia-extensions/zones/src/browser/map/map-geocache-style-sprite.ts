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
}

/**
 * Crée le style pour une feature géocache individuelle en utilisant le sprite sheet
 */
export function createGeocacheStyleFromSprite(feature: Feature<Geometry>, resolution: number): Style | Style[] {
    const properties = feature.getProperties() as GeocacheFeatureProperties;
    const isSelected = properties.selected === true;
    
    // Récupérer l'icône correspondant au type de cache
    const iconDef = getIconByCacheType(properties.cache_type || 'Unknown Cache');
    
    if (!iconDef) {
        // Fallback vers un style par défaut si le type n'est pas trouvé
        return createFallbackStyle(isSelected, properties.found);
    }

    const scale = isSelected ? 1.0 : 0.8;
    const opacity = properties.found ? 0.6 : 1.0;

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
function createFallbackStyle(isSelected: boolean, found?: boolean): Style {
    const radius = isSelected ? 10 : 8;
    const opacity = found ? 0.6 : 1.0;

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

