import * as React from 'react';
import { injectable, inject } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';

type GeocacheRow = { id: number; name: string };

@injectable()
export class ZoneGeocachesWidget extends ReactWidget {
    static readonly ID = 'zone.geocaches.widget';

    protected backendBaseUrl = 'http://127.0.0.1:8000';
    protected zoneId?: number;
    protected zoneName?: string;
    protected rows: GeocacheRow[] = [];

    constructor(@inject(MessageService) protected readonly messages: MessageService) {
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
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/zones/${this.zoneId}/geocaches`, { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.rows = await res.json();
            // eslint-disable-next-line no-console
            console.log('[ZoneGeocachesWidget] load -> rows:', this.rows.length);
            this.update();
        } catch (e) {
            console.error('ZoneGeocachesWidget: load error', e);
            this.messages.warn('Impossible de charger les géocaches de la zone');
        }
    }

    protected render(): React.ReactNode {
        return (
            <div className='p-2'>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
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
                                const res = await fetch(`${this.backendBaseUrl}/api/geocaches/import`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    credentials: 'include',
                                    body: JSON.stringify({ zone_id: this.zoneId, gc_code: gc })
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
                        <input name='gc_code' placeholder='Code GC (ex: GC12345)' style={{ width: 180 }} />
                        <button type='submit' className='theia-button'>Importer</button>
                    </form>
                </div>
                <div style={{ marginTop: 10 }}>
                    <table className='theia-table'>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left' }}>Nom</th>
                            </tr>
                        </thead>
                        <tbody>
                            {this.rows.length === 0 ? (
                                <tr><td style={{ opacity: 0.7 }}>Aucune géocache dans cette zone</td></tr>
                            ) : (
                                this.rows.map(r => (
                                    <tr key={r.id}>
                                        <td>{r.name}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }
}


