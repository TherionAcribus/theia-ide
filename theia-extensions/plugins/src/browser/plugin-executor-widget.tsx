/**
 * Widget pour exécuter des plugins.
 * 
 * Deux modes d'utilisation :
 * 
 * MODE PLUGIN (depuis Panel Plugins) :
 * - Plugin pré-sélectionné, non modifiable
 * - Options Encoder/Décoder disponibles
 * - Association géocache optionnelle
 * - Focus sur l'exécution d'UN plugin spécifique
 * 
 * MODE GEOCACHE (depuis Geocache Details) :
 * - Géocache associée, non modifiable
 * - Sélecteur de plugin visible
 * - Décoder uniquement (pas d'option encoder)
 * - Peut enchaîner les plugins
 * - Focus sur l'analyse de la géocache
 */

import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { StatefulWidget } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PluginsService, Plugin, PluginDetails, PluginResult } from '../common/plugin-protocol';
import { TasksService, Task } from '../common/task-protocol';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';

/**
 * Mode d'exécution du Plugin Executor
 */
export type PluginExecutorMode = 'plugin' | 'geocache';

/**
 * Contexte de géocache passé au widget
 */
export interface GeocacheContext {
    geocacheId?: number;
    gcCode: string;
    name: string;
    coordinates?: {
        latitude: number;
        longitude: number;
        coordinatesRaw?: string;
    };
    description?: string;
    hint?: string;
    difficulty?: number;
    terrain?: number;
    waypoints?: any[]; // Ajout des waypoints
    images?: { url: string }[];
    checkers?: Array<{ id?: number; name?: string; url?: string }>;
}

interface SerializedPluginExecutorState {
    mode: PluginExecutorMode;
    pluginName?: string;
    gcCode?: string;
    autoExecute?: boolean;
    lastAccessTimestamp?: number;
}

interface AddWaypointEventDetail {
    gcCoords: string;
    pluginName?: string;
    geocache?: {
        gcCode: string;
        name?: string;
    };
    sourceResultText?: string;
    waypointTitle?: string;
    waypointNote?: string;
    autoSave?: boolean;
    decimalLatitude?: number;
    decimalLongitude?: number;
}

const parseDdMCoordinate = (value?: string): number | null => {
    if (!value) {
        return null;
    }
    const normalized = value.trim().replace(/[,']/g, '.');
    const match = normalized.match(/^([NSEW])\s*(\d+)[°\s]+([\d.]+)/i);
    if (!match) {
        return null;
    }
    const direction = match[1].toUpperCase();
    const degrees = Number(match[2]);
    const minutes = Number(match[3]);
    if (Number.isNaN(degrees) || Number.isNaN(minutes)) {
        return null;
    }
    let decimal = degrees + minutes / 60;
    if (direction === 'S' || direction === 'W') {
        decimal = -decimal;
    }
    return decimal;
};

const convertDdMPairToDecimal = (latStr?: string, lonStr?: string): { latitude: number; longitude: number } | null => {
    const lat = parseDdMCoordinate(latStr);
    const lon = parseDdMCoordinate(lonStr);

    if (lat === null || lon === null) {
        return null;
    }

    return { latitude: lat, longitude: lon };
};

const convertCombinedCoordsToDecimal = (formatted?: string): { latitude: number; longitude: number } | null => {
    if (!formatted) {
        return null;
    }
    const trimmed = formatted.trim();

    // Format décimal simple "48.8566, 2.3522" ou "48.8566 2.3522"
    const decimalMatch = trimmed.match(/(-?\d+\.?\d*)[\s,]+(-?\d+\.?\d*)/);
    if (decimalMatch && !/[NSEW]/i.test(trimmed)) {
        const lat = Number(decimalMatch[1]);
        const lon = Number(decimalMatch[2]);
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
            return { latitude: lat, longitude: lon };
        }
    }

    // Format DDM combiné "N 48° 51.396 E 002° 21.132"
    const ddmMatch = trimmed.match(/([NS][^EW]*?\d[^EW]*)(?:\s+|,)([EW].+)/i);
    if (ddmMatch) {
        return convertDdMPairToDecimal(ddmMatch[1], ddmMatch[2]);
    }

    // Si déjà séparé par une virgule, tenter une conversion directe
    const parts = trimmed.split(',');
    if (parts.length === 2) {
        return convertDdMPairToDecimal(parts[0], parts[1]);
    }

    return null;
};

const extractDecimalCoordinates = (
    coordinates: any,
    fallbackFormatted?: string
): { latitude: number; longitude: number } | null => {
    if (!coordinates) {
        return convertCombinedCoordsToDecimal(fallbackFormatted);
    }

    if (typeof coordinates.latitude === 'number' && typeof coordinates.longitude === 'number') {
        return {
            latitude: coordinates.latitude,
            longitude: coordinates.longitude
        };
    }

    const backendDecimalLat = Number(
        coordinates.decimalLatitude ??
        coordinates.decimal_latitude ??
        coordinates.latitude_decimal ??
        coordinates.lat_decimal
    );
    const backendDecimalLon = Number(
        coordinates.decimalLongitude ??
        coordinates.decimal_longitude ??
        coordinates.longitude_decimal ??
        coordinates.lon_decimal
    );
    if (!Number.isNaN(backendDecimalLat) && !Number.isNaN(backendDecimalLon)) {
        return {
            latitude: backendDecimalLat,
            longitude: backendDecimalLon
        };
    }

    const fromStrings = convertDdMPairToDecimal(coordinates.latitude, coordinates.longitude);
    if (fromStrings) {
        return fromStrings;
    }

    return convertCombinedCoordsToDecimal(fallbackFormatted);
};

/**
 * Configuration initiale du widget
 */
export interface PluginExecutorConfig {
    mode: PluginExecutorMode;
    
    // Mode PLUGIN
    pluginName?: string;           // Plugin pré-sélectionné
    allowModeSelection?: boolean;  // Permettre encode/decode
    
    // Mode GEOCACHE
    geocacheContext?: GeocacheContext;  // Contexte géocache
    allowPluginChaining?: boolean;      // Permettre l'enchaînement
    autoExecute?: boolean;              // Exécution automatique au chargement
}

/**
 * État du composant d'exécution
 */
interface ExecutorState {
    plugins: Plugin[];
    selectedPlugin: string | null;
    pluginDetails: PluginDetails | null;
    formInputs: Record<string, any>;
    isExecuting: boolean;
    result: PluginResult | null;
    error: string | null;
    executionMode: 'sync' | 'async';
    task: Task | null;
    
    // État lié au mode
    mode: PluginExecutorMode;
    canSelectPlugin: boolean;      // Peut changer de plugin
    canChangeMode: boolean;        // Peut choisir encode/decode
    
    // Historique pour l'enchaînement (mode geocache)
    resultsHistory: PluginResult[];
}

@injectable()
export class PluginExecutorWidget extends ReactWidget implements StatefulWidget {
    static readonly ID = 'plugin-executor-widget';
    static readonly LABEL = 'Plugin Executor';

    @inject(PluginsService)
    protected readonly pluginsService!: PluginsService;

    @inject(TasksService)
    protected readonly tasksService!: TasksService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    private config: PluginExecutorConfig | null = null;
    protected interactionTimerId: number | undefined;
    private lastAccessTimestamp: number = Date.now();

    private readonly handleContentClick = (): void => {
        this.emitInteraction('click');
    };

    private readonly handleContentScroll = (): void => {
        this.emitInteraction('scroll');
    };

    @postConstruct()
    protected init(): void {
        this.id = PluginExecutorWidget.ID;
        this.title.label = PluginExecutorWidget.LABEL;
        this.title.caption = PluginExecutorWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-play-circle';
        this.update();
    }

    private getBackendBaseUrl(): string {
        const value = this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000') as string;
        return (value || 'http://localhost:8000').replace(/\/$/, '');
    }

    protected onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
        this.addInteractionListeners();
    }

    protected onBeforeDetach(msg: any): void {
        this.removeInteractionListeners();
        super.onBeforeDetach(msg);
    }

    private addInteractionListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        this.node.addEventListener('click', this.handleContentClick, true);
        this.node.addEventListener('scroll', this.handleContentScroll, true);
    }

    private removeInteractionListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        this.node.removeEventListener('click', this.handleContentClick, true);
        this.node.removeEventListener('scroll', this.handleContentScroll, true);
        this.clearMinOpenTimeTimer();
    }

    private emitInteraction(type: 'click' | 'scroll' | 'min-open-time'): void {
        if (typeof window === 'undefined') {
            return;
        }
        window.dispatchEvent(new CustomEvent('geoapp-plugin-tab-interaction', {
            detail: {
                widgetId: this.id,
                type
            }
        }));
    }

    private setupMinOpenTimeTimer(): void {
        this.clearMinOpenTimeTimer();

        if (typeof window === 'undefined') {
            return;
        }

        const enabled = this.preferenceService.get('geoApp.ui.tabs.smartReplace.interaction.minOpenTimeEnabled', true) as boolean;
        if (!enabled) {
            return;
        }

        const timeoutSeconds = this.preferenceService.get('geoApp.ui.tabs.smartReplaceTimeout', 30) as number;
        if (!timeoutSeconds || timeoutSeconds <= 0) {
            return;
        }

        this.interactionTimerId = window.setTimeout(() => {
            this.emitInteraction('min-open-time');
        }, timeoutSeconds * 1000);
    }

    private clearMinOpenTimeTimer(): void {
        if (typeof window === 'undefined') {
            return;
        }
        if (this.interactionTimerId !== undefined) {
            window.clearTimeout(this.interactionTimerId);
            this.interactionTimerId = undefined;
        }
    }

    storeState(): object | undefined {
        if (!this.config) {
            return undefined;
        }

        this.lastAccessTimestamp = Date.now();

        if (this.config.mode === 'plugin') {
            const state: SerializedPluginExecutorState = {
                mode: 'plugin',
                pluginName: this.config.pluginName,
                lastAccessTimestamp: this.lastAccessTimestamp
            };
            return state;
        }

        if (this.config.mode === 'geocache' && this.config.geocacheContext) {
            const state: SerializedPluginExecutorState = {
                mode: 'geocache',
                gcCode: this.config.geocacheContext.gcCode,
                pluginName: this.config.pluginName,
                autoExecute: this.config.autoExecute === true,
                lastAccessTimestamp: this.lastAccessTimestamp
            };
            return state;
        }

        return undefined;
    }

    restoreState(oldState: object): void {
        const state = oldState as Partial<SerializedPluginExecutorState> | undefined;
        if (!state || typeof state !== 'object' || !state.mode) {
            return;
        }

        if (state.lastAccessTimestamp && typeof state.lastAccessTimestamp === 'number') {
            this.lastAccessTimestamp = state.lastAccessTimestamp;
        }

        if (state.mode === 'plugin' && typeof state.pluginName === 'string') {
            this.initializePluginMode(state.pluginName);
            return;
        }

        if (state.mode === 'geocache' && typeof state.gcCode === 'string') {
            const context: GeocacheContext = {
                gcCode: state.gcCode,
                name: state.gcCode
            };

            const pluginName = typeof state.pluginName === 'string' ? state.pluginName : undefined;
            this.initializeGeocacheMode(context, pluginName, false);
        }
    }

    /**
     * Initialise le widget en MODE PLUGIN
     * Utilisé quand l'utilisateur clique sur un plugin dans le panel
     */
    public initializePluginMode(pluginName: string): void {
        this.lastAccessTimestamp = Date.now();
        this.config = {
            mode: 'plugin',
            pluginName,
            allowModeSelection: true  // Permet encode/decode
        };
        this.title.label = `Plugin: ${pluginName}`;
        this.title.iconClass = 'fa fa-puzzle-piece';
        console.log(`[Plugin Executor] Initialized in PLUGIN mode:`, pluginName);
        this.setupMinOpenTimeTimer();
        this.update();
    }

    /**
     * Initialise le widget en MODE GEOCACHE
     * Utilisé quand l'utilisateur clique "Analyser" depuis une géocache
     */
    public initializeGeocacheMode(context: GeocacheContext, pluginName?: string, autoExecute?: boolean): void {
        this.lastAccessTimestamp = Date.now();
        this.config = {
            mode: 'geocache',
            geocacheContext: context,
            pluginName,
            allowPluginChaining: true,  // Permet d'enchaîner les plugins
            autoExecute: autoExecute === true
        };
        this.title.label = `Analyse: ${context.gcCode}`;
        this.title.iconClass = 'fa fa-search';
        console.log(`[PluginExecutor] Initialized in GEOCACHE mode: ${context.gcCode}`);
        this.setupMinOpenTimeTimer();
        this.update();
    }

    protected render(): React.ReactNode {
        if (!this.config) {
            return (
                <div className='plugin-executor-container' style={{ padding: '20px', textAlign: 'center' }}>
                    <div>⏳ Initialisation...</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '10px' }}>
                        En attente de configuration
                    </div>
                </div>
            );
        }

        return <PluginExecutorComponent
            config={this.config}
            pluginsService={this.pluginsService}
            tasksService={this.tasksService}
            messageService={this.messageService}
            backendBaseUrl={this.getBackendBaseUrl()}
        />;
    }
}
/**
 * Composant React pour l'interface d'exécution
 */
