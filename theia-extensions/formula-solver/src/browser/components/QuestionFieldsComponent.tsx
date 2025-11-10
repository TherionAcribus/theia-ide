/**
 * Composant pour afficher les questions et saisir les valeurs
 */

import * as React from '@theia/core/shared/react';
import { Question, LetterValue, ValueType } from '../../common/types';

export interface QuestionFieldsComponentProps {
    questions: Question[];
    values: Map<string, LetterValue>;
    onValueChange: (letter: string, rawValue: string, type: ValueType) => void;
    onExtractQuestions?: () => void;
    loading?: boolean;
}

const VALUE_TYPES: Array<{ value: ValueType; label: string; description: string }> = [
    { value: 'value', label: 'Valeur', description: 'Nombre direct' },
    { value: 'checksum', label: 'Checksum', description: 'Somme des chiffres' },
    { value: 'reduced', label: 'Checksum réduit', description: 'Checksum → 1 chiffre' },
    { value: 'length', label: 'Longueur', description: 'Nb de caractères' }
];

export const QuestionFieldsComponent: React.FC<QuestionFieldsComponentProps> = ({
    questions,
    values,
    onValueChange,
    onExtractQuestions,
    loading = false
}) => {
    const [globalType, setGlobalType] = React.useState<ValueType>('value');

    // Appliquer un type à toutes les valeurs
    const handleGlobalTypeChange = (type: ValueType) => {
        setGlobalType(type);
        questions.forEach(question => {
            const currentValue = values.get(question.letter);
            if (currentValue) {
                onValueChange(question.letter, currentValue.rawValue, type);
            }
        });
    };

    if (questions.length === 0 && !loading) {
        return (
            <div style={{ marginTop: '15px' }}>
                {onExtractQuestions && (
                    <button
                        style={{
                            padding: '8px 16px',
                            backgroundColor: 'var(--theia-button-background)',
                            color: 'var(--theia-button-foreground)',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}
                        onClick={onExtractQuestions}
                        disabled={loading}
                    >
                        <span className='codicon codicon-search'></span>
                        Extraire les questions
                    </button>
                )}
            </div>
        );
    }

    // Calculer les statistiques
    const filledCount = Array.from(values.values()).filter(v => v.rawValue.trim() !== '').length;
    const totalCount = questions.length;
    const progress = totalCount > 0 ? (filledCount / totalCount) * 100 : 0;

    return (
        <div className='question-fields-component' style={{ marginTop: '15px' }}>
            {/* En-tête avec statistiques */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px',
                padding: '10px',
                backgroundColor: 'var(--theia-editor-background)',
                borderRadius: '4px',
                border: '1px solid var(--theia-panel-border)'
            }}>
                <div>
                    <strong>{totalCount} variable{totalCount > 1 ? 's' : ''}</strong>
                    <div style={{
                        fontSize: '12px',
                        color: 'var(--theia-descriptionForeground)',
                        marginTop: '2px'
                    }}>
                        {filledCount} / {totalCount} renseignée{filledCount > 1 ? 's' : ''}
                    </div>
                </div>
                
                {/* Barre de progression */}
                <div style={{
                    flex: 1,
                    maxWidth: '200px',
                    marginLeft: '15px',
                    marginRight: '15px'
                }}>
                    <div style={{
                        width: '100%',
                        height: '6px',
                        backgroundColor: 'var(--theia-input-background)',
                        borderRadius: '3px',
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            width: `${progress}%`,
                            height: '100%',
                            backgroundColor: progress === 100 
                                ? 'var(--theia-testing-iconPassed)' 
                                : 'var(--theia-button-background)',
                            transition: 'width 0.3s'
                        }} />
                    </div>
                </div>

                {/* Sélecteur de type global */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{
                        fontSize: '12px',
                        color: 'var(--theia-descriptionForeground)'
                    }}>
                        Type global:
                    </label>
                    <select
                        style={{
                            padding: '4px 8px',
                            fontSize: '12px',
                            backgroundColor: 'var(--theia-dropdown-background)',
                            color: 'var(--theia-dropdown-foreground)',
                            border: '1px solid var(--theia-dropdown-border)',
                            borderRadius: '3px',
                            cursor: 'pointer'
                        }}
                        value={globalType}
                        onChange={e => handleGlobalTypeChange(e.target.value as ValueType)}
                    >
                        {VALUE_TYPES.map(type => (
                            <option key={type.value} value={type.value}>
                                {type.label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Liste des questions/variables */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {questions.map(question => {
                    const letterValue = values.get(question.letter);
                    const hasValue = letterValue && letterValue.rawValue.trim() !== '';
                    
                    return (
                        <div
                            key={question.letter}
                            style={{
                                padding: '12px',
                                backgroundColor: hasValue 
                                    ? 'var(--theia-list-hoverBackground)' 
                                    : 'var(--theia-editor-background)',
                                border: hasValue 
                                    ? '1px solid var(--theia-focusBorder)' 
                                    : '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                transition: 'all 0.2s'
                            }}
                        >
                            {/* En-tête : Lettre + Question */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                marginBottom: '10px',
                                gap: '10px'
                            }}>
                                {/* Badge de la lettre */}
                                <div style={{
                                    minWidth: '32px',
                                    height: '32px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: hasValue 
                                        ? 'var(--theia-button-background)' 
                                        : 'var(--theia-input-background)',
                                    color: hasValue 
                                        ? 'var(--theia-button-foreground)' 
                                        : 'var(--theia-foreground)',
                                    borderRadius: '4px',
                                    fontWeight: 'bold',
                                    fontSize: '16px',
                                    fontFamily: 'var(--theia-code-font-family)'
                                }}>
                                    {question.letter}
                                </div>

                                {/* Question */}
                                <div style={{ flex: 1 }}>
                                    <div style={{
                                        fontSize: '14px',
                                        color: 'var(--theia-foreground)',
                                        lineHeight: '1.5'
                                    }}>
                                        {question.question || (
                                            <em style={{ color: 'var(--theia-descriptionForeground)' }}>
                                                Pas de question trouvée
                                            </em>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Champs de saisie */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr auto auto',
                                gap: '8px',
                                alignItems: 'center'
                            }}>
                                {/* Input valeur */}
                                <input
                                    type='text'
                                    placeholder='Valeur ou texte...'
                                    style={{
                                        padding: '8px 12px',
                                        backgroundColor: 'var(--theia-input-background)',
                                        color: 'var(--theia-input-foreground)',
                                        border: `1px solid ${hasValue ? 'var(--theia-focusBorder)' : 'var(--theia-input-border)'}`,
                                        borderRadius: '4px',
                                        fontFamily: 'var(--theia-code-font-family)',
                                        fontSize: '13px'
                                    }}
                                    value={letterValue?.rawValue || ''}
                                    onChange={e => onValueChange(
                                        question.letter,
                                        e.target.value,
                                        letterValue?.type || 'value'
                                    )}
                                />

                                {/* Select type */}
                                <select
                                    style={{
                                        padding: '8px 12px',
                                        backgroundColor: 'var(--theia-dropdown-background)',
                                        color: 'var(--theia-dropdown-foreground)',
                                        border: '1px solid var(--theia-dropdown-border)',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                        minWidth: '140px'
                                    }}
                                    value={letterValue?.type || 'value'}
                                    onChange={e => onValueChange(
                                        question.letter,
                                        letterValue?.rawValue || '',
                                        e.target.value as ValueType
                                    )}
                                    title={VALUE_TYPES.find(t => t.value === (letterValue?.type || 'value'))?.description}
                                >
                                    {VALUE_TYPES.map(type => (
                                        <option key={type.value} value={type.value}>
                                            {type.label}
                                        </option>
                                    ))}
                                </select>

                                {/* Valeur calculée */}
                                <div style={{
                                    minWidth: '80px',
                                    textAlign: 'right',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    justifyContent: 'flex-end'
                                }}>
                                    {letterValue && hasValue ? (
                                        <>
                                            <span style={{
                                                fontSize: '12px',
                                                color: 'var(--theia-descriptionForeground)'
                                            }}>
                                                =
                                            </span>
                                            <span style={{
                                                fontSize: '18px',
                                                fontWeight: 'bold',
                                                fontFamily: 'var(--theia-code-font-family)',
                                                color: 'var(--theia-textLink-activeForeground)',
                                                minWidth: '40px',
                                                textAlign: 'right'
                                            }}>
                                                {letterValue.value}
                                            </span>
                                        </>
                                    ) : (
                                        <span style={{
                                            fontSize: '14px',
                                            color: 'var(--theia-descriptionForeground)'
                                        }}>
                                            -
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
