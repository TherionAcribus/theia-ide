/**
 * Contribution Theia pour l'extension Alphabets.
 * Enregistre les widgets, commandes, keybindings et menus.
 */
import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import {
    AbstractViewContribution,
    FrontendApplicationContribution,
    FrontendApplication,
    WidgetManager,
    ApplicationShell
} from '@theia/core/lib/browser';
import { AlphabetsListWidget } from './alphabets-list-widget';
import { AlphabetViewerWidget } from './alphabet-viewer-widget';
import { CommonMenus } from '@theia/core/lib/browser';
import { AlphabetsCommands } from '../common/alphabet-protocol';

/**
 * Contribution pour le widget de liste des alphabets.
 */
@injectable()
export class AlphabetsListContribution
    extends AbstractViewContribution<AlphabetsListWidget>
    implements FrontendApplicationContribution {

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;
    
    constructor() {
        super({
            widgetId: AlphabetsListWidget.ID,
            widgetName: AlphabetsListWidget.LABEL,
            defaultWidgetOptions: {
                area: 'left',
                rank: 450  // Après plugins (400), avant debug (500)
            },
            toggleCommandId: AlphabetsCommands.OPEN_LIST.id
        });
    }
    
    /**
     * Ouvre le widget de visualisation pour un alphabet.
     */
    async openAlphabetViewer(alphabetId: string): Promise<AlphabetViewerWidget> {
        console.log('AlphabetsListContribution: openAlphabetViewer called with:', alphabetId);
        const widgetId = `${AlphabetViewerWidget.ID_PREFIX}-${alphabetId}`;
        console.log('AlphabetsListContribution: widgetId:', widgetId);

        // Vérifier si le widget est déjà dans le shell
        const widgets = this.shell.widgets;
        const existingInShell = Array.from(widgets).find(w => w.id === widgetId);

        if (existingInShell) {
            console.log('AlphabetsListContribution: Widget already in shell, activating');
            this.shell.activateWidget(widgetId);
            return existingInShell as AlphabetViewerWidget;
        }

        console.log('AlphabetsListContribution: Creating new widget');
        try {
            // Créer le widget avec un ID unique
            const widget = await this.widgetManager.getOrCreateWidget<AlphabetViewerWidget>(
                AlphabetViewerWidget.ID_PREFIX,
                { alphabetId }
            );

            console.log('AlphabetsListContribution: Widget created:', widget);
            console.log('AlphabetsListContribution: Widget ID:', widget.id);

            // S'assurer que l'ID est défini correctement
            if (!widget.id || widget.id !== widgetId) {
                console.log('AlphabetsListContribution: Setting widget ID to:', widgetId);
                widget.id = widgetId;
            }

            console.log('AlphabetsListContribution: Adding widget to main area');
            await this.shell.addWidget(widget, { area: 'main' });

            console.log('AlphabetsListContribution: Activating widget');
            this.shell.activateWidget(widgetId);
            console.log('AlphabetsListContribution: Widget activated');

            return widget;
        } catch (error) {
            console.error('AlphabetsListContribution: Error creating/opening widget:', error);
            throw error;
        }
    }
    
    /**
     * Initialisation au démarrage de l'application.
     */
    async onStart(app: FrontendApplication): Promise<void> {
        // Optionnel: ouvrir automatiquement le widget au démarrage
        // await this.openView({ activate: false });
    }
    
    /**
     * Enregistrement des commandes.
     */
    registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        
        // Commande pour actualiser la liste
        registry.registerCommand(AlphabetsCommands.REFRESH, {
            execute: () => {
                const widget = this.tryGetWidget();
                if (widget) {
                    widget.refresh();
                }
            },
            isEnabled: () => this.tryGetWidget() !== undefined
        });
        
        // Commande pour redécouvrir les alphabets
        registry.registerCommand(AlphabetsCommands.DISCOVER, {
            execute: async () => {
                const widget = this.tryGetWidget();
                if (widget) {
                    await widget.discover();
                }
            },
            isEnabled: () => this.tryGetWidget() !== undefined
        });
        
        // Commande pour ouvrir un alphabet
        registry.registerCommand(AlphabetsCommands.OPEN_VIEWER, {
            execute: async (alphabetId?: string) => {
                console.log('AlphabetsCommands.OPEN_VIEWER: execute called with:', alphabetId);
                if (alphabetId) {
                    try {
                        await this.openAlphabetViewer(alphabetId);
                        console.log('AlphabetsCommands.OPEN_VIEWER: openAlphabetViewer completed');
                    } catch (error) {
                        console.error('AlphabetsCommands.OPEN_VIEWER: Error:', error);
                    }
                } else {
                    console.warn('AlphabetsCommands.OPEN_VIEWER: No alphabetId provided');
                }
            }
        });
    }
    
    /**
     * Enregistrement des menus.
     */
    registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        
        // Ajouter au menu View
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: AlphabetsCommands.OPEN_LIST.id,
            label: 'Alphabets',
            order: '5'
        });
    }
}

