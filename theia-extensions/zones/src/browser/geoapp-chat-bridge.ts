import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { LanguageModelRegistry } from '@theia/ai-core';
import { DEFAULT_CHAT_AGENT_PREF } from '@theia/ai-chat/lib/common/ai-chat-preferences';
import { ChatAgent, ChatAgentLocation, ChatAgentService, ChatService, ChatSession, isSessionDeletedEvent } from '@theia/ai-chat';

export const GEOAPP_OPEN_CHAT_REQUEST_EVENT = 'geoapp-open-chat-request';

interface GeoAppOpenChatRequestDetail {
    geocacheId?: number;
    gcCode?: string;
    geocacheName?: string;
    sessionTitle?: string;
    prompt?: string;
    focus?: boolean;
}

interface GeoAppChatSessionMetadata {
    geocacheId?: number;
    gcCode?: string;
    geocacheName?: string;
}

@injectable()
export class GeoAppChatBridge implements FrontendApplicationContribution {

    protected readonly sessionMetadata = new Map<string, GeoAppChatSessionMetadata>();

    constructor(
        @inject(ChatService) protected readonly chatService: ChatService,
        @inject(ChatAgentService) protected readonly chatAgentService: ChatAgentService,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(LanguageModelRegistry) protected readonly languageModelRegistry: LanguageModelRegistry,
        @inject(MessageService) protected readonly messages: MessageService,
    ) {}

    onStart(): void {
        this.chatService.onSessionEvent(event => {
            if (isSessionDeletedEvent(event)) {
                this.sessionMetadata.delete(event.sessionId);
            }
        });

        window.addEventListener(GEOAPP_OPEN_CHAT_REQUEST_EVENT, this.handleOpenChatRequest as EventListener);
    }

    onStop(): void {
        window.removeEventListener(GEOAPP_OPEN_CHAT_REQUEST_EVENT, this.handleOpenChatRequest as EventListener);
    }

    protected readonly handleOpenChatRequest = async (rawEvent: Event): Promise<void> => {
        const event = rawEvent as CustomEvent<GeoAppOpenChatRequestDetail>;
        const detail = event.detail || {};
        const sessionTitle = this.buildSessionTitle(detail);
        const prompt = (detail.prompt || '').trim();

        try {
            const existingSession = this.findExistingSession(detail, sessionTitle);
            if (existingSession) {
                existingSession.pinnedAgent = await this.resolveDefaultChatAgent();
                this.setSessionMetadata(existingSession, detail);
                this.chatService.setActiveSession(existingSession.id, { focus: detail.focus !== false });
                if (prompt) {
                    await this.chatService.sendRequest(existingSession.id, { text: prompt });
                }
                return;
            }

            const pinnedAgent = await this.resolveDefaultChatAgent();
            const session = this.chatService.createSession(ChatAgentLocation.Panel, { focus: detail.focus !== false }, pinnedAgent);
            session.title = sessionTitle;
            this.setSessionMetadata(session, detail);

            if (prompt) {
                await this.chatService.sendRequest(session.id, { text: prompt });
            }
        } catch (error) {
            console.error('[GeoAppChatBridge] Failed to open GeoApp chat', error);
            this.messages.error('Impossible d\'ouvrir le chat GeoApp.');
        }
    };

    protected findExistingSession(detail: GeoAppOpenChatRequestDetail, sessionTitle: string): ChatSession | undefined {
        return this.chatService.getSessions().find(session => {
            const metadata = this.sessionMetadata.get(session.id);
            if (typeof detail.geocacheId === 'number' && metadata?.geocacheId === detail.geocacheId) {
                return true;
            }
            if (detail.gcCode && metadata?.gcCode === detail.gcCode) {
                return true;
            }
            return session.title === sessionTitle;
        });
    }

    protected setSessionMetadata(session: ChatSession, detail: GeoAppOpenChatRequestDetail): void {
        this.sessionMetadata.set(session.id, {
            geocacheId: detail.geocacheId,
            gcCode: detail.gcCode,
            geocacheName: detail.geocacheName,
        });
    }

    protected buildSessionTitle(detail: GeoAppOpenChatRequestDetail): string {
        const explicitTitle = (detail.sessionTitle || '').trim();
        if (explicitTitle) {
            return explicitTitle;
        }
        return `CHAT IA - ${detail.gcCode || detail.geocacheName || 'GeoApp'}`;
    }

    protected async resolveDefaultChatAgent(): Promise<ChatAgent | undefined> {
        const available = this.chatAgentService.getAgents();
        const candidates: ChatAgent[] = [];

        const configuredId = this.preferenceService.get(DEFAULT_CHAT_AGENT_PREF, undefined) as string | undefined;
        const configured = configuredId ? this.chatAgentService.getAgent(configuredId) : undefined;
        if (configured) {
            candidates.push(configured);
        }

        const geoApp = available.find(agent =>
            (agent.id || '').toLowerCase() === 'geoapp' || (agent.name || '').toLowerCase() === 'geoapp'
        );
        if (geoApp) {
            candidates.push(geoApp);
        }

        const universal = available.find(agent =>
            (agent.id || '').toLowerCase().includes('universal') || (agent.name || '').toLowerCase().includes('universal')
        );
        if (universal) {
            candidates.push(universal);
        }

        for (const agent of available) {
            if (!candidates.includes(agent)) {
                candidates.push(agent);
            }
        }

        for (const agent of candidates) {
            if (await this.isAgentReady(agent)) {
                return agent;
            }
        }

        return candidates[0];
    }

    protected async isAgentReady(agent: ChatAgent | undefined): Promise<boolean> {
        if (!agent?.id) {
            return false;
        }
        try {
            const model = await this.languageModelRegistry.selectLanguageModel({
                agent: agent.id,
                purpose: 'chat',
                identifier: 'default/universal'
            });
            return !!model;
        } catch {
            return false;
        }
    }
}
