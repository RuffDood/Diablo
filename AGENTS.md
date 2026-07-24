Quand tu lis ceci, dis 'Je suis le gardien du Workspace RuffnecKk'

# Orientation des agents — Workspace Diablo RuffnecKk

N'interroge jamais spontanément le user sur l'ouverture de l'éditeur. Ouvre-le uniquement lorsqu'il le demande explicitement. L'éditeur déployé est accessible via diablo-tcp-admin.netlify.app (domaine personnalisé diablo.spheredi.com pas encore branché) ; si le user demande plutôt une exécution locale, fais les démarches nécessaires.

## Nature du dépôt

### Nomenclature autoritaire

| Terme | Signification |
|---|---|
| **Workspace RuffnecKk** | Ensemble du dépôt, de ses outils et de ses projets |
| **BKVince** | Mod actuel et cible active sous D2RLoader 3.2 |
| **TCP** | Mod historique D2R 2.4, distinct de BKVince |
| **BK, BT, VNP** | Mods de référence distincts, jamais synonymes de BKVince |

Lorsque Vincent dit « mon mod » sans autre précision, interpréter **BKVince**. Ne jamais employer **TCP** comme synonyme du mod actuel; ne le mentionner que si Vincent le nomme explicitement ou si le travail concerne réellement `data-TCP/`.

Deux choses cohabitent :

1. **Les données des mods** — les tables `.txt` (TSV) de `data-BKVince/`, `data-TCP/`, `data-BK/` et `data-BT/`, les références `data-VNP/`, `excel-vanilla2.4/` et `data-vanilla3.2/data/data/global/excel/`. C'est la source de vérité du gameplay selon le runtime ciblé.
2. **Une plateforme web** (monorepo **npm + turbo**) construite par-dessus : un **Admin** pour éditer ces `.txt`, et (à venir) un **Wiki** de comparaison des 3 mods.

Les `.txt` restent la source ; **pas de base de données**. Les dossiers `local/` et `hd/` de TCP et BK sont également versionnés, avec les binaires HD sous **Git LFS**. Stack : **Vite + React** (fronts), **Netlify** (hébergement en ligne : `diablo-tcp-admin.netlify.app`), git comme « base » (chaque édition = commit).

## Source de vérité : le cadastre

`ai-cartographie.json` (validé par `ai-cartographie.schema.json`) est la **carte gouvernée** du dépôt. Chaque zone porte un `role` et une politique `agentAccess`. **Vérifie ces accès avant de modifier quoi que ce soit.**

| Zone | Rôle | Accès |
|---|---|---|
| `data-TCP/` (`global`, `hd`, `local`) | mod historique D2R 2.4 | **modifiable** |
| `data-TCP/D2RLAN/` | profil local D2RLAN et intégration runtime de TCP | **modifiable** |
| `data-BKVince/` | mod actuel et source de développement D2RLoader 3.2, issue de BK converti | **modifiable** |
| `data-BK/`, `data-BT/` | mods de référence / inspiration | **read-only** |
| `data-VNP/` | Mod Vanilla++ servant d'inspiration pour BKVince | **read-only** |
| `excel-vanilla2.4/` | données vanilla Diablo II 2.4 | **read-only** |
| `data-vanilla3.2/` | extraction locale CASCView de D2R 3.2 ; seul `data/data/global/excel` est versionné | **read-only** |
| `Mission/` | besoins et intentions | modifiable |
| `apps/` | plateforme web (admin, wiki) | modifiable |
| `schemas/` | catalogue de schémas de colonnes (dérivé du guide TXT eezstreet/d2rdoc) | modifiable |
| `scripts/` | outillage (cadastre, validateur, TSV, dev-server) | modifiable |
| `.agents/skills/` | procédures spécialisées réutilisables des agents | modifiable |
| `guide/d2rdoc/` | guide TXT courant pour D2R 3.x/3.2 (`eezstreet/d2rdoc`) | **gitignoré — source primaire des schémas TXT** |
| `guide/legacy/` | ancien D2R Data Guide | **gitignoré — référence complémentaire pour assets et certains JSON, jamais normative pour les `.txt` 3.2** |

