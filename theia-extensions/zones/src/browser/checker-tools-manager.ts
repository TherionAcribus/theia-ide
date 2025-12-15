/**
 * Tool Functions pour l'exécution automatisée des checkers (Certitude, Geocaching, etc.).
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import {
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters,
    ToolRequestParametersProperties,
    ToolCallResult
} from '@theia/ai-core';

@injectable()
export class CheckerToolsManager implements FrontendApplicationContribution {

    static readonly PROVIDER_NAME = 'geoapp.checkers';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    async onStart(): Promise<void> {
        console.log('[CHECKERS-TOOLS] Enregistrement des tools IA...');
        await this.registerTools();
        console.log('[CHECKERS-TOOLS] Tools IA enregistrés avec succès');
    }

    private async registerTools(): Promise<void> {
        const tools: ToolRequest[] = [
            this.createRunCheckerTool(),
            this.createEnsureSessionTool(),
            this.createLoginSessionTool(),
            this.createResetSessionTool()
        ];

        for (const tool of tools) {
            try {
                await this.toolRegistry.registerTool(tool);
                console.log(`[CHECKERS-TOOLS] Tool enregistré: ${tool.name}`);
            } catch (error) {
                console.error(`[CHECKERS-TOOLS] Erreur enregistrement tool ${tool.name}:`, error);
            }
        }
    }

    private createRunCheckerTool(): ToolRequest {
        return {
            id: 'geoapp.checkers.run',
            name: 'run_checker',
            description: 'Exécute un checker externe en remplissant le champ et en détectant succès/échec. Pour Certitude (certitudes.org), un mode interactif est utilisé (fenêtre Playwright + action manuelle requise).',
            providerName: CheckerToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                url: {
                    type: 'string',
                    description: 'URL du checker à ouvrir',
                    required: true
                },
                wp: {
                    type: 'string',
                    description: 'Optionnel: code waypoint GC (ex: "GCAWZA2"). Utile pour Certitude si l\'URL ne contient pas ?wp=...',
                    required: false
                },
                candidate: {
                    type: 'string',
                    description: 'Réponse candidate à tester (texte)',
                    required: true
                },
                timeout_sec: {
                    type: 'number',
                    description: 'Optionnel: durée max (secondes) pour les checkers interactifs (ex: Certitude).',
                    required: false
                }
            }),
            handler: async (argString: string) => this.handleRunChecker(argString)
        };
    }

    private createEnsureSessionTool(): ToolRequest {
        return {
            id: 'geoapp.checkers.session.ensure',
            name: 'ensure_checker_session',
            description: 'Vérifie si une session authentifiée est disponible (ex: Geocaching.com).',
            providerName: CheckerToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                provider: {
                    type: 'string',
                    description: 'Provider (ex: "geocaching")',
                    required: true
                },
                wp: {
                    type: 'string',
                    description: 'Optionnel: code waypoint (ex: "GCAWZA2") pour certains providers (certitudes).',
                    required: false
                }
            }),
            handler: async (argString: string) => this.handleEnsureSession(argString)
        };
    }

    private createLoginSessionTool(): ToolRequest {
        return {
            id: 'geoapp.checkers.session.login',
            name: 'login_checker_session',
            description: 'Ouvre une fenêtre Chromium (Playwright) pour se connecter à un provider (ex: Geocaching.com) et sauvegarde la session dans le profil GeoApp.',
            providerName: CheckerToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                provider: {
                    type: 'string',
                    description: 'Provider (ex: "geocaching")',
                    required: true
                },
                wp: {
                    type: 'string',
                    description: 'Optionnel: code waypoint (ex: "GCAWZA2") pour certains providers (certitudes).',
                    required: false
                },
                timeout_sec: {
                    type: 'number',
                    description: 'Durée max (secondes) pour laisser le temps de se connecter',
                    required: false
                }
            }),
            handler: async (argString: string) => this.handleLoginSession(argString)
        };
    }

    private createResetSessionTool(): ToolRequest {
        return {
            id: 'geoapp.checkers.session.reset',
            name: 'reset_checker_session',
            description: 'Réinitialise le profil Playwright GeoApp (supprime cookies/session).',
            providerName: CheckerToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                confirm: {
                    type: 'boolean',
                    description: 'Doit être true pour confirmer la suppression',
                    required: true
                }
            }),
            handler: async (argString: string) => this.handleResetSession(argString)
        };
    }

    private async handleRunChecker(argString: string): Promise<ToolCallResult> {
        if (!(this.preferenceService.get('geoApp.checkers.enabled', true) as boolean)) {
            return { error: 'Checker automation is disabled by preferences.' };
        }

        try {
            const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const start = performance.now();
            const args = JSON.parse(argString);
            let url = args.url as string;
            const candidate = args.candidate as string;
            const wp = typeof args.wp === 'string' ? args.wp.trim() : undefined;
            const timeoutSec = typeof args.timeout_sec === 'number' ? args.timeout_sec : 300;

            const backendBaseUrl = this.getBackendBaseUrl();

            console.log('[CHECKERS-TOOLS] run_checker:start', {
                requestId,
                url,
                isCertitudes: this.isCertitudesUrl(url),
                timeoutSec
            });

            const isCertitudes = this.isCertitudesUrl(url);
            if (isCertitudes) {
                const normalized = this.normalizeCertitudesUrl(url, wp);
                if ('error' in normalized) {
                    return { error: normalized.error };
                }
                if (normalized.url !== url) {
                    console.log('[CHECKERS-TOOLS] run_checker:normalized-url', {
                        requestId,
                        from: url,
                        to: normalized.url
                    });
                    url = normalized.url;
                }
            }
            if (isCertitudes) {
                void this.messages.info(
                    'Certitude nécessite une validation manuelle (Cloudflare/Turnstile). Une fenêtre Chromium va s\'ouvrir : cliquez sur “Certifier”, puis revenez ici.'
                );
            }

            const endpoint = isCertitudes ? '/api/checkers/run-interactive' : '/api/checkers/run';
            const body: any = {
                url,
                input: { candidate }
            };
            if (isCertitudes) {
                body.timeout_sec = timeoutSec;
            }

            const fetchTimeoutMs = (isCertitudes ? timeoutSec : 60) * 1000 + 10000;
            const controller = new AbortController();
            const timeoutHandle = window.setTimeout(() => controller.abort(), fetchTimeoutMs);

            console.log('[CHECKERS-TOOLS] run_checker:fetch', {
                requestId,
                endpoint,
                backendBaseUrl,
                fetchTimeoutMs
            });

            let res: Response;
            try {
                res = await fetch(`${backendBaseUrl}${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
            } finally {
                window.clearTimeout(timeoutHandle);
            }

            const rawText = await res.text();
            let data: any;
            try {
                data = rawText ? JSON.parse(rawText) : {};
            } catch (parseError) {
                console.error('[CHECKERS-TOOLS] run_checker:invalid-json', {
                    requestId,
                    status: res.status,
                    rawText: rawText?.slice(0, 2000)
                });
                return { error: `Invalid JSON response (HTTP ${res.status})` };
            }

            console.log('[CHECKERS-TOOLS] run_checker:response', {
                requestId,
                status: res.status,
                ok: res.ok,
                dataStatus: data?.status
            });
            if (!res.ok || data.status === 'error') {
                console.error('[CHECKERS-TOOLS] run_checker:error', {
                    requestId,
                    status: res.status,
                    data
                });
                return { error: data.error || `HTTP ${res.status}` };
            }

            if (isCertitudes) {
                void this.messages.info('Certitude: résultat récupéré depuis la fenêtre interactive.');
            }

            console.log('[CHECKERS-TOOLS] run_checker:done', {
                requestId,
                durationMs: Math.round(performance.now() - start)
            });

            return JSON.stringify(data.result, null, 2);
        } catch (error: any) {
            console.error('[CHECKERS-TOOLS] Erreur run_checker:', error);
            return { error: error.message || 'Erreur run_checker' };
        }
    }

    private normalizeCertitudesUrl(url: string, wp?: string): { url: string } | { error: string } {
        if (!url || !url.trim()) {
            return { error: 'Missing url' };
        }

        const raw = url.trim();
        let parsed: URL;
        try {
            parsed = new URL(raw);
        } catch {
            try {
                parsed = new URL(`https://${raw}`);
            } catch {
                return { error: `Invalid url: ${url}` };
            }
        }

        const host = (parsed.hostname || '').toLowerCase();
        if (!host.endsWith('certitudes.org')) {
            return { url: parsed.toString() };
        }

        // Prefer the canonical host.
        parsed.hostname = 'www.certitudes.org';
        parsed.protocol = 'https:';

        // Prefer the canonical certitude path.
        const path = (parsed.pathname || '').toLowerCase();
        if (!path.includes('certitude')) {
            parsed.pathname = '/certitude';
        }

        // Ensure wp is present when provided.
        if (!parsed.searchParams.get('wp') && wp) {
            parsed.searchParams.set('wp', wp);
        }

        return { url: parsed.toString() };
    }

    private isCertitudesUrl(url: string): boolean {
        const raw = (url || '').toLowerCase();
        return raw.includes('certitudes.org') || raw.includes('www.certitudes.org');
    }

    private async handleEnsureSession(argString: string): Promise<ToolCallResult> {
        try {
            const args = JSON.parse(argString);
            const provider = args.provider as string;
            const wp = typeof args.wp === 'string' ? args.wp : undefined;

            const backendBaseUrl = this.getBackendBaseUrl();
            const res = await fetch(`${backendBaseUrl}/api/checkers/session/ensure`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ provider, wp })
            });

            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                return { error: data.error || `HTTP ${res.status}` };
            }

            return JSON.stringify({ provider: data.provider, logged_in: data.logged_in }, null, 2);
        } catch (error: any) {
            console.error('[CHECKERS-TOOLS] Erreur ensure_checker_session:', error);
            return { error: error.message || 'Erreur ensure_checker_session' };
        }
    }

    private async handleLoginSession(argString: string): Promise<ToolCallResult> {
        try {
            const args = JSON.parse(argString);
            const provider = args.provider as string;
            const wp = typeof args.wp === 'string' ? args.wp : undefined;
            const timeoutSec = typeof args.timeout_sec === 'number' ? args.timeout_sec : 180;

            const backendBaseUrl = this.getBackendBaseUrl();
            const res = await fetch(`${backendBaseUrl}/api/checkers/session/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ provider, wp, timeout_sec: timeoutSec })
            });

            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                return { error: data.error || `HTTP ${res.status}` };
            }

            return JSON.stringify({ provider: data.provider, logged_in: data.logged_in }, null, 2);
        } catch (error: any) {
            console.error('[CHECKERS-TOOLS] Erreur login_checker_session:', error);
            return { error: error.message || 'Erreur login_checker_session' };
        }
    }

    private async handleResetSession(argString: string): Promise<ToolCallResult> {
        try {
            const args = JSON.parse(argString);
            const confirm = Boolean(args.confirm);

            const backendBaseUrl = this.getBackendBaseUrl();
            const res = await fetch(`${backendBaseUrl}/api/checkers/session/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ confirm })
            });

            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                return { error: data.error || `HTTP ${res.status}` };
            }

            return JSON.stringify(data, null, 2);
        } catch (error: any) {
            console.error('[CHECKERS-TOOLS] Erreur reset_checker_session:', error);
            return { error: error.message || 'Erreur reset_checker_session' };
        }
    }

    private getBackendBaseUrl(): string {
        const value = this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000') as string;
        return (value || 'http://localhost:8000').replace(/\/$/, '');
    }

    private buildParameters(props: Record<string, any>): ToolRequestParameters {
        const properties: ToolRequestParametersProperties = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(props)) {
            properties[key] = {
                type: value.type,
                description: value.description
            };

            if (value.required) {
                required.push(key);
            }
        }

        return {
            type: 'object',
            properties,
            required
        };
    }
}