const PluginExecutorComponent: React.FC<{
    config: PluginExecutorConfig;
    pluginsService: PluginsService;
    tasksService: TasksService;
    messageService: MessageService;
    backendBaseUrl: string;
}> = ({ config, pluginsService, tasksService, messageService, backendBaseUrl }) => {
    // Initialisation de l'état basée sur le mode
    const [state, setState] = React.useState<ExecutorState>(() => {
        // En mode plugin ou geocache, on peut avoir un plugin pré-sélectionné
        const initialPlugin = config.pluginName || null;
        const canSelectPlugin = config.mode === 'geocache';
        const canChangeMode = config.mode === 'plugin' && config.allowModeSelection !== false;
        
        console.log(`[Plugin Executor Component] Initializing in ${config.mode} mode. Initial plugin: ${initialPlugin}`);
        
        return {
            plugins: [],
            selectedPlugin: initialPlugin,
            pluginDetails: null,
            formInputs: {},
            isExecuting: false,
            result: null,
            error: null,
            executionMode: 'sync',
            task: null,
            mode: config.mode,
            canSelectPlugin,
            canChangeMode,
            resultsHistory: []
        };
    });
    
    // État pour savoir si on charge le plugin initial (mode PLUGIN uniquement)
    const [isLoadingInitial, setIsLoadingInitial] = React.useState<boolean>(
        config.mode === 'plugin' && !!config.pluginName
    );

    // Récupérer le contexte géocache (si disponible)
    const context = config.geocacheContext || {
        gcCode: '',
        name: 'Aucune géocache'
    };
    
    // Réinitialiser l'état quand la config change (changement de plugin ou de mode)
    React.useEffect(() => {
        console.log('[Plugin Executor] Config changed, reinitializing state');
        const initialPlugin = config.pluginName || null;
        const canSelectPlugin = config.mode === 'geocache';
        const canChangeMode = config.mode === 'plugin' && config.allowModeSelection !== false;
        
        setState(prev => ({
            plugins: prev.plugins, // Garder la liste des plugins déjà chargée
            selectedPlugin: initialPlugin,
            pluginDetails: null,
            formInputs: {},
            isExecuting: false,
            result: null,
            error: null,
            executionMode: 'sync',
            task: null,
            mode: config.mode,
            canSelectPlugin,
            canChangeMode,
            resultsHistory: []
        }));
        
        setIsLoadingInitial(config.mode === 'plugin' && !!config.pluginName);
    }, [config.mode, config.pluginName, config.geocacheContext?.gcCode]);

    const loadPlugins = async () => {
        try {
            const plugins = await pluginsService.listPlugins({ enabled: true });
            setState(prev => ({ ...prev, plugins }));
        } catch (error) {
            messageService.error(`Erreur lors du chargement des plugins: ${error}`);
        }
    };

    // Chargement initial des plugins
    React.useEffect(() => {
        console.log('[Plugin Executor] Chargement de la liste des plugins');
        loadPlugins();
    }, []);

    // Charger le plugin initial (mode PLUGIN ou GEOCACHE si pluginName fourni)
    React.useEffect(() => {
        if (config.pluginName) {
            setIsLoadingInitial(true);
            console.log('[Plugin Executor] Chargement du plugin initial:', config.pluginName);
            loadPluginDetails(config.pluginName).finally(() => {
                setIsLoadingInitial(false);
            });
        }
    }, [config.mode, config.pluginName]);

    // Charger les détails du plugin sélectionné (mode GEOCACHE uniquement)
    React.useEffect(() => {
        if (config.mode === 'geocache' && state.selectedPlugin) {
            console.log('[Plugin Executor] Sélection du plugin (mode geocache):', state.selectedPlugin);
            loadPluginDetails(state.selectedPlugin);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.selectedPlugin, config.mode]);

    // Debug: Logger quand le résultat change
    React.useEffect(() => {
        if (state.result) {
            console.log('=== STATE.RESULT UPDATED ===');
            console.log('Result object:', state.result);
            console.log('Has results array:', !!state.result.results);
            console.log('Results length:', state.result.results?.length);
            console.log('First result:', state.result.results?.[0]);
        }
    }, [state.result]);

    // Exécuter automatiquement si configuré
    React.useEffect(() => {
        if (config.autoExecute && state.pluginDetails && state.selectedPlugin && !state.isExecuting && !state.result) {
            console.log('[Plugin Executor] Exécution automatique déclenchée');
            // Petit délai pour laisser le rendu se faire
            setTimeout(() => {
                handleExecute();
            }, 500);
        }
    }, [config.autoExecute, state.pluginDetails, state.selectedPlugin]);

    const loadPluginDetails = async (pluginName: string): Promise<void> => {
        try {
            console.log('[Plugin Executor] Chargement du plugin:', pluginName);
            const details = await pluginsService.getPlugin(pluginName);
            console.log('[Plugin Executor] Détails reçus:', details);
            console.log('[Plugin Executor] input_schema:', details.input_schema);
            console.log('[Plugin Executor] metadata:', details.metadata);
            
            const initialInputs = generateInitialInputs(details);
            console.log('[Plugin Executor] Inputs initiaux générés:', initialInputs);

            // Correction de robustesse : pour analysis_web_page, si le champ 'text' est vide
            // alors que le contexte contient une description, on force l'utilisation de cette description.
            const patchedInputs = { ...initialInputs };
            if (
                details.name === 'analysis_web_page' &&
                (!patchedInputs.text || String(patchedInputs.text).trim() === '') &&
                context.description
            ) {
                console.log("[Plugin Executor] Forcing geocache description into 'text' for analysis_web_page");
                patchedInputs.text = context.description;
            }
            
            setState(prev => {
                // Si patchedInputs.text est défini (via description ou autre), on l'utilise en priorité.
                // Sinon, on garde la valeur précédente si elle existe.
                const newText = patchedInputs.text || prev.formInputs.text || '';
                
                return {
                    ...prev,
                    pluginDetails: details,
                    // Fusionner les inputs
                    formInputs: { ...patchedInputs, text: newText },
                    result: null,
                    error: null
                };
            });
            console.log('[Plugin Executor] État mis à jour avec pluginDetails');
        } catch (error) {
            console.error('[Plugin Executor] Erreur lors du chargement:', error);
            messageService.error(`Erreur lors du chargement du plugin: ${error}`);
            throw error;
        }
    };

    const stripHtml = (html: string): string => {
        if (typeof document !== 'undefined') {
            const temp = document.createElement('div');
            temp.innerHTML = html;
            return (temp.textContent || temp.innerText || '').trim();
        }
        return html.replace(/<[^>]+>/g, ' ').trim();
    };

    /**
     * Génère les valeurs initiales du formulaire basées sur le schéma et le contexte
     */
    const generateInitialInputs = (details: PluginDetails): Record<string, any> => {
        const inputs: Record<string, any> = {};
        
        console.log('!!! [Plugin Executor] GENERATING INPUTS V2 !!! for', details.name);
        console.log('[Plugin Executor] Context available:', context);
        console.log('[Plugin Executor] Context description present?', !!context.description);
        console.log('[Plugin Executor] Context description length:', context.description?.length);
        
        if (!details.input_schema?.properties) {
            return inputs;
        }

        // Pré-remplir avec les données de la géocache si pertinent
        for (const [key, schema] of Object.entries(details.input_schema.properties)) {
            // ATTENTION: Le schéma reçu du backend peut avoir les propriétés 'default_value_source' 
            // directement dans `details.metadata.input_types[key]` plutôt que dans `schema`.
            // Le `input_schema` est généré automatiquement par le backend et peut perdre ces métadonnées custom.
            
            const prop = schema as any;
            const metadataInputType = details.metadata?.input_types?.[key];
            const defaultValueSource = prop.default_value_source || metadataInputType?.default_value_source;

            console.log(`[Plugin Executor] Processing field '${key}'`, { propSchema: prop, metadataInputType, defaultValueSource });
            
            // 1. Priorité aux sources explicites définies dans le plugin.json
            if (defaultValueSource) {
                console.log(`[Plugin Executor] Champ '${key}' utilise source: ${defaultValueSource}`);
                if (defaultValueSource === 'geocache_id' && context.gcCode) {
                    inputs[key] = context.gcCode;
                } else if (defaultValueSource === 'geocache_description' && context.description) {
                    console.log(`[Plugin Executor] Injecting description into '${key}'`);
                    inputs[key] = context.description;
                } else {
                     console.log(`[Plugin Executor] Source '${defaultValueSource}' not found in context or empty`);
                }
            }
            // 2. Fallback sur les comportements legacy hardcodés
            // Pour le champ 'text', on préfère la description (sans HTML pour les plugins standards) si elle existe, sinon les coordonnées
            else if (key === 'text') {
                if (context.description) {
                    console.log(`[Plugin Executor] Fallback for 'text': using STRIPPED geocache description`);
                    inputs[key] = stripHtml(context.description);
                } else if (context.coordinates?.coordinatesRaw) {
                    console.log(`[Plugin Executor] Fallback for 'text': using coordinates`);
                    inputs[key] = context.coordinates.coordinatesRaw;
                }
            }
            // Pour les plugins qui attendent explicitement une coordonnée d'origine (ex: coordinate_projection)
            else if (key === 'origin_coords') {
                if (context.coordinates?.coordinatesRaw) {
                    console.log(`[Plugin Executor] Fallback for 'origin_coords': using geocache coordinatesRaw`);
                    inputs[key] = context.coordinates.coordinatesRaw;
                }
            }
            else if (key === 'hint' && context.hint) {
                inputs[key] = context.hint;
            }
            // 3. Valeurs par défaut du schéma
            else if (prop.default !== undefined) {
                inputs[key] = prop.default;
            }
            // 4. Valeurs vides par défaut selon le type
            else if (prop.type === 'string') {
                inputs[key] = '';
            } else if (prop.type === 'number' || prop.type === 'integer') {
                inputs[key] = 0;
            } else if (prop.type === 'boolean') {
                inputs[key] = false;
            }
        }

        return inputs;
    };

    const handleInputChange = (key: string, value: any) => {
        setState(prev => ({
            ...prev,
            formInputs: { ...prev.formInputs, [key]: value }
        }));
    };
    
    /**
     * Détecte les coordonnées GPS dans les résultats d'un plugin
     */
    const detectCoordinatesInResults = async (result: PluginResult) => {
        if (!result.results || result.results.length === 0) {
            return;
        }
        
        console.log('[Coordinates Detection] Analyse de', result.results.length, 'résultat(s)');
        
        // Récupérer les coordonnées d'origine si en mode GEOCACHE
        const originCoords = config.mode === 'geocache' && config.geocacheContext?.coordinates 
            ? {
                ddm_lat: `N ${config.geocacheContext.coordinates.latitude}`,
                ddm_lon: `E ${config.geocacheContext.coordinates.longitude}`
              }
            : undefined;
        
        // Parcourir chaque résultat et détecter les coordonnées
        for (const item of result.results) {
            if (item.text_output) {
                try {
                    console.log('[Coordinates Detection] Analyse du texte:', item.text_output.substring(0, 50), '...');

                    const writtenMode = state.formInputs.detect_written_coordinates === true;
                    const writtenLangMode = String(state.formInputs.written_coordinates_language || 'auto');
                    const writtenLanguages =
                        writtenLangMode === 'fr,en' ? ['fr', 'en'] :
                        writtenLangMode === 'fr' ? ['fr'] :
                        writtenLangMode === 'en' ? ['en'] :
                        ['auto'];

                    const coords = await pluginsService.detectCoordinates(item.text_output, {
                        includeNumericOnly: false,
                        includeWritten: writtenMode,
                        writtenLanguages,
                        writtenMaxCandidates: 20,
                        writtenIncludeDeconcat: true,
                        originCoords
                    });
                    
                    if (coords.exist) {
                        console.log('[Coordinates Detection] Coordonnées détectées!', coords);
                        item.coordinates = {
                            latitude: coords.ddm_lat || '',
                            longitude: coords.ddm_lon || '',
                            formatted: coords.ddm || ''
                        };

                        const pluginLabel = result.plugin_info?.name || state.selectedPlugin || 'Coordonnée détectée';
                        const decimalCoordinates = extractDecimalCoordinates({
                            latitude: (coords as any).decimal_latitude ?? item.coordinates.latitude,
                            longitude: (coords as any).decimal_longitude ?? item.coordinates.longitude,
                            decimalLatitude: (coords as any).decimal_latitude,
                            decimalLongitude: (coords as any).decimal_longitude
                        }, coords.ddm);
                        if (decimalCoordinates) {
                            console.log('[Coordinates Detection] Dispatch map highlight', {
                                gcCode: context.gcCode,
                                pluginName: pluginLabel,
                                latitude: decimalCoordinates.latitude,
                                longitude: decimalCoordinates.longitude,
                                formatted: coords.ddm || item.coordinates.formatted
                            });
                            window.dispatchEvent(new CustomEvent('geoapp-map-highlight-coordinate', {
                                detail: {
                                    gcCode: context.gcCode,
                                    pluginName: pluginLabel,
                                    coordinates: {
                                        latitude: decimalCoordinates.latitude,
                                        longitude: decimalCoordinates.longitude,
                                        formatted: coords.ddm || item.coordinates.formatted
                                    },
                                    autoSaved: false,
                                    replaceExisting: false,
                                    // Utiliser le nom de la cache si disponible pour l'affichage dans la popup
                                    waypointTitle: context.name,
                                    waypointNote: item.text_output,
                                    sourceResultText: item.text_output
                                }
                            }));
                        } else {
                            console.warn('[Coordinates Detection] Impossible de convertir les coordonnées détectées en décimal', {
                                coords,
                                itemCoordinates: item.coordinates
                            });
                        }
                    }
                } catch (error) {
                    console.error('[Coordinates Detection] Erreur:', error);
                }
            }
        }
    };

    const normalizeInputsForPlugin = (inputs: Record<string, any>, details: PluginDetails): { normalizedInputs: Record<string, any>; warnings: string[] } => {
        const textHandling = (details.metadata as any)?.text_handling;
        if (!textHandling) {
            return { normalizedInputs: inputs, warnings: [] };
        }

        const modeValue = typeof inputs.mode === 'string' ? inputs.mode.toLowerCase() : undefined;
        const shouldNormalizeTextField = modeValue === undefined || modeValue === 'encode';

        const fields: string[] = Array.isArray(textHandling.fields) && textHandling.fields.length
            ? textHandling.fields
            : ['text'];

        const fieldsToNormalize = shouldNormalizeTextField ? [...fields] : fields.filter(f => f !== 'text');
        if (
            typeof inputs.key === 'string' &&
            !fieldsToNormalize.includes('key') &&
            (((details.metadata as any)?.input_types?.key?.type === 'string') || (details.input_schema as any)?.properties?.key?.type === 'string')
        ) {
            fieldsToNormalize.push('key');
        }
        if (fieldsToNormalize.length === 0) {
            return { normalizedInputs: inputs, warnings: [] };
        }

        const allowedCharacters = typeof textHandling.allowed_characters === 'string' ? textHandling.allowed_characters : '';
        const allowedCharactersSet = new Set<string>([...allowedCharacters]);

        const allowedRanges: Array<{ start: number; end: number }> = [];
        if (Array.isArray(textHandling.allowed_ranges)) {
            for (const range of textHandling.allowed_ranges) {
                if (typeof range !== 'string') {
                    continue;
                }
                const parts = range.split('-');
                if (parts.length !== 2) {
                    continue;
                }
                const start = parseInt(parts[0], 16);
                const end = parseInt(parts[1], 16);
                if (Number.isFinite(start) && Number.isFinite(end)) {
                    allowedRanges.push({ start, end });
                }
            }
        }

        const unknownPolicy = typeof textHandling.unknown_char_policy === 'string' ? textHandling.unknown_char_policy : 'warn_keep';
        const normalizeConfig = (textHandling.normalize && typeof textHandling.normalize === 'object') ? textHandling.normalize : {};
        const removeDiacritics = !!normalizeConfig.remove_diacritics;
        const caseMode = typeof normalizeConfig.case === 'string' ? normalizeConfig.case : 'preserve';
        const mapCharacters = (normalizeConfig.map_characters && typeof normalizeConfig.map_characters === 'object') ? normalizeConfig.map_characters : {};

        const isCharAllowed = (ch: string): boolean => {
            if (allowedCharactersSet.has(ch)) {
                return true;
            }
            if (allowedRanges.length === 0) {
                return true;
            }
            const code = ch.codePointAt(0);
            if (code === undefined) {
                return false;
            }
            return allowedRanges.some(r => code >= r.start && code <= r.end);
        };

        const normalizeText = (value: string): { text: string; warnings: string[] } => {
            const localWarnings: string[] = [];

            let mapped = '';
            for (const ch of value) {
                const replacement = (mapCharacters as any)[ch];
                mapped += typeof replacement === 'string' ? replacement : ch;
            }

            let normalized = mapped;
            if (removeDiacritics) {
                const before = normalized;
                normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                if (before !== normalized) {
                    localWarnings.push('Certains caractères accentués ont été normalisés (ex: é → e).');
                }
            }

            if (caseMode === 'upper') {
                normalized = normalized.toUpperCase();
            } else if (caseMode === 'lower') {
                normalized = normalized.toLowerCase();
            }

            const unsupported = new Set<string>();
            let output = '';
            for (const ch of normalized) {
                if (isCharAllowed(ch)) {
                    output += ch;
                    continue;
                }

                unsupported.add(ch);
                if (unknownPolicy === 'strip') {
                    continue;
                }
                output += ch;
            }

            const unsupportedList = [...unsupported].sort();
            if (unsupportedList.length > 0) {
                if (unknownPolicy === 'error') {
                    throw new Error(`Caractères non supportés par le plugin: ${unsupportedList.join('')}`);
                }
                if (unknownPolicy === 'warn_keep' || unknownPolicy === 'strip') {
                    localWarnings.push(`Caractères non supportés par le plugin: ${unsupportedList.join('')}`);
                }
            }

            return { text: output, warnings: localWarnings };
        };

        const warnings: string[] = [];
        const out: Record<string, any> = { ...inputs };

        for (const field of fieldsToNormalize) {
            const value = out[field];
            if (typeof value !== 'string') {
                continue;
            }
            const result = normalizeText(value);
            out[field] = result.text;
            warnings.push(...result.warnings.map(w => `[${field}] ${w}`));
        }

        return { normalizedInputs: out, warnings };
    };

    const handleExecute = async () => {
        if (!state.selectedPlugin || !state.pluginDetails) {
            messageService.warn('Veuillez sélectionner un plugin');
            return;
        }

        // Préparer les inputs pour l'envoi
        let inputsToSend = { ...state.formInputs };

        // En mode geocache, injecter les coordonnées de la cache si le plugin attend origin_coords
        if (
            config.mode === 'geocache' &&
            config.geocacheContext?.coordinates?.coordinatesRaw &&
            (inputsToSend.origin_coords === undefined || String(inputsToSend.origin_coords || '').trim() === '')
        ) {
            inputsToSend = {
                ...inputsToSend,
                origin_coords: config.geocacheContext.coordinates.coordinatesRaw
            };
        }
        
        // Si on est en mode geocache, ajouter les waypoints au contexte envoyé
        if (config.mode === 'geocache' && config.geocacheContext?.waypoints) {
            console.log('[Plugin Executor] Ajout des waypoints aux inputs:', config.geocacheContext.waypoints.length);
            inputsToSend = {
                ...inputsToSend,
                waypoints: config.geocacheContext.waypoints
            };
        }

        // Si le plugin est orienté image et que le contexte géocache contient des images,
        // les ajouter explicitement aux inputs sans affecter les autres plugins.
        const kinds = state.pluginDetails.metadata?.kinds as string[] | undefined;
        if (
            config.mode === 'geocache' &&
            Array.isArray(kinds) &&
            kinds.includes('image') &&
            config.geocacheContext?.images &&
            config.geocacheContext.images.length > 0
        ) {
            inputsToSend = {
                ...inputsToSend,
                images: config.geocacheContext.images.map(image => ({ url: image.url }))
            };
        }

        try {
            const normalization = normalizeInputsForPlugin(inputsToSend, state.pluginDetails);
            inputsToSend = normalization.normalizedInputs;
            for (const warning of normalization.warnings) {
                messageService.warn(warning);
            }
        } catch (error: any) {
            const errorMsg = error?.message || String(error);
            messageService.error(errorMsg);
            return;
        }

        console.log('=== DEBUG Plugin Executor ===');
        console.log('Plugin sélectionné:', state.selectedPlugin);
        console.log('Plugin details name:', state.pluginDetails.name);
        console.log('Inputs du formulaire:', state.formInputs);
        console.log('Inputs envoyés au backend:', inputsToSend);
        console.log('Schéma du plugin:', state.pluginDetails.input_schema);
        
        // Vérification de cohérence
        if (state.selectedPlugin !== state.pluginDetails.name) {
            console.error('INCOHÉRENCE: selectedPlugin !== pluginDetails.name');
            messageService.error('Erreur: incohérence du plugin sélectionné. Veuillez réessayer.');
            return;
        }

        setState(prev => ({ ...prev, isExecuting: true, error: null, result: null }));

        try {
            if (state.executionMode === 'sync') {
                console.log('Exécution synchrone avec inputs:', inputsToSend);
                const result = await pluginsService.executePlugin(state.selectedPlugin, inputsToSend);
                console.log('Résultat reçu:', result);
                
                // Détecter les coordonnées si l'option est activée
                if (state.formInputs.detect_coordinates && result.results) {
                    console.log('[Coordinates Detection] Détection activée, analyse des résultats...');
                    await detectCoordinatesInResults(result);
                }
                
                setState(prev => ({ ...prev, result, isExecuting: false }));
                messageService.info('Plugin exécuté avec succès');
            } else {
                console.log('Création de tâche asynchrone avec inputs:', state.formInputs);
                const task = await tasksService.createTask(state.selectedPlugin, inputsToSend);
                console.log('Tâche créée:', task);
                setState(prev => ({ ...prev, task, isExecuting: false }));
                messageService.info(`Tâche créée: ${task.task_id}`);
                // TODO: Ouvrir le Tasks Monitor ou afficher le suivi ici
            }
        } catch (error: any) {
            console.error('Erreur lors de l\'exécution:', error);
            const errorMsg = error.message || String(error);
            setState(prev => ({ ...prev, error: errorMsg, isExecuting: false }));
            messageService.error(`Erreur lors de l'exécution: ${errorMsg}`);
        }
    };

    /**
     * Enchaîne avec un autre plugin (mode GEOCACHE uniquement)
     * Utilise le résultat précédent comme texte d'entrée
     */
    const handleChainPlugin = () => {
        if (!state.result) return;
        
        // Extraire le texte du résultat
        let resultText = '';
        if (state.result.results && state.result.results.length > 0) {
            // Prendre le premier résultat
            resultText = state.result.results[0].text_output || '';
        } else if (state.result.text_output) {
            // Format ancien
            resultText = state.result.text_output;
        }
        
        if (!resultText) {
            messageService.warn('Aucun texte trouvé dans le résultat pour enchaîner');
            return;
        }
        
        console.log('[Plugin Executor] Enchaînement avec texte:', resultText);
        
        // Archiver le résultat actuel dans l'historique
        setState(prev => ({
            ...prev,
            resultsHistory: [...prev.resultsHistory, prev.result!],
            selectedPlugin: null,
            pluginDetails: null,
            formInputs: {
                text: resultText,
                ...(config.mode === 'geocache' && config.geocacheContext?.coordinates?.coordinatesRaw
                    ? { origin_coords: config.geocacheContext.coordinates.coordinatesRaw }
                    : {})
            },
            result: null,
            error: null
        }));
        
        messageService.info('Résultat utilisé comme entrée. Sélectionnez un nouveau plugin.');
    };

    const handleRequestAddWaypoint = React.useCallback((detail: AddWaypointEventDetail) => {
        if (config.mode !== 'geocache' || !config.geocacheContext) {
            return;
        }

        const event = new CustomEvent<AddWaypointEventDetail>('geoapp-plugin-add-waypoint', {
            detail
        });
        window.dispatchEvent(event);
        messageService.info('Coordonnées envoyées au widget Waypoints');
    }, [config.mode, config.geocacheContext, messageService]);

    interface CheckerRunResult {
        status?: 'success' | 'failure' | 'unknown';
        message?: string;
        evidence?: string | null;
        extracted?: Record<string, any>;
    }

    const getCandidateTextFromCoords = React.useCallback((coords?: { formatted?: string; latitude?: string; longitude?: string }): string => {
        if (!coords) {
            return '';
        }
        if (coords.formatted && String(coords.formatted).trim()) {
            return String(coords.formatted).trim();
        }
        const lat = (coords.latitude || '').toString().trim();
        const lon = (coords.longitude || '').toString().trim();
        return `${lat} ${lon}`.trim();
    }, []);

    const pickCheckerUrl = React.useCallback((checkers?: Array<{ name?: string; url?: string }>): string | null => {
        if (!checkers || checkers.length === 0) {
            return null;
        }
        const withUrl = checkers.filter(c => typeof c.url === 'string' && c.url.trim());
        if (withUrl.length === 0) {
            return null;
        }
        const pick = (...predicates: Array<(c: { name?: string; url?: string }) => boolean>) => {
            for (const pred of predicates) {
                const found = withUrl.find(pred);
                if (found && found.url) {
                    return found.url.trim();
                }
            }
            return withUrl[0].url!.trim();
        };

        return pick(
            c => (c.url || '').toLowerCase().includes('geocaching.com'),
            c => (c.name || '').toLowerCase().includes('geocaching'),
            c => (c.url || '').toLowerCase().includes('certitudes.org'),
            c => (c.name || '').toLowerCase().includes('certitude'),
            () => true
        );
    }, []);

    const isCertitudesUrl = React.useCallback((url: string): boolean => {
        const raw = (url || '').toLowerCase();
        return raw.includes('certitudes.org') || raw.includes('www.certitudes.org');
    }, []);

    const isGeocachingUrl = React.useCallback((url: string): boolean => {
        const raw = (url || '').toLowerCase();
        if (!raw.includes('geocaching.com')) {
            return false;
        }
        return raw.includes('/geocache/') || raw.includes('cache_details.aspx');
    }, []);

    const hasHttpScheme = React.useCallback((url: string): boolean => {
        return /^https?:\/\//i.test((url || '').trim());
    }, []);

    const normalizeKnownDomainUrl = React.useCallback((url: string): string => {
        const raw = (url || '').trim();
        if (!raw || hasHttpScheme(raw)) {
            return raw;
        }

        const lower = raw.toLowerCase();
        if (lower.includes('certitudes.org') || lower.includes('geocaching.com')) {
            return `https://${raw.replace(/^https?:\/\//i, '')}`;
        }

        return raw;
    }, [hasHttpScheme]);

    const normalizeGeocachingUrl = React.useCallback((url: string, wp?: string): { url: string } | { error: string } => {
        const raw = (url || '').trim();
        if (!raw) {
            return { error: 'Missing checker url' };
        }

        if (raw.startsWith('#') || raw === 'solution-checker' || raw === '#solution-checker') {
            if (!wp) {
                return { error: 'Invalid checker url (#solution-checker). Provide a GC code to build a valid Geocaching URL.' };
            }
            return { url: `https://www.geocaching.com/geocache/${encodeURIComponent(wp)}` };
        }

        if (raw.toLowerCase().includes('/geocache/#solution-checker') || raw.toLowerCase().includes('/geocache/#')) {
            if (!wp) {
                return { error: 'Geocaching checker url is missing the GC code. Provide a GC code to build a valid Geocaching URL.' };
            }
            return { url: `https://www.geocaching.com/geocache/${encodeURIComponent(wp)}` };
        }

        if (raw.startsWith('/')) {
            return { url: `https://www.geocaching.com${raw}` };
        }

        try {
            // eslint-disable-next-line no-new
            new URL(raw);
            return { url: raw };
        } catch {
            if (raw.toLowerCase().includes('geocaching.com')) {
                return { url: `https://${raw.replace(/^https?:\/\//i, '')}` };
            }
        }

        return { url: raw };
    }, []);

    const ensureCheckerSession = React.useCallback(async (params: {
        provider: string;
        wp?: string;
    }): Promise<{ provider: string; logged_in: boolean } | { error: string }> => {
        try {
            const res = await fetch(`${backendBaseUrl}/api/checkers/session/ensure`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ provider: params.provider, wp: params.wp })
            });

            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                return { error: data.error || `HTTP ${res.status}` };
            }

            return { provider: data.provider, logged_in: Boolean(data.logged_in) };
        } catch (error: any) {
            return { error: error?.message || 'Unable to ensure checker session' };
        }
    }, [backendBaseUrl]);

    const loginCheckerSession = React.useCallback(async (params: {
        provider: string;
        wp?: string;
        timeoutSec: number;
    }): Promise<{ provider: string; logged_in: boolean } | { error: string }> => {
        try {
            const res = await fetch(`${backendBaseUrl}/api/checkers/session/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ provider: params.provider, wp: params.wp, timeout_sec: params.timeoutSec })
            });

            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                return { error: data.error || `HTTP ${res.status}` };
            }

            return { provider: data.provider, logged_in: Boolean(data.logged_in) };
        } catch (error: any) {
            return { error: error?.message || 'Unable to login checker session' };
        }
    }, [backendBaseUrl]);

    const handleVerifyCoordinates = React.useCallback(async (coords?: { formatted?: string; latitude?: string; longitude?: string }): Promise<CheckerRunResult> => {
        if (config.mode !== 'geocache' || !config.geocacheContext) {
            return { status: 'unknown', message: 'Aucune géocache associée.' };
        }

        const candidate = getCandidateTextFromCoords(coords);
        if (!candidate) {
            return { status: 'unknown', message: 'Coordonnées invalides.' };
        }

        const checkerUrl = pickCheckerUrl(config.geocacheContext.checkers);
        if (!checkerUrl) {
            return { status: 'unknown', message: 'Aucun checker disponible pour cette géocache.' };
        }

        const wp = (config.geocacheContext.gcCode || '').trim();
        let url = checkerUrl;

        url = normalizeKnownDomainUrl(url);

        const rawLower = (url || '').trim().toLowerCase();
        const shouldNormalizeGeocaching =
            rawLower.startsWith('#') ||
            rawLower.includes('solution-checker') ||
            rawLower.includes('geocaching.com') ||
            rawLower.startsWith('/');

        if (shouldNormalizeGeocaching) {
            const normalized = normalizeGeocachingUrl(url, wp);
            if ('error' in normalized) {
                return { status: 'unknown', message: normalized.error };
            }
            url = normalized.url;
        }

        url = normalizeKnownDomainUrl(url);

        if (isGeocachingUrl(url)) {
            let ensureResult = await ensureCheckerSession({ provider: 'geocaching', wp });
            if ('error' in ensureResult) {
                return { status: 'unknown', message: ensureResult.error };
            }

            if (!ensureResult.logged_in) {
                messageService.info(
                    'Geocaching.com: session non connectée. Une fenêtre Chromium va s\'ouvrir pour le login. Connectez-vous puis revenez ici.'
                );
                const loginResult = await loginCheckerSession({ provider: 'geocaching', wp, timeoutSec: 180 });
                if ('error' in loginResult) {
                    return { status: 'unknown', message: loginResult.error };
                }

                ensureResult = await ensureCheckerSession({ provider: 'geocaching', wp });
                if ('error' in ensureResult) {
                    return { status: 'unknown', message: ensureResult.error };
                }

                if (!ensureResult.logged_in) {
                    return {
                        status: 'unknown',
                        message: 'Geocaching.com: session toujours non connectée après tentative de login.'
                    };
                }
            }
        }

        const interactive = isCertitudesUrl(url) || isGeocachingUrl(url);
        const endpoint = interactive ? '/api/checkers/run-interactive' : '/api/checkers/run';
        const body: any = {
            url,
            input: { candidate }
        };
        if (interactive) {
            body.timeout_sec = 300;
        }

        if (isCertitudesUrl(url)) {
            messageService.info('Certitude nécessite une validation manuelle. Une fenêtre Chromium va s\'ouvrir : cliquez sur “Certifier”, puis revenez ici.');
        }

        if (isGeocachingUrl(url)) {
            messageService.info('Geocaching.com: le “Solution Checker” peut nécessiter une session + un reCAPTCHA. Une fenêtre Chromium peut s\'ouvrir : résolvez le captcha puis cliquez sur “Check Solution”.');
        }

        const fetchTimeoutMs = (interactive ? 300 : 60) * 1000 + 10000;
        const controller = new AbortController();
        const timeoutHandle = window.setTimeout(() => controller.abort(), fetchTimeoutMs);

        try {
            const res = await fetch(`${backendBaseUrl}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body),
                signal: controller.signal
            });

            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                return { status: 'unknown', message: data.error || `HTTP ${res.status}` };
            }

            return data.result as CheckerRunResult;
        } catch (error: any) {
            return { status: 'unknown', message: error?.message || 'Erreur lors de l\'appel au checker.' };
        } finally {
            window.clearTimeout(timeoutHandle);
        }
    }, [config.mode, config.geocacheContext, getCandidateTextFromCoords, pickCheckerUrl, isGeocachingUrl, normalizeGeocachingUrl, ensureCheckerSession, loginCheckerSession, isCertitudesUrl, backendBaseUrl, messageService]);

    return (
        <div className='plugin-executor-container'>
            {/* En-tête MODE GEOCACHE */}
            {config.mode === 'geocache' && (
                <div className='plugin-executor-header'>
                    <h3>🎯 Analyse de géocache</h3>
                    <div className='geocache-context'>
                        <strong>{context.gcCode}</strong> - {context.name}
                        {context.coordinates && (
                            <div className='geocache-coords'>
                                📍 {context.coordinates.coordinatesRaw || 
                                    `${context.coordinates.latitude}, ${context.coordinates.longitude}`}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* En-tête MODE PLUGIN */}
            {config.mode === 'plugin' && (
                <div className='plugin-executor-header'>
                    <h3>🧩 Exécution de plugin</h3>
                    {context.gcCode && (
                        <div className='geocache-context' style={{ fontSize: '13px', opacity: 0.8 }}>
                            Associé à : <strong>{context.gcCode}</strong> - {context.name}
                        </div>
                    )}
                </div>
            )}

            {/* Sélecteur de plugin (MODE GEOCACHE uniquement) */}
            {config.mode === 'geocache' && (
                <div className='plugin-form'>
                    <h4>🔌 Choix du plugin</h4>
                    <select
                        value={state.selectedPlugin || ''}
                        onChange={(e) => setState(prev => ({ ...prev, selectedPlugin: e.target.value || null }))}
                        disabled={state.isExecuting}
                        className='theia-select'
                    >
                        <option value="">-- Sélectionner un plugin --</option>
                        {state.plugins.map(plugin => (
                            <option key={plugin.name} value={plugin.name}>
                                {plugin.name} - {plugin.description}
                            </option>
                        ))}
                    </select>
                </div>
            )}
            
            {/* Indicateur de chargement (MODE PLUGIN) */}
            {config.mode === 'plugin' && isLoadingInitial && (
                <div className='plugin-form' style={{ padding: '20px', textAlign: 'center' }}>
                    <div style={{ marginBottom: '10px' }}>⏳ Chargement du plugin...</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '10px' }}>
                        En attente de configuration
                    </div>
                </div>
            )}
            
            {/* Info du plugin (MODE PLUGIN) */}
            {config.mode === 'plugin' && state.pluginDetails && !isLoadingInitial && (
                <div className='plugin-form'>
                    <h4>📦 Plugin: {state.pluginDetails.name}</h4>
                    <p style={{ margin: '5px 0', fontSize: '13px', opacity: 0.8 }}>{state.pluginDetails.description}</p>
                </div>
            )}

            {/* Sélecteur de mode encode/decode (MODE PLUGIN uniquement) */}
            {config.mode === 'plugin' && state.canChangeMode && state.pluginDetails && (
                <div className='plugin-form'>
                    <h4>🎯 Mode d'exécution</h4>
                    <div className='form-field'>
                        <label>Action</label>
                        <select
                            value={state.formInputs.mode || 'decode'}
                            onChange={(e) => handleInputChange('mode', e.target.value)}
                            disabled={state.isExecuting}
                            className='theia-select'
                        >
                            <option value='decode'>🔓 Décoder (par défaut)</option>
                            <option value='encode'>🔐 Encoder</option>
                            {state.pluginDetails.metadata?.input_types?.mode?.options?.includes('detect') && (
                                <option value='detect'>🔍 Détecter</option>
                            )}
                        </select>
                    </div>
                </div>
            )}

            {/* Zone de texte - Toujours affichée si plugin chargé */}
            {state.pluginDetails && (
                <div className='plugin-form'>
                    <h4>📝 Texte à traiter</h4>
                    <div className='form-field'>
                        <label>
                            {state.formInputs.mode === 'encode' ? 'Texte à encoder' : 
                             context.gcCode ? 'Description / Énigme' : 'Texte à décoder'}
                            <span style={{ fontSize: '12px', opacity: 0.7, marginLeft: '8px' }}>
                                (Modifiez le texte avant d'exécuter le plugin)
                            </span>
                        </label>
                        <textarea
                            value={state.formInputs.text || ''}
                            onChange={(e) => handleInputChange('text', e.target.value)}
                            rows={8}
                            placeholder={state.formInputs.mode === 'encode' ? 
                                'Entrez le texte à encoder...' : 
                                'Collez ici le texte à analyser...'}
                            disabled={state.isExecuting}
                            style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px' }}
                        />
                    </div>
                </div>
            )}

            {/* Formulaire dynamique */}
            {state.pluginDetails && (
                <div className='plugin-form'>
                    <h4>⚙️ Paramètres</h4>
                    {renderDynamicForm(
                        state.pluginDetails.input_schema,
                        state.formInputs,
                        handleInputChange,
                        state.isExecuting
                    )}
                </div>
            )}
            
            {/* Options avancées : Brute-force et Scoring */}
            {state.pluginDetails && (state.pluginDetails.metadata?.brute_force || state.pluginDetails.metadata?.enable_scoring) && (
                <div className='plugin-form'>
                    <h4>🔧 Options avancées</h4>
                    
                    {/* Option Brute-force */}
                    {state.pluginDetails.metadata?.brute_force && (
                        <div className='form-field' style={{ marginBottom: '10px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                                <input
                                    type='checkbox'
                                    checked={state.formInputs.brute_force || false}
                                    onChange={(e) => handleInputChange('brute_force', e.target.checked)}
                                    disabled={state.isExecuting}
                                    style={{ marginRight: '8px' }}
                                />
                                <span>💥 Utiliser le mode force brute</span>
                            </label>
                            <div className='field-description' style={{ marginLeft: '24px', fontSize: '12px', opacity: 0.7 }}>
                                Teste toutes les possibilités et retourne tous les résultats
                            </div>
                        </div>
                    )}
                    
                    {/* Option Scoring */}
                    {state.pluginDetails.metadata?.enable_scoring && (
                        <div className='form-field'>
                            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                                <input
                                    type='checkbox'
                                    checked={state.formInputs.enable_scoring !== false}
                                    onChange={(e) => handleInputChange('enable_scoring', e.target.checked)}
                                    disabled={state.isExecuting}
                                    style={{ marginRight: '8px' }}
                                />
                                <span>🎯 Activer le scoring automatique</span>
                            </label>
                            <div className='field-description' style={{ marginLeft: '24px', fontSize: '12px', opacity: 0.7 }}>
                                Évalue et classe les résultats par pertinence
                            </div>
                        </div>
                    )}
                    
                    {/* Option Détection de coordonnées */}
                    <div className='form-field' style={{ marginTop: '10px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                            <input
                                type='checkbox'
                                checked={state.formInputs.detect_coordinates || false}
                                onChange={(e) => handleInputChange('detect_coordinates', e.target.checked)}
                                disabled={state.isExecuting}
                                style={{ marginRight: '8px' }}
                            />
                            <span>📍 Détecter les coordonnées GPS</span>
                        </label>
                        <div className='field-description' style={{ marginLeft: '24px', fontSize: '12px', opacity: 0.7 }}>
                            Recherche automatique de coordonnées dans les résultats (peut ralentir l'affichage)
                        </div>

                        {state.formInputs.detect_coordinates && (
                            <div style={{ marginLeft: '24px', marginTop: '8px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                                    <input
                                        type='checkbox'
                                        checked={state.formInputs.detect_written_coordinates || false}
                                        onChange={(e) => handleInputChange('detect_written_coordinates', e.target.checked)}
                                        disabled={state.isExecuting}
                                        style={{ marginRight: '8px' }}
                                    />
                                    <span>📝 Inclure coordonnées écrites (mots)</span>
                                </label>

                                {state.formInputs.detect_written_coordinates && (
                                    <div style={{ marginTop: '6px' }}>
                                        <label style={{ fontSize: '12px', opacity: 0.8, display: 'block', marginBottom: '4px' }}>
                                            Langue (simple)
                                        </label>
                                        <select
                                            value={String(state.formInputs.written_coordinates_language || 'auto')}
                                            onChange={(e) => handleInputChange('written_coordinates_language', e.target.value)}
                                            disabled={state.isExecuting}
                                            style={{ width: '220px' }}
                                        >
                                            <option value='auto'>Auto</option>
                                            <option value='fr'>FR</option>
                                            <option value='en'>EN</option>
                                            <option value='fr,en'>FR + EN</option>
                                        </select>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Boutons d'exécution */}
            {state.pluginDetails && (
                <div className='execution-controls'>
                    <div className='execution-mode'>
                        <label>
                            <input
                                type='radio'
                                value='sync'
                                checked={state.executionMode === 'sync'}
                                onChange={(e) => setState(prev => ({ ...prev, executionMode: 'sync' }))}
                                disabled={state.isExecuting}
                            />
                            Synchrone
                        </label>
                        <label>
                            <input
                                type='radio'
                                value='async'
                                checked={state.executionMode === 'async'}
                                onChange={(e) => setState(prev => ({ ...prev, executionMode: 'async' }))}
                                disabled={state.isExecuting}
                            />
                            Asynchrone
                        </label>
                    </div>
                    <button
                        className='theia-button main'
                        onClick={handleExecute}
                        disabled={state.isExecuting}
                    >
                        {state.isExecuting ? 'Exécution...' : 'Exécuter'}
                    </button>
                </div>
            )}

            {/* Affichage des résultats */}
            {state.result && (
                <div className='plugin-results'>
                    <h4>✅ Résultats</h4>
                    <PluginResultDisplay
                        result={state.result}
                        configMode={config.mode}
                        geocacheContext={config.geocacheContext}
                        pluginName={state.pluginDetails?.name || state.selectedPlugin}
                        pluginsService={pluginsService}
                        onRequestAddWaypoint={handleRequestAddWaypoint}
                        onVerifyCoordinates={handleVerifyCoordinates}
                        messageService={messageService}
                    />
                    
                    {/* Bouton d'enchaînement (MODE GEOCACHE uniquement) */}
                    {config.mode === 'geocache' && config.allowPluginChaining && (
                        <div style={{ marginTop: '15px', borderTop: '1px solid var(--theia-panel-border)', paddingTop: '15px' }}>
                            <button
                                className='theia-button secondary'
                                onClick={handleChainPlugin}
                                title='Utiliser ce résultat comme entrée pour un autre plugin'
                                style={{ width: '100%' }}
                            >
                                ↪ Enchaîner avec un autre plugin
                            </button>
                        </div>
                    )}
                </div>
            )}
            
            {/* Historique des enchaînements (MODE GEOCACHE) */}
            {config.mode === 'geocache' && state.resultsHistory.length > 0 && (
                <div className='plugin-history' style={{ marginTop: '10px', padding: '10px', background: 'var(--theia-editor-background)', borderRadius: '4px' }}>
                    <h5 style={{ margin: '0 0 8px 0', fontSize: '13px', opacity: 0.8 }}>📜 Historique des enchaînements</h5>
                    <div style={{ fontSize: '12px', opacity: 0.7 }}>
                        {state.resultsHistory.length} plugin(s) exécuté(s) précédemment
                    </div>
                </div>
            )}

            {/* Affichage des erreurs */}
            {state.error && (
                <div className='plugin-error'>
                    <h4>❌ Erreur</h4>
                    <pre>{state.error}</pre>
                </div>
            )}

            {/* Tâche créée */}
            {state.task && (
                <div className='plugin-task'>
                    <h4>⏱ Tâche créée</h4>
                    <div>ID: {state.task.task_id}</div>
                    <div>Statut: {state.task.status}</div>
                </div>
            )}
        </div>
    );
};

/**
 * Génère le formulaire dynamique basé sur le schéma JSON
 * Filtre les champs techniques déjà gérés ailleurs (mode, text, input_text)
 */
function renderDynamicForm(
    schema: any,
    values: Record<string, any>,
    onChange: (key: string, value: any) => void,
    disabled: boolean
): React.ReactNode {
    if (!schema?.properties) {
        return <div>Aucun paramètre requis</div>;
    }

    // Filtrer les champs techniques déjà gérés ailleurs
    const technicalFields = ['mode', 'text', 'input_text'];
    const filteredEntries = Object.entries(schema.properties).filter(
        ([key]) => !technicalFields.includes(key)
    );
    
    if (filteredEntries.length === 0) {
        return <div style={{ fontSize: '13px', opacity: 0.7 }}>Aucun paramètre supplémentaire requis</div>;
    }

    return filteredEntries.map(([key, propSchema]) => {
        const prop = propSchema as any;
        const value = values[key];
        const isRequired = schema.required?.includes(key);

        return (
            <div key={key} className='form-field'>
                <label>
                    {prop.title || key}
                    {isRequired && <span className='required'>*</span>}
                </label>
                {prop.description && <div className='field-description'>{prop.description}</div>}
                {renderInputField(key, prop, value, onChange, disabled)}
            </div>
        );
    });
}

/**
 * Génère le champ d'entrée approprié selon le type
 */
function renderInputField(
    key: string,
    schema: any,
    value: any,
    onChange: (key: string, value: any) => void,
    disabled: boolean
): React.ReactNode {
    // Enum -> Select
    if (schema.enum) {
        return (
            <select
                value={value || ''}
                onChange={(e) => onChange(key, e.target.value)}
                disabled={disabled}
            >
                {schema.enum.map((option: string) => (
                    <option key={option} value={option}>{option}</option>
                ))}
            </select>
        );
    }

    // Boolean -> Checkbox
    if (schema.type === 'boolean') {
        return (
            <input
                type='checkbox'
                checked={!!value}
                onChange={(e) => onChange(key, e.target.checked)}
                disabled={disabled}
            />
        );
    }

    // Number/Integer -> Number input
    if (schema.type === 'number' || schema.type === 'integer') {
        return (
            <input
                type='number'
                value={value || 0}
                min={schema.minimum}
                max={schema.maximum}
                step={schema.type === 'integer' ? 1 : 'any'}
                onChange={(e) => onChange(key, parseFloat(e.target.value))}
                disabled={disabled}
            />
        );
    }

    // String avec format multiline -> Textarea
    if (schema.type === 'string' && schema.format === 'multiline') {
        return (
            <textarea
                value={value || ''}
                onChange={(e) => onChange(key, e.target.value)}
                disabled={disabled}
                rows={5}
            />
        );
    }

    // String -> Text input par défaut
    return (
        <input
            type='text'
            value={value || ''}
            onChange={(e) => onChange(key, e.target.value)}
            disabled={disabled}
        />
    );
}

/**
 * Composant d'affichage des résultats
 */
const PluginResultDisplay: React.FC<{
    result: PluginResult;
    configMode: PluginExecutorMode;
    geocacheContext?: GeocacheContext;
    pluginName?: string | null;
    pluginsService: PluginsService;
    onRequestAddWaypoint?: (detail: AddWaypointEventDetail) => void;
    onVerifyCoordinates?: (coords?: { formatted?: string; latitude?: string; longitude?: string }) => Promise<{ status?: 'success' | 'failure' | 'unknown'; message?: string }>;
    messageService: MessageService;
}> = ({ result, configMode, geocacheContext, pluginName, pluginsService, onRequestAddWaypoint, onVerifyCoordinates, messageService }) => {
    console.log('=== PluginResultDisplay RENDER ===');
    console.log('Received result:', result);
    console.log('result.results:', result.results);
    console.log('result.summary:', result.summary);

    const [verifiedCoordinates, setVerifiedCoordinates] = React.useState<Record<string, { status?: string; message?: string }>>({});
    const [verifyingCoordinates, setVerifyingCoordinates] = React.useState<Record<string, boolean>>({});
    const [detectingCoordinates, setDetectingCoordinates] = React.useState<Record<string, boolean>>({});
    const [manualDetectedCoordinates, setManualDetectedCoordinates] = React.useState<Record<string, { latitude?: string; longitude?: string; formatted?: string }>>({});

    // Vérifications de sécurité
    if (!result) {
        console.error('PluginResultDisplay: result is null/undefined');
        return <div>Erreur: Aucun résultat à afficher</div>;
    }

    // Fonction pour copier du texte dans le presse-papier
    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const toPercent = (value: any): number => {
        const v = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(v)) {
            return 0;
        }
        return Math.max(0, Math.min(100, Math.round(v * 100)));
    };

    const getScoreColor = (score: any): string => {
        const v = typeof score === 'number' ? score : Number(score);
        if (!Number.isFinite(v)) {
            return 'var(--theia-editor-background)';
        }
        if (v >= 0.8) {
            return 'var(--theia-button-background)';
        }
        if (v >= 0.5) {
            return 'var(--theia-list-hoverBackground)';
        }
        return 'var(--theia-editor-background)';
    };
    
    // Trier les résultats par confiance (décroissante) si disponible
    let sortedResults: any[] = [];
    try {
        sortedResults = result.results ? [...result.results].sort((a, b) => {
            const confA = a.confidence ?? 0;
            const confB = b.confidence ?? 0;
            return confB - confA;
        }) : [];
        console.log('sortedResults:', sortedResults);
    } catch (error) {
        console.error('Erreur lors du tri des résultats:', error);
        sortedResults = result.results || [];
    }

    const isBruteForce = sortedResults.length > 5; // Considérer comme brute-force si plus de 5 résultats
    const canRequestWaypoint = configMode === 'geocache' && !!geocacheContext && !!onRequestAddWaypoint;
    const canVerifyCoordinates = configMode === 'geocache' && !!geocacheContext?.checkers?.length && !!onVerifyCoordinates;

    const getCoordsKey = (coords?: { formatted?: string; latitude?: string; longitude?: string }): string => {
        if (!coords) {
            return '';
        }
        const formatted = (coords.formatted || '').toString().trim();
        if (formatted) {
            return formatted;
        }
        const lat = (coords.latitude || '').toString().trim();
        const lon = (coords.longitude || '').toString().trim();
        return `${lat} ${lon}`.trim();
    };

    const getItemKey = (item: any, index: number): string => {
        const id = (item && (item.id || item._id)) ? String(item.id || item._id) : '';
        if (id) {
            return id;
        }
        const text = (item && item.text_output) ? String(item.text_output).slice(0, 40) : '';
        return `${pluginName || 'result'}_${index}_${text}`;
    };

    const buildOriginCoords = (): { ddm_lat: string; ddm_lon: string } | undefined => {
        if (!geocacheContext?.coordinates?.latitude || !geocacheContext?.coordinates?.longitude) {
            return undefined;
        }
        return {
            ddm_lat: `N ${geocacheContext.coordinates.latitude}`,
            ddm_lon: `E ${geocacheContext.coordinates.longitude}`
        };
    };

    const buildGcCoords = (coords?: {
        latitude?: number | string;
        longitude?: number | string;
        formatted?: string;
    }): string | null => {
        if (!coords) {
            return null;
        }
        if (coords.latitude && coords.longitude) {
            return `${coords.latitude}, ${coords.longitude}`;
        }
        if (coords.formatted) {
            // Assurer un séparateur virgule pour WaypointsEditor
            const formatted = coords.formatted.trim();
            if (formatted.includes(',')) {
                return formatted;
            }
            const compact = formatted.replace(/\s+/g, ' ').trim();
            const tokens = compact.split(' ');
            if (tokens.length >= 4) {
                const latPart = tokens.slice(0, 2).join(' ');
                const lonPart = tokens.slice(2).join(' ');
                return `${latPart}, ${lonPart}`;
            }
            return formatted;
        }
        return null;
    };

    console.log('PluginResultDisplay final render');
    console.log('result.status:', result.status);
    console.log('result.summary:', result.summary);
    console.log('sortedResults.length:', sortedResults.length);

    return (
        <div className='result-display'>
            <div className='result-status'>
                <strong>Statut:</strong> {result.status === 'ok' ? '✓ OK' : '⚠ ' + (result.status || 'Erreur')}
            </div>

            {/* Afficher le summary si disponible */}
            {result.summary && (
                <div style={{ marginBottom: '10px', opacity: 0.8 }}>
                    {typeof result.summary === 'string' ? result.summary :
                     typeof result.summary === 'object' && (result.summary as any).message ?
                         (result.summary as any).message :
                         JSON.stringify(result.summary, null, 2)}
                </div>
            )}

            {/* Debug info */}
            <div style={{ background: 'yellow', padding: '5px', margin: '10px 0', fontSize: '12px' }}>
                DEBUG: {sortedResults.length} résultat(s) à afficher
            </div>
            
            {/* Indicateur de mode brute-force */}
            {isBruteForce && (
                <div style={{ 
                    padding: '8px 12px', 
                    background: 'var(--theia-editor-background)', 
                    borderLeft: '3px solid var(--theia-focusBorder)',
                    marginBottom: '15px',
                    fontSize: '13px'
                }}>
                    💥 <strong>Mode force brute activé</strong> - {sortedResults.length} résultats trouvés (triés par pertinence)
                </div>
            )}

            {/* Afficher tous les résultats du tableau */}
            {sortedResults.length > 0 && (
                <div>
                    {sortedResults.map((item, index) => {
                        console.log(`Rendering result ${index}:`, item);
                        try {
                            const gpsCoordinates = (item.metadata as any)?.gps_coordinates;
                            const itemKey = getItemKey(item, index);
                            const manualCoords = manualDetectedCoordinates[itemKey];
                            const resolvedCoordinates =
                                manualCoords ||
                                item.coordinates ||
                                (gpsCoordinates && gpsCoordinates.exist
                                    ? {
                                        latitude: gpsCoordinates.ddm_lat || '',
                                        longitude: gpsCoordinates.ddm_lon || '',
                                        formatted: gpsCoordinates.ddm || ''
                                    }
                                    : undefined);
                            return (
                                <div 
                                    key={item.id || index} 
                                    style={{ 
                                        marginBottom: '15px',
                                        padding: '12px',
                                        background: index === 0 && isBruteForce ? 'var(--theia-list-hoverBackground)' : 'transparent',
                                        border: '1px solid var(--theia-panel-border)',
                                        borderRadius: '4px',
                                        position: 'relative'
                                    }}
                                >
                                    {/* Badge de confiance en haut à droite */}
                                    {(item.confidence !== undefined || (item.metadata as any)?.plugin_confidence !== undefined) && (
                                        <div style={{
                                            position: 'absolute',
                                            top: '8px',
                                            right: '8px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '4px',
                                            alignItems: 'flex-end'
                                        }}>
                                            {item.confidence !== undefined && (
                                                <div style={{
                                                    padding: '4px 8px',
                                                    background: getScoreColor(item.confidence),
                                                    borderRadius: '3px',
                                                    fontSize: '11px',
                                                    fontWeight: 'bold'
                                                }}>
                                                    🎯 Score {toPercent(item.confidence)}%
                                                </div>
                                            )}
                                            {(item.metadata as any)?.plugin_confidence !== undefined && (
                                                <div style={{
                                                    padding: '3px 8px',
                                                    background: 'var(--theia-editor-background)',
                                                    border: '1px solid var(--theia-panel-border)',
                                                    borderRadius: '3px',
                                                    fontSize: '10px',
                                                    opacity: 0.9
                                                }}>
                                                    🔎 Plugin {toPercent((item.metadata as any).plugin_confidence)}%
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    
                                    {/* Always show text output if exists */}
                                    {item.text_output ? (
                                        <div className='result-text'>
                                            <strong>
                                                {isBruteForce ? `#${index + 1}` : 'Résultat'}
                                                {item.parameters?.shift !== undefined && item.parameters.shift !== null && ` (décalage: ${item.parameters.shift})`}
                                                {index === 0 && isBruteForce && ' 🏆'}
                                            </strong>
                                            <div className='output-content' style={{ position: 'relative', marginTop: '8px' }}>
                                                <pre style={{
                                                    whiteSpace: 'pre-wrap',
                                                    margin: 0,
                                                    paddingRight: '40px',
                                                    fontFamily: 'monospace',
                                                    fontSize: '13px'
                                                }}>{item.text_output}</pre>
                                                <button
                                                    className='theia-button secondary'
                                                    onClick={async () => {
                                                        const text = item.text_output ? String(item.text_output) : '';
                                                        if (!text.trim()) {
                                                            return;
                                                        }

                                                        setDetectingCoordinates(prev => ({ ...prev, [itemKey]: true }));
                                                        try {
                                                            const coords = await pluginsService.detectCoordinates(text, {
                                                                includeNumericOnly: false,
                                                                includeWritten: true,
                                                                writtenLanguages: ['fr', 'en'],
                                                                writtenMaxCandidates: 50,
                                                                writtenIncludeDeconcat: true,
                                                                originCoords: buildOriginCoords(),
                                                            });

                                                            if (coords && coords.exist) {
                                                                setManualDetectedCoordinates(prev => ({
                                                                    ...prev,
                                                                    [itemKey]: {
                                                                        latitude: coords.ddm_lat || '',
                                                                        longitude: coords.ddm_lon || '',
                                                                        formatted: coords.ddm || '',
                                                                    }
                                                                }));
                                                                messageService.info('Coordonnées détectées et ajoutées au résultat.');
                                                            } else {
                                                                messageService.info('Aucune coordonnée détectée sur ce résultat.');
                                                            }
                                                        } catch (e) {
                                                            messageService.error(`Erreur détection coordonnées: ${String(e)}`);
                                                        } finally {
                                                            setDetectingCoordinates(prev => ({ ...prev, [itemKey]: false }));
                                                        }
                                                    }}
                                                    title='Détecter coordonnées (texte, toutes langues)'
                                                    disabled={!!detectingCoordinates[itemKey]}
                                                    style={{ position: 'absolute', top: '5px', right: '45px', padding: '4px 8px' }}
                                                >
                                                    {detectingCoordinates[itemKey] ? '⏳' : '📍'}
                                                </button>
                                                <button
                                                    className='theia-button secondary'
                                                    onClick={() => copyToClipboard(item.text_output!)}
                                                    title='Copier'
                                                    style={{ position: 'absolute', top: '5px', right: '5px', padding: '4px 8px' }}
                                                >
                                                    📋
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{ color: 'orange' }}>No text_output for result {index}</div>
                                    )}

                                    {resolvedCoordinates && (
                                        <div className='result-coordinates' style={{ 
                                            marginTop: '8px',
                                            padding: '10px',
                                            background: 'var(--theia-editor-background)',
                                            border: '1px solid var(--theia-focusBorder)',
                                            borderRadius: '4px'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                                <strong>📍 Coordonnées détectées :</strong>
                                                <button
                                                    className='theia-button secondary'
                                                    onClick={() => copyToClipboard(resolvedCoordinates?.formatted ||
                                                        (resolvedCoordinates?.latitude && resolvedCoordinates?.longitude
                                                         ? `${resolvedCoordinates.latitude} ${resolvedCoordinates.longitude}`
                                                         : 'Coordonnées invalides'))}
                                                    title='Copier les coordonnées'
                                                    style={{ padding: '4px 8px', fontSize: '11px' }}
                                                >
                                                    📋 Copier
                                                </button>
                                                {canVerifyCoordinates && (
                                                    <button
                                                        className='theia-button'
                                                        onClick={async () => {
                                                            const key = resolvedCoordinates ? getCoordsKey(resolvedCoordinates) : undefined;
                                                            if (!key || !onVerifyCoordinates || !resolvedCoordinates) {
                                                                return;
                                                            }
                                                            setVerifyingCoordinates(prev => ({ ...prev, [key]: true }));
                                                            try {
                                                                const result = await onVerifyCoordinates(resolvedCoordinates);
                                                                const status = result?.status || 'unknown';
                                                                setVerifiedCoordinates(prev => ({
                                                                    ...prev,
                                                                    [key]: { status, message: result?.message }
                                                                }));

                                                                if (status === 'success') {
                                                                    messageService.info('Checker: coordonnées validées.');
                                                                } else if (status === 'failure') {
                                                                    messageService.warn('Checker: coordonnées refusées.');
                                                                } else {
                                                                    messageService.warn(result?.message || 'Checker: résultat indéterminé.');
                                                                }
                                                            } catch (error: any) {
                                                                messageService.error(error?.message || 'Erreur lors de la vérification via checker.');
                                                            } finally {
                                                                setVerifyingCoordinates(prev => ({ ...prev, [key]: false }));
                                                            }
                                                        }}
                                                        title='Envoyer ces coordonnées au checker de la géocache'
                                                        style={{ padding: '4px 8px', fontSize: '11px' }}
                                                        disabled={resolvedCoordinates ? verifyingCoordinates[getCoordsKey(resolvedCoordinates)] === true : false}
                                                    >
                                                        {resolvedCoordinates && verifyingCoordinates[getCoordsKey(resolvedCoordinates)] === true
                                                            ? '⏳ Vérification...'
                                                            : '🔎 Vérifier via Checkeur'}
                                                    </button>
                                                )}
                                                {canRequestWaypoint && resolvedCoordinates && buildGcCoords(resolvedCoordinates) && (
                                                    <>
                                                        {['manual', 'auto'].map(mode => (
                                                            <button
                                                                key={mode}
                                                                className='theia-button'
                                                                onClick={() => {
                                                                    const gcCoords = buildGcCoords(resolvedCoordinates);
                                                                    if (!gcCoords) {
                                                                        return;
                                                                    }
                                                                    const decimalCoords = extractDecimalCoordinates(resolvedCoordinates, gcCoords);
                                                                    if (!decimalCoords) {
                                                                        console.warn('[Plugin Executor] Impossible de convertir les coordonnées pour la carte', {
                                                                            coordinates: resolvedCoordinates,
                                                                            fallback: gcCoords
                                                                        });
                                                                    }
                                                                    onRequestAddWaypoint?.({
                                                                        gcCoords,
                                                                        pluginName: pluginName || result.plugin_info?.name,
                                                                        geocache: geocacheContext ? {
                                                                            gcCode: geocacheContext.gcCode,
                                                                            name: geocacheContext.name
                                                                        } : undefined,
                                                                        sourceResultText: item.text_output,
                                                                        waypointTitle: `${result.plugin_info?.name || pluginName || 'Coordonnées détectées'}`,
                                                                        waypointNote: item.text_output,
                                                                        autoSave: mode === 'auto',
                                                                        decimalLatitude: decimalCoords?.latitude,
                                                                        decimalLongitude: decimalCoords?.longitude
                                                                    });
                                                                }}
                                                                title={mode === 'auto'
                                                                    ? 'Créer immédiatement un waypoint validé'
                                                                    : 'Ajouter ces coordonnées comme nouveau waypoint'}
                                                                style={{ padding: '4px 8px', fontSize: '11px' }}
                                                            >
                                                                {mode === 'auto' ? '✅ Ajouter et valider' : '➕ Ajouter comme waypoint'}
                                                            </button>
                                                        ))}
                                                    </>
                                                )}
                                            </div>
                                            <div style={{ marginTop: '8px', fontFamily: 'monospace', fontSize: '14px', fontWeight: 'bold' }}>
                                                {resolvedCoordinates.formatted ||
                                                 (resolvedCoordinates.latitude && resolvedCoordinates.longitude
                                                  ? `${resolvedCoordinates.latitude} ${resolvedCoordinates.longitude}`
                                                  : 'Coordonnées invalides')}
                                            </div>
                                            {(() => {
                                                const key = getCoordsKey(resolvedCoordinates);
                                                const record = key ? verifiedCoordinates[key] : undefined;
                                                if (!record) {
                                                    return null;
                                                }
                                                if (record.status === 'failure') {
                                                    return (
                                                        <div style={{ marginTop: '6px', fontSize: '12px', opacity: 0.85 }}>
                                                            ❌ Coordonnées refusées
                                                        </div>
                                                    );
                                                }
                                                if (record.status !== 'success') {
                                                    return null;
                                                }
                                                return (
                                                    <div style={{ marginTop: '6px', fontSize: '12px', opacity: 0.85 }}>
                                                        ✅ Coordonnées vérifiées
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}

                                    {(() => {
                                        const scoring = (item.metadata as any)?.scoring;
                                        if (!scoring || typeof scoring !== 'object') {
                                            return null;
                                        }

                                        const features = scoring.features || {};
                                        return (
                                            <div style={{ marginTop: '10px' }}>
                                                <details>
                                                    <summary style={{ cursor: 'pointer', fontSize: '12px', opacity: 0.85 }}>
                                                        🧠 Détails scoring
                                                    </summary>
                                                    <div style={{
                                                        marginTop: '8px',
                                                        padding: '10px',
                                                        background: 'var(--theia-editor-background)',
                                                        border: '1px solid var(--theia-panel-border)',
                                                        borderRadius: '4px',
                                                        fontSize: '12px'
                                                    }}>
                                                        {scoring.explanation && (
                                                            <div style={{ marginBottom: '6px', opacity: 0.9 }}>
                                                                <strong>Explication:</strong> {String(scoring.explanation)}
                                                            </div>
                                                        )}
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', opacity: 0.85 }}>
                                                            {scoring.language_detected && (
                                                                <div>
                                                                    <strong>Langue:</strong> {String(scoring.language_detected)}
                                                                    {scoring.language_confidence !== undefined && (
                                                                        <> ({toPercent(scoring.language_confidence)}%)</>
                                                                    )}
                                                                </div>
                                                            )}
                                                            {scoring.early_exit && (
                                                                <div>
                                                                    <strong>Early-exit:</strong> {String(scoring.early_exit)}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 12px' }}>
                                                            {features.gps_confidence !== undefined && (
                                                                <div><strong>GPS</strong>: {toPercent(features.gps_confidence)}%</div>
                                                            )}
                                                            {features.coord_words !== undefined && (
                                                                <div><strong>Mots coords</strong>: {toPercent(features.coord_words)}%</div>
                                                            )}
                                                            {features.lexical_coverage !== undefined && (
                                                                <div><strong>Lexical</strong>: {toPercent(features.lexical_coverage)}%</div>
                                                            )}
                                                            {features.ngram_fitness !== undefined && (
                                                                <div><strong>N-grams</strong>: {toPercent(features.ngram_fitness)}%</div>
                                                            )}
                                                            {features.quadgram_fitness !== undefined && (
                                                                <div><strong>Quadgrams</strong>: {toPercent(features.quadgram_fitness)}%</div>
                                                            )}
                                                            {features.repetition_quality !== undefined && (
                                                                <div><strong>Répétitions</strong>: {toPercent(features.repetition_quality)}%</div>
                                                            )}
                                                            {features.ic !== undefined && (
                                                                <div><strong>IC</strong>: {Number(features.ic).toFixed ? Number(features.ic).toFixed(3) : String(features.ic)}</div>
                                                            )}
                                                            {features.entropy !== undefined && (
                                                                <div><strong>Entropie</strong>: {Number(features.entropy).toFixed ? Number(features.entropy).toFixed(2) : String(features.entropy)}</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </details>
                                            </div>
                                        );
                                    })()}

                                    {item.metadata && Object.keys(item.metadata).length > 0 && (
                                        <div className='result-metadata'>
                                            <strong>Métadonnées:</strong>
                                            <ul>
                                                {Object.entries(item.metadata)
                                                    .filter(([k]) => k !== 'scoring')
                                                    .map(([k, v]) => (
                                                    <li key={k}>
                                                        <strong>{k}:</strong>{' '}
                                                        {v !== null && typeof v === 'object'
                                                            ? JSON.stringify(v)
                                                            : String(v)}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {item.parameters && Object.keys(item.parameters).length > 0 && (
                                        <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '8px' }}>
                                            <strong>Paramètres utilisés:</strong> {JSON.stringify(item.parameters, null, 2)}
                                        </div>
                                    )}
                                </div>
                            );
                        } catch (error) {
                            console.error(`Erreur lors du rendu du résultat ${index}:`, error, item);
                            return (
                                <div key={`error-${index}`} style={{
                                    marginBottom: '15px',
                                    padding: '12px',
                                    background: 'var(--theia-error-foreground)',
                                    color: 'white',
                                    borderRadius: '4px'
                                }}>
                                    Erreur lors de l'affichage du résultat #{index + 1}
                                </div>
                            );
                        }
                    })}
                </div>
            )}

            {/* Afficher les infos du plugin */}
            {result.plugin_info && (
                <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '10px', borderTop: '1px solid var(--theia-panel-border)', paddingTop: '8px' }}>
                    Plugin: {result.plugin_info.name} v{result.plugin_info.version}
                    {result.plugin_info.execution_time_ms !== undefined && ` • Temps: ${result.plugin_info.execution_time_ms}ms`}
                </div>
            )}

            {/* Compatibilité : affichage des propriétés à la racine (ancien format) */}
            {!result.results && result.text_output && (
                <div className='result-text'>
                    <strong>Résultat texte:</strong>
                    <div className='output-content'>
                        {result.text_output}
                        <button
                            className='theia-button secondary'
                            onClick={() => copyToClipboard(result.text_output!)}
                            title='Copier'
                        >
                            📋
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
