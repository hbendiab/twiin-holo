# n8ncli : retour d'expérience (projet Twiin, 18/11/2026)

Contexte : `@workflows-accelerator/n8n-cli` 1.2.40, n8n self-hosted local (2.10.2 puis 2.48.4), base SQLite, macOS.
Objectif : générer des workflows, les valider, les exécuter et lire leurs journaux depuis un programme (Twiin).

## Problèmes constatés et corrections proposées

| # | Commande | Symptôme | Cause | Correction proposée |
|---|---|---|---|---|
| 1 | `exec` | `Input validation error: Invalid arguments for tool execute_workflow: inputs: Invalid input` | n8ncli envoie `inputs: {type: "webhook", body}` (et le même objet dans `payload`). Le MCP de n8n 2.48 attend `inputs: {webhookData: {method, body, query, headers}}` | Construire `inputs = {webhookData: {method: "POST", body: <--input>}}` pour un webhook, `{formData}` pour un formulaire, `{chatInput}` pour un chat ; ne plus envoyer `payload` |
| 2 | `exec` | `Provide triggerNodeName and inputs…` / `This workflow has multiple triggers` | `exec` n'a pas d'option pour choisir le déclencheur (`test` en a une : `options.trigger`) | Ajouter `--trigger <nom>` à `exec` ; le choisir automatiquement s'il n'y a qu'un webhook |
| 3 | `exec` | La commande rend la main avec `{"executionId": "6", "status": "started"}` | `execute_workflow` est asynchrone | Ajouter `--wait` : interroger `get_workflow_execution` jusqu'à la fin et afficher le statut final. Attention : le statut est dans `result.execution.status`, pas `result.status` |
| 4 | `logs`, `execution` | `MCP error -32602: Tool get_execution not found` / `Could not retrieve execution details` | L'outil MCP s'appelle `get_workflow_execution` (et `search_workflow_executions`) dans n8n 2.48 | Utiliser `get_workflow_execution({workflowId, executionId})` et `search_workflow_executions` ; garder l'ancien nom en repli |
| 5 | `init`, `projects`, `pull` (n8n 2.10) | `MCP error -32602: Tool search_projects not found` | Le MCP de n8n 2.10 n'a pas ces outils | Vérifier la version de l'instance (`get_instance_context` ou en-tête) et afficher : « n8ncli demande n8n ≥ 2.4x (version détectée : 2.10.2) » |
| 6 | `exec` (n8n 2.10) | `Only workflows with the following trigger nodes can be executed: …` alors que le workflow importé contient un webhook | Workflow importé par `n8n import:workflow` : pas de version enregistrée côté MCP | Message d'aide : « publie ou ouvre le workflow une fois dans l'éditeur », ou passer par `create_workflow_from_code` |
| 7 | `exec` (production) | `has no published (active) version to execute` | Mode par défaut = production | Message d'aide : « ajoute `--mode manual` pour tester sans publier » |
| 8 | `envs test` | `Unauthorized: jwt malformed` | L'utilisateur a collé l'adresse du serveur MCP (`http://localhost:5678/mcp-server/http`) au lieu du jeton | Détecter une valeur qui commence par `http` ou qui n'est pas un JWT (`eyJ…`) : « ceci est l'adresse du serveur, pas le jeton (Settings → MCP Access → Access token) » |
| 9 | `validate --lint` | Avertissements « non-English words » et Title Case sur des noms français (`Préparer la ligne`) | Règles pensées pour l'anglais | Option de langue dans `n8n-standards.json` (ex. `"locale": "fr"`) ou liste blanche par projet |
| 10 | Installation | n8n 2.48 exige Node ≥ 24 ; le Node de Homebrew peut être cassé (`libsimdjson` manquante) | Hors n8ncli | À documenter dans le README : version de n8n et de Node minimales, et `envs test` qui affiche la version de n8n |

## Ce qui a bien marché

- `envs edit/test` : configuration claire, test REST / MCP / base séparé.
- `pull` d'un workflow précis vers un fichier TypeScript, et `validate --lint` (aucune erreur sur les workflows Twiin).
- Le serveur MCP de n8n 2.48 suffit pour exécuter et suivre une exécution, une fois le bon format utilisé (voir `automation/n8n_twiin.py`, fonctions `mcp()` et `execute_mcp()`).

## Contournement utilisé dans Twiin

`automation/n8n_twiin.py` importe le workflow (`n8n import:workflow`), puis appelle directement le MCP :
`execute_workflow({workflowId, executionMode: "manual", triggerNodeName: "POST /twiin-<id>", inputs: {webhookData: {method: "POST", body}}})`,
puis `get_workflow_execution` jusqu'à ce que `execution.status` ne soit plus `running`.
