import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common';
import { ZonesTreeWidget } from './zones-tree-widget';
import { ZonesFrontendContribution } from './zones-frontend-contribution';
import { ZonesCommandContribution } from './zones-command-contribution';
import { ZoneGeocachesWidget } from './zone-geocaches-widget';
import { GeocacheDetailsWidget } from './geocache-details-widget';
import { GeocacheLogsWidget } from './geocache-logs-widget';
import { MapWidget } from './map/map-widget';
import { MapService } from './map/map-service';
import { MapWidgetFactory } from './map/map-widget-factory';
import { MapManagerWidget } from './map/map-manager-widget';
import { BatchMapIntegration } from './batch-map-integration';

export default new ContainerModule(bind => {
    bind(ZonesTreeWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: ZonesTreeWidget.ID,
        createWidget: () => ctx.container.get(ZonesTreeWidget)
    })).inSingletonScope();

    bind(ZoneGeocachesWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: ZoneGeocachesWidget.ID,
        createWidget: () => ctx.container.get(ZoneGeocachesWidget)
    })).inSingletonScope();

    bind(GeocacheDetailsWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: GeocacheDetailsWidget.ID,
        createWidget: () => ctx.container.get(GeocacheDetailsWidget)
    })).inSingletonScope();

    // Widget des logs de géocache (affichable dans right, bottom ou main)
    bind(GeocacheLogsWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: GeocacheLogsWidget.ID,
        createWidget: () => ctx.container.get(GeocacheLogsWidget)
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

    bind(ZonesFrontendContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(ZonesFrontendContribution);

    bind(ZonesCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(ZonesCommandContribution);
    bind(FrontendApplicationContribution).toService(ZonesCommandContribution);

    // Batch Map Integration pour écouter les événements du plugin batch
    bind(BatchMapIntegration).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(BatchMapIntegration);
});