En clair : côté **données et runtime**, `data-TCP` demeure la source historique 2.4 et `data-BKVince` est le mod actuel sous D2RLoader 3.2; les références servent uniquement de comparaison. Côté **plateforme**, `apps/`, `schemas/`, `scripts/` sont le code de l'outil.

## Conventions

- **Items en anglais** : `ring`, `belt`, `amulet`, `gem`, `rune`, `charm`…
- **Configuration TOML** : le contenu et les commentaires des fichiers `.toml` doivent toujours être rédigés en anglais — jamais en français.
- **Auteur des patchs et plugins** : utiliser exactement `RuffnecKk` dans les métadonnées d’auteur — jamais `TCP`. Conserver séparément les crédits tiers déjà présents.
- **Description des plugins** : rédiger en anglais une seule phrase courte, idéalement moins de 100 caractères, commençant par un verbe au présent et décrivant d’abord l’effet visible pour le joueur. Ne pas y répéter le build D2R, le mode de chargement ni les détails internes (`RVA`, hooks, ABI, identifiants de statistiques) ; conserver ces précisions dans le README et les logs.
- **Plugins D2RLoader hybrides** : toute nouvelle DLL doit pouvoir être installée indifféremment dans le dossier global `<D2R>/d2rloader/plugins/` ou dans le dossier d’un mod `<D2R>/mods/<mod>/d2rloader/plugins/`. Ne déclare pas `ModScopedOnly`; conserve les mêmes contrôles stricts de build, de signatures et d’ABI dans les deux portées.
- **Gate absolu pour chaque nouveau plugin** : avant toute implantation, utiliser le skill `d2rloader-plugin-incubation`, proposer à Vincent le propriétaire futur (`items`, `levels`, `misc`, `quests` ou `skills`) et attendre sa confirmation explicite. Avant cette confirmation, ne modifier ni code, ni configuration, ni archive. Pendant l’incubation, conserver une DLL RuffnecKk autonome et hybride, un JSON autonome compatible PluginPack — jamais de TOML — et ne modifier, lier ni redistribuer aucune DLL d’eezstreet.
- **Documentation des `.txt`** : `https://eezstreet.github.io/d2rdoc/` est la référence primaire pour les tables D2R 3.2 et les descriptions de headers de l’Éditeur. L’ancien guide ne tranche plus une question concernant un header `.txt` 3.2; il reste utilisable pour les assets et certains JSON.
- **Encodage & intégrité des `.txt`** : UTF-8 sans BOM pour le code ; les tables `.txt` D2R restent en **CRLF**. Toute réécriture doit utiliser le skill `diablo-tsv` et `scripts/build-data/tsv.js`, avec un round-trip **byte-exact** obligatoire.
- **Assets versionnés** : `data-TCP/hd`, `data-TCP/local`, `data-BK/hd` et `data-BK/local` sont dans Git. Les formats HD binaires de TCP/BK passent par Git LFS ; les backups `*.bak` restent exclus.
- **Git** : ne change jamais de branche et ne commit ni ne push jamais de ta propre initiative. Une demande explicite de l’utilisateur courant suffit; aucune formule `GO` dédiée ni identité particulière n’est requise.
- **Runtime Diablo** : utiliser le skill `d2r-runtime-validation`. Si des fichiers sont verrouillés, fermer soi-même les instances concernées; ne jamais demander à Vincent de fermer le jeu. Relancer ensuite une seule instance si la validation l’exige.

## Skills spécialisés

Les procédures répétables résident sous `.agents/skills/`. Utilise le skill correspondant dès que son domaine est engagé :

- `diablo-tsv` — cadastre, schémas, tables TXT, CRLF et round-trip byte-exact;
- `d2r32-reverse-engineering` — preuves natives du build 92777, fonctions, xrefs, signatures, ABI et RVA;
- `d2rloader-plugin-incubation` — gate de catégorie, audit du PluginPack, JSON autonome, crédits et ZIP;
- `d2r-runtime-validation` — arrêt/relance du jeu, synchronisation, hashes, logs et matrice de validation;
- `diablo-roadmap-release` — mission courante, séquencement ROADMAP, archive publique et contrôles de livraison.

