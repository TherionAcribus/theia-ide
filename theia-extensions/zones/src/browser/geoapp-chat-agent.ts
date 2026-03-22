/**
 * Chat agent GeoApp: dérivé minimal du mode "Universal" mais avec les tools GeoApp (checkers) toujours disponibles.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import { nls } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Agent, AgentService, ToolInvocationRegistry, ToolRequest, LanguageModelRequirement } from '@theia/ai-core';
import { AbstractStreamParsingChatAgent } from '@theia/ai-chat/lib/common/chat-agents';
import { MutableChatRequestModel } from '@theia/ai-chat/lib/common/chat-model';

export const GeoAppChatAgentId = 'GeoApp';
export const GeoAppChatLanguageModelRequirements: LanguageModelRequirement[] = [{
    purpose: 'chat',
    identifier: 'default/universal',
}];

const geoAppChatAgentConfiguration: Agent = {
    id: GeoAppChatAgentId,
    name: GeoAppChatAgentId,
    description: 'Agent GeoApp pour la resolution de geocaches avec acces permanent aux tools GeoApp.',
    languageModelRequirements: GeoAppChatLanguageModelRequirements,
    prompts: [],
    variables: [],
    agentSpecificVariables: [],
    functions: [],
    tags: ['GeoApp', 'Chat', 'Geocaching'],
};

@injectable()
export class GeoAppChatAgent extends AbstractStreamParsingChatAgent {

    id: string = GeoAppChatAgentId;
    name: string = GeoAppChatAgentId;

    languageModelRequirements: LanguageModelRequirement[] = GeoAppChatLanguageModelRequirements;

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
            'geoapp.plugins.listing.classify',
            'geoapp.plugins.metasolver.recommend',
            'plugin.metasolver',
            'formula-solver.detect-formula',
            'formula-solver.find-questions',
            'formula-solver.search-answer',
            'formula-solver.calculate-value',
            'formula-solver.calculate-coordinates',
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

@injectable()
export class GeoAppChatAgentContribution implements FrontendApplicationContribution {

    @inject(AgentService)
    protected readonly agentService!: AgentService;

    async onStart(): Promise<void> {
        try {
            this.agentService.unregisterAgent(GeoAppChatAgentId);
        } catch {
            // ignore
        }

        this.agentService.registerAgent(geoAppChatAgentConfiguration);
    }
}
