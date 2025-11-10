/**
 * Module frontend Formula Solver
 * Point d'entrée de l'extension Theia
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { FormulaSolverWidget } from './formula-solver-widget';
import { FormulaSolverContribution } from './formula-solver-contribution';
import { FormulaSolverService, FormulaSolverServiceImpl } from './formula-solver-service';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';

console.log('[FORMULA-SOLVER] Loading formula-solver-frontend-module...');

export default new ContainerModule(bind => {
    console.log('[FORMULA-SOLVER] Registering services and contributions...');

    // Ne pas créer MapService ici - il sera injecté depuis zones si disponible
    // L'injection @optional() dans FormulaSolverWidget gérera l'absence

    // Service
    bind(FormulaSolverService).to(FormulaSolverServiceImpl).inSingletonScope();
    
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

    console.log('[FORMULA-SOLVER] Formula Solver Extension registered successfully');
});
