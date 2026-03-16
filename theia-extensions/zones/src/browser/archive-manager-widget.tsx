import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { ConfirmDialog } from '@theia/core/lib/browser';

interface ArchiveStats {
    total_archived: number;
    solved: number;
    in_progress: number;
    found: number;
    by_cache_type: Record<string, number>;
    by_resolution_method: Record<string, number>;
}

interface ArchiveSettings {
    auto_sync_enabled: boolean;
}

type BulkFilter = 'all' | 'by_status' | 'orphaned' | 'before_date';

const BULK_FILTER_LABELS: Record<BulkFilter, string> = {
    all: 'Toutes les archives',
    by_status: 'Par statut de résolution',
    orphaned: 'Orphelines (géocache supprimée)',
    before_date: 'Antérieures à une date',
};

const STATUS_OPTIONS = [
    { value: 'not_solved', label: 'Non résolues' },
    { value: 'in_progress', label: 'En cours' },
    { value: 'solved', label: 'Résolues' },
];

@injectable()
export class ArchiveManagerWidget extends ReactWidget {
    static readonly ID = 'geoapp.archive.manager';

    protected backendBaseUrl = 'http://localhost:8000';
    protected stats: ArchiveStats | null = null;
    protected settings: ArchiveSettings | null = null;
    protected isLoading = false;
    protected isSaving = false;
    protected isDeleting = false;
    protected bulkFilter: BulkFilter = 'orphaned';
    protected bulkStatus = 'not_solved';
    protected bulkBeforeDate = '';
    protected lastActionResult: string | null = null;
    protected lastActionError: string | null = null;
    protected pendingDisable = false;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
    ) {
        super();
        this.id = ArchiveManagerWidget.ID;
        this.title.label = '🗄️ Gestionnaire Archive';
        this.title.caption = 'Gérer l\'archive de résolution des géocaches';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-database';
        this.addClass('theia-archive-manager-widget');
    }

    @postConstruct()
    initialize(): void {
        this.loadData();
    }

    protected async loadData(): Promise<void> {
        this.isLoading = true;
        this.update();
        try {
            const [statsRes, settingsRes] = await Promise.all([
                fetch(`${this.backendBaseUrl}/api/archive/stats`, { credentials: 'include' }),
                fetch(`${this.backendBaseUrl}/api/archive/settings`, { credentials: 'include' }),
            ]);
            if (statsRes.ok) { this.stats = await statsRes.json(); }
            if (settingsRes.ok) { this.settings = await settingsRes.json(); }
        } catch (e) {
            console.error('[ArchiveManagerWidget] loadData error', e);
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    protected toggleAutoSync = async (): Promise<void> => {
        if (!this.settings) { return; }
        const current = this.settings.auto_sync_enabled;

        if (current) {
            // Activation → désactivation : demander double confirmation
            const dialog = new ConfirmDialog({
                title: '⚠️ Désactiver l\'archivage automatique',
                msg: [
                    '⚠️ ATTENTION : Action non recommandée.',
                    '',
                    'Désactiver l\'archivage automatique signifie que les données de résolution',
                    '(statut, coordonnées corrigées, notes, waypoints) ne seront PLUS sauvegardées',
                    'automatiquement. En cas de suppression d\'une géocache, ces données seront perdues.',
                    '',
                    'Le snapshot avant suppression restera actif comme filet de sécurité minimal.',
                    '',
                    'Êtes-vous sûr de vouloir désactiver cette protection ?',
                ].join('\n'),
                ok: 'Désactiver quand même',
                cancel: 'Annuler',
            });
            const confirmed = await dialog.open();
            if (!confirmed) { return; }
        }

        this.isSaving = true;
        this.update();
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/archive/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ auto_sync_enabled: !current }),
            });
            if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
            const json = await res.json();
            this.settings = { auto_sync_enabled: json.auto_sync_enabled };
            if (json.warning) {
                this.messages.warn(json.warning);
            } else {
                this.messages.info('Archivage automatique activé.');
            }
        } catch (e) {
            this.messages.error(`Erreur: ${String(e)}`);
        } finally {
            this.isSaving = false;
            this.update();
        }
    };

    protected getBulkPreviewLabel(): string {
        switch (this.bulkFilter) {
            case 'all': return 'TOUTES les archives (irréversible)';
            case 'by_status': return `Archives avec statut "${this.bulkStatus}"`;
            case 'orphaned': return 'Archives dont la géocache n\'existe plus en base';
            case 'before_date': return this.bulkBeforeDate ? `Archives antérieures au ${this.bulkBeforeDate}` : 'Archives (date non définie)';
        }
    }

    protected executeBulkDelete = async (): Promise<void> => {
        if (this.bulkFilter === 'before_date' && !this.bulkBeforeDate) {
            this.messages.warn('Veuillez saisir une date avant de continuer.');
            return;
        }

        // Première confirmation
        const step1 = new ConfirmDialog({
            title: '⚠️ Suppression en masse — Étape 1/2',
            msg: [
                '⚠️ ATTENTION : Cette opération est IRRÉVERSIBLE.',
                '',
                `Vous allez supprimer : ${this.getBulkPreviewLabel()}`,
                '',
                'Les données supprimées NE PEUVENT PAS être récupérées.',
                'Souhaitez-vous continuer ?',
            ].join('\n'),
            ok: 'Continuer vers la confirmation finale',
            cancel: 'Annuler',
        });
        const ok1 = await step1.open();
        if (!ok1) { return; }

        // Deuxième confirmation
        const step2 = new ConfirmDialog({
            title: '🚨 Suppression en masse — Confirmation finale',
            msg: [
                '🚨 DERNIÈRE CHANCE : Confirmez-vous la suppression irréversible ?',
                '',
                `Cible : ${this.getBulkPreviewLabel()}`,
                '',
                'Cliquer sur "Supprimer définitivement" lancera immédiatement l\'opération.',
            ].join('\n'),
            ok: 'Supprimer définitivement',
            cancel: 'Annuler',
        });
        const ok2 = await step2.open();
        if (!ok2) { return; }

        this.isDeleting = true;
        this.lastActionResult = null;
        this.lastActionError = null;
        this.update();

        try {
            const body: Record<string, unknown> = {
                confirm: true,
                filter: this.bulkFilter,
            };
            if (this.bulkFilter === 'by_status') { body['status'] = this.bulkStatus; }
            if (this.bulkFilter === 'before_date') { body['before_date'] = this.bulkBeforeDate; }

            const res = await fetch(`${this.backendBaseUrl}/api/archive`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body),
            });

            const json = await res.json();

            if (!res.ok) {
                throw new Error(json.error || `HTTP ${res.status}`);
            }

            this.lastActionResult = `✅ ${json.deleted} entrée(s) supprimée(s).`;
            this.messages.info(`Archive : ${json.deleted} entrée(s) supprimée(s).`);
            await this.loadData();
        } catch (e) {
            this.lastActionError = `Erreur : ${String(e)}`;
            this.messages.error(`Erreur suppression archive : ${String(e)}`);
        } finally {
            this.isDeleting = false;
            this.update();
        }
    };

    protected render(): React.ReactNode {
        const autoSync = this.settings?.auto_sync_enabled ?? true;

        return (
            <div style={{ padding: 16, display: 'grid', gap: 16, maxWidth: 720 }}>
                <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    🗄️ Gestionnaire d'Archive
                    <button
                        className='theia-button secondary'
                        onClick={() => this.loadData()}
                        disabled={this.isLoading}
                        style={{ fontSize: 12, padding: '3px 10px', marginLeft: 8 }}
                        title='Rafraîchir les statistiques'
                    >
                        {this.isLoading ? '⏳' : '🔄'} Rafraîchir
                    </button>
                </h2>

                {/* Section Statistiques */}
                <div style={{
                    background: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: 6,
                    padding: 16,
                }}>
                    <h4 style={{ margin: '0 0 12px 0' }}>📊 Statistiques de l'archive</h4>
                    {this.isLoading ? (
                        <div style={{ opacity: 0.7 }}>Chargement…</div>
                    ) : this.stats ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                            {[
                                { label: 'Total archivées', value: this.stats.total_archived, color: '#60a5fa' },
                                { label: 'Résolues', value: this.stats.solved, color: '#10b981' },
                                { label: 'En cours', value: this.stats.in_progress, color: '#f59e0b' },
                                { label: 'Trouvées', value: this.stats.found, color: '#a78bfa' },
                            ].map(({ label, value, color }) => (
                                <div key={label} style={{
                                    textAlign: 'center',
                                    background: 'var(--theia-sideBar-background)',
                                    borderRadius: 4,
                                    padding: 8,
                                }}>
                                    <div style={{ fontSize: 22, fontWeight: 'bold', color }}>{value}</div>
                                    <div style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ opacity: 0.7 }}>Aucune donnée disponible.</div>
                    )}
                </div>

                {/* Section Préférence auto-sync */}
                <div style={{
                    background: 'var(--theia-editor-background)',
                    border: `1px solid ${autoSync ? 'var(--theia-panel-border)' : '#f59e0b'}`,
                    borderRadius: 6,
                    padding: 16,
                }}>
                    <h4 style={{ margin: '0 0 8px 0' }}>⚙️ Archivage automatique</h4>

                    {!autoSync && (
                        <div style={{
                            background: '#92400e22',
                            border: '1px solid #f59e0b',
                            borderRadius: 4,
                            padding: '8px 12px',
                            marginBottom: 12,
                            fontSize: 12,
                            color: '#fbbf24',
                        }}>
                            ⚠️ <strong>Archivage automatique désactivé.</strong> Les données de résolution ne sont plus sauvegardées automatiquement. Le snapshot avant suppression reste actif.
                        </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                            <div style={{ fontWeight: 'bold', fontSize: 13 }}>
                                {autoSync ? '✅ Activé (recommandé)' : '⛔ Désactivé (non recommandé)'}
                            </div>
                            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4, maxWidth: 480 }}>
                                Synchronise automatiquement l'archive lors des changements d'état (statut, coordonnées, notes, waypoints).
                                Le snapshot avant suppression reste toujours actif.
                            </div>
                        </div>
                        <button
                            className={`theia-button ${autoSync ? 'secondary' : ''}`}
                            onClick={this.toggleAutoSync}
                            disabled={this.isSaving}
                            style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}
                        >
                            {this.isSaving ? '⏳ …' : autoSync ? '⚠️ Désactiver' : '✅ Activer'}
                        </button>
                    </div>
                </div>

                {/* Section Suppression en masse */}
                <div style={{
                    background: 'var(--theia-editor-background)',
                    border: '1px solid #ef444466',
                    borderRadius: 6,
                    padding: 16,
                }}>
                    <h4 style={{ margin: '0 0 4px 0', color: '#f87171' }}>🗑️ Suppression en masse</h4>
                    <p style={{ fontSize: 11, opacity: 0.7, margin: '0 0 14px 0' }}>
                        ⚠️ Opération <strong>irréversible</strong>. Une double confirmation sera demandée. Les données supprimées ne pourront pas être récupérées.
                    </p>

                    <div style={{ display: 'grid', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <label style={{ fontSize: 12, minWidth: 80 }}>Cible :</label>
                            <select
                                value={this.bulkFilter}
                                onChange={e => { this.bulkFilter = e.target.value as BulkFilter; this.update(); }}
                                style={{
                                    background: 'var(--theia-input-background)',
                                    color: 'var(--theia-input-foreground)',
                                    border: '1px solid var(--theia-panel-border)',
                                    borderRadius: 4,
                                    padding: '4px 8px',
                                    fontSize: 12,
                                    flex: 1,
                                }}
                            >
                                {(Object.entries(BULK_FILTER_LABELS) as [BulkFilter, string][]).map(([key, label]) => (
                                    <option key={key} value={key}>{label}</option>
                                ))}
                            </select>
                        </div>

                        {this.bulkFilter === 'by_status' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <label style={{ fontSize: 12, minWidth: 80 }}>Statut :</label>
                                <select
                                    value={this.bulkStatus}
                                    onChange={e => { this.bulkStatus = e.target.value; this.update(); }}
                                    style={{
                                        background: 'var(--theia-input-background)',
                                        color: 'var(--theia-input-foreground)',
                                        border: '1px solid var(--theia-panel-border)',
                                        borderRadius: 4,
                                        padding: '4px 8px',
                                        fontSize: 12,
                                        flex: 1,
                                    }}
                                >
                                    {STATUS_OPTIONS.map(o => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {this.bulkFilter === 'before_date' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <label style={{ fontSize: 12, minWidth: 80 }}>Avant le :</label>
                                <input
                                    type='date'
                                    value={this.bulkBeforeDate}
                                    onChange={e => { this.bulkBeforeDate = e.target.value; this.update(); }}
                                    style={{
                                        background: 'var(--theia-input-background)',
                                        color: 'var(--theia-input-foreground)',
                                        border: '1px solid var(--theia-panel-border)',
                                        borderRadius: 4,
                                        padding: '4px 8px',
                                        fontSize: 12,
                                        flex: 1,
                                    }}
                                />
                            </div>
                        )}

                        <div style={{
                            background: '#ef444411',
                            border: '1px solid #ef444444',
                            borderRadius: 4,
                            padding: '6px 10px',
                            fontSize: 11,
                            color: '#fca5a5',
                        }}>
                            Cible sélectionnée : <strong>{this.getBulkPreviewLabel()}</strong>
                        </div>

                        {this.lastActionResult && (
                            <div style={{ fontSize: 12, color: '#10b981', padding: '4px 0' }}>
                                {this.lastActionResult}
                            </div>
                        )}
                        {this.lastActionError && (
                            <div style={{ fontSize: 12, color: '#f87171', padding: '4px 0' }}>
                                {this.lastActionError}
                            </div>
                        )}

                        <div>
                            <button
                                onClick={this.executeBulkDelete}
                                disabled={this.isDeleting || (this.bulkFilter === 'before_date' && !this.bulkBeforeDate)}
                                style={{
                                    background: '#ef4444',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: 4,
                                    padding: '7px 18px',
                                    fontSize: 12,
                                    cursor: this.isDeleting ? 'wait' : 'pointer',
                                    opacity: this.isDeleting ? 0.6 : 1,
                                }}
                            >
                                {this.isDeleting ? '⏳ Suppression…' : '🗑️ Supprimer (double confirmation)'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
