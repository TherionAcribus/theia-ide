/**
 * Widget Formula Solver principal
 * Interface utilisateur React pour résoudre les formules de coordonnées
 */

import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct, optional } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { FormulaSolverService } from './formula-solver-service';
import { FormulaSolverAIService } from './formula-solver-ai-service';
import { Formula, Question, LetterValue, FormulaSolverState } from '../common/types';
import { parseValueList } from './utils/value-parser';
import { ensureFormulaFragments } from './utils/formula-fragments';
import {
    DetectedFormulasComponent,
    // QuestionFieldsComponent,
    ResultDisplayComponent,
    FormulaPreviewComponent
} from './components';

@injectable()
export class FormulaSolverWidget extends ReactWidget {

    static readonly ID = 'formula-solver:widget';
    static readonly LABEL = 'Formula Solver';

    @inject(FormulaSolverService)
    protected readonly formulaSolverService!: FormulaSolverService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    @inject(FormulaSolverAIService) @optional()
    protected readonly formulaSolverAIService?: FormulaSolverAIService;

    // État du widget
    protected state: FormulaSolverState = {
        currentStep: 'detect',
        formulas: [],
        questions: [],
        values: new Map<string, LetterValue>(),
        loading: false
    };

    // Méthode de résolution : 'algorithm' ou 'ai'
    protected resolutionMethod: 'algorithm' | 'ai' = 'algorithm';

    // Type de calcul global pour les valeurs
    protected globalValueType: 'value' | 'checksum' | 'reduced' | 'length' | 'custom' = 'value';

    // État brute force
    protected bruteForceMode: boolean = false;
    protected bruteForceResults: Array<{
        id: string;
        label: string;
        values: Record<string, number>;
        coordinates?: any;
    }> = [];

    protected detectionRequestId: number = 0;

    protected questionsRequestId: number = 0;

    @postConstruct()
    protected init(): void {
        this.id = FormulaSolverWidget.ID;
        this.title.label = FormulaSolverWidget.LABEL;
        this.title.caption = FormulaSolverWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-symbol-variable';

        // Les préférences seront chargées de manière asynchrone dans onAfterAttach
        this.update();
    }

    protected onAfterAttach(msg: unknown): void {
        super.onAfterAttach(msg as any);

        if (typeof window !== 'undefined') {
            window.addEventListener(
                'geoapp-map-remove-brute-force-point',
                this.handleExternalBruteForceRemoval as EventListener
            );
        }

        // Charger les préférences
        this.loadPreferences();
        this.update();
    }

    protected onBeforeDetach(msg: unknown): void {
        if (typeof window !== 'undefined') {
            window.removeEventListener(
                'geoapp-map-remove-brute-force-point',
                this.handleExternalBruteForceRemoval as EventListener
            );
        }

        super.onBeforeDetach(msg as any);
    }

    /**
     * Charge les préférences utilisateur
     */
    protected loadPreferences(): void {
        // Pour l'instant, garder la valeur par défaut (algorithm)
        // Les préférences peuvent être ajoutées plus tard si nécessaire
        this.resolutionMethod = 'algorithm';
    }

    /**
     * Charge le Formula Solver depuis une geocache
     */
    async loadFromGeocache(geocacheId: number): Promise<void> {
        console.log(`[FORMULA-SOLVER] Chargement depuis geocache ${geocacheId}`);
        
        try {
            this.detectionRequestId++;
            this.updateState({
                loading: true,
                error: undefined,
                currentStep: 'detect',
                geocacheId: undefined,
                gcCode: undefined,
                text: '',
                originLat: undefined,
                originLon: undefined,
                formulas: [],
                selectedFormula: undefined,
                questions: [],
                values: new Map<string, LetterValue>(),
                result: undefined
            });
            this.bruteForceMode = false;
            this.bruteForceResults = [];
            
            // Récupérer les données de la geocache
            const geocache = await this.formulaSolverService.getGeocache(geocacheId);
            
            console.log(`[FORMULA-SOLVER] Geocache ${geocache.gc_code} chargée`);
            
            // Mettre à jour l'état avec les données de la geocache
            this.updateState({
                geocacheId: geocache.id,
                gcCode: geocache.gc_code,
                text: geocache.description,
                originLat: geocache.latitude,
                originLon: geocache.longitude
            });
            
            // Détecter automatiquement les formules
            if (geocache.description) {
                await this.detectFormulasFromText(geocache.description);
            } else {
                this.updateState({ loading: false });
            }
            
            this.messageService.info(`Formula Solver chargé pour ${geocache.gc_code} - ${geocache.name}`);
            
        } catch (error) {
            console.error('[FORMULA-SOLVER] Erreur lors du chargement:', error);
            const errorMsg = error instanceof Error ? error.message : 'Erreur inconnue';
            this.updateState({ 
                error: `Erreur lors du chargement de la geocache: ${errorMsg}`,
                loading: false 
            });
            this.messageService.error(`Erreur: ${errorMsg}`);
        }
    }

    /**
     * Met à jour l'état et rafraîchit l'UI
     */
    protected updateState(updates: Partial<FormulaSolverState>): void {
        this.state = { ...this.state, ...updates };
        this.update();
    }

    /**
     * Génère les fragments pour chaque formule
     */
    protected annotateFormulas(formulas: Formula[]): Formula[] {
        return formulas.map(formula => {
            const cloned: Formula = { ...formula };
            ensureFormulaFragments(cloned);
            return cloned;
        });
    }

