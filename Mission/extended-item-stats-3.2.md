# Extended Item Stats — D2R 3.2.92777

## Décision

Vincent retient l’Option A le 23 juillet 2026 : cette mission devient la
priorité immédiate de l’Incrément 7 « Mission Plugins ». Les petits gates encore ouverts de
GambleScreenLimit, Advanced Item Tooltips, BulkSkillPointAllocation et
Transmogrify reprendront après ce chantier.

La catégorie PluginPack est confirmée : `items`, avec `plugin-items.dll` comme
propriétaire futur et `items.extendedItemStats` comme clé prévue dans l’unique
`D2RPlugins.json` après fusion.

## But joueur

Permettre à n’importe quel moddeur de relever la limite pratique de poids des
objets de son propre mod, sans catalogue BKVince, adaptateur propre au mod ni
compatibilité inter-mods. Tous les pairs qui utilisent ces objets devront
charger le plugin et les mêmes tables du mod. Les objets lourds doivent être
sauvegardés, transportés et affichés sans crash, perte, troncature silencieuse
ni désynchronisation.

Description anglaise prévue du plugin autonome :

`Supports items with exceptionally large stat sets.`

## Diagnostic initial

Le fichier témoin `abc.d2s` reçu le 23 juillet 2026 est une sauvegarde externe,
non versionnée dans le dépôt. Son enveloppe est valide : version 105, 10 359
octets, checksum valide, 103 objets principaux et 10 objets sur le corps. Il
reste un témoin de compatibilité et de refus sûr; aucun nom de personnage ni
bloc brut provenant de cette sauvegarde ne doit entrer dans Git.

Le diagnostic distingue trois limites indépendantes :

1. **Schéma des statistiques.** Le mod donneur Yupgoolg v13.04 possède 511
   entrées `ItemStatCost`, contre 389 dans BKVince. Le codec BKVince refuse la
   section de statistiques du personnage dès l’ID 439, avant même la liste
   d’objets. Avec les tables Yupgoolg auditées, cette section est lisible, mais
   l’encodage des objets n’est pas reconstructible sémantiquement de façon
   unique : le premier jewel rencontre déjà l’ID 257, dont `Save Bits` est vide
   dans la table actuelle, et l’ID 361 admet plusieurs alignements candidats.
   Des IDs ultérieurs tels que 489 ont été observés pendant la reconstruction
   partielle, sans constituer une preuve de la table exacte utilisée au moment
   de la sauvegarde. Sous le schéma BKVince, une recherche hors table peut
   retourner un pointeur nul puis être déréférencée à `D2R.exe+0x61D66E`. Le
   crash observé n’est donc pas, à lui seul, la preuve d’un buffer de sauvegarde
   trop petit. Les tables exactes du donneur ne seraient nécessaires que pour
   attribuer un sens et une largeur à chaque valeur historique de `abc.d2s`;
   elles ne sont ni une dépendance ni une source de vérité de la solution
   générique destinée aux moddeurs.
2. **Sérialisation et transport.** Plusieurs objets dépassent déjà le budget
   d’un paquet item vanilla : environ 284 octets pour un jewel de 111 stats,
   201 octets pour 78 stats, 96 octets pour 32 stats et 337 octets pour un objet
   socketé avec ses deux jewels. Un autre jewel atteint environ 298 octets avant
   l’arrêt de sécurité du parseur. Le chemin de sauvegarde fournit un buffer de
   `0x4000` octets, tandis que deux chemins réseau observés fournissent `0xF4`
   octets au sérialiseur, bornent le paquet total à `0xFC` et stockent sa taille
   dans un octet. Augmenter une seule constante ne peut donc pas transporter des
   objets de 284 ou 337 octets.
3. **Rendu du tooltip.** Même un objet correctement représenté et transporté
   exige une construction de texte bornée ainsi qu’un affichage paginé,
   défilable ou autrement navigable. Cette surface UI ne doit pas être confondue
   avec le format de l’objet.

