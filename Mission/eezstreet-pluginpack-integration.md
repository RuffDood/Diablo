# Intégration des plugins RuffnecKk au PluginPack d’eezstreet

## Décision

Option A lancée par Vincent le 22 juillet 2026 : stabiliser d’abord
l’inventaire ABI et la propriété des hooks, puis intégrer les plugins par
tranches. Le dépôt cible audité est `eezstreet/D2RL-Plugins` au commit
`dc75b49ffbb67b887d7757ee00ee9a03bcde5d8a`.

Le prototype est développé uniquement dans le clone externe placé sous
`analysis-cache/`. Aucun commit ou push n’est autorisé par ce document. Il
établit aussi le contrat technique à appliquer dans une future branche de
travail du PluginPack lorsque le périmètre des plugins aura été accepté par les
deux auteurs.

Le dépôt amont est désormais enregistré comme référence gouvernée
`d2rlplugins` dans `reverse-engineering/references.json`. Le clone propre
`analysis-cache/references/D2RL-Plugins` reste byte-identique au commit épinglé
et sert aux citations reproductibles; le clone du workbench 92777 demeure la
copie modifiable réservée aux prototypes. Avant chaque nouvelle fonctionnalité,
`npm run ref:d2rlplugins -- status` vérifie le dépôt, le commit, la propreté et
la déclaration de licence. Une mise à jour amont n’avance jamais silencieusement
le pin : elle doit être examinée avant de devenir la nouvelle référence.

## Preuve de l’environnement ciblé

Le workbench persistant `D2R.exe 3.2.92777` est vérifié :

- image canonique SHA-256
  `CC59119DC2A6C7D43D088098FC162EAFA4AE1299B2079126AEF43C1ACA914715`;
- image d’analyse SHA-256
  `673E8C0B2E89563E75525B24D137098EFD07B2DB4ED42ADEC56AA1ADDF0E63AB`;
- index SQLite vérifié avec 105 850 fonctions, 1 057 329 références et
  59 patch sites connus;
- projet Ghidra persistant présent.

Le clone local du PluginPack contient les cinq plugins `items`, `levels`,
`misc`, `quests` et `skills`, ainsi que `plugin-shared` sous forme de
bibliothèque statique.

## État ABI du PluginPack

`plugin-shared.h` centralise déjà les types suivants :

- `D2TxtFieldDesc` et les conteneurs TXT;
- `D2ItemsTxt`, taille `0x1C0`;
- `D2SkillsTxt`, taille `0x2EC`;
- `D2GameStrc`, avec assertions sur `difficultyLevel`, `expansion`,
  `wItemFormat`, la chaîne vendeur et les seeds;
- `D2StatListStrc`, taille 112;
- `D2UnitStrc`, taille 448, avec champs prouvés à `0x28`, `0x2C`, `0x88`,
  `0x124` et `0x1BD`.

La définition complète de `D2UnitStrc` n’est utilisée directement que par
`plugin-items`, `plugin-skills` et deux helpers de `plugin-shared`. Les nouveaux
plugins ne doivent pas copier cette structure. Ils doivent :

1. employer un type opaque lorsqu’ils ne déréférencent aucun champ;
2. utiliser un accesseur partagé lorsqu’ils lisent un champ déjà canonique;
3. ajouter un champ au type canonique uniquement si son offset 92777 est prouvé
   et couvert par `static_assert`;
4. isoler les structures propres à un sous-système dans un header dédié plutôt
   que d’agrandir systématiquement `plugin-shared.h`.

## Audit des plugins RuffnecKk

La recherche sur les sources versionnées ne trouve aucune définition privée de
`D2UnitStrc`, `D2GameStrc` ou `D2StatListStrc`. Les pointeurs du jeu sont
généralement opaques. Les dépendances ABI restantes sont des fonctions natives
ciblées et, pour quelques plugins, des offsets locaux documentés.

