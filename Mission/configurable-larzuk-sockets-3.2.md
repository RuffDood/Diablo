# Configurable Larzuk Sockets — D2R 3.2.92777

Dernière mise à jour : 24 juillet 2026

Statut : mission planifiée, sans code, configuration, DLL ni archive créés.

## Décisions confirmées

- Vincent a retenu l’Option B le 24 juillet 2026 : commencer cette mission
  seulement après la fermeture des gates fonctionnels d’Advanced Item Tooltips
  et de Transmogrify. Extended Item Stats demeure la priorité active.
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

## Preuves et audit requis avant implantation

1. Exécuter `npm.cmd run re:d2r32 -- status` et confirmer l’image ainsi que
   l’index gouvernés du build 92777 sans redump inutile.
2. Auditer le commit PluginPack épinglé et le module propriétaire `quests` :
   fichiers, structures partagées, clés, callbacks, RVA, signatures et plages
   de hooks.
3. Prouver dans D2R 3.2 le chemin serveur autoritaire de la récompense Larzuk,
   l’accès à la difficulté, la qualité, l’`ilvl` et le plafond de sockets.
4. Arbitrer un propriétaire unique pour chaque hook ou structure canonique et
   refuser toute ABI ou signature non prouvée.

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

Après la fermeture d’Advanced Item Tooltips et de Transmogrify, exécuter le
statut du workbench 92777 puis auditer `plugin-quests.dll` avant toute
implantation.
