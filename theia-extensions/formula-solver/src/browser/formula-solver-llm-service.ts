import { LanguageModelRegistry, LanguageModelService, UserRequest, getJsonOfResponse, isLanguageModelParsedResponse, getTextOfResponse } from '@theia/ai-core';
import { injectable, inject } from '@theia/core/shared/inversify';

@injectable()
export class FormulaSolverLLMService {
    @inject(LanguageModelRegistry)
    protected readonly languageModelRegistry!: LanguageModelRegistry;

    @inject(LanguageModelService)
    protected readonly languageModelService!: LanguageModelService;

    /**
     * Effectue un appel direct à un LLM pour résoudre une tâche spécifique
     */
    protected async callLLM(prompt: string, task: string): Promise<string> {
        try {
            console.log(`[FORMULA-SOLVER-LLM] 🤖 DÉBUT APPEL LLM pour: ${task}`);
            console.log(`[FORMULA-SOLVER-LLM] 📝 PROMPT ENVOYÉ:`, prompt.substring(0, 500) + (prompt.length > 500 ? '...' : ''));

            // Sélectionner un modèle de langage
            console.log(`[FORMULA-SOLVER-LLM] 🔍 Recherche modèle de langage...`);
            const languageModel = await this.languageModelRegistry.selectLanguageModel({
                agent: 'formula-solver',
                purpose: 'formula-solving',
                identifier: 'default/universal'
            });

            if (!languageModel) {
                console.error(`[FORMULA-SOLVER-LLM] ❌ AUCUN MODÈLE DISPONIBLE !`);
                console.error(`[FORMULA-SOLVER-LLM] 💡 Vérifiez la configuration IA dans les paramètres Theia`);
                throw new Error('Aucun modèle de langage disponible pour la résolution de formules');
            }

            console.log(`[FORMULA-SOLVER-LLM] ✅ Modèle trouvé:`, {
                id: languageModel.id,
                name: languageModel.name
            });

            // Créer la requête pour le LLM
            const request: UserRequest = {
                messages: [
                    {
                        actor: 'user',
                        type: 'text',
                        text: prompt
                    }
                ],
                agentId: 'formula-solver',
                requestId: `formula-${Date.now()}`,
                sessionId: `session-${Date.now()}`
            };

            console.log(`[FORMULA-SOLVER-LLM] 📤 Envoi requête au LLM...`);

            // Envoyer la requête
            const response = await this.languageModelService.sendRequest(languageModel, request);

            console.log(`[FORMULA-SOLVER-LLM] 📥 RÉPONSE BRUTE REÇUE du LLM:`, response);
            console.log(`[FORMULA-SOLVER-LLM] ✅ Réponse LLM reçue pour: ${task}`);

            // Extraire le texte de la réponse
            let responseText: string;
            if (isLanguageModelParsedResponse(response)) {
                console.log(`[FORMULA-SOLVER-LLM] 📋 Réponse structurée détectée`);
                responseText = JSON.stringify(response.parsed);
                console.log(`[FORMULA-SOLVER-LLM] 📄 Contenu structuré:`, response.parsed);
            } else {
                console.log(`[FORMULA-SOLVER-LLM] 📝 Extraction du texte de la réponse...`);

                // Utiliser la fonction utilitaire de Theia pour extraire le texte
                try {
                    responseText = await getTextOfResponse(response);
                    console.log(`[FORMULA-SOLVER-LLM] 📄 Texte extrait:`, responseText.substring(0, 200) + (responseText.length > 200 ? '...' : ''));
                } catch (textError) {
                    console.warn(`[FORMULA-SOLVER-LLM] ⚠️ Erreur extraction texte, tentative avec getJsonOfResponse:`, textError);
                    // Fallback : essayer getJsonOfResponse
                    const jsonResponse = await getJsonOfResponse(response) as any;
                    responseText = typeof jsonResponse === 'string' ? jsonResponse : String(jsonResponse);
                    console.log(`[FORMULA-SOLVER-LLM] 📄 Texte extrait (fallback):`, responseText.substring(0, 200) + (responseText.length > 200 ? '...' : ''));
                }
            }

            console.log(`[FORMULA-SOLVER-LLM] 🎯 TEXTE FINAL RETOURNÉ:`, responseText);
            return responseText;

        } catch (error) {
            console.error(`[FORMULA-SOLVER-LLM] ❌ Erreur LLM pour ${task}:`, error);
            throw error;
        }
    }