| Plugin | Écritures ou hooks 92777 | Surface ABI | Tranche proposée |
|---|---|---|---|
| `GroundItemLabelLimit` | sept patches entre `0x1516EBE` et `0x1519AF9` | aucune structure gameplay | 1 |
| `GambleScreenLimit` | patch `0x541A7C`, immédiat à `0x541A7E` | aucune structure | 1, fusion dans `plugin-items` |
| `EnhancedDamageMinMaxFix` | hook `0x2FA430` | accès ciblés stat/unit via fonctions natives | 2 |
| `NoEtherealItemTypes` | hook `0x373890` | records `ItemTypesTxt` par offsets ciblés | 2 |
| `BulkSkillPointAllocation` | hook `0x0EC700` | getters natifs, aucune structure complète | 2, fusion dans `plugin-items` |
| `AdvancedItemTooltips` | hook `0x2DC4B0` | tooltip et résolveur natif de sockets | 2 |
| `PotionAutoPickup` | hook `0x4B9DF0` | accesseurs natifs d’unités | 2 |
| `FloatingDamage` | hook `0x427150`, plus D3D12/MinHook | vue locale de l’événement de dégâts et rendu privé | 3 |
| `CharmInventoryAuras` | hooks `0x42D2C0`, `0x491960`, `0x502D00` | offsets skill/item/stat-list ciblés | 3 |
| `RevealMap` | hook `0x3271C0` | offsets unit/path/level/room/DRLG ciblés | 3 |
| `ReviveOverhaul` | hooks `0x4A3A20`, `0x4A7270`, `0x4A8090`, `0x596720` | ABI IA et return-sites stricts | 3 |
| `DurabilityResistance` | hooks `0x2F48C0`, `0x314110`, `0x441B10` | `ItemsTxt` et `ItemTypesTxt` par offsets ciblés | 4, conflit interne à résoudre |
| `Transmogrify` | hooks `0x2BD480`, `0x314110`, `0x43D530`, `0x4F40C0` | records items, tooltip, création et placement | 4, conflit interne à résoudre |
| `ConfigurableCharsiReward` | hooks `0x325C00`, `0x441300`, `0x5DA1C0` | difficulté `D2GameStrc+0x104`, class/TXT ID unité `+0x04` | 4, conflit PluginPack à résoudre |

Les tranches mesurent le coût d’intégration au PluginPack, pas la qualité ou la
valeur gameplay des plugins.

### Correction canonique prouvée pour `D2UnitStrc+0x04`

Le header partagé du PluginPack nomme actuellement le dword à `D2UnitStrc+0x04`
`unitFlags`. Ce nom est sémantiquement incorrect sur le build 92777 : le getter
natif à `0x349860` retourne directement `dword [unit+0x04]` comme class/TXT
record ID. `ConfigurableCharsiReward` lit cette valeur pour comparer le class ID
`monstats` — la cible configurée Andariel se résout à l’ID 156 — tandis que
`Transmogrify` appelle le getter natif pour obtenir le class ID d’un item.

L’usage actuel de `plugin-items`, qui tronque ce même champ à 16 bits pour son
`npcId`, est cohérent avec un TXT record ID et non avec des flags. La structure
canonique devrait donc nommer ce champ `classId` ou `txtRecordId`; un vrai champ
de flags ne doit pas être inventé à cet offset.

## Collisions prouvées

### `0x441300` — propriétaire unique obligatoire

`plugin-items` intercepte l’entrée de la fonction de drop de treasure class à
`0x441300` pour les conditions de drop. `ConfigurableCharsiReward` intercepte
exactement la même entrée afin d’observer la mort d’une cible après l’exécution
du drop original.

Le workbench confirme à `0x441300` le prologue
`40 53 55 56 57 41 54 41 55 41 56 41 57 ...`. Deux hooks indépendants avec
le même tableau d’octets attendus ne constituent pas une coexistence sûre.

Solution recommandée : `plugin-items` demeure propriétaire de l’unique hook et
expose un callback post-drop interne au PluginPack. La logique Charsi s’abonne à
ce callback. Si `ConfigurableCharsiReward` reste une DLL autonome, une seule des
deux fonctionnalités peut posséder ce site sans dispatcher fourni par le
loader.

### `0x314110` — collision déjà présente entre plugins RuffnecKk

`DurabilityResistance` et `Transmogrify` interceptent tous deux
`GetItemsTxtRecord` à `0x314110` :

- le premier active la durabilité des bows/crossbows ciblés;
- le second force `useable=1` pour les records Transmogrify.

Solution recommandée dans le PluginPack : un seul hook propriétaire appelle
l’original puis exécute une chaîne ordonnée de transformateurs de record. Les
deux transformations sont additives, mais leur installation indépendante ne
doit pas être conservée dans le pack fusionné.

### Sous-système gamble — recouvrement sémantique

`plugin-items` possède déjà `D2GAME_STORES_FillGamble` à `0x541880` et modifie
le branchement de filtre à `0x541A28`. `GambleScreenLimit` modifie la limite de
boucle dans la même fonction à `0x541A7C`.

Les plages d’octets ne se chevauchent pas et le hook actuel de `plugin-items`
appelle l’original. La combinaison est donc techniquement composable dans cet
état précis, mais elle doit devenir une option de `plugin-items`, pas un second
plugin ignorant la propriété du sous-système.

