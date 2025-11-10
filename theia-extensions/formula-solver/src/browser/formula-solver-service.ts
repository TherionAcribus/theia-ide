/**
 * Service frontend Formula Solver
 * Communique avec l'API backend pour détecter, extraire et calculer
 */

import { injectable } from '@theia/core/shared/inversify';
import axios, { AxiosInstance } from 'axios';
import { Formula, CalculationResult } from '../common/types';

export const FormulaSolverService = Symbol('FormulaSolverService');

export interface FormulaSolverService {
    detectFormulas(params: { geocacheId?: number; text?: string }): Promise<Formula[]>;
    extractQuestions(params: { geocacheId?: number; text?: string; letters: string[]; method?: string }): Promise<Map<string, string>>;
    calculateCoordinates(params: {
        northFormula: string;
        eastFormula: string;
        values: Record<string, number>;
        originLat?: number;
        originLon?: number;
    }): Promise<CalculationResult>;
    calculateChecksum(value: string | number): number;
    calculateReducedChecksum(value: string | number): number;
    calculateLength(value: string): number;
    getGeocache(geocacheId: number): Promise<{
        id: number;
        gc_code: string;
        name: string;
        description: string;
        latitude: number;
        longitude: number;
    }>;
    createWaypoint(geocacheId: number, params: {
        name: string;
        latitude: number;
        longitude: number;
        note?: string;
        type?: string;
    }): Promise<{
        id: number;
        prefix: string;
        name: string;
        type: string;
        latitude: number;
        longitude: number;
        gc_coords: string;
        note: string;
    }>;
}

@injectable()
export class FormulaSolverServiceImpl implements FormulaSolverService {
    
    private readonly apiClient: AxiosInstance;
    private readonly baseURL: string = 'http://localhost:8000/api/formula-solver';

