# RemoteStash — D2R 3.2.92777

Dernière mise à jour : 24 juillet 2026

Statut : mission active; incubation et audit natif commencés. Aucun prototype,
aucun bouton et aucune archive publique n’existent encore.

## Décisions confirmées

- Vincent a retenu l’Option A le 24 juillet 2026 : RemoteStash devient la
  priorité immédiate et Configurable Larzuk Sockets reste intacte à son gate de
  validation en jeu.
- La catégorie PluginPack future est `misc`, avec `plugin-misc.dll` comme DLL
  propriétaire et `misc.remoteStash` comme clé prévue dans l’unique
  `D2RPlugins.json`.
- Pendant l’incubation, la fonctionnalité restera dans une DLL autonome hybride
  `RemoteStash.dll`, attribuée exactement à `RuffnecKk`, sans modifier, lier ni
  redistribuer une DLL d’eezstreet.
- La première phase porte uniquement sur le chemin natif d’ouverture du stash
  et la possibilité de le déclencher depuis un autre contrôle UI. Les sprites,
  le placement final et l’adaptation aux layouts personnalisés viendront après
  la preuve fonctionnelle.

## Résultat joueur attendu

Un contrôle placé dans l’écran d’inventaire permet d’ouvrir le stash du joueur
sans interaction directe avec le coffre du monde. Le plugin doit réutiliser le
comportement autoritaire du jeu plutôt que recréer une grille ou déplacer des
objets lui-même.

## Incubation compatible PluginPack

- Description anglaise prévue : `Opens the player stash from the inventory screen.`
- Utiliser un JSON autonome compatible PluginPack seulement lorsqu’une option
  réelle est démontrée; aucun TOML ne sera créé.
- Rechercher la configuration d’abord dans le mod actif puis dans le dossier
  global du jeu; une configuration présente mais invalide devra être refusée.
- Après un merge futur, intégrer la fonctionnalité à `plugin-misc.dll`, déplacer
  ses options sous `misc.remoteStash`, puis supprimer la DLL et le JSON autonomes.

## Audit initial

- Le gate `npm.cmd run re:d2r32 -- status` est vert : images canonique et
  d’analyse, index SQLite et projet Ghidra persistant du build 92777 sont
  vérifiés; aucun redump ni réimport n’a été effectué.
- La référence officielle `D2RL-Plugins@dc75b49ffbb67b887d7757ee00ee9a03bcde5d8a`
  est propre et vérifiée.
- La recherche `stash` dans cette référence ne retourne aucun résultat. La
  recherche `inventory` ne retourne que la configuration de plafond d’or de
  `plugin-items` (`D2RPlugins.json:11-14`, `src/plugin-items/items-main.cpp:492`).
- `plugin-misc` charge la section `misc` de l’unique JSON
  (`src/plugin-misc/misc-main.cpp:136-140`) et ne possède actuellement que les
  deux callsites `/players` `0x18885B`/`0x18887F` et le hook
  `GAME_GetPlayerCountBonus` `0x542F40` (`misc-main.cpp:5-33,142-158`). Aucun
  chevauchement RemoteStash n’est donc observé à ce stade.
- Les preuves gouvernées existantes connaissent la résolution de grille stash
  par `UNITS_GetInventoryGrid` `0x34A410`, mais aucune fonction d’ouverture du
  panneau stash n’est encore identifiée. Cette fonction ne doit pas être
  confondue avec le chemin UI recherché.
- La référence sémantique D2MOO épinglée
  `@19019806df7f3e877fa105b05395d1e3597e2316` définit `UI_STASH = 0x19`,
  `UPDATEUI_OPENSTASH = 16` et `UPDATEUI_CLOSESTASH = 17`
  (`source/D2CommonDefinitions/include/D2Constants.h:214,501-502`). Son chemin
  historique d’interaction avec l’objet stash envoie au client le paquet UI
  serveur `0x77` avec l’action `UPDATEUI_OPENSTASH`
  (`source/D2Game/src/PLAYER/PlrTrade.cpp:53-64`), au moyen de
  `D2GAME_PACKETS_SendPacket0x77_Ui_6FC3E0B0`
  (`source/D2Game/src/GAME/SCmd.cpp:1159`). Cette preuve est uniquement
  sémantique 1.10f : aucune adresse ni ABI n’est transposée vers D2R 3.2.
- Sur 92777, les 38 xrefs connus de `D2GAME_QueueServerPacket` `0x4817F0` ont
  été inventoriés. Les premières signatures ciblant naïvement un producteur de
  deux octets `0x77,0x10` ne donnent aucun match; le format ou le chemin D2R
  doit donc être établi indépendamment plutôt que supposé identique à 1.10f.

## Hypothèses à tester

- L’interaction avec le coffre pourrait encore employer un événement UI serveur
  équivalent au couple historique paquet `0x77` / action `16`, puis un
  dispatcher client réutilisable qui initialise le panneau stash existant.
- Si ce chemin ouvre le panneau déjà fourni par le jeu ou le mod actif, le
  format de grille personnalisé pourrait rester sous la responsabilité de ce
  panneau; ce n’est pas encore prouvé.
- Si l’ouverture dépend d’un objet de monde, d’un contexte serveur ou d’un état
  de transaction spécifique, un déclencheur distant pourrait exiger un chemin
  plus large qu’un simple appel de fonction.

## Gates observables

- identifier et borner la fonction native d’ouverture, ses callers et son ABI;
- distinguer l’action client, les éventuels paquets et le contexte serveur;
- prouver les signatures strictes et l’unique propriétaire de chaque hook;
- déclencher l’ouverture depuis un contrôle technique minimal, sans sprite final;
- fermer proprement le panneau et préserver inventory, personal stash et shared stash;
- vérifier ville/hors ville, changement d’acte, souris/manette, solo, hôte et joiner;
- démontrer zéro perte, duplication, sauvegarde corrompue, crash ou désynchronisation;
- seulement ensuite définir le contrat des layouts vanilla et personnalisés.

## Prochain gate

Identifier dans 92777 le producteur serveur et le consommateur client de
l’événement qui ouvre réellement le stash, en partant des 38 callers de
`D2GAME_QueueServerPacket` et de l’interaction avec l’objet; prouver ensuite le
format, la fonction, les callers, l’ABI et les préconditions avant tout hook.
