# Transmogrify — restauration D2R 3.2

## Statut et séquencement

- Statut : **implantation native fonctionnelle, matrice étendue encore ouverte**.
- Cible : `D2R.exe 3.2.92777` sous D2RLoader.
- Option A retenue par Vincent le 21 juillet 2026.
- `Transmogrify 1.2.0` est installé comme plugin hybride global/mod-local ; la
  copie mod-local est prioritaire lorsque les deux portées sont présentes.
- Le chemin souris 1.0.3 a été confirmé en jeu depuis l’inventory et le stash,
  et les transformations répétées ne génèrent plus de sockets aléatoires. La
  version 1.1.1 remplace le fallback vers l’inventory par un placement dans le
  même conteneur. Vincent a confirmé en jeu que les sorties 1.1.1 restent
  manipulables dans l’inventory et le stash ; le log autoritaire confirme les
  pages source `0` puis `4`. Cube et shared stash restent à distinguer dans la
  matrice complète.
- `AdvancedItemTooltips` demeure désactivé dans le dépôt et les deux portées
  runtime en attendant sa reprise indépendante.

## Intention joueur

Restaurer le système legacy Transmogrify : un clic droit sur un objet éligible
le consomme et crée l’objet défini par les colonnes TXT correspondantes. Ce
n’est pas un système cosmétique de changement d’apparence.

La conversion doit être utilisable depuis :

- l’inventory ;
- le Horadric Cube ;
- le personal stash ;
- le shared stash.

La souris et la manette doivent être couvertes. Le tooltip doit annoncer la
conversion disponible sans promettre un résultat que l’hôte refuserait.

## Contrat softcodé

Les recettes restent exclusivement dans `armor.txt`, `weapons.txt` et
`misc.txt` :

- `Transmogrify` active la conversion ;
- `TMogType` désigne le code de la base produite ;
- `TMogMin` et `TMogMax` déterminent la quantité produite lorsque la cible
  utilise une quantité.

Le plugin ne doit embarquer aucune liste de recettes. Toute personne capable
de modifier les tables du mod peut donc créer ses propres conversions sans
recompiler la DLL. Une éventuelle configuration TOML ne doit contenir que des
politiques globales, jamais une seconde source de recettes.

## Référence legacy gouvernée

D2MOO est une référence sémantique Diablo II 1.10f, jamais une source de RVA,
de structures ou d’ABI pour D2R 3.2.

- `D2MOO@19019806df7f3e877fa105b05395d1e3597e2316:source/D2Game/src/PLAYER/PlrMsg.cpp:3535`
  décrit le handler serveur du paquet client `0x4C`, long de 5 octets et portant
  le GUID de l’objet.
- `D2MOO@19019806df7f3e877fa105b05395d1e3597e2316:source/D2Game/src/ITEMS/ItemMode.cpp:5109`
  décrit la validation `Transmogrify`, la résolution de `TMogType`, la
  suppression de la source, la création du résultat et l’application de la
  quantité.
- `D2MOO@19019806df7f3e877fa105b05395d1e3597e2316:source/D2Game/src/SKILLS/Skills.cpp:1706`
  rattache la conversion au chemin serveur qui ajoute le son de succès.

Les points d’entrée D2R utilisés par l’implantation sont désormais prouvés dans
le workbench 92777 et gouvernés dans `known-rvas.json`. La référence D2MOO a
servi uniquement à confirmer la sémantique et la forme du créateur d’objet ;
les RVA, signatures et ABI employés proviennent tous de l’image 92777 vérifiée.

## Architecture visée

Le plugin D2RLoader hybride est installable globalement ou dans un mod :

- nom : `Transmogrify` ;
- auteur : `RuffnecKk` ;
- description : `Transforms configured items with a right-click.` ;
- aucune déclaration `ModScopedOnly` ;
- build gate strict sur `92777`, signatures et ABI vérifiées, refus sûr sinon.

Le client ne doit transmettre qu’une intention portant l’identité de l’objet.
L’hôte résout lui-même `Transmogrify`, `TMogType`, `TMogMin` et `TMogMax` depuis
ses tables chargées, valide la propriété et le conteneur, puis réalise la
mutation. Le client ne doit jamais choisir ni transmettre directement le code
de sortie.

La conversion vise une mutation atomique : une erreur de cible, de quantité, de
conteneur ou de placement conserve l’objet source et ne crée aucun résultat.
La sortie reste dans le conteneur de la source : inventory vers inventory, Cube
vers Cube et stash vers le même stash. La source est détachée temporairement
afin que sa cellule puisse accueillir la sortie ; si aucune position valide
n’existe, elle est restaurée sans être consommée. Aucun fallback vers
l’inventory ni drop au sol implicite n’est permis.

## Implantation livrée le 21 juillet 2026

