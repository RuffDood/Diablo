# Configurable Larzuk Sockets — D2R 3.2.92777

Dernière mise à jour : 24 juillet 2026

Statut : mission active; prototype autonome `0.1.0` compilé et contrôlé
statiquement, sans synchronisation runtime ni archive publique.

## Décisions confirmées

- Vincent a d’abord retenu l’Option B le 24 juillet 2026, puis a explicitement
  demandé `start` le même jour. Cette seconde instruction devient l’override
  de priorité : la mission Larzuk est active immédiatement et Extended Item
  Stats demeure intacte mais n’est plus la mission courante.
- La catégorie PluginPack future est `quests`, avec `plugin-quests.dll` comme
  DLL propriétaire et `quests.larzukSockets` comme clé prévue dans l’unique
  `D2RPlugins.json`.
- La configuration doit varier selon la difficulté où la récompense de quête
  est utilisée : Normal, Nightmare ou Hell.
- Les qualités configurables sont `magic`, `rare`, `set`, `unique` et
  `crafted`. L’ajout explicite de `crafted` a été confirmé le 24 juillet 2026.

## Résultat joueur attendu

Lorsqu’un objet admissible est confié à Larzuk, le nombre de sockets accordé
est choisi par la règle de sa difficulté et de sa qualité :

- `minSockets == maxSockets` force une valeur exacte;
- `minSockets < maxSockets` effectue un tirage inclusif dans la plage;
- le résultat ne dépasse jamais le plafond légal de l’objet concret, déterminé
  par sa base, son type, son `ilvl` et les règles runtime réellement prouvées;
- les conditions d’admissibilité et la consommation normale de la récompense
  de quête restent autoritaires;
- les objets normaux et supérieurs, ainsi que toute qualité non configurée,
  conservent le comportement vanilla;
- une configuration absente conserve entièrement le comportement vanilla;
- une configuration présente mais invalide est refusée explicitement, sans
  application partielle silencieuse.

Le schéma autonome attendu pendant l’incubation doit exprimer trois blocs de
difficulté contenant chacun les cinq qualités et leurs bornes `minSockets` et
`maxSockets`. Les noms définitifs et les bornes globales acceptées seront figés
après l’audit du chemin natif; le contenu et les commentaires du JSON resteront
en anglais.

## Incubation compatible PluginPack

- Créer à terme une DLL autonome hybride `LarzukSockets.dll`, installable dans
  le dossier global ou dans celui d’un mod, sans `ModScopedOnly`.
- Attribuer exactement le plugin à `RuffnecKk`.
- Employer la description anglaise courte :
  `Configures Larzuk socket rewards by difficulty and item quality.`
- Utiliser uniquement `LarzukSockets.json` pendant l’incubation, recherché
  d’abord dans le mod actif puis dans le dossier global du jeu. Ne créer aucun
  TOML.
- Ne pas modifier, lier ni redistribuer une DLL d’eezstreet pendant
  l’incubation.
- Lors du merge futur, déplacer la configuration sous
  `quests.larzukSockets` dans l’unique `D2RPlugins.json`, intégrer la
  fonctionnalité à `plugin-quests.dll`, puis supprimer la DLL et le JSON
  autonomes.

## Audit PluginPack propriétaire

Le snapshot officiel épinglé `D2RL-Plugins@dc75b49ffbb67b887d7757ee00ee9a03bcde5d8a`
est propre et vérifié. Son module `plugin-quests` est bien le propriétaire
fonctionnel : il charge la section `quests` de l’unique `D2RPlugins.json`
(`src/plugin-quests/quests-main.cpp:258-259`) et ses callbacks par difficulté
lisent `pGame->difficultyLevel` (`quests-main.cpp:96-122`). La structure
partagée fixe ce champ à `D2GameStrc+0x104`
(`src/plugin-shared/include/plugin-shared.h:394-408`) et énumère les qualités
Magic, Set, Rare, Unique, Crafted et Tempered (`plugin-shared.h:31-41`).

Les plages déjà possédées par `plugin-quests` ont été recensées : récompenses
Den of Evil `0x5DE5A0`, Fallen Angel `0x5E6EEE`, Black Book `0x5ED713`, Golden
Bird `0x5806B7`, Skill Book `0x58078B`, anneaux Akara/Ormus, quest-item
`0x517530` et imbue `0x36B123`/`0x36B61B`
(`quests-main.cpp:19-59,263-344`). Aucune ne chevauche `ITEMS_AddSockets`
`0x375560` ni l’appel Larzuk `0x4FD57B`. Le JSON officiel expose déjà
`quests` et `imbueAllowSockets` (`D2RPlugins.json:150-230`), mais aucune option
Larzuk de quantité de sockets. L’incubation n’écrit donc dans aucune DLL
d’eezstreet et réserve ce comportement au merge futur de `plugin-quests`.

## Preuve native D2R 3.2.92777

Le gate `npm.cmd run re:d2r32 -- status` est vert : image canonique et image
d’analyse vérifiées, index vérifié avec 105 850 fonctions, 1 057 329 références,
59 699 chaînes, 59 patch-sites, 119 connaissances après promotion et 102
références JSON;
le projet Ghidra existe, donc aucun redump ni réimport n’a été exécuté.

Le chemin serveur autoritaire est maintenant prouvé :

- `0x4FD4C6` pose `IFLAG_SOCKETED`, puis `0x4FD4E0` appelle
  `ITEMS_GetMaxSockets` (`0x36EAD0`) et `0x4FD4ED` lit la qualité avec
  `ITEMS_GetItemQuality` (`0x36CF60`);
