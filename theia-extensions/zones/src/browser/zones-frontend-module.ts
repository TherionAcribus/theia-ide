import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common';
import { ZonesWidget } from './zones-widget';
import { ZonesFrontendContribution } from './zones-frontend-contribution';
import { ZonesCommandContribution } from './zones-command-contribution';
import { ZoneGeocachesWidget } from './zone-geocaches-widget';

export default new ContainerModule(bind => {
    bind(ZonesWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: ZonesWidget.ID,
        createWidget: () => ctx.container.get(ZonesWidget)
    })).inSingletonScope();

    bind(ZoneGeocachesWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: ZoneGeocachesWidget.ID,
        createWidget: () => ctx.container.get(ZoneGeocachesWidget)
    })).inSingletonScope();

    bind(ZonesFrontendContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(ZonesFrontendContribution);

    bind(ZonesCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(ZonesCommandContribution);
    bind(FrontendApplicationContribution).toService(ZonesCommandContribution);
});


