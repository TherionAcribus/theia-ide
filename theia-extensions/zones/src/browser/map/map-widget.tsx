import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ApplicationShell } from '@theia/core/lib/browser';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { GeocacheDetailsWidget } from '../geocache-details-widget';
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

    constructor(
        @inject(MapService) protected readonly mapService: MapService,
        @inject(MessageService) protected readonly messageService: MessageService,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
    ) {
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

        // Si c'est une carte pour une géocache spécifique, la sélectionner automatiquement
        if (this.context.type === 'geocache' && this.context.id && geocaches.length > 0) {
            // Trouver la géocache correspondante
            const geocacheToSelect = geocaches.find(gc => gc.id === this.context.id);
            if (geocacheToSelect) {
                console.log(`[MapWidget ${this.id}] Sélection automatique de la géocache ${this.context.id} dans le MapService`);
                // Déléguer la sélection au MapService après un délai plus long pour laisser le temps au MapView de charger les géocaches
                setTimeout(() => {
                    console.log(`[MapWidget ${this.id}] Appel de selectGeocache pour ${this.context.id}`);
                    this.mapService.selectGeocache({
                        id: geocacheToSelect.id,
                        gc_code: geocacheToSelect.gc_code,
                        name: geocacheToSelect.name,
                        latitude: geocacheToSelect.latitude,
                        longitude: geocacheToSelect.longitude,
                        cache_type: geocacheToSelect.cache_type
                    });
                }, 500);
            }
        }

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
        // Déterminer si on doit afficher les options de waypoint
        const isGeocacheMap = this.context.type === 'geocache' && this.context.id;
        const onAddWaypoint = isGeocacheMap ? this.handleAddWaypoint : undefined;
        const onDeleteWaypoint = isGeocacheMap ? this.handleDeleteWaypoint : undefined;
        const onSetWaypointAsCorrectedCoords = isGeocacheMap ? this.handleSetWaypointAsCorrectedCoords : undefined;

        return (
            <MapView
                mapService={this.mapService}
                geocaches={this.geocaches}
                onMapReady={this.handleMapReady}
                onAddWaypoint={onAddWaypoint}
                onDeleteWaypoint={onDeleteWaypoint}
                onSetWaypointAsCorrectedCoords={onSetWaypointAsCorrectedCoords}
                onOpenGeocacheDetails={this.handleOpenGeocacheDetails}
            />
        );
    }

    /**
     * Gère l'ajout d'un waypoint depuis le menu contextuel de la carte
     */
    private handleAddWaypoint = (options: { gcCoords: string; title?: string; note?: string; autoSave?: boolean }): void => {
        if (this.context.type !== 'geocache' || !this.context.id) {
            return;
        }

        // Trouver le widget de détails de la géocache correspondant
        const detailsWidgetId = 'geocache.details.widget';
        const detailsWidget = this.shell.getWidgets('main').find(w => w.id === detailsWidgetId);

        if (detailsWidget && 'addWaypointWithCoordinates' in detailsWidget) {
            // Appeler la méthode publique du widget de détails
            (detailsWidget as any).addWaypointWithCoordinates(options.gcCoords, {
                title: options.title,
                note: options.note,
                autoSave: options.autoSave
            });
        } else {
            this.messageService.warn('Veuillez ouvrir les détails de la géocache pour ajouter un waypoint');
        }
    };

    /**
     * Gère la suppression d'un waypoint depuis le menu contextuel de la carte
     */
    private handleDeleteWaypoint = async (waypointId: number): Promise<void> => {
        if (this.context.type !== 'geocache' || !this.context.id) {
            return;
        }

        // Trouver le widget de détails de la géocache correspondant
        const detailsWidgetId = 'geocache.details.widget';
        const detailsWidget = this.shell.getWidgets('main').find(w => w.id === detailsWidgetId);

        if (detailsWidget && 'deleteWaypointById' in detailsWidget) {
            // Appeler la méthode publique du widget de détails
            await (detailsWidget as any).deleteWaypointById(waypointId);
        } else {
            this.messageService.warn('Veuillez ouvrir les détails de la géocache pour supprimer le waypoint');
        }
    };

    /**
     * Gère la définition d'un waypoint comme coordonnées corrigées depuis le menu contextuel de la carte
     */
    private handleSetWaypointAsCorrectedCoords = async (waypointId: number): Promise<void> => {
        if (this.context.type !== 'geocache' || !this.context.id) {
            return;
        }

        // Trouver le widget de détails de la géocache correspondant
        const detailsWidgetId = 'geocache.details.widget';
        const detailsWidget = this.shell.getWidgets('main').find(w => w.id === detailsWidgetId);

        if (detailsWidget && 'setWaypointAsCorrectedCoords' in detailsWidget) {
            // Appeler la méthode publique du widget de détails
            await (detailsWidget as any).setWaypointAsCorrectedCoords(waypointId);
        } else {
            this.messageService.warn('Veuillez ouvrir les détails de la géocache pour définir les coordonnées corrigées');
        }
    };

    /**
     * Gère l'ouverture des détails d'une géocache depuis le menu contextuel
     */
    private handleOpenGeocacheDetails = async (geocacheId: number, geocacheName: string): Promise<void> => {
        try {
            console.log(`[MapWidget] Ouverture des détails de la géocache ${geocacheId}: ${geocacheName}`);

            // Dispatcher un événement personnalisé pour que les widgets parents gèrent l'ouverture de la carte
            window.dispatchEvent(new CustomEvent('geoapp-open-geocache-details', {
                detail: { geocacheId, geocacheName }
            }));

            // Ouvrir le widget de détails de la géocache
            const widget = await this.widgetManager.getOrCreateWidget(GeocacheDetailsWidget.ID) as GeocacheDetailsWidget;
            widget.setGeocache({ geocacheId, name: geocacheName });

            if (!widget.isAttached) {
                this.shell.addWidget(widget, { area: 'main' });
            }

            this.shell.activateWidget(widget.id);
        } catch (error) {
            console.error('[MapWidget] Erreur lors de l\'ouverture des détails de la géocache:', error);
            this.messageService.error('Impossible d\'ouvrir les détails de la géocache');
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