Huit fonctions sont maintenant gouvernées dans `known-rvas.json` : le
sérialiseur item `0x375EE0`, les producteurs item-action `0x9C`/`0x9D` à
`0x479CD0`/`0x479EA0`, la queue serveur `0x4817F0`, les dispatchers client
`0x12E2C0`/`0x12E490` et les lecteurs item `0x374FF0`/`0x374BF0`. Le
sérialiseur possède 20 callers directs; les chemins save lui donnent `0x4000`
octets, tandis que les producteurs réseau lui donnent `0xF4`, ajoutent
respectivement 8 ou 13 octets, plafonnent le paquet total à `0xFC` et stockent
sa longueur dans un octet.

## Séquencement retenu

### 1. Sécurité et mesure

- conserver `abc.d2s` comme témoin externe et produire un cas de test minimal
  libre de données personnelles;
- détecter les stat IDs absents, les lectures hors table et les dépassements de
  budget avant toute déréférence ou émission de paquet;
- journaliser séparément la taille sauvegarde, la taille réseau, le nombre de
  stats logiques et le schéma `ItemStatCost` requis;
- refuser explicitement un objet incompatible au lieu de poursuivre avec une
  structure partielle ou corrompue.

### 2. Flux item natif opaque

- conserver la sérialisation native et les IDs/valeurs du `ItemStatCost` actif :
  le plugin ne connaît aucun catalogue de contenu propre à un mod;
- utiliser le paquet vanilla inchangé lorsque l’objet tient dans son budget;
- fournir au sérialiseur un buffer borné configurable pour obtenir le flux item
  complet lorsque l’objet dépasse le budget réseau;
- conserver le chemin de sauvegarde natif tant que l’objet tient dans son
  budget prouvé de `0x4000` octets;
- refuser proprement un objet qui dépasse la limite configurée ou dont le schéma
  ne correspond pas aux tables chargées.

Le plugin transporte des octets item opaques : il n’interprète pas le design du
mod et ne promet aucune portabilité de ces octets vers un autre ensemble de
tables.

### 3. Extended Item Transport v1

- envelopper seulement les objets trop longs dans des fragments versionnés;
- associer chaque transfert à un identifiant, la taille totale, l’index et
  l’offset de fragment, ainsi qu’un checksum du flux item complet;
- borner la taille item, le nombre de transferts simultanés et le délai de
  réassemblage avant toute allocation;
- accepter les fragments hors ordre, mais refuser les trous, doublons,
  chevauchements, métadonnées contradictoires et checksums invalides;
- remettre le flux complet au décodeur item natif seulement après validation;
- transporter les frames dans le bitstream des paquets item-action `0x9C` ou
  `0x9D` existants, avec la même métadonnée d’action pour tout le transfert;
- reconnaître le marqueur `EIT1` au niveau des wrappers de décodage item : les
  fragments incomplets sont consommés sans action, et le dernier fragment remet
  le flux complet au chemin vanilla;
- ne créer aucun opcode réseau personnalisé. Les petits items et tous les flux
  sans marqueur restent entièrement vanilla.

Limite initiale proposée : `4096` octets par objet, configurable et strictement
bornée. La compatibilité avec un pair sans plugin est refusée; elle n’est pas un
objectif produit.

Le codec de référence limite chaque frame à `0xEF` (239) octets : avec
l’enveloppe item-action `0x9D` de 13 octets, un carrier de cette famille resterait
dans le plafond total observé de `0xFC`. Le carrier est retenu sur le plan
architectural, mais son refus sans effet secondaire pour les fragments
incomplets demeure un gate natif et runtime explicite.

### 4. Huge tooltips

- construire les lignes avec des buffers bornés et une limite configurable
  sûre;
- déterminer l’overflow depuis la hauteur réellement rendue selon la résolution,
  l’échelle UI, la police, la langue et le wrapping; le nombre de stats et la
  taille sérialisée de l’objet ne constituent pas le seuil produit;
