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
    ResultDisplayComponent
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
        
        console.log('[FORMULA-SOLVER] Widget initialized');
    }

    /**
     * Met à jour l'état et rafraîchit l'UI
     */
    protected updateState(updates: Partial<FormulaSolverState>): void {
        this.state = { ...this.state, ...updates };
        this.update();
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
     * Calcule les coordonnées finales
     */
    protected async calculateCoordinates(): Promise<void> {
        if (!this.state.selectedFormula) {
            this.messageService.warn('Aucune formule sélectionnée');
            return;
        }

        // Vérifier que toutes les valeurs sont renseignées
        const letters = this.extractLettersFromFormula(this.state.selectedFormula);
        const missingValues = letters.filter(letter => !this.state.values.has(letter));
        
        if (missingValues.length > 0) {
            this.messageService.warn(`Valeurs manquantes pour : ${missingValues.join(', ')}`);
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
     */
    protected extractLettersFromFormula(formula: Formula): string[] {
        const text = `${formula.north} ${formula.east}`;
        const letters = new Set<string>();
        
        // Trouver toutes les lettres A-Z sauf N, S, E, W (directions cardinales)
        const matches = text.matchAll(/([A-Z])/g);
        for (const match of matches) {
            const letter = match[1];
            if (!['N', 'S', 'E', 'W'].includes(letter)) {
                letters.add(letter);
            }
        }
        
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
                
                {/* Bouton calculer */}
                {this.state.questions.length > 0 && (
                    <div style={{ marginTop: '15px', marginBottom: '20px' }}>
                        <button
                            style={{
                                padding: '10px 20px',
                                backgroundColor: 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: 'bold',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}
                            onClick={() => this.calculateCoordinates()}
                            disabled={this.state.loading}
                        >
                            <span className='codicon codicon-run-all'></span>
                            Calculer les coordonnées
                        </button>
                    </div>
                )}
                
                {/* Étape 3 : Résultat */}
                {this.state.result && this.state.result.status === 'success' && (
                    <ResultDisplayComponent
                        result={this.state.result}
                        onCopy={(text) => this.messageService.info(`Copié: ${text}`)}
                    />
                )}
                
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

}
