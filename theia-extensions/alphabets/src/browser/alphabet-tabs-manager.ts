import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { MessageService } from '@theia/core';
import { AlphabetViewerWidget } from './alphabet-viewer-widget';

export type AlphabetTabMode = 'smart-replace' | 'always-new-tab' | 'always-replace';

interface AlphabetTabEntry {
    widget: AlphabetViewerWidget;
    alphabetId?: string;
    isPinned: boolean;
}

export interface OpenAlphabetOptions {
    alphabetId: string;
    forceDuplicate?: boolean;
}

@injectable()
export class AlphabetTabsManager {

    protected readonly tabs: AlphabetTabEntry[] = [];
    protected nextId = 1;

    protected widgetCreator?: (alphabetId: string) => AlphabetViewerWidget;

    constructor(
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(MessageService) protected readonly messages: MessageService,
    ) {
        if (typeof window !== 'undefined') {
            window.addEventListener('geoapp-alphabet-tab-interaction', this.handleInteractionEvent as EventListener);
        }
    }

    setWidgetCreator(creator: (alphabetId: string) => AlphabetViewerWidget): void {
        this.widgetCreator = creator;
    }

    async openAlphabet(options: OpenAlphabetOptions): Promise<AlphabetViewerWidget> {
        const { alphabetId, forceDuplicate } = options;

        this.cleanupDisposed();

        const contextKey = `alphabet:${alphabetId}`;

        if (!forceDuplicate) {
            const existing = this.tabs.find(entry => entry.alphabetId === alphabetId && !entry.widget.isDisposed);
            if (existing) {
                this.attachAndActivate(existing.widget);
                return existing.widget;
            }
        }

        const mode = this.getMode();
        const aliveTabs = this.tabs.filter(entry => !entry.widget.isDisposed);

        let targetEntry: AlphabetTabEntry | undefined;

        if (mode === 'always-replace') {
            targetEntry = aliveTabs[aliveTabs.length - 1];
        } else if (mode === 'smart-replace') {
            const previewTabs = aliveTabs.filter(entry => !entry.isPinned);
            targetEntry = previewTabs[previewTabs.length - 1];
        } else {
            targetEntry = undefined;
        }

        if (!targetEntry) {
            const widget = this.createWidget(alphabetId);
            targetEntry = { widget, alphabetId, isPinned: false };
            this.tabs.push(targetEntry);
        } else {
            targetEntry.alphabetId = alphabetId;
            if (typeof (targetEntry.widget as any).setAlphabet === 'function') {
                (targetEntry.widget as any).setAlphabet(alphabetId);
            }
            targetEntry.isPinned = false;
        }

        this.attachAndActivate(targetEntry.widget);

        return targetEntry.widget;
    }

    protected getMode(): AlphabetTabMode {
        const raw = this.preferenceService.get('geoApp.ui.tabs.categories.alphabet', 'smart-replace') as string;
        if (raw === 'always-new-tab' || raw === 'always-replace' || raw === 'smart-replace') {
            return raw;
        }
        return 'smart-replace';
    }

    private handleInteractionEvent = (event: Event): void => {
        const custom = event as CustomEvent<{ widgetId?: string; type?: string }>;
        const detail = custom.detail;
        if (!detail || !detail.widgetId || !detail.type) {
            return;
        }

        if (!this.shouldPinForInteraction(detail.type)) {
            return;
        }

        const entry = this.tabs.find(e => e.widget.id === detail.widgetId && !e.widget.isDisposed);
        if (entry) {
            entry.isPinned = true;
        }
    };

    private shouldPinForInteraction(type: string): boolean {
        if (type === 'click') {
            return this.preferenceService.get('geoApp.ui.tabs.smartReplace.interaction.clickInContent', true) as boolean;
        }
        if (type === 'scroll') {
            return this.preferenceService.get('geoApp.ui.tabs.smartReplace.interaction.scroll', true) as boolean;
        }
        if (type === 'min-open-time') {
            return this.preferenceService.get('geoApp.ui.tabs.smartReplace.interaction.minOpenTimeEnabled', true) as boolean;
        }
        return false;
    }

    protected createWidget(alphabetId: string): AlphabetViewerWidget {
        if (!this.widgetCreator) {
            throw new Error('AlphabetTabsManager widgetCreator not initialized');
        }
        const widget = this.widgetCreator(alphabetId);
        widget.id = this.generateWidgetId(alphabetId);
        return widget;
    }

    protected generateWidgetId(alphabetId: string): string {
        const base = AlphabetViewerWidget.ID_PREFIX;
        const id = `${base}-${alphabetId}#${this.nextId++}`;
        return id;
    }

    protected attachAndActivate(widget: AlphabetViewerWidget): void {
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'main' });
        }
        this.activate(widget);
    }

    protected activate(widget: Widget): void {
        if (widget.id) {
            this.shell.activateWidget(widget.id);
        }
    }

    protected cleanupDisposed(): void {
        for (let i = this.tabs.length - 1; i >= 0; i--) {
            if (this.tabs[i].widget.isDisposed) {
                this.tabs.splice(i, 1);
            }
        }
    }
}