- la jump-table `0x4FDA90` envoie Magic vers `0x4FD50F`, qui tire
  `1..min(2,max)`, tandis que Set, Rare, Unique, Crafted et Tempered vont vers
  `0x4FD568` et reçoivent `min(1,max)`;
- l’appel final `0x4FD57B` invoque `ITEMS_AddSockets` (`0x375560`) et retourne
  à `0x4FD580`; la consommation normale de quête continue ensuite à
  `0x4FD598`;
- le même handler lit la difficulté depuis `[rsp+0x58]+0x104`, ce qui prouve
  à la fois le slot caller et l’offset de `D2GameStrc` utilisés par le hook;
- `ITEMS_AddSockets` borne encore l’aire d’inventaire à six, puis impose ses
  propres plafonds de qualité : Magic 4, Rare 2, Crafted/Tempered 3 et
  Set/Unique 1. Un simple changement de l’argument Larzuk ne pourrait donc
  jamais produire `set = 2`;
- après ces plafonds, la routine appelle à nouveau `ITEMS_GetMaxSockets`, pose
  le flag socketed et écrit le stat `0xC2` par `STATLIST_SetUnitStat`
  (`0x2F7D10`). La référence sémantique non transposable D2MOO
  `@19019806df7f3e877fa105b05395d1e3597e2316`,
  `source/D2Common/src/Items/Items.cpp:2986-3131`, corrobore exactement cet
  ordre et ces rôles.

Les identifications stables `STATLIST_GetUnitStat`, `STATLIST_SetUnitStat`,
`ITEMS_GetItemSeed`, `ITEMS_GetItemQuality`, `ITEMS_AddSockets` et
`LarzukAddSocketsCall` sont promues dans `known-rvas.json` avec leur source et
leur confiance.

## Prototype autonome 0.1.0

- `LarzukSockets.dll` est une DLL D2RLoader v2 autonome et hybride, sans
  `ModScopedOnly`, attribuée exactement à `RuffnecKk`; sa description est
  `Configures Larzuk socket rewards by difficulty and item quality.`
- Le hook strict de 16 octets porte uniquement sur `ITEMS_AddSockets`. Il
  transmet tous les appels non Larzuk à l’original et n’active la politique
  que pour le retour exact `0x4FD580`; neuf signatures complètes supplémentaires
  protègent chaque helper natif appelé avant l’installation du hook.
- Pour une règle configurée, le prototype refuse d’écraser un stat socket
  existant, lit difficulté et qualité, calcule le plafond natif base/type/ilvl,
  conserve le plafond physique `invwidth × invheight`, tire la plage inclusive
  sur le RNG de l’objet, puis réutilise le flag et le setter natifs. Les
  qualités absentes ou `null` restent entièrement vanilla.
- `LarzukSockets.json` contient les trois difficultés et les cinq qualités,
  toutes à `null` par défaut afin de ne modifier aucun gameplay sans choix de
  Vincent. Une configuration locale au mod a priorité sur le repli global; le
  premier fichier présent mais invalide fait échouer explicitement le plugin.
- Build Release x64 réussi; test natif de politique `1/1` vert; trois exports
  présents; aucune dépendance vers une DLL eezstreet. SHA-256 build et dépôt :
  `121F2B714CE6044838409850A328EC1E6A39E38A6E8D57C0BF171507667FD6F3`.

Ce résultat n’est pas encore une validation fonctionnelle en jeu : aucune DLL
ni configuration n’a été synchronisée vers le profil actif, et aucun ZIP
public n’a été créé.

## Preuves et audit requis avant implantation

1. ✅ Workbench et index 92777 vérifiés sans redump.
2. ✅ Commit PluginPack, module `quests`, structures, clés, callbacks et plages
   de hooks audités.
3. ✅ Chemin serveur, difficulté, qualité, `ilvl`, plafonds et setter prouvés.
4. ✅ `LarzukSockets` possède seul le hook autonome `0x375560`; le merge futur
   transférera ce propriétaire à `plugin-quests` sans coexistence des deux DLL.

Les anciennes références Diablo II 1.13c/1.13d conservées dans la ROADMAP avant
ce recadrage sont seulement des indices sémantiques. Leurs adresses et octets
32 bits ne sont pas transposables à D2R 3.2.92777.

## Gates observables

- configuration absente, valide et invalide testée séparément;
- matrice des 15 combinaisons difficulté × qualité couverte pour `magic`,
  `rare`, `set`, `unique` et `crafted`;
- valeur exacte et plage aléatoire inclusive validées;
- objets plafonnés à 1 et bases autorisant plusieurs sockets validés à
  différents seuils d’`ilvl`;
- objets normaux, supérieurs, non admissibles ou déjà socketés inchangés;
- consommation de quête et coexistence avec l’option Infinite Larzuk vérifiées;
- portées globale et mod-locale, repli de configuration et coexistence avec les
  cinq DLL eezstreet validés sans plugin rejeté ni en échec;
- solo, hôte et joiner testés dans les trois difficultés sans perte,
  duplication, valeur illégale, crash ni désynchronisation;
- build Release x64, trois exports D2RLoader, signatures strictes et hashes
  dépôt/runtime prouvés avant toute livraison;
- ZIP public limité à la DLL autonome et au JSON autonome, avec entrées réelles
  inspectées et SHA-256 consigné.

## Prochain gate

Choisir les valeurs réelles `minSockets`/`maxSockets` pour les 15 combinaisons,
activer au moins une règle de témoin, puis appliquer le workflow runtime : cold
start, logs frais, test Larzuk sur chaque qualité et difficulté, plafonds
physiques et `ilvl`, consommation de quête, Infinite Larzuk, solo/hôte/joiner
et portées globale/mod-locale. Aucun ZIP avant fermeture de cette matrice.