- conserver le tooltip vanilla byte-for-byte lorsqu’il tient dans la surface
  disponible;
- lorsqu’il déborde, présenter une fenêtre bornée de lignes et permettre son
  défilement à la molette, au clavier et à la manette, avec retour au début dès
  que l’objet survolé change;
- afficher un indicateur de plage explicite et, dans la tranche suivante, une
  scrollbar de style natif avec mode épinglé permettant de la manipuler sans
  perdre le survol;
- coordonner le propriétaire du hook final de tooltip avec Transmogrify et
  Advanced Item Tooltips; aucun second hook concurrent ne sera installé sans
  audit et propriétaire unique;
- laisser le périmètre actuel d’Advanced Item Tooltips inchangé : Max Sockets
  et ses validations propres restent une mission séparée.

Vincent retient le 23 juillet 2026 le séquencement fonctionnel d’abord : prouver
la mesure d’overflow, livrer le fenêtrage et les entrées, puis ajouter la
présentation native complète. Le constructeur final `ITEMS_BuildItemTooltip` à
`0x2BD480` demeure actuellement possédé par Transmogrify; `0x2DC4B0` ne produit
qu’un sous-buffer de stats et aucun nouveau hook concurrent ne doit y être
installé. L’arbitrage doit aboutir à un pipeline final unique.

### 5. Cycle de vie complet

- valider création, save/load, équipement, retrait, drop/pickup, corpse,
  inventory, Horadric Cube, personal stash, shared stash, marchand et échange;
- valider solo, hôte et joiner avec plusieurs tailles logiques, y compris plus
  de 100 effets affichés;
- vérifier l’absence de perte, duplication, troncature, fuite, crash et
  désynchronisation.

## Contrat d’incubation PluginPack

- nom de travail : `ExtendedItemStats`;
- auteur exact : `RuffnecKk`;
- DLL autonome hybride prévue : `ExtendedItemStats.dll`, installable globalement
  ou dans un mod, sans `ModScopedOnly`;
- la même DLL autonome porte le transport étendu et le tooltip défilable; un
  moddeur n’installe jamais une seconde DLL pour obtenir la lisibilité des
  objets lourds;
- configuration autonome prévue : `ExtendedItemStats.json`, en anglais,
  compatible avec le lecteur du PluginPack, cherchée d’abord dans le mod actif
  puis dans le dossier global du jeu;
- aucun TOML;
- aucune modification, liaison ou redistribution d’une DLL d’eezstreet pendant
  l’incubation;
- destination de merge : fichiers internes
  `plugin-items/extended-item-stats.cpp` et
  `plugin-items/extended-item-stats.h`, puis configuration sous
  `items.extendedItemStats` dans l’unique `D2RPlugins.json`;
- après fusion, aucune DLL ni configuration autonome ne subsiste pour cette
  fonctionnalité;
- éventuel ZIP public limité à la DLL autonome et à son JSON autonome.

## Audit du propriétaire PluginPack

La référence gouvernée `D2RL-Plugins` est propre et épinglée au commit
`dc75b49ffbb67b887d7757ee00ee9a03bcde5d8a`. Le module propriétaire actuel ne
contient que `src/plugin-items/items-main.cpp`, `items-private.h`, son
`CMakeLists.txt` et `plugin.rc`. Sa configuration est chargée depuis la section
racine `items` à `items-main.cpp:586`; le lecteur partagé cherche d’abord
`<modDirectory>/D2RPlugins.json`, puis le fichier global, conformément à
`src/plugin-shared/include/plugin-shared-json.h:9-31`.

Les champs actuels de `ItemPluginOptions` sont bornés dans
`items-private.h:18-55`. Les structures partagées employées par le module sont
notamment `D2ItemsTxt`, `NpcItemCacheEntry`, `VendorChainEntry`, `D2GameStrc` et
`D2UnitStrc`, définies respectivement à
`src/plugin-shared/include/plugin-shared.h:101`, `:369`, `:381`, `:394` et
`:444`. La future option `extendedItemStats` devra être ajoutée sous cette même
structure et cette même section lors du merge, sans nouveau fichier de
configuration.

