import * as React from 'react';
import { injectable, inject } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { ApplicationShell } from '@theia/core/lib/browser';

type GeocacheAttribute = { name: string; is_negative?: boolean; base_filename?: string };
type GeocacheImage = { url: string };
type GeocacheWaypoint = {
    id?: number;
    prefix?: string;
    lookup?: string;
    name?: string;
    type?: string;
    latitude?: number;
    longitude?: number;
    gc_coords?: string;
    note?: string;
};
type GeocacheChecker = { id?: number; name?: string; url?: string };

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
    coordinates_raw?: string;
    is_corrected?: boolean;
    original_latitude?: number;
    original_longitude?: number;
    placed_at?: string;
    status?: string;
    zone_id?: number;
    description_html?: string;
    hints?: string;
    attributes?: GeocacheAttribute[];
    favorites_count?: number;
    logs_count?: number;
    images?: GeocacheImage[];
    found?: boolean;
    found_date?: string;
    waypoints?: GeocacheWaypoint[];
    checkers?: GeocacheChecker[];
};

@injectable()
export class GeocacheDetailsWidget extends ReactWidget {
    static readonly ID = 'geocache.details.widget';

    protected backendBaseUrl = 'http://127.0.0.1:8000';
    protected geocacheId?: number;
    protected data?: GeocacheDto;
    protected isLoading = false;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell
    ) {
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

    /**
     * Appelé quand le widget devient actif
     * Réactive automatiquement la carte correspondante
     */
    protected onActivateRequest(msg: any): void {
        super.onActivateRequest(msg);
        this.reactivateMap();
    }

    /**
     * Réactive la carte correspondante à cette géocache
     */
    private reactivateMap(): void {
        // Si on a une géocache chargée, réactiver sa carte
        if (this.geocacheId && this.data?.gc_code) {
            const mapId = `geoapp-map-geocache-${this.geocacheId}`;
            const existingMap = this.shell.getWidgets('bottom').find(w => w.id === mapId);
            
            if (existingMap) {
                console.log('[GeocacheDetailsWidget] Réactivation de la carte géocache:', this.geocacheId);
                this.shell.activateWidget(mapId);
            }
        }
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

    protected renderAttributes(attrs?: GeocacheAttribute[]): React.ReactNode {
        if (!attrs || attrs.length === 0) { return undefined; }
        return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {attrs.map((a, idx) => (
                    <span key={idx} style={{
                        border: '1px solid var(--theia-foreground)',
                        borderRadius: 4,
                        padding: '2px 6px',
                        fontSize: 12,
                        opacity: a.is_negative ? 0.7 : 1
                    }} title={a.base_filename || a.name}>
                        {a.is_negative ? 'No ' : ''}{a.name}
                    </span>
                ))}
            </div>
        );
    }

    protected renderImages(images?: GeocacheImage[]): React.ReactNode {
        if (!images || images.length === 0) { return undefined; }
        return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {images.map((img, i) => (
                    <a key={i} href={img.url} target='_blank' rel='noreferrer' title={img.url}>
                        <img src={img.url} style={{ maxWidth: 160, maxHeight: 120, objectFit: 'cover', borderRadius: 4 }} />
                    </a>
                ))}
            </div>
        );
    }

    protected renderWaypoints(waypoints?: GeocacheWaypoint[]): React.ReactNode {
        if (!waypoints || waypoints.length === 0) { return undefined; }
        return (
            <table className='theia-table' style={{ width: '100%' }}>
                <thead>
                    <tr>
                        <th>Préfixe</th>
                        <th>Lookup</th>
                        <th>Nom</th>
                        <th>Type</th>
                        <th>Coordonnées</th>
                        <th>Note</th>
                    </tr>
                </thead>
                <tbody>
                    {waypoints.map((w, i) => (
                        <tr key={w.id ?? i}>
                            <td>{w.prefix}</td>
                            <td>{w.lookup}</td>
                            <td>{w.name}</td>
                            <td>{w.type}</td>
                            <td>{w.gc_coords || (w.latitude !== undefined && w.longitude !== undefined ? `${w.latitude}, ${w.longitude}` : '')}</td>
                            <td style={{ maxWidth: 400 }}>{w.note}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    }

    protected renderCheckers(checkers?: GeocacheChecker[]): React.ReactNode {
        if (!checkers || checkers.length === 0) { return undefined; }
        return (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
                {checkers.map((c, i) => (
                    <li key={c.id ?? i}>
                        {c.url ? <a href={c.url} target='_blank' rel='noreferrer'>{c.name || c.url}</a> : (c.name || '')}
                    </li>
                ))}
            </ul>
        );
    }

    protected render(): React.ReactNode {
        const d = this.data;
        return (
            <div className='p-2'>
                {this.isLoading && <div>Chargement…</div>}
                {!this.isLoading && !d && <div style={{ opacity: 0.7 }}>Aucune donnée</div>}
                {!this.isLoading && d && (
                    <div style={{ display: 'grid', gap: 12 }}>
                        <h3 style={{ margin: 0 }}>{d.name}</h3>
                        <table className='theia-table' style={{ maxWidth: 860 }}>
                            <tbody>
                                {this.renderRow('Code', d.gc_code)}
                                {this.renderRow('Propriétaire', d.owner)}
                                {this.renderRow('Type', d.type)}
                                {this.renderRow('Taille', d.size)}
                                {this.renderRow('Difficulté', d.difficulty?.toString())}
                                {this.renderRow('Terrain', d.terrain?.toString())}
                                {this.renderRow('Favoris', d.favorites_count?.toString())}
                                {this.renderRow('Logs', d.logs_count?.toString())}
                                {this.renderRow('Placée le', d.placed_at)}
                                {this.renderRow('Statut', d.status)}
                                {this.renderRow('Lien', d.url ? <a href={d.url} target='_blank' rel='noreferrer'>{d.url}</a> : undefined)}
                            </tbody>
                        </table>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div>
                                <h4 style={{ margin: '8px 0' }}>Coordonnées</h4>
                                <table className='theia-table' style={{ maxWidth: 600 }}>
                                    <tbody>
                                        {this.renderRow('Affichées', d.coordinates_raw)}
                                        {this.renderRow('Latitude', d.latitude?.toString())}
                                        {this.renderRow('Longitude', d.longitude?.toString())}
                                        {this.renderRow('Corrigées', d.is_corrected ? 'Oui' : (d.is_corrected === false ? 'Non' : undefined))}
                                        {this.renderRow('Originales', (d.original_latitude !== undefined && d.original_longitude !== undefined) ? `${d.original_latitude}, ${d.original_longitude}` : undefined)}
                                    </tbody>
                                </table>
                            </div>
                            <div>
                                <h4 style={{ margin: '8px 0' }}>Attributs</h4>
                                {this.renderAttributes(d.attributes)}
                            </div>
                        </div>

                        <div>
                            <h4 style={{ margin: '8px 0' }}>Description</h4>
                            <div style={{ border: '1px solid var(--theia-foreground)', borderRadius: 4, padding: 8, maxWidth: 900 }}
                                dangerouslySetInnerHTML={{ __html: d.description_html || '' }} />
                        </div>

                        {d.hints ? (
                            <div>
                                <h4 style={{ margin: '8px 0' }}>Indices</h4>
                                <div style={{ whiteSpace: 'pre-wrap', opacity: 0.9 }}>{d.hints}</div>
                            </div>
                        ) : undefined}

                        {this.renderImages(d.images)}

                        {d.waypoints && d.waypoints.length > 0 ? (
                            <div>
                                <h4 style={{ margin: '8px 0' }}>Waypoints</h4>
                                {this.renderWaypoints(d.waypoints)}
                            </div>
                        ) : undefined}

                        {d.checkers && d.checkers.length > 0 ? (
                            <div>
                                <h4 style={{ margin: '8px 0' }}>Checkers</h4>
                                {this.renderCheckers(d.checkers)}
                            </div>
                        ) : undefined}
                    </div>
                )}
            </div>
        );
    }
}


