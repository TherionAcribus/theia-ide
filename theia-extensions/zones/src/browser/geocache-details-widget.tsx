import * as React from 'react';
import { injectable, inject } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';

type GeocacheDto = {
    id: number;
    gc_code?: string;
    name: string;
    url?: string;
    type?: string;
    size?: string;
    owner?: string;
    difficulty?: number;
    terrain?: number;
    latitude?: number;
    longitude?: number;
    placed_at?: string;
    status?: string;
    zone_id?: number;
};

@injectable()
export class GeocacheDetailsWidget extends ReactWidget {
    static readonly ID = 'geocache.details.widget';

    protected backendBaseUrl = 'http://127.0.0.1:8000';
    protected geocacheId?: number;
    protected data?: GeocacheDto;
    protected isLoading = false;

    constructor(@inject(MessageService) protected readonly messages: MessageService) {
        super();
        this.id = GeocacheDetailsWidget.ID;
        this.title.label = 'Géocache';
        this.title.caption = 'Détails Géocache';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-map-marker';
        this.addClass('theia-geocache-details-widget');
    }

    setGeocache(context: { geocacheId: number; name?: string }): void {
        this.geocacheId = context.geocacheId;
        if (context.name) {
            this.title.label = `Géocache - ${context.name}`;
        } else if (this.data?.name) {
            this.title.label = `Géocache - ${this.data.name}`;
        } else {
            this.title.label = `Géocache - ${this.geocacheId}`;
        }
        this.update();
        this.load();
    }

    protected async load(): Promise<void> {
        if (!this.geocacheId) { return; }
        this.isLoading = true;
        this.update();
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}`, { credentials: 'include' });
            if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
            this.data = await res.json();
            this.title.label = `Géocache - ${this.data?.name ?? this.data?.gc_code ?? this.geocacheId}`;
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('GeocacheDetailsWidget: load error', e);
            this.messages.error('Impossible de charger la géocache');
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    protected renderRow(label: string, value?: React.ReactNode): React.ReactNode {
        if (value === undefined || value === null || value === '') { return undefined; }
        return (
            <tr>
                <td style={{ opacity: 0.7, paddingRight: 8 }}>{label}</td>
                <td>{value}</td>
            </tr>
        );
    }

    protected render(): React.ReactNode {
        const d = this.data;
        return (
            <div className='p-2'>
                {this.isLoading && <div>Chargement…</div>}
                {!this.isLoading && !d && <div style={{ opacity: 0.7 }}>Aucune donnée</div>}
                {!this.isLoading && d && (
                    <div style={{ display: 'grid', gap: 10 }}>
                        <h3 style={{ margin: 0 }}>{d.name}</h3>
                        <table className='theia-table' style={{ maxWidth: 640 }}>
                            <tbody>
                                {this.renderRow('Code', d.gc_code)}
                                {this.renderRow('Type', d.type)}
                                {this.renderRow('Taille', d.size)}
                                {this.renderRow('Propriétaire', d.owner)}
                                {this.renderRow('Difficulté', d.difficulty?.toString())}
                                {this.renderRow('Terrain', d.terrain?.toString())}
                                {this.renderRow('Latitude', d.latitude?.toString())}
                                {this.renderRow('Longitude', d.longitude?.toString())}
                                {this.renderRow('Placée le', d.placed_at)}
                                {this.renderRow('Statut', d.status)}
                                {this.renderRow('Lien', d.url ? <a href={d.url} target='_blank' rel='noreferrer'>{d.url}</a> : undefined)}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    }
}


