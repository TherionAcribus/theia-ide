/**
 * Composant de prévisualisation en temps réel de la formule
 * Affiche la substitution des variables avec codes couleur
 */

import * as React from '@theia/core/shared/react';
import { CoordinateFragments, Formula, FormulaFragment, FragmentStatus, LetterValue } from '../../common/types';
import { ensureFormulaFragments, updateFragmentsWithCalculations, evaluateExpression } from '../utils/formula-fragments';

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

const FRAGMENT_STATUS_CLASS: Record<FragmentStatus, string> = {
    fixed: 'fragment-chip-fixed',
    pending: 'fragment-chip-pending',
    ok: 'fragment-chip-ok',
    'length-mismatch': 'fragment-chip-warning',
    empty: 'fragment-chip-empty',
    invalid: 'fragment-chip-error'
};

const FRAGMENT_STATUS_LABEL: Record<FragmentStatus, string> = {
    fixed: 'Fixe',
    pending: 'En attente',
    ok: 'OK',
    'length-mismatch': 'Longueur incorrecte',
    empty: 'Vide',
    invalid: 'Invalide'
};

const InnerFormulaPreviewComponent: React.FC<FormulaPreviewProps> = ({ formula, values, onPartialCalculate }) => {
    const fragments = React.useMemo(() => {
        const withFragments = ensureFormulaFragments(formula);
        return withFragments.fragments;
    }, [formula.id, formula.north, formula.east]);

    // Calculer les fragments avec les valeurs actuelles
    const valueMap = React.useMemo(() => {
        const map = new Map<string, { value: number }>();
        values.forEach((letterValue, letter) => {
            map.set(letter, { value: letterValue.value });
        });
        return map;
    }, [values]);

    const calculatedFragments = React.useMemo(() => {
        if (!fragments) return fragments;

        return {
            north: updateFragmentsWithCalculations(fragments.north, valueMap),
            east: updateFragmentsWithCalculations(fragments.east, valueMap)
        };
    }, [fragments, valueMap]);

    const canEvaluate = React.useCallback((fragment: FormulaFragment): boolean => {
        if (!fragment?.variables?.length) {
            return true;
        }
        return fragment.variables.every(letter => valueMap.has(letter));
    }, [valueMap]);

    const collectLettersFromFragments = (axisFragments?: CoordinateFragments, fallback?: string): string[] => {
        if (!axisFragments) {
            return extractLettersFallback(fallback || '');
        }

        const letters = new Set<string>();
        const collect = (fragment: FormulaFragment) =>
            fragment.variables.forEach((letter: string) => letters.add(letter));

        collect(axisFragments.degrees);
        collect(axisFragments.minutes);
        axisFragments.decimals.forEach(collect);

        return Array.from(letters).sort();
    };

    const extractLettersFallback = (text: string): string[] => {
        const cleaned = text.replace(/^[NSEWO]\s*/i, '');
        const letters = new Set<string>();
        const matches = cleaned.match(/[A-Z]/g) || [];
        matches.forEach(letter => letters.add(letter));
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
     * Construit une coordonnée complète à partir des fragments calculés
     */
    const buildCoordinateFromFragments = (axisFragments?: CoordinateFragments): string => {
        if (!axisFragments) return '';

        const cardinal = axisFragments.cardinal.raw;
        const degrees = axisFragments.degrees.raw;
        const minutes = axisFragments.minutes.raw;

        // Calculer les décimales
        const decimalValues: string[] = [];
        for (const decimal of axisFragments.decimals) {
            if (decimal.cleaned) {
                if (!canEvaluate(decimal)) {
                    decimalValues.push('?');
                } else {
                    const result = evaluateExpression(decimal.cleaned, valueMap);
                    if (!isNaN(result)) {
                        decimalValues.push(result.toString());
                    } else {
                        decimalValues.push('?');
                    }
                }
            } else {
                decimalValues.push('?');
            }
        }

        // Construire la coordonnée complète
        return `${cardinal}${degrees}°${minutes}.${decimalValues.join('')}`;
    };

    /**
     * Valide une partie de coordonnée
     */
    const validatePart = (text: string, requiredLetters: string[], fragments?: CoordinateFragments): ValidationResult => {
        // Vérifier les lettres manquantes
        const missingLetters = requiredLetters.filter(letter => !values.has(letter));

        if (missingLetters.length > 0) {
            return {
                status: 'incomplete',
                message: `Lettres manquantes : ${missingLetters.join(', ')}`,
                substituted: fragments ? buildCoordinateFromFragments(fragments) : substituteFormula(text, values)
            };
        }

        // Utiliser les fragments calculés si disponibles, sinon substitution simple
        const substituted = fragments ? buildCoordinateFromFragments(fragments) : substituteFormula(text, values);

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

    const northFragments = calculatedFragments?.north;
    const eastFragments = calculatedFragments?.east;

    const northLetters = collectLettersFromFragments(northFragments, formula.north);
    const eastLetters = collectLettersFromFragments(eastFragments, formula.east);

    const northValidation = validatePart(formula.north, northLetters, northFragments);
    const eastValidation = validatePart(formula.east, eastLetters, eastFragments);

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

    const renderFragmentChip = (fragment: FormulaFragment) => {
        const key = `${fragment.kind}-${fragment.index ?? 'single'}`;
        const statusClass = FRAGMENT_STATUS_CLASS[fragment.status] || FRAGMENT_STATUS_CLASS.pending;
        const tooltipParts: string[] = [];

        tooltipParts.push(`${fragment.label}`);
        if (fragment.kind === 'decimal' && fragment.raw !== fragment.cleaned) {
            tooltipParts.push(`Expression: ${fragment.raw}`);
        }
        tooltipParts.push(`Statut: ${FRAGMENT_STATUS_LABEL[fragment.status] ?? fragment.status}`);

        if (fragment.expectedLength) {
            tooltipParts.push(`Longueur attendue: ${fragment.expectedLength}`);
        }
        if (fragment.actualLength !== undefined) {
            tooltipParts.push(`Longueur actuelle: ${fragment.actualLength}`);
        }
        if (fragment.notes) {
            tooltipParts.push(fragment.notes);
        }

        // Pour les décimales, afficher le résultat calculé
        let displayValue = fragment.raw || '—';
        if (fragment.kind === 'decimal' && fragment.cleaned) {
            if (!canEvaluate(fragment)) {
                displayValue = '?';
            } else {
                const result = evaluateExpression(fragment.cleaned, valueMap);
                if (!isNaN(result)) {
                    displayValue = result.toString();
                } else {
                    displayValue = '?';
                }
            }
        }

        return (
            <div
                key={key}
                className={`coordinate-fragment-chip ${statusClass}`}
                title={tooltipParts.filter(Boolean).join('\n')}
            >
                <span className="coordinate-fragment-label">{fragment.label}</span>
                <span className="coordinate-fragment-value">{displayValue}</span>
                {fragment.status === 'length-mismatch' && (
                    <span className="coordinate-fragment-warning">⚠️</span>
                )}
            </div>
        );
    };

    const renderFragmentsForAxis = (axisFragments?: CoordinateFragments) => {
        if (!axisFragments) {
            return null;
        }

        return (
            <div className="coordinate-fragments">
                {renderFragmentChip(axisFragments.cardinal)}
                {renderFragmentChip(axisFragments.degrees)}
                {renderFragmentChip(axisFragments.minutes)}
                {axisFragments.decimals.map(renderFragmentChip)}
            </div>
        );
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
                {renderFragmentsForAxis(northFragments)}
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
                {renderFragmentsForAxis(eastFragments)}
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

// Évite les recalculs/évaluations à chaque re-render du widget parent.
// On ne rerender que si la formule ou les valeurs changent (référence).
export const FormulaPreviewComponent = React.memo(InnerFormulaPreviewComponent);