- hook du getter `ItemsTxt` au RVA `0x314110` pour rendre utilisables les lignes
  dont `Transmogrify` et `TMogType` sont valides ;
- hook du constructeur de tooltip au RVA `0x2BD480`, avec une ligne rouge
  localisée placée sous les prérequis lorsqu’ils existent ; elle combine la
  chaîne native `convertsto` (ID 5387) et le nom localisé de la sortie
  `TMogType`, par exemple `Right Click to make Minor Mana Potion` ;
- résolution du code de sortie par `0x314070`, puis du texte actif par
  `0x5F4A50` à partir du champ nom D2R 92777 prouvé à `ItemsTxt+0xFC` ;
- option globale `tooltip.manual_text` dans `transmogrify.toml` : une chaîne
  vide conserve le texte automatique localisé selon `TMogType`, tandis qu’une
  chaîne non vide le remplace exactement sur tous les objets éligibles, sans
  modifier les recettes, sorties ni probabilités ;
- interception autoritaire du clic droit serveur au RVA `0x4F40C0`, résolution
  du GUID et relecture des colonnes depuis les tables chargées par l’hôte ;
- validation du propriétaire direct ou du conteneur appartenant au joueur,
  couvrant notamment les objets stockés dans le stash ;
- création non placée de qualité normale par `0x43D530`, recherche d’une place
  dans la grille native de la page source (`0x34A410`, `0x3865B0`), puis
  placement par `0x471500` avec conservation de la page et du node de stash ;
- détachement temporaire de la source avant la recherche afin de rendre sa
  cellule disponible, avec rollback vers son état original si la sortie ne peut
  pas être placée dans ce même conteneur ;
- hook ciblé du créateur `0x43D530` pendant une conversion afin de forcer son
  paramètre `noSockets=1` avant la sérialisation du nouvel objet ; aucun autre
  drop du jeu n’est modifié ;
- signatures strictes sur les quatre hooks, les deux résolveurs de tooltip et
  les routines natives de placement ; les cold-starts 1.2.0 acceptent les
  modes de tooltip manuel et automatique ainsi que les quatre
  hooks du plugin mod-local et refusent
  proprement le doublon global ; DLL dépôt/global/mod-local identiques,
  SHA-256 `8985808DC7864A7DA42FBDF62DC0B84C6A319F47E72433319CCE4654264E75AE` ;
- correctif 1.1.1 confirmé en jeu du paquet de création : `nodePage` précède
  `packedPosition`, conformément à l’appel natif `0x517530`; l’ordre inverse
  de 1.1.0 affichait la sortie mais la laissait gelée côté client ;
- règles temporaires `mp1 → qui` et armures de test `→ mp1` retirées après
  validation ; les recettes permanentes restent exclusivement sous contrôle
  des TXT.
- recette dummy `hp1 → mp1` retirée après confirmation du placement 1.1.1 ; la
  ligne `hp1` a retrouvé ses valeurs normales `Transmogrify=0` et
  `TMogType=xxx` dans les données source et runtime.
- package partageable créé sous `addons/Transmogrify/Transmogrify.zip` avec la
  DLL 1.2.0, son TOML et son README, sans table TXT ni recette dummy ; SHA-256
  du ZIP `F04932018B9F7A1F2782E1343B479216548EAE925DE00C063FD94483A09542FD`.

## Questions et gates restant à fermer

- Qualités autorisées : normal/superior seulement, ou aussi magic, rare,
  crafted, set et unique.
- États autorisés : socketed, runeword, ethereal, personalized et quest items.
- Interprétation des bornes lorsque `TMogMin` ou `TMogMax` est vide, nul,
  inversé ou supérieur au maximum de stack de la cible.
- Compatibilité attendue lorsqu’un joiner n’a pas le plugin ou charge des TXT
  différents de ceux de l’hôte.

## Gates de validation

- `armor.txt`, `weapons.txt` et `misc.txt`, cible stackable et non-stackable ;
- quantités fixes, plages et valeurs invalides ;
- inventory, Cube, personal stash et shared stash ;
- même taille, résultat plus petit et résultat plus grand que la source ;
- souris et manette, tooltip et son ;
- solo, hôte et joiner avec autorité exclusive de l’hôte ;
- sauvegarde/rechargement et changement de zone ;
- inventaire ou conteneur plein ;
- aucune perte, duplication, création partielle, crash ou désynchronisation ;
- coexistence avec `AdvancedItemTooltips` et les autres plugins BKVince.

## Critère de livraison

La mission est livrée lorsque les conversions définies uniquement par les TXT
fonctionnent dans les quatre conteneurs retenus, que l’hôte reste autoritaire,
que le plugin hybride passe ses contrôles statiques et son cold-start, et que
la matrice fonctionnelle est confirmée en jeu.
