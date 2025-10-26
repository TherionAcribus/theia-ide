import * as React from 'react';
import { injectable } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';

type ZoneDto = { id: number; name: string; description?: string; created_at?: string; geocaches_count: number };

@injectable()
export class ZonesWidget extends ReactWidget {
    static readonly ID = 'zones.widget';

    protected zones: ZoneDto[] = [];
    protected activeZoneId: number | undefined;
    protected backendBaseUrl = 'http://127.0.0.1:8000';

    constructor() {
        super();
        this.id = ZonesWidget.ID;
        this.title.closable = true;
        this.title.label = 'Zones';
        this.title.caption = 'Zones';
        this.title.iconClass = 'fa fa-map';
        this.addClass('theia-zones-widget');
    }

    onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
        this.refresh();
    }

    protected async refresh(): Promise<void> {
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/zones`, { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.zones = await res.json();
            // Charger la zone active
            const act = await fetch(`${this.backendBaseUrl}/api/active-zone`, { credentials: 'include' });
            this.activeZoneId = act.ok ? (await act.json())?.id : undefined;
            this.update();
        } catch (e) {
            console.error('Zones: fetch error', e);
        }
    }

    protected async onAddZoneSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        const name = (formData.get('name') as string || '').trim();
        const description = (formData.get('description') as string || '').trim();
        if (!name) { return; }
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/zones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ name, description })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            form.reset();
            await this.refresh();
        } catch (e) {
            console.error('Zones: create error', e);
        }
    }

    protected render(): React.ReactNode {
        return (
            <div className='p-2'>
                <form onSubmit={e => this.onAddZoneSubmit(e)} style={{ display: 'grid', gap: 6 }}>
                    <input name='name' placeholder='Nouvelle zone' />
                    <input name='description' placeholder='Description (optionnel)' />
                    <button type='submit'>Ajouter</button>
                </form>
                <ul style={{ marginTop: 8, listStyle: 'none', padding: 0 }}>
                    {this.zones.map(z => (
                        <li key={z.id} style={{ padding: '4px 0' }}>
                            <button
                                onClick={async () => {
                                    await fetch(`${this.backendBaseUrl}/api/active-zone`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        credentials: 'include',
                                        body: JSON.stringify({ zone_id: z.id })
                                    });
                                    this.activeZoneId = z.id;
                                    this.update();
                                }}
                                style={{
                                    width: '100%',
                                    textAlign: 'left',
                                    background: this.activeZoneId === z.id ? 'var(--theia-editor-selectionBackground)' : 'transparent',
                                    border: 0,
                                    color: 'inherit',
                                    padding: '4px 6px',
                                    borderRadius: 3,
                                    cursor: 'pointer'
                                }}
                                title={z.description || ''}
                            >
                                {z.name}
                                <span style={{ opacity: 0.7, marginLeft: 6 }}>({z.geocaches_count})</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }
}


