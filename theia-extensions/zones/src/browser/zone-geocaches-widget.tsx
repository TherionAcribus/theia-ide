import * as React from 'react';
import { injectable, inject } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell, WidgetManager, ConfirmDialog, Dialog } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core';
import { GeocachesTable, Geocache } from './geocaches-table';
import { ImportGpxDialog } from './import-gpx-dialog';
import { MoveGeocacheDialog } from './move-geocache-dialog';
import { MapService } from './map/map-service';
import { MapWidgetFactory } from './map/map-widget-factory';
import { GeocacheTabsManager } from './geocache-tabs-manager';

@injectable()
export class ZoneGeocachesWidget extends ReactWidget {
    static readonly ID = 'zone.geocaches.widget';

    protected backendBaseUrl = 'http://127.0.0.1:8000';
    protected zoneId?: number;
    protected zoneName?: string;
    protected rows: Geocache[] = [];
    protected loading = false;
    protected zones: Array<{ id: number; name: string }> = [];
    protected showImportDialog = false;
    protected isImporting = false;
    protected copySelectedDialog: { geocacheIds: number[] } | null = null;
    protected moveSelectedDialog: { geocacheIds: number[] } | null = null;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
        @inject(MapService) protected readonly mapService: MapService,
        @inject(MapWidgetFactory) protected readonly mapWidgetFactory: MapWidgetFactory,
        @inject(GeocacheTabsManager) protected readonly geocacheTabsManager: GeocacheTabsManager,
    ) {
        super();
        this.id = ZoneGeocachesWidget.ID;
        this.title.label = 'Géocaches';
        this.title.caption = 'Géocaches';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-table';
        this.addClass('theia-zone-geocaches-widget');

        // Écouter les événements personnalisés pour ouvrir l'onglet
        this.setupEventListeners();

        // eslint-disable-next-line no-console
        console.log('[ZoneGeocachesWidget] constructed');
    }

    private setupEventListeners(): void {
        // Écouter l'événement personnalisé pour ouvrir l'onglet des géocaches de zone
        window.addEventListener('open-zone-geocaches', (event: any) => {
            const detail = event.detail;
            if (detail && detail.zoneId) {
                console.log('ZoneGeocachesWidget: Received open-zone-geocaches event', detail);
                this.handleOpenZoneGeocaches(detail.zoneId, detail.zoneName);
            }
        });

        // Écouter les événements d'ouverture de détails de géocache depuis les cartes
        window.addEventListener('geoapp-open-geocache-details', this.handleOpenGeocacheDetailsFromMap.bind(this));
    }

    private async handleOpenZoneGeocaches(zoneId: number, zoneName?: string): Promise<void> {
        try {
            // Créer ou récupérer le widget
            const shell = (this as any).shell;
            if (!shell) {
                console.error('ZoneGeocachesWidget: No shell available');
                return;
            }

            // Configurer le widget avec la zone
            this.setZone({ zoneId, zoneName });

            // Ajouter le widget à la zone principale s'il n'y est pas déjà
            if (!this.isAttached) {
                shell.addWidget(this, { area: 'main' });
            }

            // Activer le widget
            shell.activateWidget(this.id);

            console.log('ZoneGeocachesWidget: Successfully opened for zone', zoneId, zoneName);
        } catch (error) {
            console.error('ZoneGeocachesWidget: Error opening widget:', error);
            this.messages.error('Erreur lors de l\'ouverture de l\'onglet géocaches');
        }
    }

    /** Configure le widget avec l'ID et le nom de la zone */
    setZone(context: { zoneId: number; zoneName?: string }): void {
        // eslint-disable-next-line no-console
        console.log('[ZoneGeocachesWidget] setZone', context);
        this.zoneId = context.zoneId;
        this.zoneName = context.zoneName;
        this.title.label = `Géocaches - ${this.zoneName ?? this.zoneId}`;
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
        // Fermer la carte de zone associée avant de fermer l'onglet
        this.closeAssociatedMap();

        // Appeler la méthode parente pour la fermeture normale
        super.onCloseRequest(msg);
    }

    /**
     * Ferme la carte associée à cette zone
     */
    private closeAssociatedMap(): void {
        if (this.zoneId && this.zoneName) {
            const mapId = `geoapp-map-zone-${this.zoneId}`;
            const existingMap = this.shell.getWidgets('bottom').find(w => w.id === mapId);

            if (existingMap) {
                console.log('[ZoneGeocachesWidget] Fermeture de la carte zone associée:', this.zoneId);
                existingMap.close();
            }
        }
    }

    /**
     * Réactive la carte correspondante à cette zone
     */
    private reactivateMap(): void {
        console.log('[ZoneGeocachesWidget] reactivateMap appelé, zoneId:', this.zoneId, 'zoneName:', this.zoneName);
        
        // Si on a une zone chargée, réactiver sa carte
        if (this.zoneId && this.zoneName) {
            const mapId = `geoapp-map-zone-${this.zoneId}`;
            const bottomWidgets = this.shell.getWidgets('bottom');
            console.log('[ZoneGeocachesWidget] Widgets dans bottom:', bottomWidgets.map(w => w.id));
            
            const existingMap = bottomWidgets.find(w => w.id === mapId);
            console.log('[ZoneGeocachesWidget] Carte trouvée:', !!existingMap, 'ID recherché:', mapId);
            
            if (existingMap) {
                console.log('[ZoneGeocachesWidget] Réactivation de la carte zone:', this.zoneId);
                this.shell.activateWidget(mapId);
            } else {
                console.warn('[ZoneGeocachesWidget] Carte non trouvée dans le bottom layer');
            }
        } else {
            console.warn('[ZoneGeocachesWidget] Pas de zone chargée');
        }
    }

    protected async load(): Promise<void> {
        if (!this.zoneId) { return; }
        this.loading = true;
        this.update();
        try {
            // Charger les géocaches
            const res = await fetch(`${this.backendBaseUrl}/api/zones/${this.zoneId}/geocaches`, { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.rows = await res.json();
            
            // Charger la liste des zones pour le menu contextuel
            const zonesRes = await fetch(`${this.backendBaseUrl}/api/zones`, { credentials: 'include' });
            if (zonesRes.ok) {
                this.zones = await zonesRes.json();
            }
            
            // Charger les géocaches sur la carte (avec waypoints)
            const geocachesWithCoords = this.rows.filter(gc => 
                gc.latitude !== null && 
                gc.latitude !== undefined && 
                gc.longitude !== null && 
                gc.longitude !== undefined
            );
            
            console.log('[ZoneGeocachesWidget] Géocaches avec coordonnées:', geocachesWithCoords.length, '/', this.rows.length);
            console.log('[ZoneGeocachesWidget] Première géocache:', geocachesWithCoords[0]);
            
            if (geocachesWithCoords.length > 0 && this.zoneId && this.zoneName) {
                // Préparer les données pour la carte
                const mapGeocaches = geocachesWithCoords.map(gc => ({
                    id: gc.id,
                    gc_code: gc.gc_code,
                    name: gc.name,
                    cache_type: gc.cache_type,
                    latitude: gc.latitude!,
                    longitude: gc.longitude!,
                    difficulty: gc.difficulty,
                    terrain: gc.terrain,
                    found: gc.found,
                    is_corrected: gc.is_corrected,
                    original_latitude: gc.original_latitude,
                    original_longitude: gc.original_longitude,
                    waypoints: gc.waypoints || []
                }));
                
                console.log('[ZoneGeocachesWidget] Ouverture carte pour zone:', this.zoneId, this.zoneName);
                console.log('[ZoneGeocachesWidget] Données envoyées:', mapGeocaches.length, 'géocaches');
                
                // Ouvrir une carte spécifique à cette zone
                this.mapWidgetFactory.openMapForZone(this.zoneId, this.zoneName, mapGeocaches);
            } else {
                console.warn('[ZoneGeocachesWidget] Aucune géocache avec coordonnées trouvée ou zone non définie');
            }
            
            // eslint-disable-next-line no-console
            console.log('[ZoneGeocachesWidget] load -> rows:', this.rows.length);
        } catch (e) {
            console.error('ZoneGeocachesWidget: load error', e);
            this.messages.warn('Impossible de charger les géocaches de la zone');
        } finally {
            this.loading = false;
            this.update();
        }
    }

    protected async handleDeleteSelected(ids: number[]): Promise<void> {
        const dialog = new ConfirmDialog({
            title: 'Supprimer les géocaches',
            msg: `Voulez-vous vraiment supprimer ${ids.length} géocache(s) sélectionnée(s) ?`,
            ok: Dialog.OK,
            cancel: Dialog.CANCEL
        });
        
        const confirmed = await dialog.open();
        if (!confirmed) {
            return;
        }
        
        try {
            for (const id of ids) {
                const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${id}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
            }
            this.messages.info(`${ids.length} géocache(s) supprimée(s)`);
            await this.load();
        } catch (e) {
            console.error('Delete error', e);
            this.messages.error('Erreur lors de la suppression');
        }
    }

    protected async handleRefreshSelected(ids: number[]): Promise<void> {
        try {
            this.messages.info(`Rafraîchissement de ${ids.length} géocache(s)...`);
            for (const id of ids) {
                const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${id}/refresh`, {
                    method: 'POST',
                    credentials: 'include'
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
            }
            this.messages.info(`${ids.length} géocache(s) rafraîchie(s)`);
            await this.load();
        } catch (e) {
            console.error('Refresh error', e);
            this.messages.error('Erreur lors du rafraîchissement');
        }
    }

    protected async handleDelete(id: number, gcCode: string): Promise<void> {
        const dialog = new ConfirmDialog({
            title: 'Supprimer la géocache',
            msg: `Voulez-vous vraiment supprimer la géocache ${gcCode} ?`,
            ok: Dialog.OK,
            cancel: Dialog.CANCEL
        });
        
        const confirmed = await dialog.open();
        if (!confirmed) {
            return;
        }
        
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.messages.info('Géocache supprimée');
            await this.load();
        } catch (e) {
            console.error('Delete error', e);
            this.messages.error('Erreur lors de la suppression');
        }
    }

    protected async handleRefresh(id: number): Promise<void> {
        try {
            this.messages.info('Rafraîchissement en cours...');
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${id}/refresh`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.messages.info('Géocache rafraîchie');
            await this.load();
        } catch (e) {
            console.error('Refresh error', e);
            this.messages.error('Erreur lors du rafraîchissement');
        }
    }

    protected async handleMove(geocache: Geocache, targetZoneId: number): Promise<void> {
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${geocache.id}/move`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ target_zone_id: targetZoneId })
            });
            
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            this.messages.info(`Géocache ${geocache.gc_code} déplacée`);
            await this.load();
        } catch (e) {
            console.error('Move error', e);
            this.messages.error('Erreur lors du déplacement');
        }
    }

    protected async handleCopy(geocache: Geocache, targetZoneId: number): Promise<void> {
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${geocache.id}/copy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ target_zone_id: targetZoneId })
            });

            if (!res.ok) {
                const errorText = await res.text();
                let errorMsg = 'Erreur lors de la copie';
                try {
                    const errorJson = JSON.parse(errorText);
                    if (errorJson.error) {
                        errorMsg = errorJson.error;
                    }
                } catch {
                    errorMsg = errorText || errorMsg;
                }
                throw new Error(errorMsg);
            }

            this.messages.info(`Géocache ${geocache.gc_code} copiée vers la zone cible`);

            // Rafraîchir le panneau des zones pour mettre à jour les compteurs
            const zonesWidget = this.widgetManager.getWidgets('zones.tree.widget')[0] as any;
            if (zonesWidget && typeof zonesWidget.refresh === 'function') {
                await zonesWidget.refresh();
            }

            await this.load();
        } catch (e) {
            console.error('Copy error', e);
            this.messages.error(`Erreur lors de la copie: ${e}`);
        }
    }

    protected async handleCopySelected(geocacheIds: number[]): Promise<void> {
        this.copySelectedDialog = { geocacheIds };
        this.update();
    }

    protected closeCopySelectedDialog(): void {
        this.copySelectedDialog = null;
        this.update();
    }

    protected async performCopySelected(geocacheIds: number[], targetZoneId: number): Promise<void> {
        let copiedCount = 0;
        let alreadyExistsCount = 0;
        let errorCount = 0;
        const targetZoneName = this.zones.find(z => z.id === targetZoneId)?.name || `Zone ${targetZoneId}`;

        for (const geocacheId of geocacheIds) {
            try {
                // Trouver la géocache dans les données actuelles pour obtenir le gc_code
                const geocache = this.rows.find(g => g.id === geocacheId);
                if (!geocache) continue;

                const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${geocacheId}/copy`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ target_zone_id: targetZoneId })
                });

                if (!res.ok) {
                    const errorText = await res.text();
                    let errorMsg = 'Erreur lors de la copie';
                    try {
                        const errorJson = JSON.parse(errorText);
                        if (errorJson.error) {
                            // Vérifier si c'est une erreur de géocache déjà existante
                            if (errorJson.error.includes('existe déjà')) {
                                alreadyExistsCount++;
                                continue; // C'est normal, on continue
                            }
                            errorMsg = errorJson.error;
                        }
                    } catch {
                        errorMsg = errorText || errorMsg;
                    }
                    console.error(`Copy error for ${geocache.gc_code}:`, errorMsg);
                    errorCount++;
                } else {
                    copiedCount++;
                }
            } catch (e) {
                console.error(`Copy error for geocache ${geocacheId}:`, e);
                errorCount++;
            }
        }

        // Fermer la boîte de dialogue
        this.closeCopySelectedDialog();

        // Rafraîchir le panneau des zones pour mettre à jour les compteurs
        const zonesWidget = this.widgetManager.getWidgets('zones.tree.widget')[0] as any;
        if (zonesWidget && typeof zonesWidget.refresh === 'function') {
            await zonesWidget.refresh();
        }

        // Recharger les données
        await this.load();

        // Afficher le résultat
        let message = '';
        if (copiedCount > 0) {
            message += `${copiedCount} géocache${copiedCount > 1 ? 's' : ''} copiée${copiedCount > 1 ? 's' : ''}`;
        }
        if (alreadyExistsCount > 0) {
            if (message) message += ', ';
            message += `${alreadyExistsCount} géocache${alreadyExistsCount > 1 ? 's' : ''} déjà présente${alreadyExistsCount > 1 ? 's' : ''} dans ${targetZoneName}`;
        }
        if (errorCount > 0) {
            if (message) message += ', ';
            message += `${errorCount} erreur${errorCount > 1 ? 's' : ''}`;
        }

        if (errorCount === 0) {
            this.messages.info(`Copie terminée: ${message}`);
        } else {
            this.messages.warn(`Copie partiellement réussie: ${message}`);
        }
    }

    protected async handleMoveSelected(geocacheIds: number[]): Promise<void> {
        this.moveSelectedDialog = { geocacheIds };
        this.update();
    }

    protected closeMoveSelectedDialog(): void {
        this.moveSelectedDialog = null;
        this.update();
    }

    /**
     * Gère l'ouverture de détails de géocache depuis une carte (événement personnalisé)
     */
    private handleOpenGeocacheDetailsFromMap = async (event: CustomEvent): Promise<void> => {
        const { geocacheId } = event.detail;
        console.log(`[ZoneGeocachesWidget] Ouverture de carte pour géocache ${geocacheId} depuis la carte`);

        try {
            // Trouver la géocache dans la liste actuelle
            const geocache = this.rows.find(row => row.id === geocacheId);
            if (geocache) {
                // Ouvrir la carte comme si on cliquait sur la ligne du tableau
                await this.handleRowClick(geocache);
            } else {
                // Si la géocache n'est pas dans la liste actuelle, récupérer ses données et ouvrir quand même
                const backendBaseUrl = 'http://127.0.0.1:8000';
                const response = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}`, { credentials: 'include' });

                if (response.ok) {
                    const geocacheData = await response.json();

                    // Créer un objet géocache temporaire
                    const tempGeocache = {
                        id: geocacheData.id,
                        gc_code: geocacheData.gc_code,
                        name: geocacheData.name,
                        description: geocacheData.description_raw,
                        hint: geocacheData.hints,
                        cache_type: geocacheData.cache_type,
                        difficulty: geocacheData.difficulty,
                        terrain: geocacheData.terrain,
                        size: geocacheData.size,
                        solved: geocacheData.solved,
                        found: geocacheData.found,
                        favorites_count: geocacheData.favorites_count,
                        hidden_date: geocacheData.placed_at,
                        latitude: geocacheData.latitude,
                        longitude: geocacheData.longitude,
                        coordinates_raw: geocacheData.coordinates_raw,
                        is_corrected: geocacheData.is_corrected,
                        original_latitude: geocacheData.original_latitude,
                        original_longitude: geocacheData.original_longitude,
                        waypoints: geocacheData.waypoints || []
                    };

                    // Ouvrir la carte pour cette géocache
                    if (tempGeocache.latitude !== null && tempGeocache.latitude !== undefined &&
                        tempGeocache.longitude !== null && tempGeocache.longitude !== undefined) {

                        const mapGeocacheData = {
                            id: tempGeocache.id,
                            gc_code: tempGeocache.gc_code,
                            name: tempGeocache.name,
                            cache_type: tempGeocache.cache_type,
                            latitude: tempGeocache.latitude,
                            longitude: tempGeocache.longitude,
                            difficulty: tempGeocache.difficulty,
                            terrain: tempGeocache.terrain,
                            found: tempGeocache.found,
                            is_corrected: tempGeocache.is_corrected,
                            original_latitude: tempGeocache.original_latitude,
                            original_longitude: tempGeocache.original_longitude,
                            waypoints: tempGeocache.waypoints || []
                        };

                        await this.mapWidgetFactory.openMapForGeocache(
                            geocacheId,
                            tempGeocache.gc_code,
                            mapGeocacheData
                        );
                    }
                }
            }
        } catch (error) {
            console.error('[ZoneGeocachesWidget] Erreur lors de l\'ouverture de carte depuis la carte:', error);
        }
    };

    /**
     * Gère l'application d'un plugin sur les géocaches sélectionnées
     */
    protected async handleApplyPluginSelected(geocacheIds: number[]): Promise<void> {
        if (!this.zoneId) {
            this.messages.warn('Zone active manquante');
            return;
        }

        try {
            // Récupérer les détails des géocaches sélectionnées
            const selectedGeocaches = this.rows.filter(g => geocacheIds.includes(g.id));
            
            if (selectedGeocaches.length === 0) {
                this.messages.warn('Aucune géocache sélectionnée');
                return;
            }

            // Ouvrir le widget batch via le WidgetManager
            const batchWidgetId = 'batch-plugin-executor-widget';
            
            try {
                // Créer ou récupérer le widget
                const widget = await this.widgetManager.getOrCreateWidget(batchWidgetId);
                
                // Préparer les données pour le widget
                const batchData = {
                    geocaches: selectedGeocaches.map(g => ({
                        id: g.id,
                        gc_code: g.gc_code,
                        name: g.name,
                        original_latitude: g.original_latitude,
                        original_longitude: g.original_longitude,
                        original_coordinates_raw: g.original_coordinates_raw,
                        coordinates: (g.latitude && g.longitude) ? {
                            latitude: g.latitude,
                            longitude: g.longitude,
                            coordinates_raw: g.coordinates_raw || `${g.latitude}, ${g.longitude}`
                        } : undefined,
                        description: g.description,
                        hint: g.hint,
                        difficulty: g.difficulty,
                        terrain: g.terrain,
                        waypoints: g.waypoints || []
                    })),
                    zoneId: this.zoneId,
                    zoneName: this.zoneName
                };

                // Envoyer les données au widget via un événement personnalisé
                window.dispatchEvent(new CustomEvent('batch-executor-initialize', {
                    detail: batchData
                }));

                // Ajouter et activer le widget
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'main' });
                }
                this.shell.activateWidget(widget.id);

                console.log(`[ZoneGeocachesWidget] Opened batch executor for ${selectedGeocaches.length} geocaches`);
                
            } catch (widgetError) {
                console.error('[ZoneGeocachesWidget] Error opening batch widget:', widgetError);
                this.messages.error('Impossible d\'ouvrir l\'exécuteur de plugins batch');
            }
            
        } catch (error) {
            console.error('[ZoneGeocachesWidget] Error in handleApplyPluginSelected:', error);
            this.messages.error('Erreur lors de l\'application du plugin');
        }
    }

    protected async performMoveSelected(geocacheIds: number[], targetZoneId: number): Promise<void> {
        let movedCount = 0;
        let alreadyExistsCount = 0;
        let errorCount = 0;
        const targetZoneName = this.zones.find(z => z.id === targetZoneId)?.name || `Zone ${targetZoneId}`;

        for (const geocacheId of geocacheIds) {
            try {
                // Trouver la géocache dans les données actuelles pour obtenir le gc_code
                const geocache = this.rows.find(g => g.id === geocacheId);
                if (!geocache) continue;

                const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${geocacheId}/move`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ target_zone_id: targetZoneId })
                });

                if (!res.ok) {
                    const errorText = await res.text();
                    let errorMsg = 'Erreur lors du déplacement';
                    try {
                        const errorJson = JSON.parse(errorText);
                        if (errorJson.error) {
                            errorMsg = errorJson.error;
                        }
                    } catch {
                        errorMsg = errorText || errorMsg;
                    }
                    console.error(`Move error for ${geocache.gc_code}:`, errorMsg);
                    errorCount++;
                } else {
                    const result = await res.json();
                    if (result.already_exists) {
                        alreadyExistsCount++;
                    } else {
                        movedCount++;
                    }
                }
            } catch (e) {
                console.error(`Move error for geocache ${geocacheId}:`, e);
                errorCount++;
            }
        }

        // Fermer la boîte de dialogue
        this.closeMoveSelectedDialog();

        // Rafraîchir le panneau des zones pour mettre à jour les compteurs
        const zonesWidget = this.widgetManager.getWidgets('zones.tree.widget')[0] as any;
        if (zonesWidget && typeof zonesWidget.refresh === 'function') {
            await zonesWidget.refresh();
        }

        // Recharger les données
        await this.load();

        // Afficher le résultat
        let message = '';
        if (movedCount > 0) {
            message += `${movedCount} géocache${movedCount > 1 ? 's' : ''} déplacée${movedCount > 1 ? 's' : ''}`;
        }
        if (alreadyExistsCount > 0) {
            if (message) message += ', ';
            message += `${alreadyExistsCount} géocache${alreadyExistsCount > 1 ? 's' : ''} déjà présente${alreadyExistsCount > 1 ? 's' : ''} dans ${targetZoneName}`;
        }
        if (errorCount > 0) {
            if (message) message += ', ';
            message += `${errorCount} erreur${errorCount > 1 ? 's' : ''}`;
        }

        if (errorCount === 0) {
            this.messages.info(`Déplacement terminé: ${message}`);
        } else {
            this.messages.warn(`Déplacement partiellement réussi: ${message}`);
        }
    }

    protected async handleImportGpx(file: File, updateExisting: boolean, onProgress?: (percentage: number, message: string) => void): Promise<void> {
        if (!this.zoneId) {
            this.messages.warn('Zone active manquante');
            return;
        }

        try {
            this.isImporting = true;
            if (onProgress) {
                onProgress(0, 'Préparation de l\'import...');
            }

            const formData = new FormData();
            formData.append('gpxFile', file);
            formData.append('zone_id', this.zoneId.toString());
            if (updateExisting) {
                formData.append('updateExisting', 'on');
            }

            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/import-gpx`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            // Lire le flux de progression
            const reader = res.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                let done = false;
                let lastMessage = '';

                while (!done) {
                    const { value, done: readerDone } = await reader.read();
                    done = readerDone;

                    if (value) {
                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split('\n').filter(line => line.trim());

                        for (const line of lines) {
                            try {
                                const data = JSON.parse(line);

                                if (data.error) {
                                    this.messages.error(data.message || 'Erreur lors de l\'import');
                                    if (onProgress) {
                                        onProgress(0, 'Erreur lors de l\'import');
                                    }
                                    continue;
                                }

                                if (data.progress !== undefined) {
                                    if (onProgress) {
                                        onProgress(data.progress, data.message || '');
                                    }
                                }

                                if (data.final_summary) {
                                    lastMessage = data.message;
                                }
                            } catch (e) {
                                console.error('Error parsing progress data:', e);
                            }
                        }
                    }
                }

                if (lastMessage) {
                    this.messages.info(lastMessage);
                } else {
                    this.messages.info('Import terminé');
                }
            }

            // Fermer la dialog et recharger les données
            this.showImportDialog = false;
            await this.load();
        } catch (e) {
            console.error('Import GPX error', e);
            this.messages.error('Erreur lors de l\'import du fichier GPX');
            if (onProgress) {
                onProgress(0, 'Erreur lors de l\'import');
            }
        } finally {
            this.isImporting = false;
        }
    }

    /**
     * Ouvre une carte centrée sur une géocache spécifique.
     * Méthode publique utilisée par les autres extensions.
     */
    public async openGeocacheMap(geocache: {
        id: number;
        gc_code: string;
        name: string;
        latitude: number;
        longitude: number;
        cache_type?: string;
        difficulty?: number;
        terrain?: number;
        found?: boolean;
        is_corrected?: boolean;
        original_latitude?: number;
        original_longitude?: number;
        waypoints?: any[];
    }): Promise<void> {
        try {
            console.log('[ZoneGeocachesWidget] openGeocacheMap appelée pour géocache:', geocache.gc_code);
            console.log('[ZoneGeocachesWidget] Données reçues:', geocache);

            // Ouvrir une carte spécifique pour cette géocache
            console.log('[ZoneGeocachesWidget] Appel de mapWidgetFactory.openMapForGeocache');
            await this.mapWidgetFactory.openMapForGeocache(
                geocache.id,
                geocache.gc_code,
                geocache
            );
            console.log('[ZoneGeocachesWidget] mapWidgetFactory.openMapForGeocache terminé');
        } catch (error) {
            console.error('[ZoneGeocachesWidget] Erreur lors de l\'ouverture de la carte:', error);
            this.messages.error(`Erreur lors de l'ouverture de la carte pour ${geocache.gc_code}`);
        }
    }

    protected async handleRowClick(geocache: Geocache): Promise<void> {
        try {
            // Ouvrir une carte spécifique pour cette géocache si elle a des coordonnées
            if (geocache.latitude !== null && geocache.latitude !== undefined && 
                geocache.longitude !== null && geocache.longitude !== undefined) {
                
                // Préparer les données de la géocache
                const geocacheData = {
                    id: geocache.id,
                    gc_code: geocache.gc_code,
                    name: geocache.name,
                    cache_type: geocache.cache_type,
                    latitude: geocache.latitude,
                    longitude: geocache.longitude,
                    difficulty: geocache.difficulty,
                    terrain: geocache.terrain,
                    found: geocache.found,
                    is_corrected: geocache.is_corrected,
                    original_latitude: geocache.original_latitude,
                    original_longitude: geocache.original_longitude,
                    waypoints: geocache.waypoints || []
                };

                console.log('[ZoneGeocachesWidget] Ouverture carte pour géocache:', geocache.gc_code);
                
                // Ouvrir une carte spécifique pour cette géocache
                await this.mapWidgetFactory.openMapForGeocache(
                    geocache.id,
                    geocache.gc_code,
                    geocacheData
                );
            }

            // Ouvrir les détails de la géocache
            await this.geocacheTabsManager.openGeocacheDetails({
                geocacheId: geocache.id,
                name: geocache.name
            });
        } catch (error) {
            console.error('Failed to open GeocacheDetailsWidget:', error);
            this.messages.error('Impossible d\'ouvrir les détails de la géocache');
        }
    }

    protected render(): React.ReactNode {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 8 }}>
                {/* Header with import form */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <h3 style={{ margin: 0 }}>{this.title.label}</h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <form
                            onSubmit={async (e) => {
                                e.preventDefault();
                                try {
                                    const form = e.currentTarget as HTMLFormElement;
                                    const fd = new FormData(form);
                                    const gc = (fd.get('gc_code') as string || '').trim().toUpperCase();
                                    if (!gc) { return; }
                                    if (!this.zoneId) { this.messages.warn('Zone active manquante'); return; }
                                    const res = await fetch(`${this.backendBaseUrl}/api/geocaches/add`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        credentials: 'include',
                                        body: JSON.stringify({ zone_id: this.zoneId, code: gc })
                                    });

                                    if (!res.ok) {
                                        let errorMsg = `HTTP ${res.status}`;
                                        try {
                                            const errorData = await res.json();
                                            errorMsg = errorData.error || errorMsg;
                                        } catch {
                                            const txt = await res.text();
                                            errorMsg += `: ${txt}`;
                                        }
                                        throw new Error(errorMsg);
                                    }
                                    form.reset();
                                    await this.load();
                                    this.messages.info(`Géocache ${gc} importée`);
                                } catch (err) {
                                    console.error('Import geocache error', err);
                                    this.messages.error('Erreur lors de l\'import de la géocache');
                                }
                            }}
                            style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                        >
                            <input name='gc_code' placeholder='Code GC (ex: GC12345)' style={{ width: 180, padding: '4px 8px' }} />
                            <button type='submit' className='theia-button'>+ Importer</button>
                        </form>
                        <button
                            className='theia-button secondary'
                            onClick={() => {
                                this.showImportDialog = true;
                                this.update();
                            }}
                            style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: 4,
                                backgroundColor: 'var(--theia-button-secondaryBackground)',
                                color: 'var(--theia-button-secondaryForeground)'
                            }}
                        >
                            <span>📁</span>
                            <span>Importer GPX</span>
                        </button>
                    </div>
                </div>

                {/* Table or loading/empty state */}
                {this.loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                        <span>Chargement...</span>
                    </div>
                ) : this.rows.length === 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, opacity: 0.6 }}>
                        <div style={{ textAlign: 'center' }}>
                            <p>Aucune géocache dans cette zone</p>
                            <p style={{ fontSize: '0.9em' }}>Utilisez le formulaire ci-dessus pour importer des géocaches</p>
                        </div>
                    </div>
                ) : (
                    <GeocachesTable
                        data={this.rows}
                        onRowClick={(geocache) => this.handleRowClick(geocache)}
                        onDeleteSelected={(ids) => this.handleDeleteSelected(ids)}
                        onRefreshSelected={(ids) => this.handleRefreshSelected(ids)}
                        onCopySelected={(ids) => this.handleCopySelected(ids)}
                        onMoveSelected={(ids) => this.handleMoveSelected(ids)}
                        onApplyPluginSelected={(ids) => this.handleApplyPluginSelected(ids)}
                        onDelete={(geocache) => this.handleDelete(geocache.id, geocache.gc_code)}
                        onRefresh={(id) => this.handleRefresh(id)}
                        onMove={(geocache, targetZoneId) => this.handleMove(geocache, targetZoneId)}
                        onCopy={(geocache, targetZoneId) => this.handleCopy(geocache, targetZoneId)}
                        zones={this.zones}
                        currentZoneId={this.zoneId}
                    />
                )}

                {/* Import GPX Dialog */}
                {this.showImportDialog && this.zoneId && (
                    <ImportGpxDialog
                        zoneId={this.zoneId}
                        onImport={(file, updateExisting, onProgress) => this.handleImportGpx(file, updateExisting, onProgress)}
                        onCancel={() => {
                            this.showImportDialog = false;
                            this.update();
                        }}
                        isImporting={this.isImporting}
                    />
                )}

                {/* Copy Selected Dialog */}
                {this.copySelectedDialog && this.zoneId && (
                    <MoveGeocacheDialog
                        geocacheCount={this.copySelectedDialog.geocacheIds.length}
                        currentZoneId={this.zoneId}
                        zones={this.zones}
                        onMove={async (targetZoneId: number) => {
                            await this.performCopySelected(this.copySelectedDialog!.geocacheIds, targetZoneId);
                        }}
                        onCancel={() => this.closeCopySelectedDialog()}
                        title="Copier les géocaches vers une zone"
                        actionLabel="Copier"
                    />
                )}

                {/* Move Selected Dialog */}
                {this.moveSelectedDialog && this.zoneId && (
                    <MoveGeocacheDialog
                        geocacheCount={this.moveSelectedDialog.geocacheIds.length}
                        currentZoneId={this.zoneId}
                        zones={this.zones}
                        onMove={async (targetZoneId: number) => {
                            await this.performMoveSelected(this.moveSelectedDialog!.geocacheIds, targetZoneId);
                        }}
                        onCancel={() => this.closeMoveSelectedDialog()}
                        title="Déplacer les géocaches vers une zone"
                        actionLabel="Déplacer"
                    />
                )}
            </div>
        );
    }
}


