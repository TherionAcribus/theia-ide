import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';

type LogTypeValue = 'found' | 'dnf' | 'note';

interface GeocacheListItem {
    id: number;
    gc_code: string;
    name: string;
}

@injectable()
export class GeocacheLogEditorWidget extends ReactWidget {
    static readonly ID = 'geocache.logEditor.widget';

    protected backendBaseUrl = 'http://127.0.0.1:8000';

    protected geocacheIds: number[] = [];
    protected geocaches: GeocacheListItem[] = [];
    protected isLoading = false;

    protected logDate = new Date().toISOString().slice(0, 10);
    protected logType: LogTypeValue = 'found';

    protected useSameTextForAll = true;
    protected globalText = '';
    protected perCacheText: Record<number, string> = {};

    protected isSubmitting = false;
    protected lastSubmitSummary: { ok: number; failed: number } | undefined;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService
    ) {
        super();
        this.title.label = 'Logs';
        this.title.caption = 'Édition de logs';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-pen';
        this.addClass('theia-geocache-log-editor-widget');
    }

    setContext(params: { geocacheIds: number[]; title?: string }): void {
        const ids = (params.geocacheIds || []).filter((v): v is number => typeof v === 'number');
        this.geocacheIds = Array.from(new Set(ids));
        this.geocaches = [];
        this.perCacheText = {};

        if (params.title) {
            this.title.label = params.title;
        } else if (this.geocacheIds.length === 1) {
            this.title.label = 'Log - 1 géocache';
        } else {
            this.title.label = `Log - ${this.geocacheIds.length} géocaches`;
        }

        void this.loadGeocaches();
        this.update();
    }

    protected async loadGeocaches(): Promise<void> {
        if (!this.geocacheIds.length || this.isLoading) {
            return;
        }

        this.isLoading = true;
        this.update();

        try {
            const results = await Promise.all(this.geocacheIds.map(async (id) => {
                const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${id}`, { credentials: 'include' });
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const data = await res.json();
                return {
                    id: data.id as number,
                    gc_code: (data.gc_code || '').toString(),
                    name: (data.name || '').toString(),
                } as GeocacheListItem;
            }));

            this.geocaches = results;
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] loadGeocaches error', e);
            this.messages.error('Impossible de charger la liste des géocaches.');
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    protected getTextForGeocacheId(geocacheId: number): string {
        return this.useSameTextForAll ? this.globalText : (this.perCacheText[geocacheId] ?? '');
    }

    protected async submitLogsToGeocaching(): Promise<void> {
        if (this.isSubmitting) {
            return;
        }
        if (this.isLoading || this.geocaches.length === 0) {
            this.messages.warn('Aucune géocache à loguer.');
            return;
        }

        const missingText = this.geocaches
            .map(gc => ({ gc, text: (this.getTextForGeocacheId(gc.id) || '').trim() }))
            .filter(x => !x.text);

        if (missingText.length > 0) {
            if (this.useSameTextForAll) {
                this.messages.warn('Le texte du log est vide.');
            } else {
                this.messages.warn(`Texte manquant pour ${missingText.length} géocache(s).`);
            }
            return;
        }

        this.isSubmitting = true;
        this.lastSubmitSummary = undefined;
        this.update();

        let ok = 0;
        let failed = 0;

        try {
            for (const gc of this.geocaches) {
                const payload = {
                    text: this.getTextForGeocacheId(gc.id),
                    date: this.logDate,
                    logType: this.logType,
                };

                let responseBody: any = undefined;
                try {
                    const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${gc.id}/logs/submit`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify(payload),
                    });

                    try {
                        responseBody = await res.json();
                    } catch {
                        responseBody = undefined;
                    }

                    if (res.ok) {
                        ok += 1;
                    } else {
                        failed += 1;
                        const detail = responseBody?.error ? `: ${responseBody.error}` : '';
                        this.messages.warn(`${gc.gc_code} - échec${detail}`);
                    }
                } catch (e) {
                    console.error('[GeocacheLogEditorWidget] submit log error', gc, e, responseBody);
                    failed += 1;
                    this.messages.warn(`${gc.gc_code} - erreur réseau/backend`);
                }
            }

            this.lastSubmitSummary = { ok, failed };
            if (failed === 0) {
                this.messages.info(`Logs envoyés sur Geocaching.com: ${ok}/${ok}`);
            } else {
                this.messages.warn(`Logs envoyés sur Geocaching.com: ${ok} ok, ${failed} échec(s)`);
            }
        } finally {
            this.isSubmitting = false;
            this.update();
        }
    }

    protected formatVisitedIso(dateOnly: string): string {
        const safe = (dateOnly || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(safe)) {
            return `${new Date().toISOString().slice(0, 10)}T12:00Z`;
        }
        return `${safe}T12:00Z`;
    }

    protected getLogTypeLabel(value: LogTypeValue): string {
        if (value === 'found') {
            return 'Found it';
        }
        if (value === 'dnf') {
            return "Didn't find it";
        }
        return 'Write note';
    }

    protected escapeFieldNotesText(value: string): string {
        return (value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/"/g, '""');
    }

    protected buildFieldNotes(): string {
        const visited = this.formatVisitedIso(this.logDate);
        const logType = this.getLogTypeLabel(this.logType);

        const lines = this.geocaches.map(gc => {
            const rawText = this.useSameTextForAll ? this.globalText : (this.perCacheText[gc.id] ?? '');
            const escaped = this.escapeFieldNotesText(rawText);
            return `${gc.gc_code},${visited},${logType},"${escaped}"`;
        });

        return lines.join('\n');
    }

    protected async copyFieldNotes(): Promise<void> {
        try {
            const content = this.buildFieldNotes();
            await navigator.clipboard.writeText(content);
            this.messages.info('Field notes copiées dans le presse-papiers.');
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] copyFieldNotes error', e);
            this.messages.error('Impossible de copier dans le presse-papiers.');
        }
    }

    protected downloadFieldNotes(): void {
        try {
            const content = this.buildFieldNotes();
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'geocache_visits.txt';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] downloadFieldNotes error', e);
            this.messages.error('Impossible de télécharger le fichier.');
        }
    }

    protected render(): React.ReactNode {
        return (
            <div style={{ padding: 12, height: '100%', overflow: 'auto', display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div>
                        <h3 style={{ margin: 0 }}>Logs</h3>
                        <div style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>
                            {this.geocacheIds.length} géocache(s)
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                            className='theia-button primary'
                            onClick={() => { void this.submitLogsToGeocaching(); }}
                            disabled={this.isLoading || this.isSubmitting || this.geocaches.length === 0}
                            title='Envoyer le(s) log(s) sur Geocaching.com via le backend'
                            style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                            ✅ Envoyer sur GC
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={() => { void this.copyFieldNotes(); }}
                            disabled={this.isLoading || this.geocaches.length === 0}
                            title='Copier le format geocache_visits.txt (field notes)'
                            style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                            📋 Copier field notes
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={() => this.downloadFieldNotes()}
                            disabled={this.isLoading || this.geocaches.length === 0}
                            title='Télécharger un fichier geocache_visits.txt'
                            style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                            ⬇️ Télécharger
                        </button>
                    </div>
                </div>

                {this.lastSubmitSummary && (
                    <div style={{ opacity: 0.85, fontSize: 12 }}>
                        Résultat: {this.lastSubmitSummary.ok} ok, {this.lastSubmitSummary.failed} échec(s)
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '160px 220px 1fr', gap: 12, alignItems: 'end' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Date</label>
                        <input
                            type='date'
                            className='theia-input'
                            value={this.logDate}
                            onChange={e => { this.logDate = e.target.value; this.update(); }}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Type</label>
                        <select
                            className='theia-select'
                            value={this.logType}
                            onChange={e => { this.logType = e.target.value as LogTypeValue; this.update(); }}
                            style={{ width: '100%' }}
                        >
                            <option value='found'>Found it</option>
                            <option value='dnf'>Didn't find it</option>
                            <option value='note'>Write note</option>
                        </select>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                            type='checkbox'
                            checked={this.useSameTextForAll}
                            onChange={e => { this.useSameTextForAll = e.target.checked; this.update(); }}
                        />
                        <span style={{ fontSize: 12, opacity: 0.85 }}>Texte identique pour toutes les géocaches</span>
                    </div>
                </div>

                {this.useSameTextForAll && (
                    <div>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Texte (Markdown)</label>
                        <textarea
                            className='theia-input'
                            value={this.globalText}
                            onChange={e => { this.globalText = e.target.value; this.update(); }}
                            rows={10}
                            style={{ width: '100%', resize: 'vertical' }}
                        />
                    </div>
                )}

                {this.isLoading && (
                    <div style={{ opacity: 0.7 }}>
                        Chargement…
                    </div>
                )}

                {!this.isLoading && this.geocaches.length === 0 && (
                    <div style={{ opacity: 0.7 }}>
                        Aucune géocache
                    </div>
                )}

                {!this.isLoading && this.geocaches.length > 0 && !this.useSameTextForAll && (
                    <div style={{ display: 'grid', gap: 10 }}>
                        {this.geocaches.map(gc => (
                            <div key={gc.id} style={{ border: '1px solid var(--theia-panel-border)', borderRadius: 6, padding: 10, background: 'var(--theia-editor-background)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                                    <div style={{ fontWeight: 700 }}>{gc.gc_code}</div>
                                    <div style={{ opacity: 0.8, fontSize: 12, textAlign: 'right' }}>{gc.name}</div>
                                </div>
                                <textarea
                                    className='theia-input'
                                    value={this.perCacheText[gc.id] ?? ''}
                                    onChange={e => {
                                        this.perCacheText = { ...this.perCacheText, [gc.id]: e.target.value };
                                        this.update();
                                    }}
                                    rows={6}
                                    style={{ width: '100%', resize: 'vertical', marginTop: 8 }}
                                    placeholder='Texte (Markdown)'
                                />
                            </div>
                        ))}
                    </div>
                )}

                {!this.isLoading && this.geocaches.length > 0 && (
                    <details>
                        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Aperçu field notes</summary>
                        <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', background: 'var(--theia-editor-background)', border: '1px solid var(--theia-panel-border)', borderRadius: 6, padding: 10, fontSize: 12, overflow: 'auto' }}>
                            {this.buildFieldNotes()}
                        </pre>
                    </details>
                )}
            </div>
        );
    }
}
