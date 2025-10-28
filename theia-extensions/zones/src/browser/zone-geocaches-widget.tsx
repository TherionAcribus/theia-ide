import * as React from 'react';
import { injectable, inject } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell, WidgetManager, ConfirmDialog, Dialog } from '@theia/core/lib/browser';
import { GeocacheDetailsWidget } from './geocache-details-widget';
import { MessageService } from '@theia/core';
import { GeocachesTable, Geocache } from './geocaches-table';
import { ImportGpxDialog } from './import-gpx-dialog';

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

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
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

    protected async handleRowClick(geocache: Geocache): Promise<void> {
        try {
            const widget = await this.widgetManager.getOrCreateWidget(GeocacheDetailsWidget.ID) as GeocacheDetailsWidget;
            widget.setGeocache({ geocacheId: geocache.id, name: geocache.name });
            if (!widget.isAttached) {
                this.shell.addWidget(widget, { area: 'main' });
            }
            this.shell.activateWidget(widget.id);
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
            </div>
        );
    }
}


