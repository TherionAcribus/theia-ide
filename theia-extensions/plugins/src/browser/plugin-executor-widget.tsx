/**
 * Widget pour exécuter des plugins sur une géocache spécifique.
 * 
 * Fonctionnalités :
 * - Sélection du plugin à exécuter
 * - Génération dynamique du formulaire d'entrée basé sur le schéma du plugin
 * - Pré-remplissage avec les données de la géocache
 * - Exécution synchrone ou asynchrone
 * - Affichage des résultats
 */

import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PluginsService, Plugin, PluginDetails, PluginResult } from '../common/plugin-protocol';
import { TasksService, Task } from '../common/task-protocol';

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

    private geocacheContext: GeocacheContext | null = null;
    private selectedPluginName: string | null = null;

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
     * Définit le contexte de la géocache pour l'exécution
     */
    public setGeocacheContext(context: GeocacheContext): void {
        this.geocacheContext = context;
        this.selectedPluginName = null; // Reset le plugin sélectionné
        this.update();
    }

    /**
     * Ouvre le widget avec un plugin pré-sélectionné (sans contexte géocache)
     */
    public setSelectedPlugin(pluginName: string): void {
        this.selectedPluginName = pluginName;
        // Créer un contexte vide
        this.geocacheContext = {
            gcCode: '',
            name: 'Aucune géocache'
        };
        this.update();
    }

    protected render(): React.ReactNode {
        // Contexte par défaut si pas de géocache
        const context = this.geocacheContext || {
            gcCode: '',
            name: 'Aucune géocache'
        };

        return <PluginExecutorComponent
            context={context}
            initialPlugin={this.selectedPluginName}
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
    context: GeocacheContext;
    initialPlugin?: string | null;
    pluginsService: PluginsService;
    tasksService: TasksService;
    messageService: MessageService;
}> = ({ context, initialPlugin, pluginsService, tasksService, messageService }) => {
    const [state, setState] = React.useState<ExecutorState>({
        plugins: [],
        selectedPlugin: null,
        pluginDetails: null,
        formInputs: {},
        isExecuting: false,
        result: null,
        error: null,
        executionMode: 'sync',
        task: null
    });

    // Charger la liste des plugins au montage et initialiser le champ texte
    React.useEffect(() => {
        loadPlugins();
        
        // Pré-remplir le champ text avec la description de la géocache
        const initialText = context.description || context.hint || context.coordinates?.coordinatesRaw || '';
        if (initialText) {
            // Retirer les balises HTML si présentes
            const div = document.createElement('div');
            div.innerHTML = initialText;
            const textContent = div.textContent || div.innerText || initialText;
            
            setState(prev => ({
                ...prev,
                formInputs: { ...prev.formInputs, text: textContent }
            }));
        }
        
        // Pré-sélectionner le plugin si fourni
        if (initialPlugin) {
            setState(prev => ({
                ...prev,
                selectedPlugin: initialPlugin
            }));
        }
    }, []);

    // Charger les détails du plugin sélectionné
    React.useEffect(() => {
        if (state.selectedPlugin) {
            loadPluginDetails(state.selectedPlugin);
        }
    }, [state.selectedPlugin]);

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

    const loadPlugins = async () => {
        try {
            const plugins = await pluginsService.listPlugins({ enabled: true });
            setState(prev => ({ ...prev, plugins }));
        } catch (error) {
            messageService.error(`Erreur lors du chargement des plugins: ${error}`);
        }
    };

    const loadPluginDetails = async (pluginName: string) => {
        try {
            const details = await pluginsService.getPlugin(pluginName);
            const initialInputs = generateInitialInputs(details);
            setState(prev => ({
                ...prev,
                pluginDetails: details,
                // Fusionner les nouveaux inputs sans écraser le champ "text" déjà rempli
                formInputs: { ...initialInputs, ...prev.formInputs },
                result: null,
                error: null
            }));
        } catch (error) {
            messageService.error(`Erreur lors du chargement du plugin: ${error}`);
        }
    };

    /**
     * Génère les valeurs initiales du formulaire basées sur le schéma et le contexte
     */
    const generateInitialInputs = (details: PluginDetails): Record<string, any> => {
        const inputs: Record<string, any> = {};
        
        if (!details.input_schema?.properties) {
            return inputs;
        }

        // Pré-remplir avec les données de la géocache si pertinent
        for (const [key, schema] of Object.entries(details.input_schema.properties)) {
            const prop = schema as any;
            
            // Pré-remplir le champ "text" avec les coordonnées si disponible
            if (key === 'text' && context.coordinates?.coordinatesRaw) {
                inputs[key] = context.coordinates.coordinatesRaw;
            }
            // Pré-remplir le champ "hint" si disponible
            else if (key === 'hint' && context.hint) {
                inputs[key] = context.hint;
            }
            // Valeur par défaut du schéma
            else if (prop.default !== undefined) {
                inputs[key] = prop.default;
            }
            // Valeur vide selon le type
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

    const handleExecute = async () => {
        if (!state.selectedPlugin || !state.pluginDetails) {
            return;
        }

        console.log('=== DEBUG Plugin Executor ===');
        console.log('Plugin sélectionné:', state.selectedPlugin);
        console.log('Inputs du formulaire:', state.formInputs);
        console.log('Schéma du plugin:', state.pluginDetails.input_schema);

        setState(prev => ({ ...prev, isExecuting: true, error: null, result: null }));

        try {
            if (state.executionMode === 'sync') {
                console.log('Exécution synchrone avec inputs:', state.formInputs);
                const result = await pluginsService.executePlugin(state.selectedPlugin, state.formInputs);
                console.log('Résultat reçu:', result);
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

    return (
        <div className='plugin-executor-container'>
            {/* En-tête avec contexte géocache */}
            <div className='plugin-executor-header'>
                <h3>🎯 Exécuter un plugin</h3>
                {context.gcCode ? (
                    <div className='geocache-context'>
                        <strong>{context.gcCode}</strong> - {context.name}
                        {context.coordinates && (
                            <div className='geocache-coords'>
                                📍 {context.coordinates.coordinatesRaw || 
                                    `${context.coordinates.latitude}, ${context.coordinates.longitude}`}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className='geocache-context' style={{ opacity: 0.7, fontSize: '14px' }}>
                        <em>Pas de géocache associée - Exécution libre</em>
                    </div>
                )}
            </div>

            {/* Zone de texte pour la description/énigme */}
            <div className='plugin-form'>
                <h4>📝 Texte à analyser</h4>
                <div className='form-field'>
                    <label>
                        Description / Énigme
                        <span style={{ fontSize: '12px', opacity: 0.7, marginLeft: '8px' }}>
                            (Modifiez le texte avant d'exécuter le plugin)
                        </span>
                    </label>
                    <textarea
                        value={state.formInputs.text || ''}
                        onChange={(e) => handleInputChange('text', e.target.value)}
                        disabled={state.isExecuting}
                        rows={8}
                        placeholder="Collez ici le texte à analyser ou extraire de l'énigme..."
                        style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px' }}
                    />
                </div>
            </div>

            {/* Sélection du plugin */}
            <div className='plugin-selector'>
                <label>Plugin:</label>
                <select
                    value={state.selectedPlugin || ''}
                    onChange={(e) => setState(prev => ({ ...prev, selectedPlugin: e.target.value || null }))}
                    disabled={state.isExecuting}
                >
                    <option value="">-- Sélectionner un plugin --</option>
                    {state.plugins.map(plugin => (
                        <option key={plugin.name} value={plugin.name}>
                            {plugin.name} (v{plugin.version}){plugin.category ? ` - ${plugin.category}` : ''}
                        </option>
                    ))}
                </select>
            </div>

            {/* Formulaire dynamique */}
            {state.pluginDetails && (
                <div className='plugin-form'>
                    <h4>Paramètres</h4>
                    {renderDynamicForm(
                        state.pluginDetails.input_schema,
                        state.formInputs,
                        handleInputChange,
                        state.isExecuting
                    )}
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
                    <PluginResultDisplay result={state.result} />
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

    return Object.entries(schema.properties).map(([key, propSchema]) => {
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
const PluginResultDisplay: React.FC<{ result: PluginResult }> = ({ result }) => {
    console.log('=== PluginResultDisplay RENDER ===');
    console.log('Received result:', result);
    console.log('result.results:', result.results);
    console.log('result.summary:', result.summary);
    
    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
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

            {/* Afficher tous les résultats du tableau */}
            {result.results && result.results.length > 0 && (
                <div>
                    {result.results.map((item, index) => (
                        <div key={item.id || index} style={{ marginBottom: '15px' }}>
                            {item.text_output && (
                                <div className='result-text'>
                                    <strong>Résultat {result.results!.length > 1 ? `#${index + 1}` : ''}:</strong>
                                    <div className='output-content'>
                                        <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{item.text_output}</pre>
                                        <button
                                            className='theia-button secondary'
                                            onClick={() => copyToClipboard(item.text_output!)}
                                            title='Copier'
                                            style={{ position: 'absolute', top: '5px', right: '5px' }}
                                        >
                                            📋
                                        </button>
                                    </div>
                                </div>
                            )}

                            {item.coordinates && (
                                <div className='result-coordinates'>
                                    <strong>Coordonnées:</strong>
                                    <div>Latitude: {item.coordinates.latitude}</div>
                                    <div>Longitude: {item.coordinates.longitude}</div>
                                </div>
                            )}

                            {item.confidence !== undefined && (
                                <div style={{ fontSize: '12px', opacity: 0.7 }}>
                                    Confiance: {Math.round(item.confidence * 100)}%
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