Empreinte native existante relevée dans `items-main.cpp:22-96` et installée à
`items-main.cpp:599-700` :

- hooks directs : `0x53C9F0` (vendeur), `0x541880` (gamble), `0x34B320`
  (limite d’or), `0x441300` (drop TC), `0x444920` (condition TC) et `0x3B5380`
  (évaluation `ConditionCalc`);
- redirections d’appels : `0x3A85A2` et `0x3A8682`;
- patches ponctuels : `0x442D2A`, `0x58BE1A`, `0x424AD1`, la table
  `0x372638..0x37264F`, `0x541A28`, `0x540F88..0x540F8D`,
  `0x54104D..0x541052` et `0x541084..0x541089`;
- fonctions seulement appelées, non hookées : `0x540EA0`, `0x53CFA0`,
  `0xA12150`, `0x3719E0` et `0x2F7D10`.

Aucune occurrence des chemins candidats de sérialisation `0x375EE0` et
`0x37FFD0` n’existe dans ce module au commit épinglé. Le constructeur final
`ITEMS_BuildItemTooltip` à `0x2BD480` est toutefois un point partagé avec
Transmogrify; depuis les prototypes `ExtendedItemStats 0.2.0` et
`Transmogrify 1.2.3`, le premier chargé en devient l’unique propriétaire et
l’autre lui délègue sa transformation par export explicite. Les six sites de
transport et ce septième hook final ont été prouvés dans le workbench 92777 et
acceptés par leurs signatures strictes au cold start mod-local.

Avant le premier changement de code, exécuter les gates obligatoires
`npm.cmd run re:d2r32 -- status` et
`npm.cmd run ref:d2rlplugins -- status`, puis auditer les structures, callbacks,
RVA, plages de hooks et clés de configuration déjà possédés par `plugin-items`.

## Gates observables

- catégorie `items` et destination `plugin-items.dll` confirmées par Vincent;
- `abc.d2s` diagnostiqué ou refusé sans access violation;
- stat ID absent et dépassement de budget différenciés dans les logs;
- objet synthétique de plus de 100 stats sérialisé, fragmenté et réassemblé
  byte-exact sans catalogue propre au mod;
- taille réellement sauvegardée et émise sous chaque plafond documentée;
- huge tooltip lisible jusqu’à sa dernière ligne à la souris et à la manette;
- cycle de vie complet validé en solo, chez l’hôte et chez le joiner;
- configuration absente gérée par défaut et JSON invalide refusé explicitement;
- build, signatures et ABI incompatibles refusés sûrement;
- coexistence avec les cinq DLL eezstreet, Advanced Item Tooltips et
  Transmogrify sans hook concurrent non arbitré;
- Release x64, manifeste v2, trois exports, hashes dépôt/runtime et deux portées
  d’installation validés avant toute livraison;
- ZIP éventuel inspecté et limité strictement à la DLL et au JSON.

## État

Mission en cours. Le fixture anonyme et le codec de référence
`Extended Item Transport v1` couvrent la mesure, la fragmentation bornée et le
réassemblage byte-exact hors jeu : 120 stats produisent 271 octets, fragmentés
en deux frames puis reconstitués byte-exact. Le cas maximal directement
encodable avec le schéma BKVince courant couvre 233 stats, 576 octets et trois
fragments. Un second fixture générique fondé sur des couches de stats valides
atteint exactement la limite configurée : 1019 stats dans 4096 octets, avec un
round-trip stat/layer/value byte-exact. Son SHA-256 item est
`2A42FC43F161770D89726F0806697371E363911690F0F32253546364F468A49B`.
Les tests JavaScript ciblés et le test natif Release passent.

