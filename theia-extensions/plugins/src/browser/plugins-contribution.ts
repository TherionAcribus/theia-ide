/**
 * Contribution Theia pour l'extension Plugins.
 * 
 * Ce fichier enregistre les widgets, commandes, keybindings et menus
 * dans l'interface Theia.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { AbstractViewContribution, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PluginsBrowserWidget } from './plugins-browser-widget';
import { CommonMenus } from '@theia/core/lib/browser';

/**
 * Commandes disponibles pour l'extension Plugins.
 */
export namespace PluginsCommands {
    export const OPEN_PLUGINS_BROWSER = {
        id: 'plugins.openBrowser',
        label: 'Plugins: Ouvrir le navigateur de plugins'
    };
    
    export const REFRESH_PLUGINS = {
        id: 'plugins.refresh',
        label: 'Plugins: Rafraîchir la liste'
    };
    
    export const DISCOVER_PLUGINS = {
        id: 'plugins.discover',
        label: 'Plugins: Redécouvrir les plugins'
    };
}

/**
 * Contribution pour le widget Plugins Browser.
 */
@injectable()
export class PluginsBrowserContribution extends AbstractViewContribution<PluginsBrowserWidget> {
    
    constructor() {
        super({
            widgetId: PluginsBrowserWidget.ID,
            widgetName: PluginsBrowserWidget.LABEL,
            defaultWidgetOptions: {
                area: 'left',
                rank: 400  // Après explorer, avant debug
            },
            toggleCommandId: PluginsCommands.OPEN_PLUGINS_BROWSER.id
        });
    }
    
    /**
     * Enregistre les commandes.
     */
    registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        
        // Commande pour rafraîchir
        registry.registerCommand(PluginsCommands.REFRESH_PLUGINS, {
            execute: () => {
                const widget = this.tryGetWidget();
                if (widget) {
                    widget.refresh();
                }
            },
            isEnabled: () => this.tryGetWidget() !== undefined
        });
        
        // Commande pour redécouvrir
        registry.registerCommand(PluginsCommands.DISCOVER_PLUGINS, {
            execute: () => {
                const widget = this.tryGetWidget();
                if (widget) {
                    widget.discoverPlugins();
                }
            },
            isEnabled: () => this.tryGetWidget() !== undefined
        });
    }
    
    /**
     * Enregistre les menus.
     */
    registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        
        // Ajouter au menu View
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: PluginsCommands.OPEN_PLUGINS_BROWSER.id,
            label: 'Plugins Browser',
            order: '5'
        });
    }
}

/**
 * Contribution pour initialiser l'extension au démarrage.
 */
@injectable()
export class PluginsFrontendApplicationContribution implements FrontendApplicationContribution {
    
    onStart(): void {
        // Hook pour initialisation au démarrage si nécessaire
        console.log('MysterAI Plugins Extension started');
    }
}
