import * as React from 'react';
import { injectable, inject } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { GeocacheDetailsWidget } from './geocache-details-widget';
import { MessageService } from '@theia/core';
import { GeocachesTable, Geocache } from './geocaches-table';

@injectable()
export class ZoneGeocachesWidget extends ReactWidget {
    static readonly ID = 'zone.geocaches.widget';

    protected backendBaseUrl = 'http://127.0.0.1:8000';
    protected zoneId?: number;
    protected zoneName?: string;
    protected rows: Geocache[] = [];
    protected loading = false;

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
            const res = await fetch(`${this.backendBaseUrl}/api/zones/${this.zoneId}/geocaches`, { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.rows = await res.json();
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

    protected async handleDelete(id: number): Promise<void> {
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
                        onDelete={(id) => this.handleDelete(id)}
                        onRefresh={(id) => this.handleRefresh(id)}
                    />
                )}
            </div>
        );
    }
}