Le prototype autonome hybride `ExtendedItemStats 0.2.3` est maintenant compilé
avec manifeste v2, transport et tooltip défilable dans la même DLL, quatre
exports et configuration JSON mod-local/global. La DLL Release gouvernée porte
le SHA-256
`EFCC8166754FEF1AB4374897A71D1E269CC5DA794FE09BDFF416F3D59B91D23E`.
Le cold start mod-local BKVince du 23 juillet 2026 lit le bon JSON, accepte les
six hooks de transport et l’unique hook final de tooltip à `0x2BD480`, tandis
que `Transmogrify 1.2.3` délègue ce point et conserve seulement ses trois autres
hooks. Le démarrage termine avec `active=21`, `rejected=0`, `failed=0`.

Le moteur pur de tooltip conserve byte-exact le texte qui tient, respecte
l’ordre final bas-vers-haut de D2R, recherche la plus grande fenêtre mesurée qui
tient et passe en Release un fixture de 1019 lignes jusqu’à la plage finale
`1011-1019`. Le prototype runtime expose molette, flèches, Page Up/Down,
Home/End, D-pad, épaules et stick droit. Pour ce premier test jouable, le seuil
est un budget conservateur configurable de 12 lignes, indicateur compris; la
mesure native exacte selon résolution et échelle UI demeure donc un gate ouvert
et ne doit pas être déclarée réussie à partir du seul cold start.

La validation automatisée en jeu de `ExtendedItemStats 0.2.3` couvre le même
jewel neuf de 233 stats et 576 octets dans le personal stash, en fullscreen
3840×2160 puis en fenêtre 1920×1080. La première résolution avait été décrite
à tort comme 2560×1440 en reprenant la taille logique de la capture automatisée;
les réglages D2R et le retour final au fullscreen confirment 3840×2160. Aux deux
résolutions, le tooltip réel est borné à 12 lignes affichées et ouvre sur
`[LINES 1-11 OF 40]`. La molette le fait progresser sans disparition jusqu’à
`[LINES 16-26 OF 40]`; `End` atteint la plage terminale
`[LINES 30-40 OF 40]` et `Home` revient à la première. Le passage sur une
potion conserve son tooltip normal sans indicateur ni détournement de la
molette, puis le retour au jewel recommence à la première plage.

Le test 1920×1080 a aussi découvert qu’en `0.2.2`, fermer puis rouvrir le coffre
sur le même objet pouvait conserver la plage terminale. La `0.2.3` réinitialise
maintenant l’état après une interruption de rendu supérieure à 500 ms; le
scénario fautif rejoué avec une pause d’une seconde revient bien à
`[LINES 1-11 OF 40]`. L’objet reste dans le coffre, les 88 potions bloquent
toujours l’inventaire, le save est écrit, le processus demeure répondant et
aucun nouveau rapport de crash n’est créé. Les 18 tests JavaScript et les deux
tests natifs Release passent; le cold start correspondant termine avec
`active=21`, `rejected=0`, `failed=0`. Cette preuve ferme l’accès à la dernière
ligne à la souris et au clavier pour ce contexte et ces deux résolutions. La
manette Xbox est détectée par Windows, mais aucune entrée manette n’a encore été
émise en jeu; ce gate, les autres conteneurs et la mesure native de hauteur
restent ouverts.

`ExtendedItemStats 0.3.0` livre la seconde tranche souris dans la même DLL :
rail, flèches et curseur proportionnel de style natif, molette à une ligne par
cran, clic milieu pour épingler le tooltip, clics de flèches à ±1 ligne et drag
continu selon le ratio du rail. Les résolveurs gouvernés `0x2A7810` et
`0x2A89C0` conservent respectivement l’unité et le widget du panneau épinglé;
le texte natif reste ainsi visible lorsque le pointeur quitte le jewel pour
manipuler la scrollbar. Le rendu réutilise, lorsqu’il est présent, le callback
overlay générique exporté par `FloatingDamage`; en son absence, la même DLL
`ExtendedItemStats` installe après découverte son propre hôte DirectX 12. Le
moddeur n’a donc toujours qu’un seul plugin fonctionnel à installer pour les
objets lourds; `FloatingDamage` est une coexistence optionnelle, pas une
dépendance.