## Registre des hooks

`plugin-shared` est une bibliothèque **statique**. Chaque DLL reçoit donc sa
propre copie de ses variables globales. Un registre runtime ajouté naïvement à
`plugin-shared` ne détecterait pas les hooks enregistrés par les autres DLL.

Le PluginPack doit employer deux niveaux :

1. un manifeste source unique recensant, pour chaque RVA, le propriétaire, le
   type d’écriture, la longueur, la fonctionnalité et les octets attendus;
2. un contrôle de build/CI qui refuse les plages chevauchantes et exige un
   propriétaire commun pour les hooks identiques.

Lorsqu’un même RVA doit servir plusieurs fonctionnalités, celles-ci sont
réunies derrière un hook propriétaire unique. Un vrai dispatcher inter-DLL ne
sera envisagé que si D2RLoader fournit explicitement ce service ou si
`plugin-shared` redevient un composant runtime partagé.

## Séquencement retenu

### Tranche 0 — fondation

- ajouter le manifeste des hooks et le contrôle de chevauchement;
- conserver `D2UnitStrc` canonique dans `plugin-shared`;
- introduire des vues/accesseurs minimaux pour les offsets réellement partagés;
- documenter la règle de propriété unique des hooks.

### Tranche 1 — intégrations sans structure gameplay

1. `GroundItemLabelLimit`, nouveau plugin indépendant;
2. `GambleScreenLimit`, intégré comme option de `plugin-items`.

### Tranche 2 — petits hooks à ABI opaque

1. `EnhancedDamageMinMaxFix`;
2. `NoEtherealItemTypes`;
3. `BulkSkillPointAllocation`, intégré comme option de `plugin-items`;
4. `AdvancedItemTooltips`;
5. `PotionAutoPickup`.

L’ordre final de cette tranche peut suivre les plugins effectivement acceptés
par eezstreet sans modifier la fondation.

### Tranche 3 — sous-systèmes complexes

`FloatingDamage`, `CharmInventoryAuras`, `RevealMap` et `ReviveOverhaul` sont
traités séparément, avec validation de leurs dépendances graphiques, offsets de
structures ou chemins IA.

### Tranche 4 — conflits à fusionner

- réunir les transformateurs `GetItemsTxtRecord` de `DurabilityResistance` et
  `Transmogrify` derrière un hook unique;
- faire de `plugin-items` le propriétaire du hook drop `0x441300` et brancher
  `ConfigurableCharsiReward` sur son callback post-drop;
- valider toutes les combinaisons d’options concernées.

## Contrat de squelette pour les futurs plugins

Toute fonctionnalité RuffnecKk destinée au PluginPack doit être développée dès
le départ comme un composant du pack :

1. choisir d’abord le module propriétaire parmi `plugin-items`, `plugin-levels`,
   `plugin-misc`, `plugin-quests` et `plugin-skills` selon le sous-système touché;
2. ajouter des fichiers `.cpp`/`.h` internes à ce module et les appeler depuis
   son point d’entrée existant, sans créer une nouvelle DLL par défaut;
3. créer une nouvelle target `plugin-*` seulement si aucun module existant n’est
   un propriétaire logique ou si le sous-système exige réellement une isolation;
4. placer la configuration sous la section du module propriétaire dans l’unique
   `D2RPlugins.json`, désactivée par défaut dans le dépôt du pack;
5. ne copier aucune structure gameplay déjà canonique et ne créer aucun TOML
   autonome, sauf décision explicite des mainteneurs de changer le standard;
6. conserver les métadonnées et crédits du plugin propriétaire, tout en créditant
   exactement `RuffnecKk` dans le fichier source de la fonctionnalité, son log et
   la documentation;
7. conserver l’installation globale ou mod-locale, le contrôle strict du build,
   des signatures et de l’ABI, ainsi que l’inventaire des RVA;
8. compiler les cinq DLL Release x64 du pack complet, puis effectuer un démarrage
   à froid et un test fonctionnel avec les autres fonctions actives.

Ce contrat rend les ajouts indépendants côté développement, mais prévisibles à
fusionner : eezstreet peut faire évoluer ses plugins, RuffnecKk peut préparer les
siens, et chaque contribution arrive déjà dans le même format de configuration,
de compilation et de validation.

## Prototype local de la tranche 1

