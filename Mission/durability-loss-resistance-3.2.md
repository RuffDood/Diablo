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
d'allonger le temps entre les réparations sans modifier leur durabilité maximale,
les affixes, le format des sauvegardes ni les coûts unitaires de réparation.

Trois réglages doivent pouvoir être ajustés indépendamment :

- `weapon_chance` : chance qu'une arme perde 1 point lors d'un événement
  admissible;
- `armor_chance` : chance que la pièce d'armure sélectionnée perde 1 point lors
  d'un événement admissible;
- `ethereal_max_durability_percent` : pourcentage de la durabilité maximale
  normale conservé lorsqu'un objet devient éthéré, avec le bonus d'arrondi
  vanilla à confirmer séparément.

La valeur gameplay finale sera choisie après confirmation du comportement sous
D2R 3.2. Une valeur de `0` ne doit pas être utilisée comme preset initial : elle
équivaudrait à une durabilité infinie.

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

Ces valeurs et cette structure ne constituent pas encore une preuve pour
`D2R.exe 3.2.92777`. Aucune adresse, signature ou instruction provenant d'une
ancienne version ne peut être réutilisée directement.

## Cible et méthode

- cible exclusive : `D2R.exe 3.2.92777` sous D2RLoader 1.0.1-beta;
- reconstruire une copie d'analyse déchiffrée en lecture seule et restaurer les
  octets attendus des patches déjà actifs;
- retrouver la routine 3.2 par comparaison sémantique : vérification du type
  d'item, tirage aléatoire modulo 100, seuils arme/armure, lecture de
  `STAT_DURABILITY`, décrément de 1 et synchronisation client;
- retrouver séparément le chemin 3.2 qui calcule la durabilité d'un objet éthéré,
  confirmer la division par 2, le bonus `+1`, la borne maximale et tous les
  chemins capables d'appliquer le flag éthéré;
- confirmer séparément les chemins arme et armure ainsi que tous leurs appelants
  pertinents;
- privilégier un patch JSON D2RLoader minimal à taille constante si les seuils
  sont des opérandes sûrs; utiliser un plugin mod-local seulement si une couche de
  configuration ou plusieurs chemins refondus l'exigent;
- vérifier les octets `expected` avant toute écriture et refuser proprement le
  chargement sur tout build ou toute signature incompatible;
- ne pas modifier les poids de sélection des emplacements d'armure dans cette
  mission.

## Gate de validation

1. Documenter les RVA, fonctions englobantes, octets originaux et octets patchés
   du build 92777.
2. Vérifier statiquement chaque site sur l'image d'analyse déchiffrée, sans
   chevauchement avec un patch ou plugin existant.
3. Confirmer au cold-start que tous les patches et plugins BKVince se chargent
   sans échec, assertion ni crash.
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
