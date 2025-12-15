/**
 * Widget pour afficher les logs (commentaires) d'une géocache.
 * 
 * Ce widget peut être affiché dans le panneau droit, en bas, ou dans la zone principale.
 * Il permet de visualiser les logs récupérés depuis Geocaching.com et de les rafraîchir.
 */
import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';

/**
 * Interface représentant un log de géocache
 */
interface GeocacheLogDto {
    id: number;
    external_id: string;
    author: string;
    author_guid?: string;
    text: string;
    date: string | null;
    log_type: string;
    is_favorite: boolean;
    created_at: string | null;
}

/**
 * Interface pour la réponse de l'API des logs
 */
interface LogsApiResponse {
    geocache_id: number;
    gc_code: string;
    total_count: number;
    offset: number;
    limit: number;
    logs: GeocacheLogDto[];
}

/**
 * Interface pour la réponse du rafraîchissement
 */
interface RefreshApiResponse {
    geocache_id: number;
    gc_code: string;
    message: string;
    added: number;
    updated: number;
    total: number;
}

/**
 * Props pour le composant LogItem
 */
interface LogItemProps {
    log: GeocacheLogDto;
}

/**
 * Retourne la couleur associée à un type de log
 */
function getLogTypeColor(logType: string): string {
    const type = logType.toLowerCase();
    if (type === 'found' || type.includes('found')) {
        return '#22c55e'; // Vert
    }
    if (type === 'did not find' || type === 'dnf') {
        return '#ef4444'; // Rouge
    }
    if (type === 'note' || type === 'write note') {
        return '#3b82f6'; // Bleu
    }
    if (type.includes('owner') || type.includes('maintenance')) {
        return '#f59e0b'; // Orange
    }
    if (type.includes('reviewer')) {
        return '#8b5cf6'; // Violet
    }
    if (type.includes('disable') || type.includes('archive')) {
        return '#6b7280'; // Gris
    }
    return '#9ca3af'; // Gris clair par défaut
}

/**
 * Retourne l'icône associée à un type de log
 */
function getLogTypeIcon(logType: string): string {
    const type = logType.toLowerCase();
    if (type === 'found' || type.includes('found')) {
        return 'fa-check';
    }
    if (type === 'did not find' || type === 'dnf') {
        return 'fa-times';
    }
    if (type === 'note' || type === 'write note') {
        return 'fa-sticky-note';
    }
    if (type.includes('owner') || type.includes('maintenance')) {
        return 'fa-wrench';
    }
    if (type.includes('reviewer')) {
        return 'fa-shield';
    }
    if (type.includes('disable')) {
        return 'fa-pause';
    }
    if (type.includes('archive')) {
        return 'fa-archive';
    }
    if (type.includes('enable') || type.includes('publish')) {
        return 'fa-play';
    }
    return 'fa-comment';
}

/**
 * Formate une date ISO en format lisible
 */
function formatDate(dateStr: string | null): string {
    if (!dateStr) {
        return 'Date inconnue';
    }
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    } catch {
        return dateStr;
    }
}

/**
 * Composant pour afficher un seul log
 */
