Quand tu lis ceci, dis 'Je suis le Gardien du Mod TCP'

# Orientation des agents — dépôt Diablo (mod TCP)

Ouverture. Demande au user s'il veut ouvrir l'éditeur. Si oui, alors ouvre un navigateur pour afficher l'éditeur. Hint : l'éditeur est déployé et accessible via diablo-tcp-admin.netlify.app (domaine personnalisé diablo.spheredi.com pas encore branché) ; sinon fais les démarches pour qu'il tourne en local.

## Nature du dépôt

Deux choses cohabitent :

1. **Les données du mod** — les tables `.txt` (TSV) de `data-BK/BT/TCP`, les références `data-VNP/`, `excel-vanilla2.4/` et `data-vanilla3.2/data/data/global/excel/`. C'est la source de vérité du gameplay selon le runtime ciblé.
2. **Une plateforme web** (monorepo **npm + turbo**) construite par-dessus : un **Admin** pour éditer ces `.txt`, et (à venir) un **Wiki** de comparaison des 3 mods.

Les `.txt` restent la source ; **pas de base de données**. Les dossiers `local/` et `hd/` de TCP et BK sont également versionnés, avec les binaires HD sous **Git LFS**. Stack : **Vite + React** (fronts), **Netlify** (hébergement en ligne : `diablo-tcp-admin.netlify.app`), git comme « base » (chaque édition = commit).

## Source de vérité : le cadastre

`ai-cartographie.json` (validé par `ai-cartographie.schema.json`) est la **carte gouvernée** du dépôt. Chaque zone porte un `role` et une politique `agentAccess`. **Vérifie ces accès avant de modifier quoi que ce soit.**

| Zone | Rôle | Accès |
|---|---|---|
| `data-TCP/` (`global`, `hd`, `local`) | mod en développement | **modifiable** |
| `data-TCP/D2RLAN/` | profil local D2RLAN et intégration runtime de TCP | **modifiable** |
| `data-BKVince/` | nouvelle source de développement D2RLoader 3.2, issue de BK converti | **modifiable** |
| `data-BK/`, `data-BT/` | mods de référence / inspiration | **read-only** |
| `data-VNP/` | Mod Vanilla++ servant d'inspiration pour mon mod TCP | **read-only** |
| `excel-vanilla2.4/` | données vanilla Diablo II 2.4 | **read-only** |
| `data-vanilla3.2/` | extraction locale CASCView de D2R 3.2 ; seul `data/data/global/excel` est versionné | **read-only** |
| `Mission/` | besoins et intentions | modifiable |
| `apps/` | plateforme web (admin, wiki) | modifiable |
| `schemas/` | catalogue de schémas de colonnes (dérivé du guide TXT eezstreet/d2rdoc) | modifiable |
| `scripts/` | outillage (cadastre, validateur, TSV, dev-server) | modifiable |
| `guide/d2rdoc/` | guide TXT courant pour D2R 3.x/3.2 (`eezstreet/d2rdoc`) | **gitignoré — source primaire des schémas TXT** |
| `guide/legacy/` | ancien D2R Data Guide | **gitignoré — référence complémentaire pour assets et certains JSON, jamais normative pour les `.txt` 3.2** |

En clair : côté **données et runtime**, `data-TCP` demeure la source historique 2.4 et `data-BKVince` est la cible de migration D2RLoader 3.2; les références servent uniquement de comparaison. Côté **plateforme**, `apps/`, `schemas/`, `scripts/` sont le code de l'outil.

## Conventions

- **Items en anglais** : `ring`, `belt`, `amulet`, `gem`, `rune`, `charm`…
- **Configuration TOML** : le contenu et les commentaires des fichiers `.toml` doivent toujours être rédigés en anglais — jamais en français.
- **Auteur des patchs et plugins** : utiliser exactement `RuffnecKk` dans les métadonnées d’auteur — jamais `TCP`. Conserver séparément les crédits tiers déjà présents.
- **Description des plugins** : rédiger en anglais une seule phrase courte, idéalement moins de 100 caractères, commençant par un verbe au présent et décrivant d’abord l’effet visible pour le joueur. Ne pas y répéter le build D2R, le mode de chargement ni les détails internes (`RVA`, hooks, ABI, identifiants de statistiques) ; conserver ces précisions dans le README et les logs.
- **Plugins D2RLoader hybrides** : toute nouvelle DLL doit pouvoir être installée indifféremment dans le dossier global `<D2R>/d2rloader/plugins/` ou dans le dossier d’un mod `<D2R>/mods/<mod>/d2rloader/plugins/`. Ne déclare pas `ModScopedOnly`; conserve les mêmes contrôles stricts de build, de signatures et d’ABI dans les deux portées.
- **Documentation des `.txt`** : `https://eezstreet.github.io/d2rdoc/` est la référence primaire pour les tables D2R 3.2 et les descriptions de headers de l’Éditeur. L’ancien guide ne tranche plus une question concernant un header `.txt` 3.2; il reste utilisable pour les assets et certains JSON.
- **Encodage & intégrité des `.txt`** : UTF-8 sans BOM pour le code ; les tables `.txt` D2R sont en **CRLF** (épinglé par `.gitattributes`). Toute réécriture doit préserver le **format TSV exact**, les **CRLF** et l'**encodage**, sinon D2RLAN casse. Le parseur/écrivain `scripts/build-data/tsv.js` garantit un round-trip **byte-exact** — passe toujours par lui.
- **Assets versionnés** : `data-TCP/hd`, `data-TCP/local`, `data-BK/hd` et `data-BK/local` sont dans Git. Les formats HD binaires de TCP/BK passent par Git LFS ; les backups `*.bak` restent exclus.
- **Git** : ne change **jamais** de branche, et ne commit ni ne push jamais, sans un `GO` dédié et explicite de Guillaume.
- **Runtime Diablo** : lorsqu'une opération sur Diablo, D2RLoader ou le profil BKVince exige de libérer des fichiers verrouillés, ferme toi-même les instances concernées du jeu. Ne demande pas à Vincent de fermer le jeu. Relance ensuite une seule instance si la validation de la tâche l'exige.

