/**
 * Module frontend Theia pour l'extension MysterAI Plugins.
 * 
 * Ce module configure l'injection de dépendances et enregistre
 * les services nécessaires à la gestion des plugins.
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { WidgetFactory, bindViewContribution, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';

import { PluginsService } from '../common/plugin-protocol';
import { TasksService } from '../common/task-protocol';
import { PluginsServiceImpl } from './services/plugins-service';
import { TasksServiceImpl } from './services/tasks-service';
import { BatchPluginService } from './services/batch-plugin-service';
import { PluginsBrowserWidget } from './plugins-browser-widget';
import { PluginExecutorWidget } from './plugin-executor-widget';
import { BatchPluginExecutorWidget } from './batch-plugin-executor-widget';
import { PluginsBrowserContribution, PluginExecutorContribution, PluginsFrontendApplicationContribution } from './plugins-contribution';
import { PluginToolsManager } from './plugin-tools-manager';

import './style/plugins-browser.css';
import './style/plugin-executor.css';

console.log('[MYSTERAI] Loading plugins-frontend-module...');

export default new ContainerModule(bind => {
    console.log('[MYSTERAI] Registering services and contributions...');
    // Services de communication avec l'API
    bind(PluginsService).to(PluginsServiceImpl).inSingletonScope();
    bind(PluginsServiceImpl).toSelf().inSingletonScope();
    bind(TasksService).to(TasksServiceImpl).inSingletonScope();
    bind(TasksServiceImpl).toSelf().inSingletonScope();
    bind(BatchPluginService).to(BatchPluginService).inSingletonScope();
    
    // Widget Plugins Browser
    bind(PluginsBrowserWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: PluginsBrowserWidget.ID,
        createWidget: () => ctx.container.get<PluginsBrowserWidget>(PluginsBrowserWidget)
    })).inSingletonScope();
    
    // Widget Plugin Executor
    bind(PluginExecutorWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: PluginExecutorWidget.ID,
        createWidget: () => ctx.container.get<PluginExecutorWidget>(PluginExecutorWidget)
    })).inSingletonScope();
    
    // Widget Batch Plugin Executor
    bind(BatchPluginExecutorWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: BatchPluginExecutorWidget.ID,
        createWidget: () => ctx.container.get<BatchPluginExecutorWidget>(BatchPluginExecutorWidget)
    })).inSingletonScope();
    
    // Contributions
    bindViewContribution(bind, PluginsBrowserContribution);
    bind(CommandContribution).toService(PluginsBrowserContribution);
    bind(MenuContribution).toService(PluginsBrowserContribution);
    
    bindViewContribution(bind, PluginExecutorContribution);
    bind(CommandContribution).toService(PluginExecutorContribution);
    bind(MenuContribution).toService(PluginExecutorContribution);
    
    bind(FrontendApplicationContribution).to(PluginsFrontendApplicationContribution).inSingletonScope();
    bind(PluginToolsManager).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(PluginToolsManager);
});
