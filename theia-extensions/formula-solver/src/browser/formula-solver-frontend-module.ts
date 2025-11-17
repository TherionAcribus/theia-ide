/**
 * Module frontend Formula Solver
 * Point d'entrée de l'extension Theia
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { FormulaSolverWidget } from './formula-solver-widget';
import { FormulaSolverContribution } from './formula-solver-contribution';
import { FormulaSolverService, FormulaSolverServiceImpl } from './formula-solver-service';
import { FormulaSolverAIService, FormulaSolverAIServiceImpl } from './formula-solver-ai-service';
import { FormulaSolverLLMService } from './formula-solver-llm-service';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';

console.log('[FORMULA-SOLVER] Loading formula-solver-frontend-module...');

export default new ContainerModule(bind => {
    console.log('[FORMULA-SOLVER] Registering services and contributions...');

    // Ne pas créer MapService ici - il sera injecté depuis zones si disponible
    // L'injection @optional() dans FormulaSolverWidget gérera l'absence

    // Service principal
    bind(FormulaSolverService).to(FormulaSolverServiceImpl).inSingletonScope();
    
    // Service IA
    bind(FormulaSolverAIService).to(FormulaSolverAIServiceImpl).inSingletonScope();

    // Service LLM pour les appels IA directs
    bind(FormulaSolverLLMService).toSelf().inSingletonScope();
    
    // Widget
    bind(FormulaSolverWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: FormulaSolverWidget.ID,
        createWidget: () => ctx.container.get<FormulaSolverWidget>(FormulaSolverWidget)
    })).inSingletonScope();

    // Contribution
    bind(FormulaSolverContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(FormulaSolverContribution);
    bind(CommandContribution).toService(FormulaSolverContribution);
    bind(MenuContribution).toService(FormulaSolverContribution);
    bind(TabBarToolbarContribution).toService(FormulaSolverContribution);

    console.log('[FORMULA-SOLVER] Formula Solver Extension (with AI) registered successfully');
});