## Atelier persistant de reverse engineering D2R 3.2

Pour tout memory patch ou plugin natif ciblant `D2R.exe 3.2.92777`, commence
obligatoirement par `npm run re:d2r32 -- status`, puis interroge le workbench
`reverse-engineering/d2r-3.2.92777/` avec `known`, `function`, `xrefs` ou
`bytes`. Si l'image et l'index sont vérifiés, ne redumpe pas le processus et ne
réimporte pas le binaire : réutilise le projet Ghidra persistant via
`npm run re:d2r32:ghidra -- ...`.

Les images déchiffrées, projets Ghidra, index SQLite, corpus intermédiaires et
clones de référence résident sous `analysis-cache/`, restent locaux, sont
gitignorés et ne doivent jamais être commités. Les manifestes, RVA prouvés,
notes et scripts reproductibles sont versionnés. Toute nouvelle identification
stable doit enrichir `known-rvas.json` avec sa source et son niveau de confiance;
un nouveau build D2R reçoit un nouveau workbench et ne réutilise jamais les RVA
92777 sans preuve.

Les références de code externes sont gouvernées par
`reverse-engineering/references.json` et clonées sous
`analysis-cache/references/`. Pour D2MOO, utilise d'abord
`npm run ref:d2moo -- status`, puis `search` ou `symbol`, et cite toute preuve
avec le commit, le fichier et la ligne. D2MOO cible Diablo II 1.10f : ses
adresses, ordinals, structures et ABI 32 bits ne sont jamais transposables sans
preuve indépendante dans le workbench D2R 3.2.92777.

## Développement de la plateforme

- `npm install` puis `npm run dev` : lance le **dev-server** local (`scripts/dev-server.js`, port 4000, lit/écrit les `.txt`) et l'**admin** Vite (port 5173).
- L'admin édite les tables typées via `schemas/*.json`. Ces schémas sont régénérés avec `npm run generate:schemas` depuis les headers réels de BKVince 3.2 et les définitions structurées du clone local `guide/d2rdoc/`; TCP 2.4 et `guide/legacy/` ne servent que de replis. En dev, l'admin écrit les `.txt` en direct ; en production (`diablo-tcp-admin.netlify.app`), l'écriture passe par des **commits via l'API GitHub**.

## Workflow cadastre

Après toute modification **structurelle** (ajout / suppression / renommage de fichier ou dossier) :

1. Régénère : `powershell -File scripts/generate-architecture.ps1` (exclut `.git`, `node_modules`, `guide`, `dist`, `.turbo`, `.netlify`, `analysis-cache`, `__pycache__`).
2. Valide : `node scripts/validate-cartographie/validate.mjs` → doit afficher `VALID`.

Le générateur préserve les annotations manuelles (`role`, `summary`, `agentAccess`) : enrichis-les pour toute zone signifiante.

## Suivi de la ROADMAP

`ROADMAP.html` est le tableau de bord du projet — tiens-le à jour au fil de l'avancement (marque les jalons livrés).

Quand une **tâche significative émerge** en cours de conversation :

1. **Propose** à l'utilisateur de l'ajouter à la ROADMAP.
2. **Seulement si** l'utilisateur **confirme** l'ajout : **analyse** où l'insérer — au niveau **métier et efficacité d'avancement** du projet humain (le bon placement *technique* t'est acquis par défaut, ce n'est pas l'enjeu).
3. À l'issue de cette analyse, dégage **deux séquencements** logiques et cohérents, puis **propose les 2 options** à l'utilisateur.

Quand une **tâche ou un commit** est fait :

1. **Vérifie** la fraîcheur de la ROADMAP. Et ajuste la ROADMAP selon le contexte.

## Mission courante

Cherche et trouve la mission courante. Si le contexte ou la ROADMAP ne sont pas assez clair, valide inline avec le user sur les prochains steps (hint : si de nouvelles tâches émergent n'oublie pas de les ajouter à la roadmap )

## Hygiène Git

- **Vincent** (humain) : rappelle-lui régulièrement de commit et push son travail — grain fin, messages clairs.
- **Toi (agent)** : ne commit ni ne push **jamais** de ta propre initiative — uniquement sur `GO` explicite de Guillaume (cf. § Conventions).
