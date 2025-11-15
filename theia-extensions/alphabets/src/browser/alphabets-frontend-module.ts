/**
 * Module principal de l'extension Alphabets pour Theia.
 * Configure l'injection de dépendances et enregistre les contributions.
 */
import { ContainerModule, interfaces } from '@theia/core/shared/inversify';
import { AlphabetsService } from './services/alphabets-service';
import { AlphabetsListContribution } from './alphabets-contribution';
import { WidgetFactory, bindViewContribution, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { AlphabetsListWidget } from './alphabets-list-widget';
import { AlphabetViewerWidget } from './alphabet-viewer-widget';
import { CommandContribution, MenuContribution } from '@theia/core';

export default new ContainerModule(bind => {
    // Bind le service
    bind(AlphabetsService).toSelf().inSingletonScope();
    
    // Bind le widget de liste
    bind(AlphabetsListWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: AlphabetsListWidget.ID,
        createWidget: () => ctx.container.get<AlphabetsListWidget>(AlphabetsListWidget)
    })).inSingletonScope();
    
    // Bind le widget de visualisation avec une approche simple
    bind(AlphabetViewerWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: AlphabetViewerWidget.ID_PREFIX,
        createWidget: (options: { alphabetId: string }) => {
            // Créer un container enfant pour isoler les instances
            const child = ctx.container.createChild();
            child.bind('alphabetId').toConstantValue(options.alphabetId);

            // Créer le widget avec ses dépendances injectées
            const widget = child.get(AlphabetViewerWidget);

            // S'assurer que l'ID est défini
            widget.id = `${AlphabetViewerWidget.ID_PREFIX}-${options.alphabetId}`;
            return widget;
        }
    })).inSingletonScope();
    
    // Bind la contribution (commandes, menus, vue)
    bindViewContribution(bind, AlphabetsListContribution);
    bind(FrontendApplicationContribution).toService(AlphabetsListContribution);
    bind(CommandContribution).toService(AlphabetsListContribution);
    bind(MenuContribution).toService(AlphabetsListContribution);
});

