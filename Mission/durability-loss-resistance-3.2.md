# Résistance à la perte de durabilité — BKVince D2RLoader 3.2

## Décision et séquencement

Option A retenue par Vincent le 18 juillet 2026 : entreprendre ce memory edit
immédiatement après la validation fonctionnelle des tomes TP/ID illimités, puis
reprendre `pierce-res` et les autres memory edits.

Le périmètre couvre uniquement les armes à durabilité et les pièces d'armure.
Les armes de jet sont explicitement exclues : leur quantité diminue déjà d'une
unité par projectile et un réglage séparé de leur perte de durabilité n'apporte
pas la valeur gameplay recherchée.

## Objectif gameplay

Permettre aux armes et armures de perdre leur durabilité moins souvent, afin
d'allonger le temps entre les réparations sans modifier les affixes, le format
des sauvegardes ni les coûts unitaires de réparation.

Trois réglages sont ajustables indépendamment dans
`d2rloader/config/durability-resistance.toml` :

- `normal_resistance_percent` : résistance à la perte pour un objet normal;
- `ethereal_resistance_percent` : résistance à la perte pour un objet éthéré;
- `max_durability_percent` : part de la durabilité maximale normale conservée
  lorsqu'un objet devient éthéré.

La résistance est appliquée au-dessus des probabilités natives, sans les
remplacer : la fréquence effective vaut `chance vanilla × (100 - résistance) /
100`. Ainsi, avec le preset initial de 50 %, une arme normale passe de 4 % à 2 %
et une armure de 10 % à 5 %. Une résistance de 100 % rend la durabilité infinie;
0 % conserve strictement la fréquence vanilla.

## Référence technique historique

La reconstruction D2MOO de Diablo II 1.10 expose deux routines utiles comme
indices conceptuels :

- `SUNITDMG_DrainItemDurability` traite les coups de mêlée réussis, applique la
  perte à l'arme de l'attaquant et choisit une pièce d'armure du défenseur selon
  les poids casque 3, torse 5, main droite 4, main gauche 4, ceinture 2, bottes 2
  et gants 2;
- `ITEMS_UpdateDurability` utilise une chance vanilla de 4 % pour une arme et de
  10 % pour une armure, puis retire exactement 1 point si le tirage réussit.
- le chemin de génération éthérée remplace la durabilité maximale par
  `(durabilité normale / 2) + 1`, puis initialise la durabilité courante à ce
  nouveau maximum, soit environ 50 % de la valeur normale.

La comparaison a ensuite été prouvée directement dans l'image déchiffrée de
`D2R.exe 3.2.92777`; aucune adresse historique n'a été réutilisée.

## Preuve D2R 3.2.92777

La routine native complète de perte de durabilité occupe le RVA
`0x00441B10–0x00441E89` :

- `0x00441B83` charge le seuil arme `4`;
- `0x00441BA6` charge le seuil armure `10`;
- `0x00441BB6–0x00441BC2` tire un nombre sur 100 et compare le résultat au
  seuil;
- `0x00441BCE–0x00441BD7` lit `STAT_DURABILITY` (`72`) et prépare la
  décrémentation exacte de 1;
- `0x00441C34–0x00441C38` réécrit la durabilité et les chemins suivants
  conservent les notifications et la synchronisation vanilla;
- le contrôle throwable natif passe par le RVA `0x00374710` avant le tirage.

La génération éthérée est confirmée séparément :

- le flag natif est `0x00400000` et son helper de lecture est au RVA
  `0x0036E2D0`;
- `0x0044351A` lit `STAT_MAXDURABILITY` (`73`);
- `0x0044351F–0x0044352E` calcule `(maximum normal / 2) + 1`;
- `0x00443532` écrit le nouveau maximum, puis `0x00443541–0x00443553`
  initialise la durabilité courante à ce maximum.

## Implantation livrée

`DurabilityResistance.dll` est un plugin D2RLoader mod-local, verrouillé à la
build 92777 et à deux signatures strictes :

- hook de la routine de perte au RVA `0x00441B10`, signature attendue
  `48 89 6C 24 10 56 57 41 54 41 56 41`;
- hook du getter de stat de base au RVA `0x002F48C0`, signature attendue
  `48 89 5C 24 10 48 89 6C 24 18 48 89 74 24 20`.

Le premier hook effectue un tirage de résistance avec la seed native de l'unité,
puis laisse la routine originale faire son tirage 4 %/10 %, sa décrémentation de
1 et sa synchronisation. Les throwables sont renvoyés directement vers la
routine originale sans tirage additionnel. Le second hook ne modifie le getter
que lorsque son adresse de retour est exactement `0x0044351F`; tous les autres
appels de stats restent inchangés. La valeur est précompensée afin que la formule
native `/ 2 + 1` produise le pourcentage configuré, arrondi et borné entre 1 et
255. La valeur 50 conserve exactement l'arrondi vanilla.

Sources : `data-BKVince/d2rloader/plugins/DurabilityResistance-src/`.
Configuration : `data-BKVince/d2rloader/config/durability-resistance.toml`.

## Cible et méthode

- cible exclusive : `D2R.exe 3.2.92777` sous D2RLoader 1.0.1-beta;
- reconstruire une copie d'analyse déchiffrée en lecture seule et restaurer les
  octets attendus des patches déjà actifs;
- routine 3.2, seuils, décrément, synchronisation et formule éthérée retrouvés et
  consignés ci-dessus;
- plugin mod-local retenu, car un patch JSON des constantes 4/10 ne pourrait pas
  distinguer les objets normaux des objets éthérés;
- vérifier les octets `expected` avant toute écriture et refuser proprement le
  chargement sur tout build ou toute signature incompatible;
- ne pas modifier les poids de sélection des emplacements d'armure dans cette
  mission.

## Gate de validation

1. **Réussi** — RVA, fonctions englobantes, formule et signatures du build 92777
   documentés.
2. **Réussi** — signatures et formule relues byte-exactes sur l'image d'analyse
   déchiffrée; aucun patch JSON existant ne cible les deux fonctions hookées.
3. **Réussi pour l'extension** — compilation Release x64, tests unitaires de la
   politique, source/runtime SHA-256 identiques, puis cold-start avec 19/19
   patches et 7/7 plugins, deux hooks acceptés et startup 24/24. Une assertion
   RapidJSON tardive de BKVince est reproduite à l'identique lors du lancement
   témoin sans `DurabilityResistance.dll`; elle est indépendante de ce plugin.
4. Mesurer sur un nombre suffisant de coups admissibles que les fréquences arme
   et armure suivent les valeurs configurées et que chaque succès retire toujours
   exactement 1 point.
5. Générer des exemplaires normaux et éthérés d'une même base avec plusieurs
   valeurs du pourcentage, puis confirmer la durabilité maximale, la durabilité
   courante initiale, l'arrondi, la borne de sauvegarde et le coût de réparation.
6. Tester arme à une main, arme à deux mains, dual wield, bouclier, chaque slot
   d'armure, objet éthéré, indestructible, self-repair et objet déjà brisé.
7. Vérifier souris et manette, solo, hôte et joiner, sauvegarde/rechargement,
   réparation marchande, absence de désynchronisation et absence d'effet sur les
   quantités des armes de jet.
