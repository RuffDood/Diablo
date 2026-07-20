# Audit sélectif des assets HD Yupgoolg v13.04

## État

**CLOS — validation visuelle confirmée par Vincent le 20 juillet 2026.** Les
imports retenus sont installés dans la source et le runtime BKVince. Les VFX de
missiles/skills demeurent volontairement exclus de cette livraison et ne
constituent pas un reste à faire de la mission close.

Installation directe autorisée par Vincent le 20 juillet 2026, sans campagne de
test préalable, à l'exception explicite des VFX de missiles/skills qui restent
en quarantaine jusqu'à la vérification de leurs interférences gameplay.

Premier lot installé et synchronisé dans la source `data-BKVince` et dans le
profil runtime `mods/BKVince` : 129 fichiers couvrant les deux polices, Cain HD,
les apparences NPC retenues, les 24 plaques anglaises dérivées et les 14
waypoints avec leurs dépendances. Les 129 copies source/runtime correspondent à
leur source par SHA-256. La demande « stash agrandi » vise le coffre 3D visible
dans les villes, et non le panneau UI : les deux sprites et le changement de
layout initialement tentés ont été retirés. La définition Yupgoolg
`data/hd/objects/chests/bank.json` est désormais installée; elle conserve le
modèle, le squelette et les textures vanilla et applique seulement une échelle
visuelle uniforme de `2.0` au torse du coffre. La grille, les cases, la capacité
et tous les layouts d'inventaire BKVince restent inchangés.

Retour ciblé demandé par Vincent après vérification visuelle : l'apparence
Rogue/Navi a été retirée de la source et du runtime. Le rollback supprime
`rogue1.json`, les textures Navi/Rogue et les deux arcs élémentaires propres à
ce remplacement; Kashya, Fara, Lysander, Cain et les plaques anglaises sont
conservés.

La mise à l'échelle des monstres est abandonnée à la demande de Vincent. La
taille des hirelings est installée conformément aux définitions Yupgoolg : les
mercenaires des actes I (`roguehire`) et II (`act2hire`) reçoivent uniquement
une transformation racine uniforme de `1.3`; les actes III et V restent à
`1.0`, comme dans la source. Les textures Rogue/Navi retirées ne sont pas
réintroduites et aucune table de statistiques, collision ou IA n'est modifiée.

VFX de buffs installés : Yupgoolg ne fournit que trois définitions actives et
autonomes retrouvées dans cette famille, soit `Battle Orders`, `Enchant` et
`Fade`, accompagnées de leurs particules `*_icon.particles`. Battle Orders et
Enchant sont installés comme overlays visuels; l'entité d'icône Fade est
fusionnée dans la définition Fade plus riche déjà présente dans BKVince au lieu
de l'écraser. Les particules Werebear/Werewolf non instanciées ne sont pas
copiées. Aucun overlay de curse autonome supplémentaire n'a été retrouvé dans
les chemins connus du MPQ; aucune table de skill, state, durée ou statistique
n'est modifiée.

Les registres globaux `missiles.json`, `overlay.txt`, `monsters.json` et les
state machines des joueurs ne sont pas copiés en bloc : ils entrent en collision
avec les versions D2R 3.2 de BKVince et mélangent des mappings ou comportements
qui dépassent un simple remplacement binaire d'asset. Les éléments visuels
restants doivent être extraits ou fusionnés entrée par entrée, sans régression
du runtime 3.2. Le manifeste local du premier lot est conservé sous
`C:/Games/Diablo II Resurrected/asset-tests/install-manifests/bkvince-yupgoolg-2026-07-20.json`.

Option B retenue par Vincent le 20 juillet 2026 : interrompre temporairement la
validation fonctionnelle de `CharmInventoryAuras` afin d'auditer en priorité les
assets visuels du mod coréen Yupgoolg v13.04.

