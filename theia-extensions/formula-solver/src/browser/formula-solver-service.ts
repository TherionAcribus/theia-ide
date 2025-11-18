/**
 * Service frontend pour interagir avec l'API Formula Solver.
 */

import { injectable } from '@theia/core/shared/inversify';
import axios, { AxiosInstance } from 'axios';
import { CalculationResult, Formula } from '../common/types';

export const FormulaSolverService = Symbol('FormulaSolverService');

export interface DetectFormulasParams {
    text?: string;
    geocache_id?: number;
}

export interface ExtractQuestionsParams {
    text?: string;
    geocache_id?: number;
    letters: string[];
    method?: 'regex' | 'ai';
}

export interface CalculateCoordinatesParams {
    northFormula: string;
    eastFormula: string;
    values: Record<string, number>;
    originLat?: number;
    originLon?: number;
}

export interface FormulaSolverGeocache {
    id: number;
    gc_code: string;
    name: string;
    description: string;
    latitude?: number;
    longitude?: number;
}

export interface FormulaSolverService {
    detectFormulas(params: DetectFormulasParams): Promise<Formula[]>;
    extractQuestions(params: ExtractQuestionsParams): Promise<Map<string, string>>;
    calculateCoordinates(params: CalculateCoordinatesParams): Promise<CalculationResult>;
    getGeocache(id: number): Promise<FormulaSolverGeocache>;
    calculateChecksum(value: string | number): number;
    calculateReducedChecksum(value: string | number): number;
    calculateLength(value: string | number): number;
}

@injectable()
export class FormulaSolverServiceImpl implements FormulaSolverService {
    protected readonly api: AxiosInstance;

    constructor() {
        this.api = axios.create({
            baseURL: 'http://localhost:8000/api/formula-solver',
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    async detectFormulas(params: DetectFormulasParams): Promise<Formula[]> {
        const response = await this.api.post('/detect-formulas', params);
        return response.data?.formulas ?? [];
    }

    async extractQuestions(params: ExtractQuestionsParams): Promise<Map<string, string>> {
        const response = await this.api.post('/extract-questions', params);
        const questions = response.data?.questions ?? {};
        return new Map<string, string>(Object.entries(questions));
    }

    async calculateCoordinates(params: CalculateCoordinatesParams): Promise<CalculationResult> {
        const response = await this.api.post('/calculate', {
            north_formula: params.northFormula,
            east_formula: params.eastFormula,
            values: params.values,
            origin: params.originLat !== undefined && params.originLon !== undefined
                ? { latitude: params.originLat, longitude: params.originLon }
                : undefined
        });
        return response.data;
    }

    async getGeocache(id: number): Promise<FormulaSolverGeocache> {
        const response = await this.api.get(`/geocache/${id}`);
        return response.data?.geocache;
    }

    calculateChecksum(value: string | number): number {
        const str = value.toString().toUpperCase();

        // Si la chaîne contient des lettres, convertir chaque lettre en sa position dans l'alphabet
        // et additionner. Sinon, utiliser seulement les chiffres présents.
        const hasLetters = /[A-Z]/.test(str);

        if (hasLetters) {
            // Convertir les lettres en positions (A=1, B=2, ..., Z=26)
            return str.split('').reduce((sum, char) => {
                const code = char.charCodeAt(0);
                if (code >= 65 && code <= 90) { // A-Z
                    return sum + (code - 64); // A=1, B=2, etc.
                } else if (code >= 48 && code <= 57) { // 0-9
                    return sum + parseInt(char, 10);
                }
                return sum; // Ignorer les autres caractères
            }, 0);
        } else {
            // Comportement original : seulement les chiffres
            const digitsOnly = str.replace(/\D/g, '');
            return digitsOnly.split('').reduce((sum, digit) => sum + parseInt(digit, 10), 0);
        }
    }

    calculateReducedChecksum(value: string | number): number {
        let result = this.calculateChecksum(value);
        while (result >= 10) {
            result = this.calculateChecksum(result);
        }
        return result;
    }

    calculateLength(value: string | number): number {
        return value.toString().replace(/\s+/g, '').length;
    }
}
