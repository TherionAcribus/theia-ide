/**
 * Interfaces pour la gestion des plugins MysterAI.
 * 
 * Ces interfaces correspondent aux structures de données retournées
 * par l'API backend Flask.
 */

/**
 * Représente un plugin MysterAI.
 */
export interface Plugin {
    /** ID unique du plugin en base de données */
    id?: number;
    
    /** Nom unique du plugin */
    name: string;
    
    /** Version du plugin */
    version: string;
    
    /** Version de l'API plugin supportée */
    plugin_api_version?: string;
    
    /** Description du plugin */
    description?: string;
    
    /** Auteur du plugin */
    author?: string;
    
    /** Type de plugin (python, binary, javascript) */
    plugin_type: 'python' | 'binary' | 'javascript';
    
    /** Source du plugin (official, custom) */
    source: 'official' | 'custom';
    
    /** Chemin vers le répertoire du plugin */
    path: string;
    
    /** Point d'entrée (fichier principal) */
    entry_point?: string;
    
    /** Catégories du plugin */
    categories?: string[];
    
    /** Types d'entrée supportés */
    input_types?: Record<string, PluginInputType>;
    
    /** Indique si le plugin est gourmand en CPU */
    heavy_cpu?: boolean;
    
    /** Indique si le plugin nécessite une connexion réseau */
    needs_network?: boolean;
    
    /** Indique si le plugin nécessite l'accès au système de fichiers */
    needs_filesystem?: boolean;
    
    /** Indique si le plugin est activé */
    enabled?: boolean;
    
    /** Métadonnées additionnelles (JSON) */
    metadata_json?: string;
    
    /** Date de création */
    created_at?: string;
    
    /** Date de dernière mise à jour */
    updated_at?: string;
}

/**
 * Définition d'un type d'entrée pour un plugin.
 */
export interface PluginInputType {
    /** Type de données (string, number, boolean, coordinates, etc.) */
    type: string;
    
    /** Label à afficher dans l'interface */
    label?: string;
    
    /** Description de l'entrée */
    description?: string;
    
    /** Valeur par défaut */
    default?: any;
    
    /** Indique si l'entrée est obligatoire */
    required?: boolean;
    
    /** Valeurs possibles (pour les énumérations) */
    enum?: any[];
    
    /** Validation (regex, min, max, etc.) */
    validation?: Record<string, any>;
}

/**
 * Filtres pour la liste des plugins.
 */
export interface PluginFilters {
    /** Filtrer par source */
    source?: 'official' | 'custom';
    
    /** Filtrer par catégorie */
    category?: string;
    
    /** Filtrer par statut enabled */
    enabled?: boolean;
}

/**
 * Résultat de l'exécution d'un plugin.
 */
export interface PluginResult {
    /** Statut de l'exécution */
    status: 'ok' | 'error' | 'partial';
    
    /** Message d'erreur (si status = error) */
    error?: string;
    
    /** Résultats de l'exécution */
    results?: PluginResultItem[];
    
    /** Métadonnées de l'exécution */
    metadata?: {
        /** Temps d'exécution en ms */
        execution_time_ms?: number;
        
        /** Plugin utilisé */
        plugin_name?: string;
        
        /** Version du plugin */
        plugin_version?: string;
        
        /** Autres métadonnées */
        [key: string]: any;
    };
}

/**
 * Un résultat individuel d'un plugin.
 */
export interface PluginResultItem {
    /** Texte résultat */
    text_output?: string;
    
    /** Coordonnées résultats */
    coordinates?: {
        latitude: number;
        longitude: number;
    };
    
    /** Score de confiance (0-1) */
    confidence?: number;
    
    /** Méthode utilisée */
    method?: string;
    
    /** Métadonnées additionnelles */
    [key: string]: any;
}

/**
 * Entrées à fournir lors de l'exécution d'un plugin.
 */
export interface PluginInputs {
    [key: string]: any;
}

/**
 * Statut des plugins (retourné par /api/plugins/status).
 */
export interface PluginsStatus {
    /** Nombre total de plugins */
    total: number;
    
    /** Nombre de plugins chargés */
    loaded: number;
    
    /** Nombre de plugins activés */
    enabled: number;
    
    /** Statut détaillé de chaque plugin */
    plugins: Record<string, {
        enabled: boolean;
        loaded: boolean;
        error?: string;
    }>;
}

/**
 * Le symbole utilisé pour injecter le service des plugins.
 */
export const PluginsService = Symbol('PluginsService');

/**
 * Interface du service de gestion des plugins.
 */
export interface PluginsService {
    /**
     * Récupère la liste des plugins.
     */
    listPlugins(filters?: PluginFilters): Promise<Plugin[]>;
    
    /**
     * Récupère les détails d'un plugin.
     */
    getPlugin(name: string): Promise<Plugin>;
    
    /**
     * Exécute un plugin de manière synchrone.
     */
    executePlugin(name: string, inputs: PluginInputs): Promise<PluginResult>;
    
    /**
     * Récupère le statut de tous les plugins.
     */
    getPluginsStatus(): Promise<PluginsStatus>;
    
    /**
     * Demande au backend de redécouvrir les plugins.
     */
    discoverPlugins(): Promise<void>;
    
    /**
     * Recharge un plugin spécifique.
     */
    reloadPlugin(name: string): Promise<void>;
}