    /**
     * Affiche le résultat sur la carte via événement window
     */
    protected showOnMap(): void {
        if (!this.state.result || !this.state.result.coordinates) {
            this.messageService.error('Aucun résultat à afficher sur la carte');
            return;
        }

        try {
            // Préparer les informations pour le popup
            const formulaText = this.state.selectedFormula 
                ? `${this.state.selectedFormula.north} ${this.state.selectedFormula.east}`
                : 'Formule inconnue';
            
            const valueEntries: Array<[string, LetterValue]> = Array.from(this.state.values.entries());
            const valuesText = valueEntries
                .map(([letter, value]) => `${letter}=${value.value} (${value.rawValue})`)
                .join(', ');

            const coords = this.state.result.coordinates;
            const formattedCoords = `${coords.ddm}\n${coords.dms}\n${coords.decimal}`;

            // Construire la note détaillée
            const note = `Solution Formula Solver\n\nFormule: ${formulaText}\nValeurs: ${valuesText}\n\nCoordonnées:\n${formattedCoords}`;

            console.log('[FORMULA-SOLVER] Émission événement geoapp-map-highlight-coordinate', {
                lat: coords.latitude,
                lon: coords.longitude,
                formatted: coords.ddm
            });

            // Émettre événement pour la carte (compatible avec MapService de zones)
            window.dispatchEvent(new CustomEvent('geoapp-map-highlight-coordinate', {
                detail: {
                    gcCode: this.state.gcCode,
                    pluginName: 'Formula Solver',
                    coordinates: {
                        latitude: coords.latitude,
                        longitude: coords.longitude,
                        formatted: coords.ddm
                    },
                    waypointTitle: 'Solution formule',
                    waypointNote: note,
                    sourceResultText: formattedCoords,
                    replaceExisting: false
                }
            }));

            this.messageService.info('Coordonnées affichées sur la carte !');
            
        } catch (error) {
            console.error('[FORMULA-SOLVER] Erreur lors de l\'affichage sur la carte:', error);
            this.messageService.error('Erreur lors de l\'affichage sur la carte');
        }
    }

