import { injectable, inject } from 'inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { ZonesWidget } from './zones-widget';

export const ZonesCommands = {
    OPEN: <Command>{ id: 'zones:open', label: 'Zones: Ouvrir' }
};

@injectable()
export class ZonesCommandContribution implements CommandContribution {
    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(ZonesCommands.OPEN, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget(ZonesWidget.ID);
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'left' });
                }
                this.shell.activateWidget(widget.id);
            }
        });
    }
}