Le ZIP source reste externe au dépôt :
`C:/Users/Vincent Barrière/Downloads/4.엽굵모드(일반)_V1 v13.04.zip`.
Son MPQ a été exploré en lecture seule et une extraction d'audit isolée a été
créée sous
`C:/Games/Diablo II Resurrected/mods/yupgoolg132-v13.04-audit/`, sans remplacer
le mod `yupgoolg132` déjà installé ni modifier BKVince.

## Intention artistique

Importer uniquement certaines améliorations HD jugées cohérentes avec BKVince,
notamment la typographie, les enrichissements d'environnement et les refontes
purement cosmétiques des personnages ou NPC. Les modèles et textures de visage,
peau, cheveux, corps et vêtements propres à un personnage, leurs squelettes ainsi
que l'apparence 3D des équipements portés sont admissibles après validation
visuelle et technique. Le périmètre doit néanmoins préserver :

- les éléments et layouts de l'interface ;
- tout texte ou graphisme textuel coréen original ; les plaques de nom des NPC
  ne sont admissibles que dans leur variante dérivée `English-only` ;
- les fonds d'inventaire, de coffre, de Cube et de mercenaire ;
- les sprites d'objets, de skills et d'inventaire ;
- les comportements des personnages et toute logique gameplay ;
- les animations, sauf adaptation strictement nécessaire, isolée et auditée pour
  accompagner un squelette retenu ;
- les sprites, icônes et représentations 2D des armes, armures et autres items
  dans l'inventaire ou l'interface ; leur apparence 3D lorsqu'ils sont portés est
  désormais dans le périmètre ;
- les données gameplay, plugins, patches et configurations runtime du mod source.

## Liste d'import cible de Vincent

Périmètre consolidé le 20 juillet 2026. Chaque ligne reste soumise à un audit de
dépendances et à un test isolé avant intégration dans BKVince :

1. mise à l'échelle agrandie des monstres : abandonnée par Vincent ;
2. mise à l'échelle agrandie des hirelings, avec les mêmes contrôles et sans
   reprendre leur IA ou leurs statistiques ;
3. apparence extérieure du stash : agrandir le coffre 3D placé dans le monde,
   sans modifier le panneau UI, la grille intérieure, le nombre ou les
   coordonnées des cases ni la capacité BKVince ;
4. police générale du mod coréen, avec audit des mappings de polices et sans
   importer ses layouts UI ;
5. animation/VFX de mort global des monstres, décrite comme une aura rouge qui
   apparaît à la mort ;
6. VFX des curses et buffs, sans modifier leurs effets, durées, statistiques,
   icônes ou logique gameplay ;
7. Cain HD avec orbes, flammes spectrales et plaque anglaise dérivée ;
8. éclairage global des 14 variantes de waypoints ;
9. apparences NPC de Fara, Kashya, Rogue/Navi et Lysander, chacune isolée ;
10. plaques anglaises optionnelles des NPC ;
11. squelettes des personnages joueurs et apparence 3D des équipements portés,
    avec adaptations d'animation seulement lorsqu'elles sont indispensables au
    squelette retenu.

Les sources coréennes des plaques demeurent exclues ; seules les variantes
`English-only` sont candidates. Les sprites et icônes 2D d'objets/skills restent
également exclus. Le point 3 est la seule réouverture actuelle du périmètre UI/
inventaire et reste strictement cosmétique. Il ne vaut pas autorisation
d'importer la grille, la capacité ni les autres changements UI du mod source.

## Premier inventaire

- MPQ v13.04 : 385 892 051 octets ;
- MPQ déjà installé : 457 456 237 octets, laissé intact ;
- le MPQ ne contient aucun `(listfile)` exploitable ;
- 40 321 chemins candidats ont été testés à partir des corpus locaux ;
- 181 fichiers ont été identifiés et extraits, pour 120 320 995 octets ;
- rapport local :
  `C:/Games/Diablo II Resurrected/mods/yupgoolg132-v13.04-audit/extraction-report.json`.

Premiers candidats à étudier séparément :