    constructor() {
        this.apiClient = axios.create({
            baseURL: this.baseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('[FORMULA-SOLVER] Service initialized with base URL:', this.baseURL);
    }

    /**
     * Détecte les formules de coordonnées dans un texte ou une géocache
     */
    async detectFormulas(params: { geocacheId?: number; text?: string }): Promise<Formula[]> {
        try {
            console.log('[FORMULA-SOLVER] Detecting formulas with params:', params);
            
            const response = await this.apiClient.post('/detect-formulas', {
                geocache_id: params.geocacheId,
                text: params.text
            });

            if (response.data.status === 'error') {
                throw new Error(response.data.error || 'Erreur lors de la détection des formules');
            }

            const formulas = response.data.formulas || [];
            console.log('[FORMULA-SOLVER] Formulas detected:', formulas.length);
            
            return formulas;
        } catch (error) {
            console.error('[FORMULA-SOLVER] Error detecting formulas:', error);
            if (axios.isAxiosError(error) && error.response) {
                throw new Error(error.response.data.error || 'Erreur réseau lors de la détection');
            }
            throw error;
        }
    }

    /**
     * Extrait les questions associées aux variables d'une formule
     */
    async extractQuestions(params: {
        geocacheId?: number;
        text?: string;
        letters: string[];
        method?: string;
    }): Promise<Map<string, string>> {
        try {
            console.log('[FORMULA-SOLVER] Extracting questions for letters:', params.letters);
            
            const response = await this.apiClient.post('/extract-questions', {
                geocache_id: params.geocacheId,
                text: params.text,
                letters: params.letters,
                method: params.method || 'regex'
            });

            if (response.data.status === 'error') {
                throw new Error(response.data.error || 'Erreur lors de l\'extraction des questions');
            }

            // Convertir l'objet en Map
            const questionsMap = new Map<string, string>();
            const questions = response.data.questions || {};
            
            Object.entries(questions).forEach(([letter, question]) => {
                questionsMap.set(letter, question as string);
            });

            console.log('[FORMULA-SOLVER] Questions extracted:', questionsMap.size, 'found');
            
            return questionsMap;
        } catch (error) {
            console.error('[FORMULA-SOLVER] Error extracting questions:', error);
            if (axios.isAxiosError(error) && error.response) {
                throw new Error(error.response.data.error || 'Erreur réseau lors de l\'extraction');
            }
            throw error;
        }
    }

    /**
     * Calcule les coordonnées finales à partir d'une formule et des valeurs
     */
    async calculateCoordinates(params: {
        northFormula: string;
        eastFormula: string;
        values: Record<string, number>;
        originLat?: number;
        originLon?: number;
    }): Promise<CalculationResult> {
        try {
            console.log('[FORMULA-SOLVER] Calculating coordinates with formula:', {
                north: params.northFormula,
                east: params.eastFormula,
                values: params.values
            });
            
            const response = await this.apiClient.post('/calculate', {
                north_formula: params.northFormula,
                east_formula: params.eastFormula,
                values: params.values,
                origin_lat: params.originLat,
                origin_lon: params.originLon
            });

            if (response.data.status === 'error') {
                return {
                    status: 'error',
                    error: response.data.error || 'Erreur lors du calcul'
                };
            }

            console.log('[FORMULA-SOLVER] Coordinates calculated successfully');
            
            return {
                status: 'success',
                coordinates: response.data.coordinates,
                distance: response.data.distance,
                calculation_steps: response.data.calculation_steps
            };
        } catch (error) {
            console.error('[FORMULA-SOLVER] Error calculating coordinates:', error);
            
            let errorMessage = 'Erreur lors du calcul des coordonnées';
            if (axios.isAxiosError(error) && error.response) {
                errorMessage = error.response.data.error || errorMessage;
            } else if (error instanceof Error) {
                errorMessage = error.message;
            }
            
            return {
                status: 'error',
                error: errorMessage
            };
        }
    }

    /**
     * Calcule le checksum d'un nombre (somme des chiffres)
     */
    calculateChecksum(value: string | number): number {
        const str = value.toString().replace(/\D/g, ''); // Garder seulement les chiffres
        return str.split('').reduce((sum, digit) => sum + parseInt(digit, 10), 0);
    }

    /**
     * Calcule le checksum réduit (checksum récursif jusqu'à 1 chiffre)
     */
    calculateReducedChecksum(value: string | number): number {
        let result = this.calculateChecksum(value);
        while (result >= 10) {
            result = this.calculateChecksum(result);
        }
        return result;
    }

    /**
     * Calcule la longueur d'un texte (en retirant les espaces)
     */
    calculateLength(value: string): number {
        return value.replace(/\s/g, '').length;
    }

    /**
     * Récupère les informations d'une geocache pour le Formula Solver
     */
    async getGeocache(geocacheId: number): Promise<{
        id: number;
        gc_code: string;
        name: string;
        description: string;
        latitude: number;
        longitude: number;
    }> {
        console.log(`[FORMULA-SOLVER] Récupération geocache ${geocacheId}`);
        
        try {
            const response = await this.apiClient.get(`/geocache/${geocacheId}`);
            
            if (response.data.status === 'success') {
                console.log(`[FORMULA-SOLVER] Geocache ${response.data.geocache.gc_code} récupérée`);
                return response.data.geocache;
            } else {
                throw new Error(response.data.error || 'Erreur inconnue');
            }
        } catch (error) {
            console.error('[FORMULA-SOLVER] Erreur lors de la récupération de la geocache:', error);
            throw error;
        }
    }

    /**
     * Crée un waypoint depuis le résultat du Formula Solver
     */
    async createWaypoint(geocacheId: number, params: {
        name: string;
        latitude: number;
        longitude: number;
        note?: string;
        type?: string;
    }): Promise<{
        id: number;
        prefix: string;
        name: string;
        type: string;
        latitude: number;
        longitude: number;
        gc_coords: string;
        note: string;
    }> {
        console.log(`[FORMULA-SOLVER] Création waypoint pour geocache ${geocacheId}`);
        
        try {
            const response = await this.apiClient.post(`/geocache/${geocacheId}/waypoint`, params);
            
            if (response.data.status === 'success') {
                console.log(`[FORMULA-SOLVER] Waypoint ${response.data.waypoint.prefix} créé`);
                return response.data.waypoint;
            } else {
                throw new Error(response.data.error || 'Erreur inconnue');
            }
        } catch (error) {
            console.error('[FORMULA-SOLVER] Erreur lors de la création du waypoint:', error);
            throw error;
        }
    }
}
