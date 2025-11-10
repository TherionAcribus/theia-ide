/**
 * Types TypeScript pour le Formula Solver
 */

/**
 * Formule de coordonnées GPS détectée
 */
export interface Formula {
    id: string;
    north: string;
    east: string;
    source: string;
    text_output: string;
    confidence: number;
}

/**
 * Question associée à une variable
 */
export interface Question {
    letter: string;
    question: string;
    answer?: string | number;
}

/**
 * Valeur d'une lettre/variable avec différents types de calculs
 */
export interface LetterValue {
    letter: string;
    rawValue: string;          // Valeur brute saisie
    value: number;              // Valeur numérique calculée
    type: ValueType;            // Type de calcul appliqué
}

/**
 * Types de valeurs calculées
 */
export type ValueType = 
    | 'value'           // Valeur directe
    | 'checksum'        // Somme des chiffres
    | 'reduced'         // Somme réduite (checksum récursif jusqu'à 1 chiffre)
    | 'length'          // Longueur du texte
    | 'custom';         // Calcul personnalisé

/**
 * Coordonnées calculées dans différents formats
 */
export interface CalculatedCoordinates {
    latitude: number;
    longitude: number;
    ddm: string;              // Degrees Decimal Minutes
    dms: string;              // Degrees Minutes Seconds
    decimal: string;          // Lat, Lon en décimal
}

/**
 * Résultat complet du calcul
 */
export interface CalculationResult {
    status: 'success' | 'error';
    coordinates?: CalculatedCoordinates;
    distance?: {
        km: number;
        miles: number;
    };
    calculation_steps?: {
        north_original: string;
        east_original: string;
        north_substituted: string;
        east_substituted: string;
    };
    error?: string;
}

/**
 * État du Formula Solver
 */
export interface FormulaSolverState {
    // Étape actuelle
    currentStep: 'detect' | 'questions' | 'values' | 'calculate';
    
    // Données
    geocacheId?: number;
    gcCode?: string;
    text?: string;
    
    // Coordonnées d'origine
    originLat?: number;
    originLon?: number;
    
    // Formules détectées
    formulas: Formula[];
    selectedFormula?: Formula;
    
    // Questions extraites
    questions: Question[];
    
    // Valeurs des variables
    values: Map<string, LetterValue>;
    
    // Résultat
    result?: CalculationResult;
    
    // État UI
    loading: boolean;
    error?: string;
}

/**
 * Opération sur une valeur (checksum, length, etc.)
 */
export interface ValueOperation {
    type: ValueType;
    label: string;
    description: string;
    icon: string;
    calculate: (input: string) => number;
}

/**
 * Configuration du vérificateur externe
 */
export interface ExternalChecker {
    name: string;
    url: string;
    method: 'GET' | 'POST';
    enabled: boolean;
}
