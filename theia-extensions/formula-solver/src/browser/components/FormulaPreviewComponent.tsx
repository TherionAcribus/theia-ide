/**
 * Composant de prévisualisation en temps réel de la formule
 * Affiche la substitution des variables avec codes couleur
 */

import * as React from '@theia/core/shared/react';
import { Formula, LetterValue } from '../../common/types';

interface FormulaPreviewProps {
    formula: Formula;
    values: Map<string, LetterValue>;
    onPartialCalculate?: (part: 'north' | 'east', result: string) => void;
}

interface ValidationResult {
    status: 'valid' | 'incomplete' | 'invalid';
    message: string;
    substituted: string;
}

export const FormulaPreviewComponent: React.FC<FormulaPreviewProps> = ({ formula, values, onPartialCalculate }) => {
    
    /**
     * Extrait les lettres d'une partie de formule (sans les cardinales)
     */
    const extractLetters = (text: string): string[] => {
        const cleaned = text.replace(/^[NSEW]\s*/i, '');
        const letters = new Set<string>();
        const matches = cleaned.matchAll(/([A-Z])/g);
        for (const match of matches) {
            letters.add(match[1]);
        }
        return Array.from(letters).sort();
    };

    /**
     * Substitue les lettres dans une formule
     */
    const substituteFormula = (text: string, values: Map<string, LetterValue>): string => {
        let result = text;
        
        // Remplacer chaque lettre par sa valeur
        for (const [letter, letterValue] of values.entries()) {
            const regex = new RegExp(letter, 'g');
            result = result.replace(regex, letterValue.value.toString());
        }
        
        return result;
    };

    /**
     * Valide une partie de coordonnée
     */
    const validatePart = (text: string, requiredLetters: string[]): ValidationResult => {
        // Vérifier les lettres manquantes
        const missingLetters = requiredLetters.filter(letter => !values.has(letter));
        
        if (missingLetters.length > 0) {
            return {
                status: 'incomplete',
                message: `Lettres manquantes : ${missingLetters.join(', ')}`,
                substituted: substituteFormula(text, values)
            };
        }

        // Substituer toutes les lettres
        const substituted = substituteFormula(text, values);

        // Extraire la direction cardinale
        const cardinalMatch = text.match(/^([NSEW])\s*/i);
        const cardinal = cardinalMatch ? cardinalMatch[1].toUpperCase() : '';

        // Parser la coordonnée substituée
        // Format attendu : N 48° 22.222 ou E 007° 22.222
        const coordMatch = substituted.match(/([NSEW])?\s*(\d+)°\s*(\d+)\.(\d+)/i);
        
        if (!coordMatch) {
            return {
                status: 'invalid',
                message: 'Format de coordonnée invalide',
                substituted
            };
        }

        const degrees = parseInt(coordMatch[2], 10);
        const minutes = parseInt(coordMatch[3], 10);
        // const decimals = coordMatch[4]; // Peut être utilisé plus tard pour validation

        // Validation des limites
        const isLatitude = ['N', 'S'].includes(cardinal);
        const isLongitude = ['E', 'W'].includes(cardinal);

        if (isLatitude && (degrees < 0 || degrees > 90)) {
            return {
                status: 'invalid',
                message: `Latitude invalide : ${degrees}° (doit être entre 0° et 90°)`,
                substituted
            };
        }

        if (isLongitude && (degrees < 0 || degrees > 180)) {
            return {
                status: 'invalid',
                message: `Longitude invalide : ${degrees}° (doit être entre 0° et 180°)`,
                substituted
            };
        }

        if (minutes < 0 || minutes >= 60) {
            return {
                status: 'invalid',
                message: `Minutes invalides : ${minutes} (doit être entre 0 et 59)`,
                substituted
            };
        }

        // Tout est valide
        return {
            status: 'valid',
            message: 'Coordonnée valide',
            substituted
        };
    };

    const northLetters = extractLetters(formula.north);
    const eastLetters = extractLetters(formula.east);

    const northValidation = validatePart(formula.north, northLetters);
    const eastValidation = validatePart(formula.east, eastLetters);

    // Calculer automatiquement les parties complètes
    React.useEffect(() => {
        if (northValidation.status === 'valid' && onPartialCalculate) {
            onPartialCalculate('north', northValidation.substituted);
        }
    }, [northValidation.status, northValidation.substituted]);

    React.useEffect(() => {
        if (eastValidation.status === 'valid' && onPartialCalculate) {
            onPartialCalculate('east', eastValidation.substituted);
        }
    }, [eastValidation.status, eastValidation.substituted]);

    /**
     * Retourne la classe CSS selon le statut
     */
    const getStatusClass = (status: 'valid' | 'incomplete' | 'invalid'): string => {
        switch (status) {
            case 'valid': return 'theia-success';
            case 'incomplete': return 'theia-warn';
            case 'invalid': return 'theia-error';
        }
    };

    /**
     * Retourne l'icône selon le statut
     */
    const getStatusIcon = (status: 'valid' | 'incomplete' | 'invalid'): string => {
        switch (status) {
            case 'valid': return 'codicon codicon-check';
            case 'incomplete': return 'codicon codicon-circle-outline';
            case 'invalid': return 'codicon codicon-error';
        }
    };

    return (
        <div className="formula-preview-container" style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>
                📍 Prévisualisation en temps réel
            </h3>

            {/* Latitude / Nord */}
            <div className="formula-part" style={{ marginBottom: '12px' }}>
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    marginBottom: '4px'
                }}>
                    <span className={getStatusIcon(northValidation.status)} />
                    <strong>Latitude :</strong>
                    <span className={getStatusClass(northValidation.status)}>
                        {northValidation.status === 'valid' ? '✓ Valide' : 
                         northValidation.status === 'incomplete' ? '○ Incomplète' : '✗ Invalide'}
                    </span>
                </div>
                <div style={{
                    padding: '8px',
                    backgroundColor: 'var(--theia-input-background)',
                    border: `1px solid ${
                        northValidation.status === 'valid' ? 'var(--theia-successText)' :
                        northValidation.status === 'incomplete' ? 'var(--theia-warningText)' :
                        'var(--theia-errorText)'
                    }`,
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                    fontSize: '13px'
                }}>
                    {northValidation.substituted || formula.north}
                </div>
                <div style={{ 
                    fontSize: '11px', 
                    color: 'var(--theia-descriptionForeground)',
                    marginTop: '4px',
                    fontStyle: 'italic'
                }}>
                    {northValidation.message}
                </div>
            </div>

            {/* Longitude / Est */}
            <div className="formula-part">
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    marginBottom: '4px'
                }}>
                    <span className={getStatusIcon(eastValidation.status)} />
                    <strong>Longitude :</strong>
                    <span className={getStatusClass(eastValidation.status)}>
                        {eastValidation.status === 'valid' ? '✓ Valide' : 
                         eastValidation.status === 'incomplete' ? '○ Incomplète' : '✗ Invalide'}
                    </span>
                </div>
                <div style={{
                    padding: '8px',
                    backgroundColor: 'var(--theia-input-background)',
                    border: `1px solid ${
                        eastValidation.status === 'valid' ? 'var(--theia-successText)' :
                        eastValidation.status === 'incomplete' ? 'var(--theia-warningText)' :
                        'var(--theia-errorText)'
                    }`,
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                    fontSize: '13px'
                }}>
                    {eastValidation.substituted || formula.east}
                </div>
                <div style={{ 
                    fontSize: '11px', 
                    color: 'var(--theia-descriptionForeground)',
                    marginTop: '4px',
                    fontStyle: 'italic'
                }}>
                    {eastValidation.message}
                </div>
            </div>

            {/* Résumé global */}
            {northValidation.status === 'valid' && eastValidation.status === 'valid' && (
                <div style={{
                    marginTop: '12px',
                    padding: '8px',
                    backgroundColor: 'var(--theia-successBackground)',
                    border: '1px solid var(--theia-successText)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <span className="codicon codicon-check" />
                    <span>Les coordonnées complètes sont prêtes pour le calcul final !</span>
                </div>
            )}
        </div>
    );
};
