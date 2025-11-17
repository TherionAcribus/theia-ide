# Intégration IA dans Formula Solver

## Vue d'ensemble

Le Formula Solver intègre maintenant un agent IA spécialisé pour résoudre automatiquement les formules de géocaching Mystery. L'utilisateur peut choisir entre la méthode algorithmique classique et la résolution assistée par IA via un simple toggle dans l'interface.

## Architecture

### Backend (Flask)

#### 1. Service de Recherche Web
**Fichier**: `gc-backend/gc_backend/services/web_search_service.py`

Service pour rechercher des réponses sur Internet via l'API DuckDuckGo.

Fonctionnalités:
- Recherche sans clé API nécessaire
- Parsing et scoring des résultats
- Extraction de la meilleure réponse

#### 2. Endpoints AI
**Fichier**: `gc-backend/gc_backend/blueprints/formula_solver.py`

Nouveaux endpoints optimisés pour les tools de l'agent:

- `POST /api/formula-solver/ai/detect-formula` - Détection enrichie de formule
- `POST /api/formula-solver/ai/find-questions` - Recherche de questions
- `POST /api/formula-solver/ai/search-answer` - Recherche web
- `POST /api/formula-solver/ai/suggest-calculation-type` - Suggestion de type de calcul

### Frontend (Theia)

#### 1. Tool Functions
**Fichier**: `src/browser/formula-solver-tools.ts`

Enregistre 5 tools pour l'agent:

1. `detect_formula` - Détection de formule GPS
2. `find_questions_for_variables` - Recherche de questions
3. `search_answer_online` - Recherche web
4. `calculate_variable_value` - Calcul de valeur (checksum, longueur, etc.)
5. `calculate_final_coordinates` - Calcul coordonnées finales

#### 2. Agent Formula Solver
**Fichier**: `src/browser/formula-solver-agent.ts`

Agent IA spécialisé avec:
- ID: `formula-solver`
- Prompt système détaillé expliquant le processus de résolution
- Utilisation des 5 tools ci-dessus

#### 3. Service d'appel de l'agent
**Fichier**: `src/browser/formula-solver-ai-service.ts`

Service pour interagir avec l'agent:
- Méthode `solveWithAI(text, geocacheId?)` 
- Vérification de disponibilité de l'IA
- Parsing des résultats structurés

#### 4. Widget UI
**Fichier**: `src/browser/formula-solver-widget.tsx`

Modifications:
- Toggle "Algorithme / IA" en haut du widget
- Méthode `solveWithAI()` pour résolution IA
- Méthode `detectFormulasWithAlgorithm()` pour méthode classique
- Sauvegarde de la préférence de méthode

#### 5. Module DI
**Fichier**: `src/browser/formula-solver-frontend-module.ts`

Enregistrement de:
- `FormulaSolverAIService`
- `FormulaSolverAgent` (comme `Agent`)
- `FormulaSolverToolsManager` (comme `FrontendApplicationContribution`)

### Préférences

**Fichier**: `shared/preferences/geo-preferences-schema.json`

Nouvelles préférences:
- `geoApp.formulaSolver.defaultMethod` - "algorithm" ou "ai"
- `geoApp.formulaSolver.ai.webSearchEnabled` - Autoriser recherche web
- `geoApp.formulaSolver.ai.maxWebResults` - Nombre max de résultats web

## Flux de Résolution avec IA

1. **Utilisateur** active le mode IA et colle une description de géocache
2. **Widget** appelle `FormulaSolverAIService.solveWithAI(text)`
3. **Service** vérifie que l'agent est disponible
4. **Service** envoie une requête à l'agent avec le texte
5. **Agent** utilise ses tools dans l'ordre:
   - `detect_formula` → trouve la formule
   - `find_questions_for_variables` → trouve les questions
   - Pour chaque question, `search_answer_online` → cherche la réponse
   - Pour chaque réponse, `calculate_variable_value` → calcule la valeur
   - `calculate_final_coordinates` → calcule les coordonnées finales
6. **Service** parse la réponse et retourne les résultats structurés
7. **Widget** affiche les résultats (formule, questions, réponses, coordonnées)

## Utilisation

### Pour l'Utilisateur

1. Ouvrir le widget Formula Solver
2. Cliquer sur le toggle "IA 🤖" en haut à droite
3. Coller la description de la géocache
4. Cliquer sur "Détecter la formule"
5. L'agent IA traite automatiquement toutes les étapes
6. Les résultats s'affichent au fur et à mesure

### Configuration

La méthode par défaut est configurable dans les préférences:
```json
{
  "geoApp.formulaSolver.defaultMethod": "algorithm"
}
```

Pour activer l'IA par défaut:
```json
{
  "geoApp.formulaSolver.defaultMethod": "ai"
}
```

## Dépendances

### Backend
- `requests` - Pour les appels web search

### Frontend
- `@theia/ai-core` - Pour Agent, ToolInvocationRegistry, AgentService
- Pas de dépendances supplémentaires (déjà présentes dans Theia)

## Limitations Actuelles

1. **Parsing de réponse agent**: Le parsing de la réponse de l'agent est basique et peut nécessiter des améliorations selon le format exact de réponse de l'AgentService de Theia
2. **Questions complexes**: Les questions nécessitant observation sur place ne peuvent pas être résolues automatiquement
3. **Rate limiting**: Pas de limitation de taux pour les recherches web (à implémenter si nécessaire)
4. **Coûts LLM**: Pas de tracking des tokens utilisés (à implémenter pour monitoring)

## Améliorations Futures

1. **Streaming de réponse**: Afficher les étapes en temps réel pendant la résolution
2. **Historique**: Sauvegarder l'historique des résolutions IA
3. **Feedback**: Permettre à l'utilisateur de corriger les réponses de l'IA
4. **Multi-agents**: Utiliser plusieurs agents spécialisés (détection, résolution, vérification)
5. **Cache**: Mettre en cache les résultats de recherche web
6. **Validation externe**: Intégrer GeoCheck pour valider les coordonnées finales

## Debug

### Logs Backend
Les logs sont préfixés par `[AI]`:
```
[AI] Détection formule: 1 trouvée(s), confiance moyenne: 0.92
[AI] Recherche questions: 6/6 trouvées
[AI] Recherche web: 3 résultats pour 'hauteur tour eiffel'
```

### Logs Frontend
Les logs sont préfixés par `[FORMULA-SOLVER-AI]` ou `[FORMULA-SOLVER-TOOLS]`:
```
[FORMULA-SOLVER-AI] Démarrage résolution IA...
[FORMULA-SOLVER-TOOLS] detect_formula appelé: {...}
[FORMULA-SOLVER-AI] Résultat IA: {...}
```

## Tests

Pour tester l'intégration:

1. **Backend**: Les endpoints AI peuvent être testés directement:
```bash
curl -X POST http://localhost:8000/api/formula-solver/ai/detect-formula \
  -H "Content-Type: application/json" \
  -d '{"text": "N 47° 5A.BC E 006° 5D.EF"}'
```

2. **Frontend**: 
   - Ouvrir Formula Solver
   - Activer le mode IA
   - Coller une formule simple
   - Vérifier les logs dans la console navigateur

## Compatibilité

- **Theia**: Testé avec Theia 1.65.1
- **@theia/ai-core**: Compatible avec les versions récentes supportant Agent et ToolInvocationRegistry
- **Backend**: Python 3.8+, Flask

## Auteur

Intégration IA réalisée selon le plan d'architecture défini dans `integration.plan.md`.

