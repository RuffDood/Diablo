# Transmogrify — restauration D2R 3.2

## Statut et séquencement

- Statut : **implantation native fonctionnelle, matrice étendue encore ouverte**.
- Cible : `D2R.exe 3.2.92777` sous D2RLoader.
- Option A retenue par Vincent le 21 juillet 2026.
- `Transmogrify 1.0.3` est installé comme plugin hybride global/mod-local ; la
  copie mod-local est prioritaire lorsque les deux portées sont présentes.
- Le chemin souris a été confirmé en jeu depuis l’inventory et le stash : la
  source disparaît, le résultat arrive dans l’inventory et les transformations
  répétées ne génèrent plus de sockets aléatoires.
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
La politique exacte de placement — même cellule, autre cellule du même
conteneur, fallback inventory ou annulation — doit être arrêtée avant
l’implantation; aucun drop au sol implicite ne sera adopté sans décision
explicite.

## Implantation livrée le 21 juillet 2026

- hook du getter `ItemsTxt` au RVA `0x314110` pour rendre utilisables les lignes
  dont `Transmogrify` et `TMogType` sont valides ;
- hook du constructeur de tooltip au RVA `0x2BD480`, avec une ligne rouge
  localisée placée sous les prérequis lorsqu’ils existent ; elle combine la
  chaîne native `convertsto` (ID 5387) et le nom localisé de la sortie
  `TMogType`, par exemple `Right Click to make Minor Mana Potion` ;
- résolution du code de sortie par `0x314070`, puis du texte actif par
  `0x5F4A50` à partir du champ nom D2R 92777 prouvé à `ItemsTxt+0xFC` ; aucun
  texte de tooltip ni réglage TOML propre au plugin n’est requis ;
- interception autoritaire du clic droit serveur au RVA `0x4F40C0`, résolution
  du GUID et relecture des colonnes depuis les tables chargées par l’hôte ;
- validation du propriétaire direct ou du conteneur appartenant au joueur,
  couvrant notamment les objets stockés dans le stash ;
- création de qualité normale par le helper natif `0x517530`, puis notification,
  détachement et libération de la source par les chemins natifs 92777 ;
- hook ciblé du créateur `0x43D530` pendant une conversion afin de forcer son
  paramètre `noSockets=1` avant la sérialisation du nouvel objet ; aucun autre
  drop du jeu n’est modifié ;
- signatures strictes sur les quatre hooks et les deux résolveurs de tooltip ;
  le cold-start 1.0.3 accepte les quatre hooks du plugin mod-local et refuse
  proprement le doublon global ; DLL dépôt/global/mod-local identiques,
  SHA-256 `1DEECC4E65F005F489F237FD851D6F9C9116687CB1FD7A7FF8485DA5CEC65488` ;
- règles temporaires `mp1 → qui` et armures de test `→ mp1` retirées après
  validation ; les recettes permanentes restent exclusivement sous contrôle
  des TXT.
- recette dummy temporaire `hp1 → mp1` activée dans `misc.txt` pour valider le
  tooltip localisé 1.0.3 et la conversion, à retirer après confirmation.

## Questions et gates restant à fermer

- Qualités autorisées : normal/superior seulement, ou aussi magic, rare,
  crafted, set et unique.
- États autorisés : socketed, runeword, ethereal, personalized et quest items.
- Interprétation des bornes lorsque `TMogMin` ou `TMogMax` est vide, nul,
  inversé ou supérieur au maximum de stack de la cible.
- Politique de placement lorsque le résultat est plus grand que la source.
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
