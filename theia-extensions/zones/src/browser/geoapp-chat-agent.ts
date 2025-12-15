/**
 * Chat agent GeoApp: dérivé minimal du mode "Universal" mais avec les tools GeoApp (checkers) toujours disponibles.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import { nls } from '@theia/core';
import { ToolInvocationRegistry, ToolRequest, LanguageModelRequirement } from '@theia/ai-core';
import { AbstractStreamParsingChatAgent } from '@theia/ai-chat/lib/common/chat-agents';
import { MutableChatRequestModel } from '@theia/ai-chat/lib/common/chat-model';

export const GeoAppChatAgentId = 'GeoApp';

@injectable()
export class GeoAppChatAgent extends AbstractStreamParsingChatAgent {

    id: string = GeoAppChatAgentId;
    name: string = GeoAppChatAgentId;

    languageModelRequirements: LanguageModelRequirement[] = [{
        purpose: 'chat',
        identifier: 'default/universal',
    }];

    protected defaultLanguageModelPurpose: string = 'chat';

    override description = nls.localize(
        'geoapp/ai/chat/geoapp/description',
        'Agent GeoApp pour la résolution de géocaches avec accès permanent aux tools GeoApp (checkers, etc.).'
    );

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    override async invoke(request: MutableChatRequestModel): Promise<void> {
        this.additionalToolRequests = this.getGeoAppTools();
        return super.invoke(request);
    }

    protected getGeoAppTools(): ToolRequest[] {
        const ids = [
            'geoapp.checkers.run',
            'geoapp.checkers.session.ensure',
            'geoapp.checkers.session.login',
            'geoapp.checkers.session.reset',
        ];

        const tools: ToolRequest[] = [];
        for (const id of ids) {
            const tool = this.toolRegistry.getFunction(id);
            if (tool) {
                tools.push(tool);
            }
        }
        return tools;
    }
}