    /**
     * Crée un waypoint depuis le résultat
     * Utilise le système d'événements pour créer le waypoint (comme les plugins)
     */
    protected async createWaypoint(autoSave: boolean = false): Promise<void> {
        if (!this.state.geocacheId || !this.state.result || !this.state.result.coordinates) {
            this.messageService.error('Impossible de créer le waypoint : données manquantes');
            return;
        }

        try {
            const coords = this.state.result.coordinates;
            const note = this.buildWaypointNote(coords);

            this.dispatchWaypointCreation({
                coords,
                note,
                title: 'Solution formule',
                pluginName: 'Formula Solver',
                autoSave
            });

        } catch (error) {
            console.error('[FORMULA-SOLVER] Erreur lors de la préparation du waypoint:', error);
            const errorMsg = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur: ${errorMsg}`);
        }
    }

    protected createWaypointFromBrute(resultId: string, autoSave: boolean = false): void {
        if (!this.state.geocacheId) {
            this.messageService.error('Aucune géocache chargée, impossible de créer le waypoint');
            return;
        }

        const result = this.bruteForceResults.find(r => r.id === resultId);
        if (!result) {
            this.messageService.error('Résultat brute force introuvable');
            return;
        }

        if (!result.coordinates) {
            this.messageService.error('Ce résultat ne contient pas de coordonnées valides');
            return;
        }

        try {
            const note = this.buildWaypointNote(result.coordinates, result.values);

            this.dispatchWaypointCreation({
                coords: result.coordinates,
                note,
                title: result.label || 'Solution brute force',
                pluginName: 'Formula Solver (Brute Force)',
                autoSave
            });

        } catch (error) {
            console.error('[FORMULA-SOLVER] Erreur lors de la préparation du waypoint brute force:', error);
            const errorMsg = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur: ${errorMsg}`);
        }
    }

    private dispatchWaypointCreation(options: {
        coords: {
            latitude: number;
            longitude: number;
            ddm?: string;
            dms?: string;
            decimal?: string;
        };
        note: string;
        title: string;
        pluginName: string;
        autoSave: boolean;
    }): void {
        const { coords, note, title, pluginName, autoSave } = options;

        const gcCoords = this.formatGeocachingCoordinates(coords.latitude, coords.longitude);

        window.dispatchEvent(new CustomEvent('geoapp-plugin-add-waypoint', {
            detail: {
                gcCoords,
                pluginName,
                geocache: this.state.gcCode ? { gcCode: this.state.gcCode } : undefined,
                waypointTitle: title,
                waypointNote: note,
                sourceResultText: note,
                decimalLatitude: coords.latitude,
                decimalLongitude: coords.longitude,
                autoSave
            }
        }));

        if (autoSave) {
            this.messageService.info(`${title} validé automatiquement en waypoint`);
        } else {
            this.messageService.info(`${title}: formulaire de waypoint ouvert`);
        }
    }

    private buildWaypointNote(coords: { ddm?: string; dms?: string; decimal?: string }, valuesOverride?: Record<string, number>): string {
        const formulaText = this.state.selectedFormula
            ? `${this.state.selectedFormula.north} ${this.state.selectedFormula.east}`
            : 'Formule inconnue';

        let valuesText: string;
        if (valuesOverride) {
            const entries = Object.entries(valuesOverride)
                .map(([letter, value]) => `${letter}=${value}`)
                .join('\n');
            valuesText = entries || 'Aucune valeur';
        } else {
            const valueEntries: Array<[string, LetterValue]> = Array.from(this.state.values.entries());
            valuesText = valueEntries
                .map(([letter, value]) => `${letter}=${value.value} (${value.rawValue}, type: ${value.type})`)
                .join('\n');
        }

        const coordDetails = [coords.ddm, coords.dms, coords.decimal].filter(Boolean).join('\n');

        return `Solution Formula Solver\n\nFormule:\n${formulaText}\n\nValeurs:\n${valuesText}\n\nCoordonnées:\n${coordDetails}`;
    }

    /**
     * Convertit des coordonnées décimales au format Geocaching
     */
    private formatGeocachingCoordinates(lat: number, lon: number): string {
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';

        const absLat = Math.abs(lat);
        const absLon = Math.abs(lon);

        const latDeg = Math.floor(absLat);
        const latMin = (absLat - latDeg) * 60;

        const lonDeg = Math.floor(absLon);
        const lonMin = (absLon - lonDeg) * 60;

        return `${latDir} ${latDeg}° ${latMin.toFixed(3)} ${lonDir} ${String(lonDeg).padStart(3, '0')}° ${lonMin.toFixed(3)}`;
    }

    /**
     * Détecte les formules depuis un texte (selon la méthode choisie)
     */
    protected async detectFormulasFromText(text: string): Promise<void> {
        if (!text.trim()) {
            this.messageService.warn('Veuillez saisir un texte à analyser');
            return;
        }

        const requestId = ++this.detectionRequestId;
        this.bruteForceMode = false;
        this.bruteForceResults = [];

        // Router vers la bonne méthode selon le toggle
        console.log(`[FORMULA-SOLVER] 🎯 Méthode de résolution sélectionnée: ${this.resolutionMethod.toUpperCase()}`);

        if (this.resolutionMethod === 'ai') {
            console.log('[FORMULA-SOLVER] 🤖 Appel de la résolution IA');
            await this.solveWithAI(text, requestId);
        } else {
            console.log('[FORMULA-SOLVER] ⚙️ Appel de la résolution algorithmique');
            await this.detectFormulasWithAlgorithm(text, requestId);
        }
    }

    /**
     * Détecte les formules avec l'algorithme (méthode par défaut)
     */
    protected async detectFormulasWithAlgorithm(text: string, requestId: number): Promise<void> {
        this.updateState({
            loading: true,
            error: undefined,
            formulas: [],
            selectedFormula: undefined,
            questions: [],
            values: new Map<string, LetterValue>(),
            result: undefined
        });

        try {
            const formulas = await this.formulaSolverService.detectFormulas({ text });

            if (requestId !== this.detectionRequestId) {
                return;
            }
            
            if (formulas.length === 0) {
                this.messageService.info('Aucune formule détectée dans le texte');
                this.updateState({
                    loading: false,
                    formulas: [],
                    selectedFormula: undefined,
                    currentStep: 'detect',
                    questions: [],
                    values: new Map<string, LetterValue>(),
                    result: undefined
                });
            } else {
                const enrichedFormulas = this.annotateFormulas(formulas);
                this.messageService.info(`${formulas.length} formule(s) détectée(s)`);
                this.updateState({
                    loading: false,
                    formulas: enrichedFormulas,
                    selectedFormula: enrichedFormulas[0],
                    currentStep: 'questions',
                    questions: [],
                    values: new Map<string, LetterValue>(),
                    result: undefined
                });

                console.log('[FORMULA-SOLVER] Extraction automatique des questions (algorithm)');
                await this.extractQuestions(enrichedFormulas[0]);
            }
        } catch (error) {
            if (requestId !== this.detectionRequestId) {
                return;
            }
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur : ${message}`);
            this.updateState({ loading: false, error: message });
        }
    }

    /**
     * Résout une formule avec l'IA
     */
    protected async solveWithAI(text: string, requestId: number): Promise<void> {
        if (!this.formulaSolverAIService) {
            this.messageService.error('Service IA non disponible. Vérifiez la configuration.');
            this.resolutionMethod = 'algorithm';
            this.update();
            return;
        }

        this.updateState({
            loading: true,
            error: undefined,
            formulas: [],
            selectedFormula: undefined,
            questions: [],
            values: new Map<string, LetterValue>(),
            result: undefined
        });
        this.messageService.info('🤖 Résolution par IA en cours...');

        try {
            // Vérifier que l'IA est disponible
            const available = await this.formulaSolverAIService.isAIAvailable();
            if (!available) {
                throw new Error('L\'agent Formula Solver n\'est pas disponible. Vérifiez la configuration de l\'IA dans les paramètres.');
            }

            // Appeler l'agent IA
            const result = await this.formulaSolverAIService.solveWithAI(text, this.state.geocacheId);

            if (requestId !== this.detectionRequestId) {
                return;
            }

            console.log('[FORMULA-SOLVER] Résultat IA:', result);

            if (result.status === 'error') {
                throw new Error(result.error || 'Erreur inconnue lors de la résolution IA');
            }

            // Traiter les résultats
            if (result.formulas && result.formulas.length > 0) {
                const enrichedFormulas = this.annotateFormulas(result.formulas);
                result.formulas = enrichedFormulas;
                this.updateState({
                    formulas: enrichedFormulas,
                    selectedFormula: enrichedFormulas[0],
                    currentStep: 'questions',
                    questions: [],
                    values: new Map<string, LetterValue>(),
                    result: undefined
                });
            }

            if (result.questions && result.questions.size > 0) {
                const letters = Array.from(result.questions.keys());
                const questions: Question[] = letters.map(letter => ({
                    letter,
                    question: result.questions!.get(letter) || ''
                }));
                this.updateState({ questions });
            }

            // Traiter les réponses trouvées par l'IA et les convertir en valeurs automatiquement
            if (result.answers && result.answers.size > 0) {
                console.log('[FORMULA-SOLVER] 🤖 Réponses IA détectées, remplissage automatique des champs...');

                // Pour chaque réponse IA, utiliser le type global actuel
                result.answers.forEach((answer, letter) => {
                    // Utiliser le type global pour appliquer le bon calcul
                    this.updateValue(letter, answer.toString(), this.globalValueType);
                });

                console.log('[FORMULA-SOLVER] ✅ Réponses IA automatiquement remplies dans les champs avec calcul selon type');

                // Après avoir rempli les champs IA, déclencher un recalcul pour s'assurer
                // que les valeurs suivent bien les types sélectionnés
                setTimeout(() => {
                    this.tryAutoCalculateOrBruteForce();
                }, 100);
            }

            if (result.values && result.values.size > 0) {
                const values = new Map<string, LetterValue>();
                result.values.forEach((value: number, letter: string) => {
                    values.set(letter, {
                        letter,
                        rawValue: value.toString(),
                        value,
                        type: 'value'
                    });
                });
                this.updateState({ values });
            }

            if (result.coordinates) {
                this.updateState({
                    result: {
                        status: 'success',
                        coordinates: result.coordinates
                    }
                });
            }

            const stepsMessage = result.steps ? `\n\nÉtapes:\n${result.steps.join('\n')}` : '';

            // Message spécial si des réponses ont été automatiquement remplies
            const answersCount = result.answers ? result.answers.size : 0;
            const answersMessage = answersCount > 0 ? `\n\n💡 ${answersCount} réponse(s) automatiquement remplie(s) dans les champs !` : '';

            this.messageService.info(`✅ Résolution IA terminée !${answersMessage}${stepsMessage}`);
            
            this.updateState({ loading: false });

        } catch (error) {
            if (requestId !== this.detectionRequestId) {
                return;
            }
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            console.error('[FORMULA-SOLVER] Erreur résolution IA:', error);
            this.messageService.error(`Erreur IA : ${message}`);
            this.updateState({ loading: false, error: message });
        }
    }

    /**
     * Modifie manuellement une formule détectée
     */
    protected handleEditFormula(formula: Formula, updatedNorth: string, updatedEast: string): void {
        // Mise à jour de la formule dans la liste
        const updatedFormulasRaw = this.state.formulas.map((f: Formula) => {
            if (f.id === formula.id) {
                return {
                    ...f,
                    north: updatedNorth,
                    east: updatedEast,
                    text_output: `${updatedNorth} ${updatedEast}`,
                    confidence: 1.0 // Formule manuellement corrigée = confiance maximale
                };
            }
            return f;
        });

        const updatedFormulas = this.annotateFormulas(updatedFormulasRaw);

        // Si c'est la formule sélectionnée, la mettre à jour aussi
        const updatedSelectedFormula = this.state.selectedFormula?.id === formula.id
            ? updatedFormulas.find(f => f.id === formula.id)
            : this.state.selectedFormula;

        this.updateState({
            formulas: updatedFormulas,
            selectedFormula: updatedSelectedFormula,
            // Réinitialiser les questions car la formule a changé
            questions: [],
            values: new Map()
        });

        this.messageService.info('Formule modifiée avec succès');
    }

    /**
     * Extrait les questions pour une formule
     */
    protected async extractQuestions(formula: Formula): Promise<void> {
        const requestId = ++this.questionsRequestId;
        console.log('[FORMULA-SOLVER] extractQuestions (regex) start', {
            requestId,
            letters: this.extractLettersFromFormula(formula),
            geocacheId: this.state.geocacheId,
            gcCode: this.state.gcCode
        });

        this.updateState({
            loading: true,
            error: undefined,
            questions: [],
            values: new Map<string, LetterValue>(),
            result: undefined
        });

        try {
            // Extraire les lettres de la formule
            const letters = this.extractLettersFromFormula(formula);
            
            if (letters.length === 0) {
                this.messageService.warn('Aucune variable détectée dans la formule');
                this.updateState({ loading: false });
                return;
            }

            // Extraire les questions
            const questionsMap = await this.formulaSolverService.extractQuestions({
                text: this.state.text || '',
                letters,
                method: 'regex'
            });

            if (requestId !== this.questionsRequestId) {
                return;
            }

            // Convertir en tableau de Questions
            const questions: Question[] = letters.map(letter => ({
                letter,
                question: questionsMap.get(letter) || ''
            }));

            this.messageService.info(`Questions extraites pour ${letters.length} variable(s)`);
            this.updateState({
                loading: false,
                questions,
                currentStep: 'values'
            });
        } catch (error) {
            if (requestId !== this.questionsRequestId) {
                return;
            }
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur : ${message}`);
            this.updateState({ loading: false, error: message });
        }
    }

    /**
     * Tente un calcul automatique si toutes les lettres sont remplies
     */
    protected tryAutoCalculate(): void {
        if (!this.state.selectedFormula) {
            return;
        }

        // Vérifier que toutes les valeurs sont renseignées
        const letters = this.extractLettersFromFormula(this.state.selectedFormula);
        const missingValues = letters.filter(letter => !this.state.values.has(letter));
        
        if (missingValues.length === 0) {
            // Toutes les lettres sont remplies, calculer automatiquement
            console.log('[FORMULA-SOLVER] Toutes les lettres sont remplies, calcul automatique...');
            this.calculateCoordinates();
        }
    }

    /**
     * Calcule les coordonnées finales
     */
    protected async calculateCoordinates(): Promise<void> {
        if (!this.state.selectedFormula) {
            return;
        }

        // Vérifier que toutes les valeurs sont renseignées
        const letters = this.extractLettersFromFormula(this.state.selectedFormula);
        const missingValues = letters.filter(letter => !this.state.values.has(letter));
        
        if (missingValues.length > 0) {
            // Mode silencieux : ne pas afficher de warning, c'est normal en cours de saisie
            return;
        }

        this.updateState({ loading: true, error: undefined });

        try {
            // Construire l'objet values
            const values: Record<string, number> = {};
        this.state.values.forEach((letterValue: LetterValue, letter: string) => {
            values[letter] = letterValue.value;
        });

            // Appeler l'API
            const result = await this.formulaSolverService.calculateCoordinates({
                northFormula: this.state.selectedFormula.north,
                eastFormula: this.state.selectedFormula.east,
                values
            });

            if (result.status === 'success') {
                this.messageService.info('Coordonnées calculées avec succès !');
                this.updateState({
                    loading: false,
                    result,
                    currentStep: 'calculate'
                });
                
                // Afficher automatiquement le point sur la carte
                this.showOnMap();
            } else {
                throw new Error(result.error || 'Erreur lors du calcul');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur : ${message}`);
        }
    }

    /**
     * Exécute le brute force automatiquement depuis les champs remplis
     */
    protected async executeBruteForceFromFields(): Promise<void> {
        if (!this.state.selectedFormula) {
            this.messageService.error('Aucune formule sélectionnée');
            return;
        }

        // Générer les combinaisons depuis les valeurs des champs
        const letterValuesMap: Record<string, number[]> = {};
        
        for (const [letter, letterValue] of this.state.values.entries()) {
            if (letterValue.values && letterValue.values.length > 0) {
                // Utiliser la liste de valeurs
                letterValuesMap[letter] = letterValue.values;
            } else if (letterValue.value !== undefined && !isNaN(letterValue.value)) {
                // Utiliser la valeur unique
                letterValuesMap[letter] = [letterValue.value];
            }
        }

        const combinations = this.generateCombinations(letterValuesMap);
        
        if (combinations.length === 0) {
            this.messageService.warn('Aucune combinaison à tester');
            return;
        }

        if (combinations.length > 1000) {
            this.messageService.warn(`${combinations.length} combinaisons détectées. Limité à 1000 pour éviter les calculs trop longs.`);
            combinations.splice(1000);
        }

        this.bruteForceMode = true;
        this.bruteForceResults = [];
        this.updateState({ loading: true, error: undefined });

        this.messageService.info(`Calcul de ${combinations.length} combinaisons...`);

        try {
            const results: Array<{ id: string; label: string; values: Record<string, number>; coordinates?: any }> = [];

            // Calculer chaque combinaison
            for (const combination of combinations) {
                try {
                    const result = await this.formulaSolverService.calculateCoordinates({
                        northFormula: this.state.selectedFormula.north,
                        eastFormula: this.state.selectedFormula.east,
                        values: combination
                    });

                    if (result.status === 'success' && result.coordinates) {
                        // Générer un ID unique basé sur les valeurs
                        const id = Object.entries(combination)
                            .map(([k, v]) => `${k}${v}`)
                            .join('-');
                        
                        const label = `Solution ${results.length + 1}`;

                        results.push({
                            id,
                            label,
                            values: combination,
                            coordinates: result.coordinates
                        });
                    }
                } catch (error) {
                    // Ignorer les erreurs de calcul individuelles
                    console.warn('[FORMULA-SOLVER] Erreur pour combinaison', combination, error);
                }
            }

            this.bruteForceResults = results;
            this.updateState({ loading: false });

            // Afficher tous les points sur la carte (uniquement ceux avec coordonnées)
            const validResults = results.filter((r): r is { id: string; label: string; values: Record<string, number>; coordinates: any } => 
                r.coordinates !== undefined
            );
            this.showAllResultsOnMap(validResults);

            this.messageService.info(
                `${results.length} résultat${results.length > 1 ? 's' : ''} calculé${results.length > 1 ? 's' : ''} avec succès !`
            );

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur brute force : ${message}`);
            this.updateState({ loading: false, error: message });
        }
    }

    /**
     * Génère toutes les combinaisons possibles à partir d'un mapping de valeurs
     */
    protected generateCombinations(letterValuesMap: Record<string, number[]>): Record<string, number>[] {
        const letters = Object.keys(letterValuesMap);
        
        if (letters.length === 0) {
            return [];
        }

        const combinations: Record<string, number>[] = [];
        
        const generate = (index: number, current: Record<string, number>) => {
            if (index === letters.length) {
                combinations.push({ ...current });
                return;
            }

            const letter = letters[index];
            const values = letterValuesMap[letter];

            for (const value of values) {
                current[letter] = value;
                generate(index + 1, current);
            }
        };

        generate(0, {});
        return combinations;
    }

    /**
     * Supprime un résultat brute force spécifique
     */
    protected removeBruteForceResult(resultId: string): void {
        console.log('[FORMULA-SOLVER] Suppression du résultat', resultId);
        
        // Retirer du tableau
        this.bruteForceResults = this.bruteForceResults.filter(r => r.id !== resultId);
        
        // Émettre l'événement de suppression pour synchroniser la carte
        window.dispatchEvent(new CustomEvent('geoapp-map-remove-brute-force-point', {
            detail: { bruteForceId: resultId }
        }));
        
        if (this.bruteForceResults.length === 0) {
            // Plus de résultats, quitter le mode brute force
            this.bruteForceMode = false;
            window.dispatchEvent(new CustomEvent('geoapp-map-highlight-clear'));
        }
        
        this.update();
        this.messageService.info('Résultat supprimé');
    }

    private handleExternalBruteForceRemoval = (event: Event): void => {
        if (!this.bruteForceMode || this.bruteForceResults.length === 0) {
            return;
        }

        const customEvent = event as CustomEvent<{ bruteForceId?: string }>;
        const bruteForceId = customEvent.detail?.bruteForceId;

        if (!bruteForceId) {
            return;
        }

        if (!this.bruteForceResults.some(result => result.id === bruteForceId)) {
            return;
        }

        console.log('[FORMULA-SOLVER] Résultat supprimé depuis la carte', bruteForceId);
        this.bruteForceResults = this.bruteForceResults.filter(result => result.id !== bruteForceId);

        if (this.bruteForceResults.length === 0) {
            this.bruteForceMode = false;
        }

        this.update();
        this.messageService.info('Résultat supprimé depuis la carte');
    };

    /**
     * Affiche tous les résultats du brute force sur la carte
     */
    protected showAllResultsOnMap(results: Array<{ id: string; label: string; values: Record<string, number>; coordinates: any }>): void {
        console.log('[FORMULA-SOLVER] Affichage de', results.length, 'résultats sur la carte');

        // Effacer les points précédents
        window.dispatchEvent(new CustomEvent('geoapp-map-highlight-clear'));

        // Ajouter chaque point
        results.forEach(result => {
            const coords = result.coordinates;
            const valuesText = Object.entries(result.values)
                .map(([letter, value]) => `${letter}=${value}`)
                .join(', ');

            window.dispatchEvent(new CustomEvent('geoapp-map-highlight-coordinate', {
                detail: {
                    gcCode: this.state.gcCode,
                    pluginName: 'Formula Solver (Brute Force)',
                    coordinates: {
                        latitude: coords.latitude,
                        longitude: coords.longitude,
                        formatted: coords.ddm
                    },
                    waypointTitle: result.label,
                    waypointNote: `Valeurs: ${valuesText}\n\nCoordonnées:\n${coords.ddm}`,
                    sourceResultText: coords.ddm,
                    replaceExisting: false, // Ajouter sans remplacer
                    bruteForceId: result.id // ID pour la suppression
                }
            }));
        });
    }

    /**
     * Extrait les lettres (variables) d'une formule
     * Ignore uniquement les lettres cardinales (N, S, E, W) en début de coordonnées
     */
    protected extractLettersFromFormula(formula: Formula): string[] {
        // Supprimer les directions cardinales au début de chaque partie
        // Ex: "N 48°AB.CDE" -> "48°AB.CDE", "E 007°FG.HIJ" -> "007°FG.HIJ"
        const northCleaned = formula.north.replace(/^[NSEW]\s*/i, '');
        const eastCleaned = formula.east.replace(/^[NSEW]\s*/i, '');
        const text = `${northCleaned} ${eastCleaned}`;
        
        const letters = new Set<string>();
        
        // Extraire toutes les lettres A-Z maintenant que les directions sont retirées
        const matches = text.matchAll(/([A-Z])/g);
        for (const match of matches) {
            letters.add(match[1]);
        }
        
        console.log('[FORMULA-SOLVER] Lettres extraites:', {
            north: formula.north,
            east: formula.east,
            northCleaned,
            eastCleaned,
            letters: Array.from(letters).sort()
        });
        
        return Array.from(letters).sort();
    }

    /**
     * Met à jour la valeur d'une variable
     */
    protected updateValue(letter: string, rawValue: string, type: 'value' | 'checksum' | 'reduced' | 'length' | 'custom'): void {
        console.log(`[FORMULA-SOLVER] updateValue: ${letter} = "${rawValue}" (type: ${type})`);

        // Parser la valeur pour détecter les listes (ex: "2,3,4" ou "1-5")
        const parsed = parseValueList(rawValue);
        console.log(`[FORMULA-SOLVER] Parsed values:`, parsed.values);

        // Calculer la valeur pour le premier élément (ou appliquer le calcul sur la chaîne brute)
        let calculatedValue: number = 0;
        let calculatedValues: number[] = [];

        if (parsed.values.length > 0) {
            // Il y a des valeurs numériques parsées (nombres ou listes)
            console.log(`[FORMULA-SOLVER] Using parsed numeric values`);
            for (const val of parsed.values) {
                let calculated: number;
                const strVal = val.toString();

                switch (type) {
                    case 'checksum':
                        calculated = this.formulaSolverService.calculateChecksum(strVal);
                        break;
                    case 'reduced':
                        calculated = this.formulaSolverService.calculateReducedChecksum(strVal);
                        break;
                    case 'length':
                        calculated = this.formulaSolverService.calculateLength(strVal);
                        break;
                    case 'custom':
                    case 'value':
                    default:
                        calculated = val;
                        break;
                }

                calculatedValues.push(calculated);
            }

            calculatedValue = calculatedValues[0];
        } else if (rawValue.trim() && (type === 'checksum' || type === 'reduced' || type === 'length')) {
            // Pas de valeurs numériques parsées, mais on a du texte et un type qui travaille sur du texte
            console.log(`[FORMULA-SOLVER] Applying ${type} calculation on raw text: "${rawValue}"`);

            switch (type) {
                case 'checksum':
                    calculatedValue = this.formulaSolverService.calculateChecksum(rawValue.trim());
                    break;
                case 'reduced':
                    calculatedValue = this.formulaSolverService.calculateReducedChecksum(rawValue.trim());
                    break;
                case 'length':
                    calculatedValue = this.formulaSolverService.calculateLength(rawValue.trim());
                    break;
                default:
                    calculatedValue = 0;
                    break;
            }

            calculatedValues = [calculatedValue];
        } else {
            // Valeur vide ou type 'value' sans contenu parsable
            console.log(`[FORMULA-SOLVER] No calculation applied`);
            calculatedValue = 0;
            calculatedValues = [];
        }

        console.log(`[FORMULA-SOLVER] Final calculated value: ${calculatedValue}`);

        const letterValue: LetterValue = {
            letter,
            rawValue,
            value: calculatedValue,
            type,
            values: calculatedValues.length > 0 ? calculatedValues : undefined,
            isList: parsed.isList
        };

        this.state.values.set(letter, letterValue);
        this.update();
        
        // Déclencher le calcul automatique ou brute force si applicable
        this.tryAutoCalculateOrBruteForce();
    }

    /**
     * Tente un calcul automatique simple ou lance le brute force si des listes sont détectées
     */
    protected tryAutoCalculateOrBruteForce(): void {
        // Vérifier si tous les champs sont remplis
        const allFilled = this.state.questions.every((q: Question) => {
            const val = this.state.values.get(q.letter);
            return val && val.rawValue.trim() !== '';
        });
        
        if (!allFilled) {
            return;
        }
        
        // Vérifier si au moins un champ contient une liste
        const hasLists = Array.from(this.state.values.values()).some((v: LetterValue) => !!v.isList);
        
        if (hasLists) {
            // Brute force automatique
            console.log('[FORMULA-SOLVER] Listes détectées, déclenchement automatique du brute force');
            this.executeBruteForceFromFields();
        } else {
            // Calcul simple
            this.tryAutoCalculate();
        }
    }

    /**
     * Render du composant React
     */
    protected render(): React.ReactNode {
        return (
            <div className='formula-solver-container' style={{ padding: '20px', height: '100%', overflow: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ marginTop: 0, marginBottom: 0 }}>Formula Solver</h2>
                    
                    {/* Toggle Algorithme / IA */}
                    {this.renderMethodToggle()}
                </div>
                
                {/* Étape 1 : Détection de formule */}
                {this.renderDetectionStep()}
                
                {/* Étape 2 : Questions et valeurs */}
                {this.state.currentStep !== 'detect' && this.renderQuestionsStep()}
                
                {/* Étape 3 : Calcul automatique des coordonnées */}
                {this.state.questions.length > 0 && this.renderCalculateStep()}
                
                {/* État de chargement */}
                {this.state.loading && (
                    <div style={{ textAlign: 'center', marginTop: '20px' }}>
                        <span className='theia-animation-spin codicon codicon-loading'></span>
                        <span style={{ marginLeft: '10px' }}>Chargement...</span>
                    </div>
                )}
                
                {/* Message d'erreur */}
                {this.state.error && (
                    <div style={{ color: 'var(--theia-errorForeground)', marginTop: '10px', padding: '10px', backgroundColor: 'var(--theia-inputValidation-errorBackground)' }}>
                        ⚠️ {this.state.error}
                    </div>
                )}
            </div>
        );
    }

    /**
     * Render du toggle de méthode de résolution
     */
    protected renderMethodToggle(): React.ReactNode {
        const isAI = this.resolutionMethod === 'ai';
        const hasAIService = !!this.formulaSolverAIService;

        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12px', opacity: 0.8 }}>Méthode:</span>
                <div 
                    style={{
                        display: 'flex',
                        backgroundColor: 'var(--theia-input-background)',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: '4px',
                        overflow: 'hidden'
                    }}
                >
                    <button
                        style={{
                            padding: '6px 12px',
                            border: 'none',
                            backgroundColor: !isAI ? 'var(--theia-button-background)' : 'transparent',
                            color: !isAI ? 'var(--theia-button-foreground)' : 'var(--theia-foreground)',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: !isAI ? 'bold' : 'normal',
                            transition: 'all 0.2s'
                        }}
                        onClick={() => {
                            this.resolutionMethod = 'algorithm';
                            this.update();
                        }}
                        title="Utilise l'algorithme de détection classique"
                    >
                        Algorithme
                    </button>
                    <button
                        style={{
                            padding: '6px 12px',
                            border: 'none',
                            backgroundColor: isAI ? 'var(--theia-button-background)' : 'transparent',
                            color: isAI ? 'var(--theia-button-foreground)' : 'var(--theia-foreground)',
                            cursor: hasAIService ? 'pointer' : 'not-allowed',
                            fontSize: '12px',
                            fontWeight: isAI ? 'bold' : 'normal',
                            opacity: hasAIService ? 1 : 0.5,
                            transition: 'all 0.2s'
                        }}
                        onClick={() => {
                            if (hasAIService) {
                                this.resolutionMethod = 'ai';
                                this.update();
                            } else {
                                this.messageService.warn('Service IA non disponible. Vérifiez la configuration.');
                            }
                        }}
                        disabled={!hasAIService}
                        title={hasAIService ? "Utilise l'agent IA pour résoudre la formule" : "Service IA non disponible"}
                    >
                        IA 🤖
                    </button>
                </div>
            </div>
        );
    }

    protected renderDetectionStep(): React.ReactNode {
        return (
            <div className='detection-step' style={{ marginBottom: '20px' }}>
                <h3>1. Détecter la formule</h3>
                <textarea
                    placeholder='Collez ici la description de la géocache ou la formule directement...'
                    style={{
                        width: '100%',
                        minHeight: '100px',
                        padding: '10px',
                        fontFamily: 'monospace',
                        backgroundColor: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: '4px'
                    }}
                    onChange={e => this.updateState({ text: e.target.value })}
                    value={this.state.text || ''}
                />
                <button
                    style={{
                        marginTop: '10px',
                        padding: '8px 16px',
                        backgroundColor: 'var(--theia-button-background)',
                        color: 'var(--theia-button-foreground)',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                    }}
                    onClick={() => this.detectFormulasFromText(this.state.text || '')}
                    disabled={this.state.loading}
                >
                    Détecter la formule
                </button>
                
                {/* Formules détectées avec le nouveau composant */}
                {this.state.formulas.length > 0 && (
                    <DetectedFormulasComponent
                        formulas={this.state.formulas}
                        selectedFormula={this.state.selectedFormula}
                        onSelect={(formula) => {
                            this.updateState({
                                selectedFormula: formula,
                                questions: [],
                                values: new Map<string, LetterValue>(),
                                result: undefined,
                                currentStep: 'questions'
                            });
                            void this.extractQuestions(formula);
                        }}
                        onEditFormula={(formula, north, east) => this.handleEditFormula(formula, north, east)}
                        loading={this.state.loading}
                    />
                )}
            </div>
        );
    }

    protected renderQuestionsStep(): React.ReactNode {
        if (!this.state.selectedFormula) return null;

        return (
            <div className='questions-step' style={{ marginBottom: '20px' }}>
                <h3>2. Questions pour les variables</h3>
                
                <div style={{
                    padding: '20px',
                    backgroundColor: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '4px',
                    marginBottom: '20px'
                }}>
                    <h3 style={{ marginTop: 0 }}>2. Questions pour les variables</h3>

                    {this.state.questions.length === 0 ? (
                        <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                            Aucune question trouvée. Lancez la détection pour extraire les questions.
                        </div>
                    ) : (
                        <div>
                            <div style={{ marginBottom: '10px', fontSize: '14px' }}>
                                {this.state.questions.length} variable{this.state.questions.length > 1 ? 's' : ''} détectée{this.state.questions.length > 1 ? 's' : ''}
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {this.state.questions.map(question => {
                                    const value = this.state.values.get(question.letter);
                                    const hasValue = value && value.rawValue.trim() !== '';

                                    return (
                                        <div key={question.letter} style={{
                                            padding: '12px',
                                            backgroundColor: hasValue ? 'var(--theia-list-hoverBackground)' : 'var(--theia-input-background)',
                                            border: hasValue ? '1px solid var(--theia-focusBorder)' : '1px solid var(--theia-input-border)',
                                            borderRadius: '4px'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                                <div style={{
                                                    width: '30px',
                                                    height: '30px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    backgroundColor: hasValue ? 'var(--theia-button-background)' : 'var(--theia-input-background)',
                                                    color: hasValue ? 'var(--theia-button-foreground)' : 'var(--theia-foreground)',
                                                    borderRadius: '4px',
                                                    fontWeight: 'bold',
                                                    fontSize: '16px'
                                                }}>
                                                    {question.letter}
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <strong>{question.question || 'Question inconnue'}</strong>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <input
                                                    type="text"
                                                    placeholder="Valeur"
                                                    value={value?.rawValue || ''}
                                                    onChange={e => this.updateValue(question.letter, e.target.value, value?.type || 'value')}
                                                    style={{
                                                        flex: 1,
                                                        padding: '6px 10px',
                                                        border: '1px solid var(--theia-input-border)',
                                                        borderRadius: '3px',
                                                        backgroundColor: 'var(--theia-input-background)',
                                                        color: 'var(--theia-input-foreground)'
                                                    }}
                                                />

                                                <select
                                                    value={value?.type || 'value'}
                                                    onChange={e => this.updateValue(question.letter, value?.rawValue || '', e.target.value as any)}
                                                    style={{
                                                        padding: '6px 8px',
                                                        border: '1px solid var(--theia-dropdown-border)',
                                                        borderRadius: '3px',
                                                        backgroundColor: 'var(--theia-dropdown-background)',
                                                        color: 'var(--theia-dropdown-foreground)'
                                                    }}
                                                >
                                                    <option value="value">Valeur</option>
                                                    <option value="checksum">Checksum</option>
                                                    <option value="reduced">Checksum réduit</option>
                                                    <option value="length">Longueur</option>
                                                </select>

                                                <div style={{ minWidth: '60px', textAlign: 'right', fontWeight: 'bold' }}>
                                                    = {value?.value || '-'}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    protected renderCalculateStep(): React.ReactNode {
        if (!this.state.selectedFormula) return null;

        return (
            <div className='calculate-step' style={{ marginBottom: '20px' }}>
                <h3>3. Calcul des coordonnées</h3>
                
                {/* Prévisualisation en temps réel avec calcul automatique */}
                <FormulaPreviewComponent
                    formula={this.state.selectedFormula}
                    values={this.state.values}
                    onPartialCalculate={(part, result) => {
                        console.log(`[FORMULA-SOLVER] Partie ${part} calculée automatiquement:`, result);
                        // Vérifier si les deux parties sont complètes pour calculer automatiquement
                        this.tryAutoCalculate();
                    }}
                />
                
                {/* Résultat du calcul normal */}
                {!this.bruteForceMode && this.state.result && this.state.result.status === 'success' && (
                    <ResultDisplayComponent
                        result={this.state.result}
                        onCopy={(text) => this.messageService.info(`Copié: ${text}`)}
                        onCreateWaypoint={this.state.geocacheId ? () => this.createWaypoint(false) : undefined}
                        onAutoSaveWaypoint={this.state.geocacheId ? () => this.createWaypoint(true) : undefined}
                        onProjectOnMap={() => this.showOnMap()}
                    />
                )}
                
                {/* Résultats du brute force */}
                {this.bruteForceMode && this.bruteForceResults.length > 0 && (
                    <div style={{
                        marginTop: '20px',
                        padding: '16px',
                        backgroundColor: 'var(--theia-editor-background)',
                        border: '1px solid var(--theia-panel-border)',
                        borderRadius: '6px'
                    }}>
                        <h4 style={{ margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="codicon codicon-checklist" />
                            Résultats Brute Force ({this.bruteForceResults.length})
                        </h4>
                        <div style={{ 
                            maxHeight: '400px', 
                            overflowY: 'auto',
                            fontSize: '12px'
                        }}>
                            {this.bruteForceResults.map((result) => {
                                const hasCoordinates = Boolean(result.coordinates);
                                return (
                                    <div key={result.id} style={{
                                        padding: '8px',
                                        marginBottom: '8px',
                                        backgroundColor: 'var(--theia-input-background)',
                                        borderRadius: '4px',
                                        borderLeft: '3px solid var(--theia-successText)',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'flex-start',
                                        gap: '12px'
                                    }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                                                {result.label}
                                            </div>
                                            <div style={{ fontFamily: 'var(--theia-code-font-family)' }}>
                                                Valeurs: {Object.entries(result.values)
                                                    .map(([letter, value]) => `${letter}=${value}`)
                                                    .join(', ')}
                                            </div>
                                            <div style={{ fontFamily: 'var(--theia-code-font-family)', color: 'var(--theia-descriptionForeground)' }}>
                                                {result.coordinates?.ddm || '—'}
                                            </div>
                                        </div>
                                        <div style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '6px',
                                            alignItems: 'flex-end'
                                        }}>
                                            <button
                                                className='theia-button'
                                                style={{
                                                    padding: '6px 10px',
                                                    fontSize: '11px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}
                                                disabled={!hasCoordinates}
                                                title={hasCoordinates ? 'Ouvrir le formulaire de waypoint prérempli' : 'Aucune coordonnée pour ce résultat'}
                                                onClick={() => hasCoordinates && this.createWaypointFromBrute(result.id, false)}
                                            >
                                                <span className='codicon codicon-add' />
                                                Créer waypoint
                                            </button>
                                            <button
                                                className='theia-button'
                                                style={{
                                                    padding: '6px 10px',
                                                    fontSize: '11px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}
                                                disabled={!hasCoordinates}
                                                title={hasCoordinates ? 'Créer et valider immédiatement le waypoint' : 'Aucune coordonnée pour ce résultat'}
                                                onClick={() => hasCoordinates && this.createWaypointFromBrute(result.id, true)}
                                            >
                                                <span className='codicon codicon-pass-filled' />
                                                Ajouter & valider
                                            </button>
                                            <button
                                                onClick={() => this.removeBruteForceResult(result.id)}
                                                title="Supprimer cette solution"
                                                style={{
                                                    padding: '4px 8px',
                                                    backgroundColor: 'transparent',
                                                    color: 'var(--theia-errorForeground)',
                                                    border: '1px solid var(--theia-errorForeground)',
                                                    borderRadius: '3px',
                                                    cursor: 'pointer',
                                                    fontSize: '11px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.backgroundColor = 'var(--theia-errorForeground)';
                                                    e.currentTarget.style.color = 'var(--theia-editor-background)';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.backgroundColor = 'transparent';
                                                    e.currentTarget.style.color = 'var(--theia-errorForeground)';
                                                }}
                                            >
                                                <span className="codicon codicon-trash" />
                                                Supprimer
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <button
                            onClick={() => {
                                this.bruteForceMode = false;
                                this.bruteForceResults = [];
                                window.dispatchEvent(new CustomEvent('geoapp-map-highlight-clear'));
                                this.update();
                            }}
                            style={{
                                marginTop: '12px',
                                padding: '8px 16px',
                                backgroundColor: 'var(--theia-button-secondaryBackground)',
                                color: 'var(--theia-button-secondaryForeground)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px'
                            }}
                        >
                            Effacer les résultats
                        </button>
                    </div>
                )}
            </div>
        );
    }

}
