/**
 * Widget Formula Solver principal
 * Interface utilisateur React pour résoudre les formules de coordonnées
 */

import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FormulaSolverService } from './formula-solver-service';
import { Formula, Question, LetterValue, FormulaSolverState } from '../common/types';
import {
    DetectedFormulasComponent,
    QuestionFieldsComponent,
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

    // État du widget
    protected state: FormulaSolverState = {
        currentStep: 'detect',
        formulas: [],
        questions: [],
        values: new Map(),
        loading: false
    };

    @postConstruct()
    protected init(): void {
        this.id = FormulaSolverWidget.ID;
        this.title.label = FormulaSolverWidget.LABEL;
        this.title.caption = FormulaSolverWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-symbol-variable';
        
        this.update();
    }

    /**
     * Charge le Formula Solver depuis une geocache
     */
    async loadFromGeocache(geocacheId: number): Promise<void> {
        console.log(`[FORMULA-SOLVER] Chargement depuis geocache ${geocacheId}`);
        
        try {
            this.updateState({ loading: true, error: undefined });
            
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
            
            const valuesText = Array.from(this.state.values.entries())
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
     */
    protected async createWaypoint(): Promise<void> {
        if (!this.state.geocacheId || !this.state.result || !this.state.result.coordinates) {
            this.messageService.error('Impossible de créer le waypoint : données manquantes');
            return;
        }

        try {
            // Préparer la note avec la formule et les valeurs
            const formulaText = this.state.selectedFormula 
                ? `${this.state.selectedFormula.north} ${this.state.selectedFormula.east}`
                : 'Formule inconnue';
            
            const valuesText = Array.from(this.state.values.entries())
                .map(([letter, value]) => `${letter}=${value.value} (${value.rawValue}, type: ${value.type})`)
                .join('\n');
            
            const note = `Solution Formula Solver\n\nFormule:\n${formulaText}\n\nValeurs:\n${valuesText}`;

            // Appeler le service pour créer le waypoint
            const waypoint = await this.formulaSolverService.createWaypoint(
                this.state.geocacheId,
                {
                    name: 'Solution formule',
                    latitude: this.state.result.coordinates.latitude,
                    longitude: this.state.result.coordinates.longitude,
                    note: note,
                    type: 'Reference Point'
                }
            );

            this.messageService.info(`Waypoint ${waypoint.prefix} créé avec succès !`);
            
            // TODO: Actualiser le GeocacheDetailsWidget
            
        } catch (error) {
            console.error('[FORMULA-SOLVER] Erreur lors de la création du waypoint:', error);
            const errorMsg = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur lors de la création du waypoint: ${errorMsg}`);
        }
    }

    /**
     * Détecte les formules depuis un texte
     */
    protected async detectFormulasFromText(text: string): Promise<void> {
        if (!text.trim()) {
            this.messageService.warn('Veuillez saisir un texte à analyser');
            return;
        }

        this.updateState({ loading: true, error: undefined });

        try {
            const formulas = await this.formulaSolverService.detectFormulas({ text });
            
            if (formulas.length === 0) {
                this.messageService.info('Aucune formule détectée dans le texte');
                this.updateState({ loading: false, formulas: [] });
            } else {
                this.messageService.info(`${formulas.length} formule(s) détectée(s)`);
                this.updateState({
                    loading: false,
                    formulas,
                    selectedFormula: formulas[0],
                    currentStep: 'questions'
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur : ${message}`);
            this.updateState({ loading: false, error: message });
        }
    }

    /**
     * Modifie manuellement une formule détectée
     */
    protected handleEditFormula(formula: Formula, updatedNorth: string, updatedEast: string): void {
        // Mise à jour de la formule dans la liste
        const updatedFormulas = this.state.formulas.map(f => {
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
        this.updateState({ loading: true, error: undefined });

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
            this.state.values.forEach((letterValue, letter) => {
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
            this.updateState({ loading: false, error: message });
        }
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
        let calculatedValue: number;

        switch (type) {
            case 'checksum':
                calculatedValue = this.formulaSolverService.calculateChecksum(rawValue);
                break;
            case 'reduced':
                calculatedValue = this.formulaSolverService.calculateReducedChecksum(rawValue);
                break;
            case 'length':
                calculatedValue = this.formulaSolverService.calculateLength(rawValue);
                break;
            case 'custom':
                // Pour custom, on considère que l'utilisateur a saisi directement la valeur
                calculatedValue = parseInt(rawValue, 10) || 0;
                break;
            case 'value':
            default:
                calculatedValue = parseInt(rawValue, 10) || 0;
                break;
        }

        const letterValue: LetterValue = {
            letter,
            rawValue,
            value: calculatedValue,
            type
        };

        this.state.values.set(letter, letterValue);
        this.update();
        
        // Déclencher le calcul automatique si toutes les lettres sont remplies
        this.tryAutoCalculate();
    }

    /**
     * Render du composant React
     */
    protected render(): React.ReactNode {
        return (
            <div className='formula-solver-container' style={{ padding: '20px', height: '100%', overflow: 'auto' }}>
                <h2 style={{ marginTop: 0 }}>Formula Solver</h2>
                
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
                        onSelect={(formula) => this.updateState({ selectedFormula: formula })}
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
                
                <QuestionFieldsComponent
                    questions={this.state.questions}
                    values={this.state.values}
                    onValueChange={(letter, rawValue, type) => this.updateValue(letter, rawValue, type)}
                    onExtractQuestions={this.state.questions.length === 0 ? () => this.extractQuestions(this.state.selectedFormula!) : undefined}
                    loading={this.state.loading}
                />
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
                
                {/* Résultat du calcul */}
                {this.state.result && this.state.result.status === 'success' && (
                    <ResultDisplayComponent
                        result={this.state.result}
                        onCopy={(text) => this.messageService.info(`Copié: ${text}`)}
                        onCreateWaypoint={this.state.geocacheId ? () => this.createWaypoint() : undefined}
                        onProjectOnMap={() => this.showOnMap()}
                    />
                )}
            </div>
        );
    }

}
