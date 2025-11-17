/**
 * Service d'interaction avec l'Agent Formula Solver
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core';
import { FormulaSolverLLMService } from './formula-solver-llm-service';
import { Formula } from '../common/types';

export const FormulaSolverAIService = Symbol('FormulaSolverAIService');

export interface AIResolutionResult {
    status: 'success' | 'error' | 'partial';
    formulas?: Formula[];
    questions?: Map<string, string>;
    answers?: Map<string, string>;
    values?: Map<string, number>;
    coordinates?: {
        latitude: number;
        longitude: number;
        ddm: string;
        dms: string;
        decimal: string;
    };
    steps?: string[];
    error?: string;
    conversation_id?: string;
}

/**
 * Service pour interagir avec l'Agent Formula Solver
 */
export interface FormulaSolverAIService {
    /**
     * Résout une formule de géocache avec l'IA
     */
    solveWithAI(text: string, geocacheId?: number): Promise<AIResolutionResult>;
    
    /**
     * Vérifie si l'IA est disponible
     */
    isAIAvailable(): Promise<boolean>;
}

@injectable()
export class FormulaSolverAIServiceImpl implements FormulaSolverAIService {

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(FormulaSolverLLMService)
    protected readonly llmService!: FormulaSolverLLMService;

    constructor() {
        console.log('[FORMULA-SOLVER-AI] Service AI initialisé avec LLM direct');
    }

    /**
     * Résout une formule avec l'IA via l'Agent Formula Solver
     */
    async solveWithAI(text: string, geocacheId?: number): Promise<AIResolutionResult> {
        console.log('[FORMULA-SOLVER-AI] 🚀 DÉMARRAGE RÉSOLUTION IA AVEC AGENT');
        console.log('[FORMULA-SOLVER-AI] 📝 Texte à analyser:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));

        // Pas besoin de vérifier l'agent, on utilise le LLM directement

        const result: AIResolutionResult = {
            status: 'partial',
            steps: []
        };

        try {
            // Étape 1: Détection de la formule avec IA
            console.log('[FORMULA-SOLVER-AI] 🔍 ÉTAPE 1: Détection de formule');
            result.steps!.push('🔍 Détection de la formule avec IA...');

            const formulas = await this.llmService.detectFormulasWithAI(text);
            if (formulas && formulas.length > 0) {
                result.formulas = formulas;
                const formulaStr = `${formulas[0].north} ${formulas[0].east}`;
                console.log('[FORMULA-SOLVER-AI] ✅ Formule IA trouvée:', formulaStr);
                result.steps!.push(`✅ Formule IA: ${formulaStr}`);
            } else {
                console.log('[FORMULA-SOLVER-AI] ❌ Aucune formule IA détectée');
                result.steps!.push('❌ Aucune formule détectée par IA');
                return result;
            }

            // Étape 2: Extraction des variables et questions
            console.log('[FORMULA-SOLVER-AI] ❓ ÉTAPE 2: Extraction questions');
            result.steps!.push('❓ Extraction des questions avec IA...');

            const formula = result.formulas![0];
            const variables = this.extractVariablesFromFormula(formula);
            console.log('[FORMULA-SOLVER-AI] 🔤 Variables trouvées:', variables);

            if (variables.length > 0) {
                const questions = await this.llmService.extractQuestionsWithAI(text, variables);
                if (questions) {
                    result.questions = new Map(Object.entries(questions));
                    const foundCount = Array.from(result.questions.values()).filter(q => q).length;
                    console.log(`[FORMULA-SOLVER-AI] ✅ Questions IA: ${foundCount}/${variables.length}`);
                    result.steps!.push(`✅ ${foundCount}/${variables.length} questions trouvées par IA`);
                }
            }

            // Étape 3: Recherche des réponses
            if (result.questions && result.questions.size > 0) {
                console.log('[FORMULA-SOLVER-AI] 🔍 ÉTAPE 3: Recherche réponses');
                result.steps!.push('🔍 Recherche des réponses avec IA...');

                const questionsObj: { [key: string]: string } = {};
                result.questions.forEach((value, key) => {
                    questionsObj[key] = value;
                });

                const answers = await this.llmService.searchAnswersWithAI(questionsObj, text.substring(0, 200));
                if (answers) {
                    result.answers = new Map(Object.entries(answers));
                    console.log('[FORMULA-SOLVER-AI] ✅ Réponses IA trouvées:', Array.from(result.answers.entries()));
                    result.steps!.push(`✅ ${result.answers.size} réponses trouvées par IA`);
                }
            }

            // Étape 4: Calcul des coordonnées
            if (result.formulas && result.answers && result.answers.size > 0) {
                console.log('[FORMULA-SOLVER-AI] 🧮 ÉTAPE 4: Calcul coordonnées');
                result.steps!.push('🧮 Calcul des coordonnées avec IA...');

                // Convertir les réponses en valeurs numériques (simplifié pour l'instant)
                const values: { [key: string]: number } = {};
                result.answers.forEach((answer, variable) => {
                    // Essayer de parser comme nombre, sinon utiliser la longueur de la chaîne
                    const numValue = parseFloat(answer) || answer.length;
                    values[variable] = numValue;
                });

                const coordinates = await this.llmService.calculateCoordinatesWithAI(formula, values);
                if (coordinates) {
                    result.coordinates = coordinates;
                    console.log('[FORMULA-SOLVER-AI] 🎯 Coordonnées finales:', coordinates);
                    result.steps!.push(`🎯 Coordonnées: ${coordinates.ddm}`);
                    result.status = 'success';
                } else {
                    result.steps!.push('❌ Échec calcul coordonnées');
                }
            }

            console.log('[FORMULA-SOLVER-AI] ✅ RÉSOLUTION IA TERMINÉE');
            return result;

        } catch (error: any) {
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            console.error('[FORMULA-SOLVER-AI] Erreur résolution IA:', error);
            return {
                status: 'error',
                error: message,
                steps: ['Erreur lors de la résolution IA']
            };
        }
    }

    /**
     * Vérifie si l'IA est disponible (Language Model Service)
     */
    async isAIAvailable(): Promise<boolean> {
        try {
            // Tester si on peut accéder au service LLM
            const available = !!this.llmService;
            console.log('[FORMULA-SOLVER-AI] Service LLM disponible:', available);
            return available;
        } catch (error) {
            console.error('[FORMULA-SOLVER-AI] Erreur vérification LLM:', error);
            return false;
        }
    }

    // ========================================================================
    // MÉTHODES PRIVÉES - UTILITAIRES
    // ========================================================================

    /**
     * Extrait les variables (lettres) d'une formule
     */
    private extractVariablesFromFormula(formula: any): string[] {
        const variables = new Set<string>();
        const formulaText = `${formula.north} ${formula.east}`;

        // Chercher tous les caractères alphabétiques majuscules
        const matches = formulaText.match(/[A-Z]/g);
        if (matches) {
            matches.forEach(letter => variables.add(letter));
        }

        return Array.from(variables).sort();
    }
}