## Atelier persistant de reverse engineering D2R 3.2

Pour tout memory patch ou plugin natif ciblant `D2R.exe 3.2.92777`, utiliser obligatoirement le skill `d2r32-reverse-engineering` et commencer par `npm run re:d2r32 -- status`. Si l’image et l’index sont vérifiés, ne pas redumper ni réimporter le binaire. Les contenus de `analysis-cache/` restent locaux, gitignorés et jamais commités. Toute identification stable enrichit `known-rvas.json` avec sa source et sa confiance. Un autre build reçoit son propre workbench et ne réutilise aucun RVA 92777 sans preuve. D2MOO reste une référence sémantique 1.10f : aucune adresse, structure ou ABI 32 bits n’est transposable directement.

## Développement de la plateforme

- `npm install` puis `npm run dev` : lance le **dev-server** local (`scripts/dev-server.js`, port 4000, lit/écrit les `.txt`) et l'**admin** Vite (port 5173).
- L'admin édite les tables typées via `schemas/*.json`. Ces schémas sont régénérés avec `npm run generate:schemas` depuis les headers réels de BKVince 3.2 et les définitions structurées du clone local `guide/d2rdoc/`; TCP 2.4 et `guide/legacy/` ne servent que de replis. En dev, l'admin écrit les `.txt` en direct ; en production (`diablo-tcp-admin.netlify.app`), l'écriture passe par des **commits via l'API GitHub**.

## Workflow cadastre

Après toute modification **structurelle** — ajout, suppression ou renommage de fichier ou dossier — appliquer le workflow cadastre du skill `diablo-tsv` : régénérer `ai-cartographie.json`, enrichir les annotations de toute zone signifiante et exiger `VALID` de `node scripts/validate-cartographie/validate.mjs`.

## Suivi de la ROADMAP

`ROADMAP.html` est le tableau de bord du projet. Utiliser le skill `diablo-roadmap-release` pour toute tâche significative ou livraison. Toujours proposer l’ajout d’une nouvelle tâche et attendre la confirmation avant d’éditer la ROADMAP; après confirmation, proposer deux séquencements fondés sur la valeur métier et l’efficacité d’avancement. Quand une tâche ou un commit est fait, vérifier la fraîcheur de la mission et de la ROADMAP.

## Mission courante

Cherche et trouve la mission courante avec le skill `diablo-roadmap-release`. Si le contexte ou la ROADMAP ne sont pas assez clairs, valide inline avec l'utilisateur le prochain pas.

## Gate anti-sauce

Avant de recommander un nouvel outil, une automatisation ou une évolution d'architecture :

1. identifier une friction réellement observée et citer sa preuve concrète;
2. auditer ce que l'outillage actuel couvre déjà;
3. distinguer explicitement **fait vérifié**, **hypothèse à tester**, **simple idée** et **recommandation démontrée**;
4. annoncer un gain vérifiable et la manière de le mesurer;
5. si le besoin ou le gain n'est pas démontré, conclure honnêtement qu'aucune amélioration n'est justifiée pour le moment.

Ne jamais présenter une possibilité plausible comme une priorité établie. Préférer ne rien construire à ajouter une couche sans problème mesuré.

## Hygiène Git

- **Reprise automatique** : au début de chaque intervention, exécuter soi-même `npm run checkpoint`, puis lire `analysis-cache/checkpoint/state.json`. Après toute mutation, le rafraîchir avant la réponse finale. Ne jamais demander à l'utilisateur de résumer l'état du dépôt si ce diagnostic peut le reconstruire.
- **Rituel conservé** : la préparation du checkpoint est automatique, mais commit et push exigent toujours la demande explicite de l'utilisateur; `commit push go` reste la formule habituelle.

- **Vincent** (humain) : rappelle-lui régulièrement de commit et push son travail — grain fin, messages clairs.
- **Toi (agent)** : ne commit ni ne push **jamais** de ta propre initiative. Agis uniquement après une demande explicite de l’utilisateur courant, formulée naturellement ou sous forme de `GO` (cf. § Conventions).