const LogItem: React.FC<LogItemProps> = ({ log }) => {
    const color = getLogTypeColor(log.log_type);
    const icon = getLogTypeIcon(log.log_type);
    const [expanded, setExpanded] = React.useState(false);
    
    // Tronquer le texte si trop long
    const maxLength = 200;
    const isLong = log.text && log.text.length > maxLength;
    const displayText = expanded || !isLong 
        ? log.text 
        : log.text.substring(0, maxLength) + '...';
    
    return (
        <div 
            style={{
                background: 'var(--theia-editor-background)',
                border: '1px solid var(--theia-panel-border)',
                borderLeft: `4px solid ${color}`,
                borderRadius: 6,
                padding: 12,
                marginBottom: 8
            }}
        >
            {/* En-tête du log */}
            <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'flex-start',
                marginBottom: 8
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Icône du type */}
                    <span 
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            background: color,
                            color: 'white',
                            fontSize: 12
                        }}
                    >
                        <i className={`fa ${icon}`} />
                    </span>
                    
                    {/* Type et auteur */}
                    <div>
                        <div style={{ fontWeight: 'bold', color }}>
                            {log.log_type}
                            {log.is_favorite && (
                                <span style={{ marginLeft: 6, color: '#fbbf24' }} title="Favori">
                                    <i className="fa fa-star" />
                                </span>
                            )}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>
                            par <strong>{log.author}</strong>
                        </div>
                    </div>
                </div>
                
                {/* Date */}
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {formatDate(log.date)}
                </div>
            </div>
            
            {/* Texte du log */}
            {log.text && (
                <div style={{ 
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: '1px solid var(--theia-panel-border)',
                    whiteSpace: 'pre-wrap',
                    fontSize: 13,
                    lineHeight: 1.5
                }}>
                    {displayText}
                    {isLong && (
                        <button
                            onClick={() => setExpanded(!expanded)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--theia-textLink-foreground)',
                                cursor: 'pointer',
                                marginLeft: 4,
                                padding: 0,
                                fontSize: 12
                            }}
                        >
                            {expanded ? 'Voir moins' : 'Voir plus'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * Props pour le composant LogsList
 */
interface LogsListProps {
    logs: GeocacheLogDto[];
    isLoading: boolean;
    onLoadMore?: () => void;
    hasMore: boolean;
}

/**
 * Composant pour afficher la liste des logs
 */
const LogsList: React.FC<LogsListProps> = ({ logs, isLoading, onLoadMore, hasMore }) => {
    if (isLoading && logs.length === 0) {
        return (
            <div style={{ textAlign: 'center', padding: 20, opacity: 0.7 }}>
                <i className="fa fa-spinner fa-spin" style={{ marginRight: 8 }} />
                Chargement des logs...
            </div>
        );
    }
    
    if (logs.length === 0) {
        return (
            <div style={{ textAlign: 'center', padding: 20, opacity: 0.7 }}>
                <i className="fa fa-comments" style={{ marginRight: 8 }} />
                Aucun log disponible
            </div>
        );
    }
    
    return (
        <div>
            {logs.map(log => (
                <LogItem key={log.id} log={log} />
            ))}
            
            {hasMore && (
                <button
                    onClick={onLoadMore}
                    disabled={isLoading}
                    style={{
                        width: '100%',
                        padding: '10px 16px',
                        background: 'var(--theia-button-background)',
                        color: 'var(--theia-button-foreground)',
                        border: 'none',
                        borderRadius: 4,
                        cursor: isLoading ? 'wait' : 'pointer',
                        marginTop: 8
                    }}
                >
                    {isLoading ? (
                        <>
                            <i className="fa fa-spinner fa-spin" style={{ marginRight: 8 }} />
                            Chargement...
                        </>
                    ) : (
                        <>
                            <i className="fa fa-chevron-down" style={{ marginRight: 8 }} />
                            Charger plus de logs
                        </>
                    )}
                </button>
            )}
        </div>
    );
};

/**
 * Widget Theia pour afficher les logs d'une géocache
 */
@injectable()
export class GeocacheLogsWidget extends ReactWidget {
    static readonly ID = 'geocache.logs.widget';

    protected backendBaseUrl = 'http://127.0.0.1:8000';
    protected geocacheId?: number;
    protected geocacheCode?: string;
    protected geocacheName?: string;
    protected logs: GeocacheLogDto[] = [];
    protected totalCount = 0;
    protected isLoading = false;
    protected isRefreshing = false;
    protected offset = 0;
    protected limit = 25;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService
    ) {
        super();
        this.id = GeocacheLogsWidget.ID;
        this.title.label = 'Logs';
        this.title.caption = 'Logs de la géocache';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-comments';
        this.addClass('theia-geocache-logs-widget');
    }

    @postConstruct()
    initialize(): void {
        // Écouter les événements de sélection de géocache
        this.addGlobalEventListeners();
    }

    protected onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
    }

    protected onBeforeDetach(msg: any): void {
        this.removeGlobalEventListeners();
        super.onBeforeDetach(msg);
    }

    private handleGeocacheSelected = (event: CustomEvent<{ geocacheId: number; gcCode?: string; name?: string }>): void => {
        const { geocacheId, gcCode, name } = event.detail;
        this.setGeocache({ geocacheId, gcCode, name });
    };

    private addGlobalEventListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        window.addEventListener('geoapp-geocache-selected', this.handleGeocacheSelected as EventListener);
    }

    private removeGlobalEventListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        window.removeEventListener('geoapp-geocache-selected', this.handleGeocacheSelected as EventListener);
    }

    /**
     * Définit la géocache dont on veut afficher les logs
     */
    setGeocache(params: { geocacheId: number; gcCode?: string; name?: string }): void {
        this.geocacheId = params.geocacheId;
        this.geocacheCode = params.gcCode;
        this.geocacheName = params.name;
        this.logs = [];
        this.offset = 0;
        this.totalCount = 0;
        
        this.title.label = params.gcCode ? `Logs - ${params.gcCode}` : 'Logs';
        
        this.loadLogs();
    }

    /**
     * Charge les logs depuis le backend
     */
    protected async loadLogs(): Promise<void> {
        if (!this.geocacheId || this.isLoading) {
            return;
        }

        this.isLoading = true;
        this.update();

        try {
            const url = `${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/logs?limit=${this.limit}&offset=${this.offset}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data: LogsApiResponse = await response.json();
            
            if (this.offset === 0) {
                this.logs = data.logs;
            } else {
                this.logs = [...this.logs, ...data.logs];
            }
            
            this.totalCount = data.total_count;
            this.geocacheCode = data.gc_code;
            
        } catch (error) {
            console.error('[GeocacheLogsWidget] Failed to load logs:', error);
            this.messages.error('Impossible de charger les logs');
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    /**
     * Charge plus de logs (pagination)
     */
    protected loadMore = (): void => {
        this.offset += this.limit;
        this.loadLogs();
    };

    /**
     * Rafraîchit les logs depuis Geocaching.com
     */
    protected async refreshLogs(): Promise<void> {
        if (!this.geocacheId || this.isRefreshing) {
            return;
        }

        this.isRefreshing = true;
        this.update();

        try {
            const url = `${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/logs/refresh?count=50`;
            const response = await fetch(url, { method: 'POST' });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const data: RefreshApiResponse = await response.json();
            
            this.messages.info(`Logs rafraîchis : ${data.added} ajoutés, ${data.updated} mis à jour`);
            
            // Recharger les logs depuis le début
            this.offset = 0;
            await this.loadLogs();
            
        } catch (error) {
            console.error('[GeocacheLogsWidget] Failed to refresh logs:', error);
            this.messages.error(`Impossible de rafraîchir les logs: ${error}`);
        } finally {
            this.isRefreshing = false;
            this.update();
        }
    }

    protected render(): React.ReactNode {
        const hasMore = this.logs.length < this.totalCount;
        
        return (
            <div style={{ 
                padding: 16, 
                height: '100%', 
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column'
            }}>
                {/* En-tête */}
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: 16,
                    flexShrink: 0
                }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 16 }}>
                            {this.geocacheCode ? (
                                <>Logs - {this.geocacheCode}</>
                            ) : (
                                <>Logs</>
                            )}
                        </h3>
                        {this.geocacheName && (
                            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                                {this.geocacheName}
                            </div>
                        )}
                        {this.totalCount > 0 && (
                            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                                {this.totalCount} log{this.totalCount > 1 ? 's' : ''} au total
                            </div>
                        )}
                    </div>
                    
                    {/* Bouton rafraîchir */}
                    {this.geocacheId && (
                        <button
                            onClick={() => this.refreshLogs()}
                            disabled={this.isRefreshing}
                            style={{
                                padding: '8px 16px',
                                background: 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: 4,
                                cursor: this.isRefreshing ? 'wait' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8
                            }}
                            title="Récupérer les logs depuis Geocaching.com"
                        >
                            <i className={`fa ${this.isRefreshing ? 'fa-spinner fa-spin' : 'fa-sync-alt'}`} />
                            {this.isRefreshing ? 'Rafraîchissement...' : 'Rafraîchir'}
                        </button>
                    )}
                </div>
                
                {/* Message si pas de géocache sélectionnée */}
                {!this.geocacheId ? (
                    <div style={{ 
                        textAlign: 'center', 
                        padding: 40, 
                        opacity: 0.7,
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        <i className="fa fa-comments" style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }} />
                        <p>Sélectionnez une géocache pour voir ses logs</p>
                    </div>
                ) : (
                    /* Liste des logs */
                    <div style={{ flex: 1, overflow: 'auto' }}>
                        <LogsList 
                            logs={this.logs}
                            isLoading={this.isLoading}
                            onLoadMore={this.loadMore}
                            hasMore={hasMore}
                        />
                    </div>
                )}
            </div>
        );
    }
}