Après un premier essai sous forme de DLL distincte, `GroundItemLabelLimit` a été
reclassé comme fonctionnalité interne de `plugin-misc`. Le clone local contient
maintenant `ground-item-label-limit.cpp/.h`, compilés par la target existante
`plugin-misc`; aucune sixième DLL ni aucun nouvel export D2RLoader n’est créé.
L’intégration conserve :

- la configuration `misc.groundItemLabels` dans l’unique `D2RPlugins.json`, avec
  `enabled=false` et `limit=64` par défaut dans le clone du pack;
- le crédit exact `RuffnecKk` dans les sources et le message d’activation;
- les sept signatures strictes du build 92777;
- l’absence totale de structure gameplay privée.

La compilation Release x64 complète réussit avec uniquement les cinq DLL
d’eezstreet. La `plugin-misc.dll` fusionnée a le SHA-256
`E5E4A15DD854782B211B35488BD2B629974D8D8770BC5775ABB8D62CA2EDA275`.
Le correctif local déjà requis par `plugin-misc` pour déclarer
`PluginFlags::NativeHooks` est repris dans le source fusionné.

Le test BKVince active cette section avec `limit=64`. La nouvelle DLL a été
copiée dans la source gouvernée et dans le profil actif avec des SHA-256
identiques. La DLL eezstreet originale est sauvegardée sous `analysis-cache/`
avec le SHA-256
`EF92AC285FA58083D0D3F89CADE94AD93220CAD3875D820F63A56C35C5CFED79`, et les
trois binaires du prototype séparé ont été déplacés au même endroit. L’ancienne
DLL standalone historique reste sous l’extension `.standalone-disabled`.

Au démarrage à froid du 22 juillet, D2RLoader charge explicitement
`plugin-misc.dll [mod]`, désactive sa copie globale, puis termine le scan des
plugins avec `failed=0`. Le journal de `plugin-misc` confirme à la fois son hook
natif existant et `Ground Item Label Limit by RuffnecKk active; limit raised
from 32 to 64`. L’instance s’est ensuite fermée avec déchargement de D2RCore;
la validation visuelle en jeu demeure à faire par Vincent. Le clone demeure
local sous `analysis-cache/`, sans commit ni push.

## Contribution SDK prête à envoyer

Le lot court retenu par Vincent est préparé dans
`reverse-engineering/d2r-3.2.92777/sdk-contribution/`. Il répond directement à
la demande de Dimentio d’obtenir une liste de tables et d’offsets sans lui
transmettre le workbench brut :

- `README.md` explique en anglais les preuves et leurs limites dans la voix de
  RuffnecKk;
- `sdk-candidates.json` fournit la version machine-readable;
- `verified-layouts.hpp` fournit uniquement les fragments C++ vérifiés et
  compile en C++20 avec MSVC sous `/W4 /WX`;
- `discord-message.md` est prêt à copier dans la discussion;
- `RuffnecKk-D2RLoader-SDK-notes-92777.zip` contient les trois fichiers
  techniques partageables, SHA-256
  `0A18B93C751025AA5FBB0F7715D76CC0B26CD8717EDD62994F8A8F8582E8D01D`.

Le noyau proposé comprend l’accesseur de contexte à `0x300A90`, les entrées
`skills`, `itemtypes` et `items`, les champs réellement exercés des records
`ItemTypesTxt` et `ItemsTxt`, puis la correction canonique prouvée de
`D2UnitStrc+0x04` : le getter natif `0x349860` le traite comme class/TXT record
ID, pas comme `unitFlags`. Les résultats de `BulkSkillPointAllocation` et
`AdvancedItemTooltips` sont classés séparément comme helpers SDK candidats
(`0x214220`, `0x14C3DA0`, `0x36EAD0`) afin de ne pas les présenter à tort comme
de nouveaux offsets de tables. Le lot exclut les cartographies spéculatives,
les caches locaux, les images du jeu et les patches de balance sans surface SDK
réutilisable.

## Gates d’acceptation

- périmètre des plugins accepté par RuffnecKk et eezstreet;
- un seul type canonique pour chaque structure partagée;
- aucun champ ajouté sans preuve 92777 et assertion d’offset;
- manifeste exhaustif des écritures et hooks;
- zéro chevauchement non arbitré;
- compilation Release x64 de chaque configuration CMake;
- plugins installables globalement ou dans un mod, sans `ModScopedOnly`;
- build, signatures et ABI strictement refusés sur cible incompatible;
- cold-start avec toutes les options désactivées, puis activation isolée;
- matrice de coexistence par paire pour les plugins touchant un même
  sous-système;
- validations fonctionnelles en jeu sur `D2R.exe 3.2.92777`.
