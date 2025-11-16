import { injectable, inject } from 'inversify';
import { FrontendApplication, FrontendApplicationContribution, WidgetManager, Widget } from '@theia/core/lib/browser';
import { ZonesTreeWidget } from './zones-tree-widget';
import { ZoneGeocachesWidget } from './zone-geocaches-widget';
import { MapManagerWidget } from './map/map-manager-widget';
import { MapWidgetFactory } from './map/map-widget-factory';

@injectable()
export class ZonesFrontendContribution implements FrontendApplicationContribution {

    constructor() {
        console.log('[ZonesFrontendContribution] CONSTRUCTEUR appelé - extension zones créée');
    }

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(MapWidgetFactory)
    protected readonly mapWidgetFactory: MapWidgetFactory;

    async onStart(app: FrontendApplication): Promise<void> {
        console.log('[ZonesFrontendContribution] ========== onStart appelé - extension zones initialisée ==========');

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

        // Écoute globale pour ouverture d'une carte de géocache (utilisé par l'extension alphabets)
        console.log('[ZonesFrontendContribution] ========== Enregistrement des écouteurs open-geocache-map ==========');
        const eventHandler = async (event: any) => {
            try {
                console.log('[ZonesFrontendContribution] !!!!! ÉVÉNEMENT CUSTOMEVENTS REÇU !!!!!');
                console.log('[ZonesFrontendContribution] Événement open-geocache-map reçu sur', event.currentTarget === document ? 'document' : 'window');
                console.log('ZonesFrontendContribution: Événement open-geocache-map reçu', event);
                const detail = event?.detail || {};
                console.log('ZonesFrontendContribution: Détails de l\'événement:', detail);
                const geocache = detail.geocache;
                if (!geocache || !geocache.id) {
                    console.warn('ZonesFrontendContribution: Invalid geocache data for open-geocache-map event', detail);
                    return;
                }

                console.log('ZonesFrontendContribution: Received open-geocache-map event for', geocache.gc_code);
                console.log('ZonesFrontendContribution: Données géocache:', geocache);

                // Récupérer le widget de géocaches et ouvrir la carte
                console.log('ZonesFrontendContribution: Récupération du widget ZoneGeocachesWidget');
                const gWidget = await this.widgetManager.getOrCreateWidget(ZoneGeocachesWidget.ID) as ZoneGeocachesWidget;
                console.log('ZonesFrontendContribution: Widget récupéré:', gWidget);
                await gWidget.openGeocacheMap(geocache);
                console.log('ZonesFrontendContribution: openGeocacheMap terminé');
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('ZonesFrontendContribution: failed to open geocache map', e);
            }
        };

        document.addEventListener('open-geocache-map', eventHandler);
        window.addEventListener('open-geocache-map', eventHandler);
        console.log('[ZonesFrontendContribution] ========== Écouteurs CustomEvent enregistrés sur document et window ==========');

        // Écouteurs pour la carte générale
        console.log('[ZonesFrontendContribution] ========== Enregistrement des écouteurs open-general-map ==========');
        const generalMapHandler = async () => {
            try {
                console.log('[ZonesFrontendContribution] Événement open-general-map reçu');
                await this.mapWidgetFactory.openGeneralMap();
                console.log('[ZonesFrontendContribution] Carte générale ouverte/activée');
            } catch (error) {
                console.error('[ZonesFrontendContribution] Erreur lors de l\'ouverture de la carte générale', error);
            }
        };
        document.addEventListener('open-general-map', generalMapHandler);
        window.addEventListener('open-general-map', generalMapHandler);

        // Écouter aussi les messages window.postMessage
        const messageHandler = async (messageEvent: MessageEvent) => {
            console.log('[ZonesFrontendContribution] !!!!! MESSAGE REÇU (tous types) !!!!!', messageEvent.data);
            if (messageEvent.data && messageEvent.data.type === 'open-geocache-map' && messageEvent.data.source === 'alphabets-extension') {
                console.log('[ZonesFrontendContribution] !!!!! MESSAGE POSTMESSAGE OPEN-GEOCACHE-MAP REÇU !!!!!');
                console.log('[ZonesFrontendContribution] Message postMessage reçu:', messageEvent.data);
                const geocache = messageEvent.data.geocache;
                if (geocache && geocache.id) {
                    console.log('[ZonesFrontendContribution] Traitement du geocache:', geocache.gc_code);
                    try {
                        // Utiliser le widgetManager pour récupérer ou créer le widget
                        const gWidget = await this.widgetManager.getOrCreateWidget(ZoneGeocachesWidget.ID) as ZoneGeocachesWidget;
                        console.log('[ZonesFrontendContribution] Widget ZoneGeocachesWidget récupéré:', gWidget);
                        await gWidget.openGeocacheMap(geocache);
                        console.log('[ZonesFrontendContribution] openGeocacheMap terminé avec succès');
                    } catch (error) {
                        console.error('[ZonesFrontendContribution] Erreur lors de l\'ouverture de la carte:', error);
                    }
                } else {
                    console.warn('[ZonesFrontendContribution] Données geocache invalides:', geocache);
                }
            } else if (messageEvent.data && messageEvent.data.type === 'open-general-map' && messageEvent.data.source === 'alphabets-extension') {
                console.log('[ZonesFrontendContribution] !!!!! MESSAGE POSTMESSAGE OPEN-GENERAL-MAP REÇU !!!!!');
                try {
                    await this.mapWidgetFactory.openGeneralMap();
                    console.log('[ZonesFrontendContribution] Carte générale ouverte via postMessage');
                } catch (error) {
                    console.error('[ZonesFrontendContribution] Erreur lors de l\'ouverture de la carte générale via postMessage', error);
                }
            }
        };
        window.addEventListener('message', messageHandler);
        console.log('[ZonesFrontendContribution] ========== Écouteur postMessage enregistré sur window ==========');
        console.log('[ZonesFrontendContribution] ========== Tous les écouteurs sont maintenant actifs ==========');
    }

    protected async getOrCreateWidget(): Promise<Widget> {
        return this.widgetManager.getOrCreateWidget(ZonesTreeWidget.ID);
    }
}


