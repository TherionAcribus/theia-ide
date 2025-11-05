/**
 * Service de communication avec l'API backend pour les plugins.
 * 
 * Ce service encapsule toutes les requêtes HTTP vers le backend Flask
 * pour la gestion des plugins.
 */

import { injectable } from '@theia/core/shared/inversify';
import axios, { AxiosInstance } from 'axios';
import {
    Plugin,
    PluginDetails,
    PluginFilters,
    PluginInputs,
    PluginResult,
    PluginsStatus,
    PluginsService as IPluginsService
} from '../../common/plugin-protocol';

@injectable()
export class PluginsServiceImpl implements IPluginsService {
    
    private readonly client: AxiosInstance;
    private readonly baseUrl: string;
    
    constructor() {
        // URL du backend Flask
        // TODO: Rendre configurable via les préférences Theia
        this.baseUrl = 'http://localhost:8000';
        
        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: 30000, // 30 secondes
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
    
    /**
     * Récupère la liste des plugins.
     */
    async listPlugins(filters?: PluginFilters): Promise<Plugin[]> {
        try {
            const params: Record<string, string> = {};
            
            if (filters?.source) {
                params.source = filters.source;
            }
            if (filters?.category) {
                params.category = filters.category;
            }
            if (filters?.enabled !== undefined) {
                params.enabled = filters.enabled.toString();
            }
            
            const response = await this.client.get('/api/plugins', { params });
            
            // L'API retourne { plugins: Plugin[], total: number, filters: {} }
            const plugins: Plugin[] = response.data.plugins || [];
            
            // Ajouter la catégorie principale si elle existe
            return plugins.map(plugin => ({
                ...plugin,
                category: plugin.categories && plugin.categories.length > 0 
                    ? plugin.categories[0] 
                    : undefined
            }));
            
        } catch (error) {
            console.error('Erreur lors de la récupération des plugins:', error);
            throw new Error(`Impossible de récupérer les plugins: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Récupère les détails d'un plugin.
     */
    async getPlugin(name: string): Promise<PluginDetails> {
        try {
            const response = await this.client.get(`/api/plugins/${name}`);
            const plugin = response.data;
            
            // Ajouter la catégorie principale si elle existe
            if (plugin.categories && plugin.categories.length > 0 && !plugin.category) {
                plugin.category = plugin.categories[0];
            }
            
            return plugin;
            
        } catch (error) {
            console.error(`Erreur lors de la récupération du plugin ${name}:`, error);
            throw new Error(`Plugin ${name} introuvable: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Exécute un plugin de manière synchrone.
     */
    async executePlugin(name: string, inputs: PluginInputs): Promise<PluginResult> {
        try {
            const response = await this.client.post(`/api/plugins/${name}/execute`, {
                inputs
            });
            
            return response.data;
            
        } catch (error) {
            console.error(`Erreur lors de l'exécution du plugin ${name}:`, error);
            throw new Error(`Échec de l'exécution du plugin ${name}: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Récupère le statut de tous les plugins.
     */
    async getPluginsStatus(): Promise<PluginsStatus> {
        try {
            const response = await this.client.get('/api/plugins/status');
            return response.data;
            
        } catch (error) {
            console.error('Erreur lors de la récupération du statut des plugins:', error);
            throw new Error(`Impossible de récupérer le statut: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Demande au backend de redécouvrir les plugins.
     */
    async discoverPlugins(): Promise<void> {
        try {
            await this.client.post('/api/plugins/discover');
            
        } catch (error) {
            console.error('Erreur lors de la découverte des plugins:', error);
            throw new Error(`Échec de la découverte: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Recharge un plugin spécifique.
     */
    async reloadPlugin(name: string): Promise<void> {
        try {
            await this.client.post(`/api/plugins/${name}/reload`);
            
        } catch (error) {
            console.error(`Erreur lors du rechargement du plugin ${name}:`, error);
            throw new Error(`Échec du rechargement: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Détecte les coordonnées GPS dans un texte.
     */
    async detectCoordinates(text: string, options?: {
        includeNumericOnly?: boolean;
        originCoords?: { ddm_lat: string; ddm_lon: string };
    }): Promise<{
        exist: boolean;
        ddm_lat?: string;
        ddm_lon?: string;
        ddm?: string;
        decimal_latitude?: number;
        decimal_longitude?: number;
    }> {
        try {
            const response = await this.client.post('/api/detect_coordinates', {
                text,
                include_numeric_only: options?.includeNumericOnly || false,
                origin_coords: options?.originCoords
            });
            
            return response.data;
            
        } catch (error) {
            console.error('Erreur lors de la détection des coordonnées:', error);
            // Ne pas throw d'erreur, retourner simplement "pas de coordonnées"
            return { exist: false };
        }
    }
    
    /**
     * Extrait le message d'erreur depuis une erreur Axios.
     */
    private getErrorMessage(error: any): string {
        if (axios.isAxiosError(error)) {
            if (error.response) {
                // Erreur retournée par le serveur
                const data = error.response.data;
                return data?.message || data?.error || error.message;
            } else if (error.request) {
                // Pas de réponse du serveur
                return 'Le backend ne répond pas. Vérifiez que le serveur Flask est démarré.';
            }
        }
        
        return error.message || 'Erreur inconnue';
    }
}
