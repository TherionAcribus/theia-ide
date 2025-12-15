/********************************************************************************
 * Copyright (C) 2020 TypeFox, EclipseSource and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 *
 * Rôle: module DI frontend du product Theia (bindings widgets/contributions).
 ********************************************************************************/

import '../../src/browser/style/index.css';

import { WidgetFactory } from '@theia/core/lib/browser';
import { AboutDialog } from '@theia/core/lib/browser/about-dialog';
import { CommandContribution } from '@theia/core/lib/common/command';
import { ContainerModule } from '@theia/core/shared/inversify';
import { GettingStartedWidget } from '@theia/getting-started/lib/browser/getting-started-widget';
import { MenuContribution } from '@theia/core/lib/common/menu';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { TheiaIDEAboutDialog } from './theia-ide-about-dialog';
import { TheiaIDEContribution } from './theia-ide-contribution';
import { TheiaIDEGettingStartedWidget } from './theia-ide-getting-started-widget';

export default new ContainerModule((bind, _unbind, isBound, rebind) => {
    bind(TheiaIDEGettingStartedWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: GettingStartedWidget.ID,
        createWidget: () => context.container.get<TheiaIDEGettingStartedWidget>(TheiaIDEGettingStartedWidget),
    })).inSingletonScope();
    if (isBound(AboutDialog)) {
        rebind(AboutDialog).to(TheiaIDEAboutDialog).inSingletonScope();
    } else {
        bind(AboutDialog).to(TheiaIDEAboutDialog).inSingletonScope();
    }

    bind(TheiaIDEContribution).toSelf().inSingletonScope();
    [CommandContribution, MenuContribution, FrontendApplicationContribution].forEach(serviceIdentifier =>
        bind(serviceIdentifier).toService(TheiaIDEContribution)
    );
});
