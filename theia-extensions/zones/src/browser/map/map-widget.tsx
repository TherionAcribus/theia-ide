import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ApplicationShell } from '@theia/core/lib/browser';
import * as React from 'react';
import { MapView } from './map-view';
import { MapService } from './map-service';
import { MapGeocache } from './map-layer-manager';

export interface MapContext {
    type: 'zone' | 'geocache' | 'general';
    id?: number;
    label: string;
}

/**
 * Widget Theia qui affiche la carte OpenLayers dans le Bottom Layer
 * Chaque contexte (zone, géocache) a sa propre instance de carte
 */
@injectable()
export class MapWidget extends ReactWidget {
    static readonly ID = 'geoapp-map';
    static readonly LABEL = 'GeoApp - Carte';

    private mapInstance: any = null;
    private context: MapContext;
    private geocaches: MapGeocache[] = [];  // ✅ Données propres à ce widget

    @inject(MapService)
    protected readonly mapService!: MapService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    constructor() {
        super();
        // Contexte par défaut
        this.context = {
            type: 'general',
            label: 'Carte Générale'
        };
    }

    /**
     * Définit le contexte de la carte (zone, géocache, etc.)
     */
    setContext(context: MapContext): void {
        this.context = context;
        this.id = this.generateId();
        this.title.label = context.label;
        this.title.caption = `Carte - ${context.label}`;
        this.update();
    }

    /**
     * Génère un ID unique basé sur le contexte
     */
    private generateId(): string {
        switch (this.context.type) {
            case 'zone':
                return `geoapp-map-zone-${this.context.id}`;
            case 'geocache':
                return `geoapp-map-geocache-${this.context.id}`;
            default:
                return MapWidget.ID;
        }
    }

    /**
     * Récupère le contexte actuel
     */
    getContext(): MapContext {
        return this.context;
    }

    /**
     * Charge les géocaches dans cette carte spécifique
     */
    loadGeocaches(geocaches: MapGeocache[]): void {
        console.log(`[MapWidget ${this.id}] loadGeocaches:`, geocaches.length, 'géocaches');
        this.geocaches = geocaches;
        this.update();  // Force le re-render
    }

    /**
     * Récupère les géocaches de cette carte
     */
    getGeocaches(): MapGeocache[] {
        return this.geocaches;
    }

    @postConstruct()
    protected init(): void {
        this.id = this.generateId();
        this.title.label = this.context.label;
        this.title.caption = `Carte - ${this.context.label}`;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-map';

        this.addClass('geoapp-map-widget');
        this.update();
    }

    protected render(): React.ReactNode {
        // Déterminer si on doit afficher l'option "Ajouter un waypoint"
        const onAddWaypoint = this.context.type === 'geocache' && this.context.id
            ? this.handleAddWaypoint
            : undefined;

        return (
            <MapView 
                mapService={this.mapService}
                geocaches={this.geocaches}
                onMapReady={this.handleMapReady}
                onAddWaypoint={onAddWaypoint}
            />
        );
    }

    /**
     * Gère l'ajout d'un waypoint depuis le menu contextuel de la carte
     */
    private handleAddWaypoint = (gcCoords: string): void => {
        if (this.context.type !== 'geocache' || !this.context.id) {
            return;
        }

        // Trouver le widget de détails de la géocache correspondant
        const detailsWidgetId = 'geocache.details.widget';
        const detailsWidget = this.shell.getWidgets('main').find(w => w.id === detailsWidgetId);

        if (detailsWidget && 'addWaypointWithCoordinates' in detailsWidget) {
            // Appeler la méthode publique du widget de détails
            (detailsWidget as any).addWaypointWithCoordinates(gcCoords);
        } else {
            this.messageService.warn('Veuillez ouvrir les détails de la géocache pour ajouter un waypoint');
        }
    };

    /**
     * Callback appelé quand la carte est initialisée
     */
    private handleMapReady = (map: any): void => {
        this.mapInstance = map;
        
        // Écouter les événements de la carte pour mettre à jour le service
        map.on('moveend', () => {
            const view = map.getView();
            const center = view.getCenter();
            const zoom = view.getZoom();
            
            if (center && zoom !== undefined) {
                this.mapService.updateView(center, zoom);
            }
        });

        console.log('Map initialized successfully');
    };

    /**
     * Appelé quand le widget est redimensionné
     */
    protected onResize(msg: any): void {
        super.onResize(msg);
        
        if (this.mapInstance) {
            // Forcer OpenLayers à recalculer la taille de la carte
            this.updateMapSize();
        }
    }

    /**
     * Appelé quand le widget devient visible
     */
    protected onActivateRequest(msg: any): void {
        super.onActivateRequest(msg);
        
        if (this.mapInstance) {
            // Forcer un update de la taille après un court délai
            // pour s'assurer que les transitions CSS sont terminées
            setTimeout(() => {
                if (this.mapInstance) {
                    this.updateMapSize();
                }
            }, 100);
        }
    }

    /**
     * Met à jour la taille de la carte
     */
    private updateMapSize(): void {
        const updateFn = (this.mapInstance as any)?.updateSize;
        if (typeof updateFn === 'function') {
            updateFn.call(this.mapInstance);
        }
    }

    /**
     * Appelé avant que le widget soit détruit
     */
    dispose(): void {
        if (this.mapInstance) {
            this.mapInstance.setTarget(undefined);
            this.mapInstance = null;
        }
        super.dispose();
    }
}


