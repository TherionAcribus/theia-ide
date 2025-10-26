import { injectable, inject } from 'inversify';
import { FrontendApplication, FrontendApplicationContribution, WidgetManager, Widget } from '@theia/core/lib/browser';
import { ZonesWidget } from './zones-widget';

@injectable()
export class ZonesFrontendContribution implements FrontendApplicationContribution {

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    async onStart(app: FrontendApplication): Promise<void> {
        const widget = await this.getOrCreateWidget();
        if (!widget.isAttached) {
            app.shell.addWidget(widget, { area: 'left' });
        }
        app.shell.activateWidget(widget.id);
    }

    protected async getOrCreateWidget(): Promise<Widget> {
        return this.widgetManager.getOrCreateWidget(ZonesWidget.ID);
    }
}


