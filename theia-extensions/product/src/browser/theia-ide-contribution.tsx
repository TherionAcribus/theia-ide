/********************************************************************************
 * Copyright (C) 2021 Ericsson and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 *
 * Rôle: contribution frontend Theia (menus/commandes) + interception des liens externes pour ouverture dans le Mini Browser.
 ********************************************************************************/

import { inject, injectable } from '@theia/core/shared/inversify';
import { CommonMenus } from '@theia/core/lib/browser/common-frontend-contribution';
import { Command, CommandContribution, CommandRegistry, CommandService } from '@theia/core/lib/common/command';
import { MenuContribution, MenuModelRegistry, MenuPath } from '@theia/core/lib/common/menu';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { DisposableCollection, Disposable } from '@theia/core/lib/common/disposable';

export namespace TheiaIDEMenus {
    export const THEIA_IDE_HELP: MenuPath = [...CommonMenus.HELP, 'theia-ide'];
}
export namespace TheiaIDECommands {
    export const CATEGORY = 'TheiaIDE';
    export const REPORT_ISSUE: Command = {
        id: 'theia-ide:report-issue',
        category: CATEGORY,
        label: 'Report Issue'
    };
    export const DOCUMENTATION: Command = {
        id: 'theia-ide:documentation',
        category: CATEGORY,
        label: 'Documentation'
    };
}

@injectable()
export class TheiaIDEContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution {

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(CommandService)
    protected readonly commandService: CommandService;

    protected readonly toDispose = new DisposableCollection();

    protected readonly iframeBlockedHostSuffixes: string[] = [
        'geocaching.com',
    ];

    protected readonly linkClickListener = (event: MouseEvent): void => {
        if (event.defaultPrevented) {
            return;
        }
        if (event.button !== 0) {
            return;
        }
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const anchor = target.closest('a[href]');
        if (!(anchor instanceof HTMLAnchorElement)) {
            return;
        }

        const href = anchor.getAttribute('href');
        if (!href) {
            return;
        }

        let url: URL;
        try {
            url = new URL(href, window.location.href);
        } catch {
            return;
        }

        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return;
        }

        if (url.origin === window.location.origin) {
            return;
        }

        const host = url.hostname.toLowerCase();
        if (this.iframeBlockedHostSuffixes.some(suffix => host === suffix || host.endsWith(`.${suffix}`))) {
            event.preventDefault();
            event.stopPropagation();
            this.windowService.openNewWindow(url.toString(), { external: true });
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        this.commandService.executeCommand('mini-browser.openUrl', url.toString()).catch(() => {
            this.windowService.openNewWindow(url.toString(), { external: true });
        });
    };

    onStart(): void {
        document.addEventListener('click', this.linkClickListener, true);
        this.toDispose.push(Disposable.create(() => document.removeEventListener('click', this.linkClickListener, true)));
    }

    onStop(): void {
        this.toDispose.dispose();
    }

    static REPORT_ISSUE_URL = 'https://github.com/eclipse-theia/theia-ide/issues/new?assignees=&labels=&template=bug_report.md';
    static DOCUMENTATION_URL = 'https://theia-ide.org/docs/user_getting_started/';

    registerCommands(commandRegistry: CommandRegistry): void {
        commandRegistry.registerCommand(TheiaIDECommands.REPORT_ISSUE, {
            execute: () => this.windowService.openNewWindow(TheiaIDEContribution.REPORT_ISSUE_URL, { external: true })
        });
        commandRegistry.registerCommand(TheiaIDECommands.DOCUMENTATION, {
            execute: () => this.windowService.openNewWindow(TheiaIDEContribution.DOCUMENTATION_URL, { external: true })
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(TheiaIDEMenus.THEIA_IDE_HELP, {
            commandId: TheiaIDECommands.REPORT_ISSUE.id,
            label: TheiaIDECommands.REPORT_ISSUE.label,
            order: '1'
        });
        menus.registerMenuAction(TheiaIDEMenus.THEIA_IDE_HELP, {
            commandId: TheiaIDECommands.DOCUMENTATION.id,
            label: TheiaIDECommands.DOCUMENTATION.label,
            order: '2'
        });
    }
}