La validation réelle dans le personal stash ouvre le jewel à
`[LINES 1-11 OF 40]`, puis un cran de molette donne
`[LINES 2-12 OF 40]`. Après épinglage, le texte demeure visible hors de
l’objet; le drag atteint directement `[LINES 30-40 OF 40]` et la flèche haute
revient exactement à `[LINES 29-39 OF 40]`. Le jewel demeure dans la première
case du coffre et l’inventaire bloqué par les potions n’est pas touché. Le cold
start final accepte les neuf hooks (six transport, deux résolveurs UI et
`0x2BD480`), applique 20 patchsets sur 20 et termine avec `active=20`,
`rejected=0`, `failed=0`; aucun rapport de crash postérieur au démarrage n’est
créé. Les deux tests natifs Release passent. Les DLL gouvernées et runtime sont
byte-identiques : SHA-256
`901C42AE4674CC763FEEEB452A71DA3347B0A3782E7B4C0C879D1D74F9DBA6EA` pour
`ExtendedItemStats.dll` et
`2EEDA1B58ED125E34022D8702CBF7282B9680BF226F06E442C45DA9976E40D02` pour
`FloatingDamage.dll`.

À la fermeture, D2RLoader signale séparément une exception structurée dans le
callback de déchargement de `FloatingDamage.dll`. `D2RCore` est néanmoins
déchargé, aucun processus `D2R` ou `D2RLoader` ne subsiste et aucun rapport de
crash frais n’est produit. Le log nomme explicitement cet autre plugin; cette
anomalie de teardown ne remet donc pas en cause la preuve fonctionnelle
`ExtendedItemStats`, mais elle interdit de qualifier la sortie globale de
parfaitement propre.

Le gate runtime du vrai objet est maintenant franchi dans BKVince à deux
niveaux historiques, puis au plafond produit. Le témoin frontière de 107 stats logiques produit un flux item natif
de 241 octets, dépasse donc le carrier vanilla de 239 octets, entre en partie
sans crash et affiche son huge tooltip. Le test maximal du schéma courant porte
233 stats dans 576 octets et trois fragments : le jewel charge directement dans
le personal stash, demeure présent après sauvegarde et rechargement, puis peut
être resauvegardé sans crash ni disparition. Le save maximal de preuve est
conservé localement sous `analysis-cache/runtime-validation/extended-item-stats/`
avec le SHA-256
`C8FE154186F8EB50E8E57043F0C31A5FED59F9897AB9312D5D865C72D5CFA507`;
le `QtyTester.d2s` original a ensuite été restauré byte-exact avec son SHA-256
`87C529363662D5F663047A29C3F92EA13BA7D8F6052AB46CBE0193385159F515`.

Le 23 juillet 2026, le personnage synthétique contenant directement dans son
personal stash l’item de 4096 octets et 1019 stats a été installé avec le
SHA-256 D2S
`18B47F34B1813144078F254BB9C96E9AB313A4F195FCCDFD8A3F7B4D05AF2790`.
Vincent confirme en jeu que le personnage, le coffre et l’objet fonctionnent
sans crash, overflow ni anomalie observée. Cette confirmation ferme le gate
solo de chargement au plafond configuré; elle ne ferme pas par inférence les
gates de cycle de vie, save/reload au plafond, hôte/joiner ou portée globale.

Les gates encore ouverts sont la confirmation fonctionnelle du fenêtrage à la
manette, la mesure native d’overflow selon résolution/échelle UI, la validation
runtime du renderer autonome de repli sans `FloatingDamage`, la matrice de cycle de vie complète
inventory/Cube/shared stash/corpse/drop/marchand/échange, la validation
solo/hôte/joiner et la portée globale. Aucune archive publique n’est créée.
