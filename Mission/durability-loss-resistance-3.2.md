# Résistance à la perte de durabilité — BKVince D2RLoader 3.2

## Décision et séquencement

Option A retenue par Vincent le 18 juillet 2026 : entreprendre ce memory edit
immédiatement après la validation fonctionnelle des tomes TP/ID illimités, puis
reprendre `pierce-res` et les autres memory edits.

Le périmètre couvre les armes à durabilité, les pièces d'armure et la durabilité
interne des armes de jet lorsqu'elles sont utilisées en mêlée. La consommation
d'une unité par projectile lancé passe par une routine séparée et demeure hors
du périmètre de ce plugin.

## Objectif gameplay

Permettre aux armes et armures de perdre leur durabilité moins souvent, afin
d'allonger le temps entre les réparations sans modifier les affixes, le format
des sauvegardes ni les coûts unitaires de réparation.

Quatre réglages sont ajustables dans
`d2rloader/config/durability-resistance.toml` :

- `normal_resistance_percent` : résistance à la perte pour un objet normal;
- `ethereal_resistance_percent` : résistance à la perte pour un objet éthéré;
- `max_durability_percent` : part de la durabilité maximale normale conservée
  lorsqu'un objet devient éthéré, de 1 à 200 %;
- `force_maximum_durability` : surcharge le pourcentage et force la borne D2R
  absolue de 255 points.

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
- le contrôle throwable natif passe par le RVA `0x00374710` avant le tirage;
- lorsque la durabilité interne d'une arme de jet utilisée en mêlée atteint
  zéro, `0x00441CAF–0x00441CB9` lit `STAT_QUANTITY` (`70`) puis retire une unité
  au stack; la consommation d'un projectile utilise séparément le RVA
  `0x0043921D`.

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
1 et sa synchronisation. Depuis la version 1.0.1, la durabilité interne des
throwing weapons utilisées en mêlée reçoit elle aussi cette résistance; leur
consommation par projectile reste entièrement native et séparée. Le second hook
ne modifie le getter que lorsque son adresse de retour est exactement
`0x0044351F`; tous les autres appels de stats restent inchangés. La valeur est
précompensée afin que la formule native `/ 2 + 1` produise la cible configurée.
Sous 100 %, le bonus vanilla `+1` est conservé : pour une base de 20, les valeurs
25/50/75 produisent 6/11/16. Les valeurs 100 et 200 produisent respectivement la
durabilité normale et son double. Le résultat est borné à 255 et
`force_maximum_durability=true` force directement cette borne absolue.

Sources : `data-BKVince/d2rloader/plugins/DurabilityResistance-src/`.
Configuration : `data-BKVince/d2rloader/config/durability-resistance.toml`.
Archive publique : `addons/DurabilityResistance/DurabilityResistance.zip`,
contenant uniquement la DLL et le TOML, sans README ni sources. Archive 1.0.1 :
SHA-256 `B509AF955BE992BEA0CEBE9C8204366460B657BFE9E6B3112129A8957541A772`.

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
   politique, source/runtime SHA-256 identiques, puis cold-start 1.0.1 avec 20/20
   patches et 7/7 plugins, deux hooks acceptés et startup 24/24. La DLL validée
   porte le SHA-256
   `01E5A9137F091983DFE839B14E8372A6D432C812C62EE04B3FB9B9D0B6B1FD64` et
   le TOML le SHA-256
   `1601DCAA70EE41ED5A56F8A4D1D055EBF8F97FCB1A85972C1E66A5D846AED1AE`.
   Une assertion
   RapidJSON tardive de BKVince est reproduite à l'identique lors du lancement
   témoin sans `DurabilityResistance.dll`; elle est indépendante de ce plugin.
   La version 1.0.1 ajoute la couverture unitaire des cibles 25/50/75/100/200 et
   du réglage absolu 255; son cold-start et ses hashes sont consignés lors de sa
   reconstruction.
4. Mesurer sur un nombre suffisant de coups admissibles que les fréquences arme
   et armure suivent les valeurs configurées et que chaque succès retire toujours
   exactement 1 point.
5. Générer des exemplaires normaux et éthérés d'une même base avec plusieurs
   valeurs du pourcentage, puis confirmer la durabilité maximale, la durabilité
   courante initiale, l'arrondi, la borne de sauvegarde et le coût de réparation.
6. Tester arme à une main, arme à deux mains, dual wield, bouclier, chaque slot
   d'armure, objet éthéré, indestructible, self-repair et objet déjà brisé.
7. Vérifier souris et manette, solo, hôte et joiner, sauvegarde/rechargement,
   réparation marchande et absence de désynchronisation. Pour les armes de jet,
   vérifier séparément qu'une attaque de mêlée à 100 % ne réduit plus la
   durabilité interne ni le stack, tandis qu'un projectile lancé continue de
   consommer exactement une unité.