    /**
     * Détecte les formules GPS dans un texte avec IA
     */
    async detectFormulasWithAI(text: string): Promise<any[]> {
        console.log(`[FORMULA-SOLVER-LLM] 🎯 DÉTECTION FORMULES - Texte d'entrée:`, text.substring(0, 300) + (text.length > 300 ? '...' : ''));

        const prompt = `Analyse ce texte de géocache et détecte les formules de coordonnées GPS qu'il contient.

Texte à analyser:
${text}

INSTRUCTIONS IMPORTANTES:
- Cherche les patterns de coordonnées GPS comme N49°12.345 E006°12.345
- Identifie les formules avec variables (A, B, C, etc.) dans les expressions mathématiques
- Les lettres N, S, E, W isolées au début des coordonnées sont des POINTS CARDINAUX, pas des variables
- Seules les lettres utilisées DANS les parenthèses () sont des variables à résoudre
- Les champs "north" et "east" doivent contenir UNIQUEMENT la partie coordonnée, SANS le signe "=" au début
- Par exemple : "north": "N49°12.(A+B+C)" et NON "north": "N=N49°12.(A+B+C)"
- Retourne UNIQUEMENT un objet JSON valide avec cette structure:
{
  "formulas": [
    {
      "id": "formula_1",
      "north": "N49°12.(A+B+C)",
      "east": "E006°00.(D-E)",
      "text_output": "N49°12.(A+B+C) E006°00.(D-E)",
      "confidence": 0.95,
      "source": "ai-detected"
    }
  ]
}

Si aucune formule n'est trouvée, retourne {"formulas": []}`;

        console.log(`[FORMULA-SOLVER-LLM] 🎯 PROMPT CRÉÉ pour détection formules`);

        const response = await this.callLLM(prompt, 'détection-formules');

        console.log(`[FORMULA-SOLVER-LLM] 🎯 RÉPONSE BRUTE pour détection:`, response);

        // Essayer de parser le JSON
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            console.log(`[FORMULA-SOLVER-LLM] 🎯 JSON trouvé dans réponse:`, jsonMatch ? jsonMatch[0] : 'AUCUN JSON TROUVÉ');

            const parsed = JSON.parse(jsonMatch?.[0] || '{"formulas": []}');
            console.log(`[FORMULA-SOLVER-LLM] 🎯 JSON parsé:`, parsed);
            console.log(`[FORMULA-SOLVER-LLM] 🎯 Formules trouvées:`, parsed.formulas?.length || 0);

            return parsed.formulas || [];
        } catch (parseError) {
            console.error(`[FORMULA-SOLVER-LLM] 🎯 ERREUR PARSING JSON:`, parseError);
            console.error(`[FORMULA-SOLVER-LLM] 🎯 Réponse qui n'a pas pu être parsée:`, response);
            return [];
        }
    }

    /**
     * Extrait les questions pour les variables avec IA
     */
    async extractQuestionsWithAI(text: string, variables: string[]): Promise<{ [key: string]: string }> {
        const prompt = `Analyse ce texte de géocache et trouve les questions correspondant à ces variables: ${variables.join(', ')}

IMPORTANT: Ces variables (${variables.join(', ')}) sont les LETTRES utilisées dans les formules mathématiques.
NE CONFONDS PAS avec les points cardinaux (N, S, E, W) qui sont au début des coordonnées !

Texte complet:
${text}

INSTRUCTIONS:
- Pour chaque variable (${variables.join(', ')}), trouve la question qui permet de déterminer sa valeur
- Les questions sont souvent au format "A. [question]" ou "Quel est [question] A ?"
- IGNORE les points cardinaux N, S, E, W qui ne sont pas des variables à résoudre
- Retourne UNIQUEMENT un objet JSON avec les questions trouvées:
{
  "A": "Nombre de fenêtres de l'église",
  "B": "Année de construction",
  "C": "",
  ...
}

Si aucune question n'est trouvée pour une variable, utilise une chaîne vide.`;

        const response = await this.callLLM(prompt, `extraction-questions-${variables.join('')}`);
        const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}');
        return parsed;
    }

    /**
     * Recherche des réponses avec IA
     */
    async searchAnswersWithAI(questions: { [key: string]: string }, context: string): Promise<{ [key: string]: string }> {
        const questionsText = Object.entries(questions)
            .map(([var_name, question]) => `${var_name}: ${question}`)
            .join('\n');

        const prompt = `Trouve les réponses à ces questions pour une géocache mystère.

Contexte de la géocache: ${context}

Questions à résoudre:
${questionsText}

INSTRUCTIONS:
- Utilise tes connaissances générales pour répondre aux questions
- Si c'est une question factuelle (année, nombre, etc.), donne la réponse exacte
- Si c'est une question spécifique à un lieu, utilise des connaissances générales
- Retourne UNIQUEMENT un objet JSON:
{
  "A": "42",
  "B": "1850",
  ...
}`;

        const response = await this.callLLM(prompt, 'recherche-réponses');
        const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}');
        return parsed;
    }

}
