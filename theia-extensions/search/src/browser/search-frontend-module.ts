/**
 * Module frontend Theia pour l'extension GeoApp Search.
 * 
 * Enregistre le service de recherche, le renderer d'overlay,
 * et les contributions (commandes, keybindings).
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common';
import { KeybindingContribution, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { SearchService } from './search-service';
import { SearchOverlayRenderer } from './search-overlay-renderer';
import { SearchContribution } from './search-contribution';

import './style/search-overlay.css';

export default new ContainerModule(bind => {
    console.log('[GEOAPP-SEARCH] Loading search-frontend-module...');

    // Service central de recherche (singleton)
    bind(SearchService).toSelf().inSingletonScope();

    // Renderer de l'overlay React (singleton)
    bind(SearchOverlayRenderer).toSelf().inSingletonScope();

    // Contribution : commandes, keybindings, lifecycle
    bind(SearchContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(SearchContribution);
    bind(KeybindingContribution).toService(SearchContribution);
    bind(FrontendApplicationContribution).toService(SearchContribution);
});