- `data/hd/ui/fonts/kodia.ttf` ;
- `data/hd/ui/fonts/exocetblizzardot-medium.otf` ;
- les presets HD de Rogue Encampment et Lut Gholein sous `data/hd/env/preset/`.
- les définitions HD des mercenaires et les state machines des personnages,
  utilisées comme cartes de dépendances pour retrouver modèles, matériaux et
  textures cosmétiques, sans import automatique de leur logique.

Les vidéos de taille nulle sont des suppressions/remplacements intentionnels du
mod source et ne sont pas des candidats à importer.

## Audit Rogue Encampment

Première passe effectuée le 20 juillet 2026 sur
`data/hd/env/preset/act1/outdoors/bivouac.json` :

- 382 dépendances uniques déclarées ;
- 5 fichiers de particules, 77 modèles, 298 textures, 1 fichier physique et
  1 biome JSON ;
- seulement quatre dépendances sont physiquement fournies dans le MPQ Yupgoolg ;
- les 378 autres sont des références aux assets vanilla résolus par le jeu.

Les quatre fichiers propres au MPQ sont tous des textures de l'NPC `navi` :

- `navi_body_SSS.texture` ;
- `navi_head_SSS.texture` ;
- `navi_hair_FLOW.texture` ;
- `navi_hair_HRT.texture`.

Le diff avec vanilla 3.2 confirme qu'aucune particule de brouillard, texture de
terrain, lumière ou modèle de décor spécifique à Yupgoolg n'est apporté au camp :

- les 382 dépendances du preset sont identiques à vanilla ;
- les 233 entités vanilla sont inchangées et Yupgoolg ajoute seulement l'entité
  `waypoint01_01`, qui réutilise le modèle et la physique vanilla du waypoint ;
- les quatre textures `navi` embarquées sont byte-identiques à vanilla 3.2 et ne
  constituent donc aucun changement visuel ;
- `bivouac.ds1` diffère (6 441 octets contre 5 107 pour vanilla), ce qui correspond
  vraisemblablement au placement ou au fonctionnement de la zone/du waypoint et
  relève d'un changement de carte potentiellement gameplay-adjacent, pas d'une
  amélioration de lumière ou de VFX.

Conclusion : Rogue Encampment n'est pas retenu comme lot visuel à tester. Le
preset et le DS1 restent isolés pour documentation seulement ; ils ne doivent pas
être importés dans BKVince sans une demande distincte concernant la carte ou le
waypoint.

Audit local et quatre dépendances extraites :
`C:/Games/Diablo II Resurrected/asset-tests/dependency-audits/rogue-encampment-v13.04/`.

## Méthode d'audit

L'audit est désormais organisé par familles visuelles transversales, et non par
zone. Les presets et DS1 de villes ne servent que d'indices pour retrouver les
systèmes globaux qu'ils référencent.

1. Prioriser les refontes et surcouches de NPC (Cain en premier), les 14 variantes
   de waypoints, les VFX de missiles/skills, les éclairages/VFX globaux, les
   personnages, squelettes, équipements portés et polices.
2. Compléter autant que possible l'inventaire des noms absents du MPQ sans
   importer aveuglément l'archive complète.
3. Classer chaque fichier en `candidat`, `exclu`, `dépendance` ou `inconnu`.
4. Pour chaque candidat, comparer le fichier à vanilla 3.2, BKVince, TCP, BK et
   VNP, puis relever toutes ses références et dépendances.
5. Tester chaque famille dans une copie runtime isolée, une seule à la fois.
6. Ne copier dans `data-BKVince/BKVince.mpq/data` qu'après validation visuelle
   explicite de Vincent.
7. Conserver la provenance exacte et vérifier les droits de redistribution avant
   toute publication ou inclusion dans une archive distribuable.

## Familles transversales confirmées

### Waypoints

Les 14 définitions HD connues sous `data/hd/objects/waypoint_portals/` sont
présentes dans le MPQ. Elles ajoutent toutes la dépendance visuelle
`FX_Horadric_Light.particles`. La variante désert remplace aussi le beacon
standard par `pf_beacon_waypoint1.json`, lui-même fourni dans l'archive. Cette
famille est un candidat prioritaire à tester globalement, sans importer les DS1
des zones.

