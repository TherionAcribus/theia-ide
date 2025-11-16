import { injectable, inject } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters,
    ToolRequestParametersProperties,
    ToolRequestParameterProperty,
    ToolCallResult
} from '@theia/ai-core';
import { PluginsService, Plugin, PluginDetails, PluginSchema, PluginResult } from '../common/plugin-protocol';

/**
 * Enregistre dynamiquement chaque plugin MysterAI comme Tool IA.
 */
@injectable()
export class PluginToolsManager implements FrontendApplicationContribution {

    static readonly PROVIDER_NAME = 'geoapp.plugins';

    @inject(PluginsService)
    protected readonly pluginsService!: PluginsService;

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    protected isRefreshing = false;

    async onStart(): Promise<void> {
        console.log('[PluginTools] Initialisation du gestionnaire de tools IA...');
        await this.refreshTools({ silent: true });
        console.log('[PluginTools] Gestionnaire de tools IA initialisé');
    }

    /**
     * Rafraîchit l'ensemble des tools exposés à l'IA.
     */
    async refreshTools(options?: { silent?: boolean }): Promise<void> {
        if (this.isRefreshing) {
            return;
        }
        this.isRefreshing = true;
        try {
            this.toolRegistry.unregisterAllTools(PluginToolsManager.PROVIDER_NAME);

            const plugins = await this.pluginsService.listPlugins({ enabled: true });
            const toolRequests = await Promise.all(
                plugins
                    .filter((plugin: Plugin) => plugin.enabled !== false)
                    .map((plugin: Plugin) => this.toToolRequest(plugin))
            );

            const registeredTools = [];
            for (const tool of toolRequests) {
                if (tool) {
                    this.toolRegistry.registerTool(tool);
                    registeredTools.push(tool.name);
                    console.log(`[PluginTools] Tool enregistré: ${tool.name} (${tool.id})`);
                }
            }

            const totalTools = registeredTools.length;
            console.log(`[PluginTools] ${totalTools} tools IA synchronisés:`, registeredTools);

            if (!options?.silent) {
                this.messages.info(`Tools IA synchronisés (${totalTools})`);
            }
        } catch (error) {
            console.error('[PluginTools] Impossible de synchroniser les tools IA', error);
            if (!options?.silent) {
                this.messages.error('Impossible de synchroniser les tools IA (voir console)');
            }
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * Transforme un plugin en ToolRequest utilisable par le Chat.
     */
    protected async toToolRequest(plugin: Plugin): Promise<ToolRequest | undefined> {
        try {
            const details = await this.resolvePluginDetails(plugin);
            const parameters = this.buildParameters(details.input_schema);

            return {
                id: `plugin.${details.name}`,
                name: details.name,
                description: this.buildDescription(details),
                providerName: PluginToolsManager.PROVIDER_NAME,
                parameters,
                handler: async (argString: string) => this.executePlugin(details.name, argString)
            };
        } catch (error) {
            console.error(`[PluginTools] Tool non enregistré pour ${plugin.name}`, error);
            return undefined;
        }
    }

    protected async resolvePluginDetails(plugin: Plugin): Promise<PluginDetails> {
        if (this.hasUsableSchema(plugin.input_schema)) {
            return plugin as PluginDetails;
        }
        return this.pluginsService.getPlugin(plugin.name);
    }

    protected buildDescription(plugin: Plugin): string {
        const parts = [
            plugin.description?.trim(),
            plugin.category ? `Catégorie: ${plugin.category}` : undefined,
            plugin.heavy_cpu ? '⚠️ Consommation CPU élevée' : undefined,
            plugin.needs_network ? '⚠️ Nécessite un accès réseau' : undefined
        ].filter(Boolean);
        return parts.join(' • ') || `Plugin ${plugin.name}`;
    }

    protected buildParameters(schema?: PluginSchema): ToolRequestParameters {
        if (this.hasUsableSchema(schema)) {
            return {
                type: 'object',
                properties: this.normalizeProperties(schema!.properties!),
                required: Array.isArray(schema!.required) ? schema!.required!.slice() : []
            };
        }
        return this.defaultParameters();
    }

    protected normalizeProperties(properties: Record<string, any>): ToolRequestParametersProperties {
        const normalized: ToolRequestParametersProperties = {};
        Object.entries(properties).forEach(([key, value]) => {
            normalized[key] = this.normalizeProperty(value);
        });
        return normalized;
    }

    protected normalizeProperty(value: any): ToolRequestParameterProperty {
        if (!value || typeof value !== 'object') {
            return { type: 'string' };
        }

        const clone: ToolRequestParameterProperty = { ...value };
        const allowedTypes = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

        if (clone.anyOf && Array.isArray(clone.anyOf)) {
            clone.anyOf = clone.anyOf.map(entry => this.normalizeProperty(entry));
        }

        if (clone.type) {
            clone.type = allowedTypes.has(clone.type) ? clone.type : 'string';
        } else if (!clone.anyOf) {
            clone.type = 'string';
        }

        return clone;
    }

    protected hasUsableSchema(schema?: PluginSchema): schema is PluginSchema {
        return !!(schema && schema.properties && Object.keys(schema.properties).length > 0);
    }

    protected defaultParameters(): ToolRequestParameters {
        return {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'Texte ou données à transmettre au plugin.'
                }
            }
        };
    }

    protected async executePlugin(name: string, argString: string): Promise<ToolCallResult> {
        console.log(`[PluginTools] Exécution du plugin '${name}' avec arguments:`, argString);
        try {
            const inputs = this.parseArguments(argString);
            console.log(`[PluginTools] Arguments parsés pour '${name}':`, inputs);

            const result = await this.pluginsService.executePlugin(name, inputs);
            const formatted = this.formatResult(result);

            console.log(`[PluginTools] Résultat du plugin '${name}':`, formatted);
            return formatted;
        } catch (error) {
            console.error(`[PluginTools] Erreur lors de l'exécution du plugin '${name}':`, error);
            throw error;
        }
    }

    protected parseArguments(argString: string): Record<string, unknown> {
        if (!argString || !argString.trim()) {
            return {};
        }
        try {
            return JSON.parse(argString);
        } catch (error) {
            throw new Error(`Arguments JSON invalides pour le plugin: ${error}`);
        }
    }

    protected formatResult(result: PluginResult): ToolCallResult {
        if (result.text_output) {
            return result.text_output;
        }

        return {
            status: result.status,
            summary: result.summary ?? result.error ?? 'Résultat du plugin',
            results: result.results,
            coordinates: result.coordinates,
            metadata: result.metadata ?? result.plugin_info
        };
    }

    /**
     * Vérifie le statut des tools IA enregistrés.
     */
    getToolsStatus(): { total: number; names: string[] } {
        const allTools = this.toolRegistry.getAllFunctions();
        const pluginTools = allTools.filter(tool => tool.providerName === PluginToolsManager.PROVIDER_NAME);

        return {
            total: pluginTools.length,
            names: pluginTools.map(tool => tool.name)
        };
    }

    /**
     * Affiche le statut des tools dans la console (pour debug).
     */
    logToolsStatus(): void {
        const status = this.getToolsStatus();
        console.log(`[PluginTools] Statut actuel: ${status.total} tools enregistrés`, status.names);

        if (status.total === 0) {
            console.warn('[PluginTools] Aucun tool IA enregistré - vérifiez que les plugins sont actifs');
        }
    }
}

