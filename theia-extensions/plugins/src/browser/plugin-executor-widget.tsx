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
import { MessageService } from '@theia/core/lib/common/message-service';
import { PluginsService, Plugin, PluginDetails, PluginResult } from '../common/plugin-protocol';
import { TasksService, Task } from '../common/task-protocol';

/**
 * Mode d'exécution du Plugin Executor
 */
export type PluginExecutorMode = 'plugin' | 'geocache';

/**
 * Contexte de géocache passé au widget
 */
export interface GeocacheContext {
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
export class PluginExecutorWidget extends ReactWidget {
    static readonly ID = 'plugin-executor-widget';
    static readonly LABEL = 'Plugin Executor';

    @inject(PluginsService)
    protected readonly pluginsService!: PluginsService;

    @inject(TasksService)
    protected readonly tasksService!: TasksService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    private config: PluginExecutorConfig | null = null;

    @postConstruct()
    protected init(): void {
        this.id = PluginExecutorWidget.ID;
        this.title.label = PluginExecutorWidget.LABEL;
        this.title.caption = PluginExecutorWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-play-circle';
        this.update();
    }

    /**
     * Initialise le widget en MODE PLUGIN
     * Utilisé quand l'utilisateur clique sur un plugin dans le panel
     */
    public initializePluginMode(pluginName: string): void {
        this.config = {
            mode: 'plugin',
            pluginName,
            allowModeSelection: true  // Permet encode/decode
        };
        this.title.label = `Plugin: ${pluginName}`;
        this.title.iconClass = 'fa fa-puzzle-piece';
        console.log(`[Plugin Executor] Initialized in PLUGIN mode:`, pluginName);
        this.update();
    }

