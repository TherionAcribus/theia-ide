import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common';
import { ZonesTreeWidget } from './zones-tree-widget';
import { ZonesFrontendContribution } from './zones-frontend-contribution';
import { ZonesCommandContribution } from './zones-command-contribution';
import { ZoneGeocachesWidget } from './zone-geocaches-widget';
import { GeocacheDetailsWidget } from './geocache-details-widget';
import { GeocacheLogsWidget } from './geocache-logs-widget';
import { GeocacheNotesWidget } from './geocache-notes-widget';
import { MapWidget } from './map/map-widget';
import { MapService } from './map/map-service';
import { MapWidgetFactory } from './map/map-widget-factory';
import { MapManagerWidget } from './map/map-manager-widget';
import { BatchMapIntegration } from './batch-map-integration';
import { GeocacheTabsManager } from './geocache-tabs-manager';
import { GeocacheImageEditorWidget } from './geocache-image-editor-widget';
import { GeocacheImageEditorTabsManager } from './geocache-image-editor-tabs-manager';
import { GeocacheImageEditorFrontendContribution } from './geocache-image-editor-frontend-contribution';
import { ZoneTabsManager } from './zone-tabs-manager';
import { CheckerToolsManager } from './checker-tools-manager';
import { GeoAppChatAgent } from './geoapp-chat-agent';
import { GeoAppOcrAgentContribution } from './geoapp-ocr-agent';
import { ChatAgent } from '@theia/ai-chat/lib/common/chat-agents';

export default new ContainerModule(bind => {
    bind(ZonesTreeWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: ZonesTreeWidget.ID,
        createWidget: () => ctx.container.get(ZonesTreeWidget)
    })).inSingletonScope();

    // ZoneGeocachesWidget: instances gérées par ZoneTabsManager et le WidgetManager (plusieurs onglets possibles)
    bind(ZoneGeocachesWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: ZoneGeocachesWidget.ID,
        createWidget: () => ctx.container.get(ZoneGeocachesWidget)
    })).inSingletonScope();

    // GeocacheDetailsWidget: instances gérées par GeocacheTabsManager et le WidgetManager (plusieurs onglets possibles)
    bind(GeocacheDetailsWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: GeocacheDetailsWidget.ID,
        createWidget: () => ctx.container.get(GeocacheDetailsWidget)
    })).inSingletonScope();

     // GeocacheImageEditorWidget: instances gérées par GeocacheImageEditorTabsManager (plusieurs onglets possibles)
     bind(GeocacheImageEditorWidget).toSelf();
     bind(WidgetFactory).toDynamicValue(ctx => ({
         id: GeocacheImageEditorWidget.ID,
         createWidget: () => ctx.container.get(GeocacheImageEditorWidget)
     })).inSingletonScope();

    // Widget des logs de géocache (affichable dans right, bottom ou main)
    bind(GeocacheLogsWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: GeocacheLogsWidget.ID,
        createWidget: () => ctx.container.get(GeocacheLogsWidget)
    })).inSingletonScope();

    // Widget des notes de géocache (affichable dans right, bottom ou main)
    bind(GeocacheNotesWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: GeocacheNotesWidget.ID,
        createWidget: () => ctx.container.get(GeocacheNotesWidget)
    })).inSingletonScope();

    bind(MapService).toSelf().inSingletonScope();
    
    // MapWidget n'est plus singleton pour permettre plusieurs instances
    bind(MapWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: MapWidget.ID,
        createWidget: () => {
            // Créer un child container pour chaque widget
            const child = ctx.container.createChild();
            return child.get(MapWidget);
        }
    })).inSingletonScope();
    
    // MapWidgetFactory avec configuration du créateur
    bind(MapWidgetFactory).toSelf().inSingletonScope().onActivation((context, factory) => {
        // Configurer le créateur de widget avec accès au container
        factory.setWidgetCreator((mapContext) => {
            const child = context.container.createChild();
            const widget = child.get(MapWidget);
            if (mapContext) {
                widget.setContext(mapContext);
            }
            return widget;
        });
        return factory;
    });

    bind(MapManagerWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: MapManagerWidget.ID,
        createWidget: () => ctx.container.get(MapManagerWidget)
    })).inSingletonScope();

    // Gestionnaire centralisé des onglets de détails de géocaches
    bind(GeocacheTabsManager).toSelf().inSingletonScope();

     // Gestionnaire centralisé des onglets d'éditeur d'images
     bind(GeocacheImageEditorTabsManager).toSelf().inSingletonScope();

     bind(GeocacheImageEditorFrontendContribution).toSelf().inSingletonScope();
     bind(FrontendApplicationContribution).toService(GeocacheImageEditorFrontendContribution);

    // Gestionnaire centralisé des onglets de tableaux de géocaches par zone
    bind(ZoneTabsManager).toSelf().inSingletonScope();

    bind(ZonesFrontendContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(ZonesFrontendContribution);

    bind(ZonesCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(ZonesCommandContribution);
    bind(FrontendApplicationContribution).toService(ZonesCommandContribution);

    // Batch Map Integration pour écouter les événements du plugin batch
    bind(BatchMapIntegration).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(BatchMapIntegration);

    bind(CheckerToolsManager).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(CheckerToolsManager);

    bind(GeoAppOcrAgentContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GeoAppOcrAgentContribution);

    bind(GeoAppChatAgent).toSelf().inSingletonScope();
    bind(ChatAgent).toService(GeoAppChatAgent);
});