Correction D2R 3.2 après le premier contrôle en jeu : la simple présence de
`FX_Horadric_Light.particles` dans `dependencies` ne l'instanciait pas. Les 14
définitions BKVince possèdent maintenant chacune une entité
`WaypointHoradricLight`, une transformation centrée et un
`VfxDefinitionComponent` actif pointant sur cette particule. La dépendance est
dédupliquée. Le composant `entity_special1` du waypoint extérieur de l'acte I a
également été retiré avec sa dépendance, puisque son modèle est invalide sous
D2R 3.2 et apparaissait explicitement dans le journal de rendu. Les fichiers
source et runtime ont été resynchronisés et vérifiés byte pour byte.

### VFX de missiles et skills

Le périmètre inclut les effets rendus dans le monde, mais exclut toujours les
icônes/sprites d'interface et toute modification de dégâts, trajectoire, vitesse,
hitbox ou logique. Sept fichiers connus ont été retrouvés :

- `blizzard.json` et `chainlightningbolt.json`, candidats visuels à isoler ;
- `missiles.json`, registre global à auditer entrée par entrée et à ne jamais
  importer en bloc ;
- `wincaster_O.particles`, `wincaster_X.particles` et les gradients rouge/vert,
  déjà byte-identiques aux fichiers présents dans TCP.

### NPC et surcouches

Le balayage global du registre a confirmé 33 définitions NPC remplacées : les
six formes de Cain et 27 autres NPC.

- Cain devient un `act2male` âgé avec deux petits orbes Dragon Stone en mains et
  des VFX de feu rouge/bleu et de flammes spectrales de nécromancien ; les six
  définitions sont byte-identiques. Sa plaque n'est admissible qu'avec la texture
  dérivée anglaise.
- 23 particules de plaques de nom et 23 textures de noms personnalisées ont été
  retrouvées pour les NPC des différents actes. Les textures coréennes restent
  exclues. À la demande de Vincent, 24 variantes `npcname_*.texture` incluant Cain
  ont été dérivées : les icônes et noms anglais existants sont conservés pixel
  pour pixel, et seules les rangées coréennes sont remplacées par le fond noir
  original. Les sources ne sont pas écrasées.
- Fara reçoit cinq textures de cheveux/visage/tenue et deux dagues attachées.
- Kashya reçoit trois textures personnalisées de cheveux, visage et tenue.
- `rogue1` utilise le squelette et les textures de Navi, une texture d'armure et
  des arcs élémentaires froid/feu.
- Lysander est radicalement transformé avec squelette et ailes de Tyraël, VFX
  d'ailes Lucifer et un modèle de test en guise de torse ; ce lot expérimental ne
  doit pas être mélangé aux simples plaques de nom.

Les lots de test deviennent donc : plaques lumineuses anglaises, Cain avec sa
plaque anglaise, Fara, Kashya, Rogue/Navi et Lysander séparément.

## Gates de validation

- aucun changement d'UI, d'inventaire, de sprites d'objets ou de skills ;
- aucun texte ni graphisme textuel coréen ; seules les plaques dérivées
  `English-only` peuvent accompagner les NPC ;
- pour les personnages et NPC, limiter l'import aux modèles, textures,
  matériaux, squelettes et apparences 3D d'équipements explicitement approuvés,
  sans changement de gameplay ; toute adaptation d'animation doit être justifiée
  par le squelette retenu, isolée et validée séparément ;
- aucun fichier TXT, DLL, patch JSON, TOML ou configuration gameplay importé ;
- chargement à froid sans assertion, erreur ou crash ;
- comparaison en jeu avant/après aux mêmes scènes, résolutions et réglages ;
- test souris/manette et low-end si un asset possède une variante associée ;
- retrait atomique possible de chaque famille d'assets ;
- reprise de `CharmInventoryAuras` après décision finale sur ce chantier visuel.