    /**
     * Initialise le widget en MODE GEOCACHE
     * Utilisé quand l'utilisateur clique "Analyser" depuis une géocache
     */
    public initializeGeocacheMode(context: GeocacheContext, pluginName?: string, autoExecute: boolean = false): void {
        console.log('[PluginExecutor] initializeGeocacheMode called with context:', context, 'pluginName:', pluginName, 'autoExecute:', autoExecute);
        console.log('[PluginExecutor] Context description length:', context.description?.length);
        this.config = {
            mode: 'geocache',
            geocacheContext: context,
            pluginName: pluginName, // Plugin pré-sélectionné optionnel
            allowPluginChaining: true,  // Permet d'enchaîner les plugins
            autoExecute: autoExecute
        };
        this.title.label = `Analyse: ${context.gcCode}`;
        this.title.iconClass = 'fa fa-search';
        console.log(`[PluginExecutor] Initialized in GEOCACHE mode: ${context.gcCode}`);
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
}> = ({ config, pluginsService, tasksService, messageService }) => {
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
            
            setState(prev => {
                // Si initialInputs.text est défini (via description ou autre), on l'utilise en priorité.
                // Sinon, on garde la valeur précédente si elle existe.
                const newText = initialInputs.text || prev.formInputs.text || '';
                
                return {
                    ...prev,
                    pluginDetails: details,
                    // Fusionner les inputs
                    formInputs: { ...initialInputs, text: newText },
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
            else if (key === 'text' && context.coordinates?.coordinatesRaw) {
                inputs[key] = context.coordinates.coordinatesRaw;
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
                    const coords = await pluginsService.detectCoordinates(item.text_output, {
                        includeNumericOnly: false,
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
                                    waypointTitle: pluginLabel,
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

    const handleExecute = async () => {
        if (!state.selectedPlugin || !state.pluginDetails) {
            messageService.warn('Veuillez sélectionner un plugin');
            return;
        }

        // Préparer les inputs pour l'envoi
        let inputsToSend = { ...state.formInputs };
        
        // Si on est en mode geocache, ajouter les waypoints au contexte envoyé
        if (config.mode === 'geocache' && config.geocacheContext?.waypoints) {
            console.log('[Plugin Executor] Ajout des waypoints aux inputs:', config.geocacheContext.waypoints.length);
            inputsToSend = {
                ...inputsToSend,
                waypoints: config.geocacheContext.waypoints
            };
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
                const task = await tasksService.createTask(state.selectedPlugin, state.formInputs);
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
            formInputs: { text: resultText },
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
                        onRequestAddWaypoint={handleRequestAddWaypoint}
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
    onRequestAddWaypoint?: (detail: AddWaypointEventDetail) => void;
}> = ({ result, configMode, geocacheContext, pluginName, onRequestAddWaypoint }) => {
    console.log('=== PluginResultDisplay RENDER ===');
    console.log('Received result:', result);
    console.log('result.results:', result.results);
    console.log('result.summary:', result.summary);

    // Fonction pour copier du texte dans le presse-papier
    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };
    
    // Trier les résultats par confiance (décroissante) si disponible
    const sortedResults = result.results ? [...result.results].sort((a, b) => {
        const confA = a.confidence ?? 0;
        const confB = b.confidence ?? 0;
        return confB - confA;
    }) : [];

    const isBruteForce = sortedResults.length > 5; // Considérer comme brute-force si plus de 5 résultats
    const canRequestWaypoint = configMode === 'geocache' && !!geocacheContext && !!onRequestAddWaypoint;

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

    return (
        <div className='result-display'>
            <div className='result-status'>
                <strong>Statut:</strong> {result.status === 'ok' ? '✓ OK' : '⚠ ' + result.status}
            </div>

            {/* Afficher le summary si disponible */}
            {result.summary && (
                <div style={{ marginBottom: '10px', opacity: 0.8 }}>
                    {result.summary}
                </div>
            )}
            
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
                    {sortedResults.map((item, index) => (
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
                            {item.confidence !== undefined && (
                                <div style={{ 
                                    position: 'absolute', 
                                    top: '8px', 
                                    right: '8px',
                                    padding: '4px 8px',
                                    background: item.confidence > 0.7 ? 'var(--theia-button-background)' : 'var(--theia-editor-background)',
                                    borderRadius: '3px',
                                    fontSize: '11px',
                                    fontWeight: 'bold'
                                }}>
                                    🎯 {Math.round(item.confidence * 100)}%
                                </div>
                            )}
                            
                            {item.text_output && (
                                <div className='result-text'>
                                    <strong>
                                        {isBruteForce ? `#${index + 1}` : 'Résultat'}
                                        {item.parameters?.shift !== undefined && ` (décalage: ${item.parameters.shift})`}
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
                                            onClick={() => copyToClipboard(item.text_output!)}
                                            title='Copier'
                                            style={{ position: 'absolute', top: '5px', right: '5px', padding: '4px 8px' }}
                                        >
                                            📋
                                        </button>
                                    </div>
                                </div>
                            )}

                            {item.coordinates && (
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
                                            onClick={() => copyToClipboard(item.coordinates?.formatted || 
                                                `${item.coordinates?.latitude} ${item.coordinates?.longitude}`)}
                                            title='Copier les coordonnées'
                                            style={{ padding: '4px 8px', fontSize: '11px' }}
                                        >
                                            📋 Copier
                                        </button>
                                        {canRequestWaypoint && buildGcCoords(item.coordinates) && (
                                            <>
                                                {['manual', 'auto'].map(mode => (
                                                    <button
                                                        key={mode}
                                                        className='theia-button'
                                                        onClick={() => {
                                                            const gcCoords = buildGcCoords(item.coordinates);
                                                            if (!gcCoords) {
                                                                return;
                                                            }
                                                            const decimalCoords = extractDecimalCoordinates(item.coordinates, gcCoords);
                                                            if (!decimalCoords) {
                                                                console.warn('[Plugin Executor] Impossible de convertir les coordonnées pour la carte', {
                                                                    coordinates: item.coordinates,
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
                                        {item.coordinates.formatted || `${item.coordinates.latitude} ${item.coordinates.longitude}`}
                                    </div>
                                    {/* TODO: Ajouter boutons d'action (Ajouter waypoint, Ouvrir sur carte, etc.) */}
                                </div>
                            )}

                            {item.metadata && Object.keys(item.metadata).length > 0 && (
                                <div className='result-metadata'>
                                    <strong>Métadonnées:</strong>
                                    <ul>
                                        {Object.entries(item.metadata).map(([k, v]) => (
                                            <li key={k}><strong>{k}:</strong> {String(v)}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {item.parameters && Object.keys(item.parameters).length > 0 && (
                                <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '8px' }}>
                                    <strong>Paramètres utilisés:</strong> {JSON.stringify(item.parameters)}
                                </div>
                            )}
                        </div>
                    ))}
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
