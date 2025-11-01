import { injectable, inject } from 'inversify';
import { FrontendApplication, FrontendApplicationContribution, WidgetManager, Widget } from '@theia/core/lib/browser';
import { ZonesTreeWidget } from './zones-tree-widget';
import { ZoneGeocachesWidget } from './zone-geocaches-widget';
import { MapManagerWidget } from './map/map-manager-widget';

@injectable()
export class ZonesFrontendContribution implements FrontendApplicationContribution {

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    async onStart(app: FrontendApplication): Promise<void> {
        // Ajouter le widget des zones
        const widget = await this.getOrCreateWidget();
        if (!widget.isAttached) {
            app.shell.addWidget(widget, { area: 'left', rank: 100 });
        }
        app.shell.activateWidget(widget.id);

        // Ajouter le gestionnaire de cartes
        console.log('[ZonesFrontendContribution] Création du MapManagerWidget...');
        const mapManagerWidget = await this.widgetManager.getOrCreateWidget(MapManagerWidget.ID);
        console.log('[ZonesFrontendContribution] MapManagerWidget créé:', mapManagerWidget.id);
        if (!mapManagerWidget.isAttached) {
            console.log('[ZonesFrontendContribution] Ajout du MapManagerWidget à la barre latérale gauche');
            app.shell.addWidget(mapManagerWidget, { area: 'left', rank: 200 });
        } else {
            console.log('[ZonesFrontendContribution] MapManagerWidget déjà attaché');
        }

        // Ecoute globale pour ouverture d'un onglet central de géocaches
        window.addEventListener('open-zone-geocaches', async (event: any) => {
            try {
                const detail = event?.detail || {};
                const zoneId = detail.zoneId;
                const zoneName = detail.zoneName;
                if (!zoneId) {
                    return;
                }
                const gWidget = await this.widgetManager.getOrCreateWidget(ZoneGeocachesWidget.ID) as ZoneGeocachesWidget;
                gWidget.setZone({ zoneId, zoneName });
                if (!gWidget.isAttached) {
                    app.shell.addWidget(gWidget, { area: 'main' });
                }
                app.shell.activateWidget(gWidget.id);
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('ZonesFrontendContribution: failed to open zone-geocaches widget', e);
            }
        });
    }

    protected async getOrCreateWidget(): Promise<Widget> {
        return this.widgetManager.getOrCreateWidget(ZonesTreeWidget.ID);
    }
}


