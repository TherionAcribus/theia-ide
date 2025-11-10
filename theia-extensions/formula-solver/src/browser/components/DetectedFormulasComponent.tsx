/**
 * Composant pour afficher les formules détectées
 */

import * as React from '@theia/core/shared/react';
import { Formula } from '../../common/types';

export interface DetectedFormulasComponentProps {
    formulas: Formula[];
    selectedFormula?: Formula;
    onSelect: (formula: Formula) => void;
    loading?: boolean;
}

export const DetectedFormulasComponent: React.FC<DetectedFormulasComponentProps> = ({
    formulas,
    selectedFormula,
    onSelect,
    loading = false
}) => {
    if (formulas.length === 0 && !loading) {
        return null;
    }

    return (
        <div className='detected-formulas-component' style={{ marginTop: '15px' }}>
            <div style={{
                padding: '12px',
                backgroundColor: 'var(--theia-editor-background)',
                borderRadius: '4px',
                border: '1px solid var(--theia-panel-border)'
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '10px'
                }}>
                    <strong style={{ color: 'var(--theia-foreground)' }}>
                        {formulas.length > 1 ? `${formulas.length} formules détectées` : 'Formule détectée'}
                    </strong>
                    {selectedFormula && (
                        <span style={{
                            fontSize: '12px',
                            color: 'var(--theia-descriptionForeground)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                        }}>
                            <span className='codicon codicon-check' style={{ color: 'var(--theia-testing-iconPassed)' }}></span>
                            Confiance: {Math.round(selectedFormula.confidence * 100)}%
                        </span>
                    )}
                </div>

                {formulas.map((formula, index) => {
                    const isSelected = selectedFormula?.id === formula.id;
                    
                    return (
                        <div
                            key={formula.id}
                            style={{
                                marginBottom: formulas.length > 1 && index < formulas.length - 1 ? '8px' : '0',
                                padding: '10px',
                                backgroundColor: isSelected 
                                    ? 'var(--theia-list-activeSelectionBackground)' 
                                    : 'var(--theia-input-background)',
                                border: isSelected 
                                    ? '2px solid var(--theia-focusBorder)' 
                                    : '1px solid var(--theia-input-border)',
                                borderRadius: '4px',
                                cursor: formulas.length > 1 ? 'pointer' : 'default',
                                transition: 'all 0.2s'
                            }}
                            onClick={() => formulas.length > 1 && onSelect(formula)}
                        >
                            {/* En-tête avec numéro et actions */}
                            {formulas.length > 1 && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    marginBottom: '8px',
                                    paddingBottom: '8px',
                                    borderBottom: '1px solid var(--theia-panel-border)'
                                }}>
                                    <span style={{
                                        fontSize: '12px',
                                        fontWeight: 'bold',
                                        color: 'var(--theia-descriptionForeground)'
                                    }}>
                                        Formule #{index + 1}
                                    </span>
                                    {isSelected && (
                                        <span style={{
                                            fontSize: '11px',
                                            padding: '2px 8px',
                                            backgroundColor: 'var(--theia-button-background)',
                                            color: 'var(--theia-button-foreground)',
                                            borderRadius: '3px'
                                        }}>
                                            Sélectionnée
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Formule complète */}
                            <div style={{
                                fontFamily: 'var(--theia-code-font-family)',
                                fontSize: '14px',
                                color: isSelected ? 'var(--theia-list-activeSelectionForeground)' : 'var(--theia-foreground)',
                                marginBottom: '8px'
                            }}>
                                {formula.text_output || `${formula.north} ${formula.east}`}
                            </div>

                            {/* Détails Nord/Est */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: '8px',
                                fontSize: '12px',
                                color: 'var(--theia-descriptionForeground)'
                            }}>
                                <div>
                                    <span style={{ fontWeight: 'bold' }}>Nord:</span>
                                    <div style={{
                                        marginTop: '2px',
                                        fontFamily: 'var(--theia-code-font-family)',
                                        padding: '4px 6px',
                                        backgroundColor: 'var(--theia-editor-background)',
                                        borderRadius: '3px'
                                    }}>
                                        {formula.north}
                                    </div>
                                </div>
                                <div>
                                    <span style={{ fontWeight: 'bold' }}>Est:</span>
                                    <div style={{
                                        marginTop: '2px',
                                        fontFamily: 'var(--theia-code-font-family)',
                                        padding: '4px 6px',
                                        backgroundColor: 'var(--theia-editor-background)',
                                        borderRadius: '3px'
                                    }}>
                                        {formula.east}
                                    </div>
                                </div>
                            </div>

                            {/* Source si disponible */}
                            {formula.source && (
                                <div style={{
                                    marginTop: '8px',
                                    fontSize: '11px',
                                    color: 'var(--theia-descriptionForeground)',
                                    fontStyle: 'italic'
                                }}>
                                    Source: {formula.source}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
