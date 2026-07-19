# Correctif Enhanced Damage + Min/Max — BKVince D2RLoader 3.2

## Décision et séquencement

Mission confirmée par Vincent le 19 juillet 2026.

Deux séquencements ont été considérés :

1. corriger immédiatement la propagation des dégâts après le gate des tomes
   TP/ID et avant `pierce-res` et les autres patches gameplay 3.2 ;
2. attendre la fin du portage sélectif TCP/BKVince et traiter le défaut dans une
   passe autonome d'itemisation.

L'option 1 est retenue afin de sécuriser les calculs de dégâts physiques avant
les autres modifications du runtime et de réutiliser le workbench 92777 déjà
vérifié.

## Défaut à corriger

Le défaut historique n'est pas limité à l'affichage de la fiche de personnage.
Il touche la propagation effective du `% Enhanced Damage` lorsqu'un objet autre
qu'une arme contient également un bonus plat de dégâts physiques :

| Statistiques agrégées sur casque, armure ou bouclier | Comportement défectueux |
|---|---|
| `%ED` + Maximum Damage | `%ED` transmis uniquement au minimum |
| `%ED` + Minimum Damage | `%ED` transmis uniquement au maximum |
| `%ED` + Minimum et Maximum Damage | `%ED` transmis à aucune borne |

Les mêmes combinaisons doivent conserver leur comportement local vanilla sur
une arme. Un joyau `%ED` seul serti hors arme doit continuer à transmettre ses
deux composantes au porteur.

## Cause moteur

La propriété `dmg%` crée deux statistiques distinctes :
`item_mindamage_percent` et `item_maxdamage_percent`. Dans
`itemstatcost.txt`, chacune utilise l'opération `op=13` sur la borne plate
correspondante (`mindamage` ou `maxdamage`).

La reconstruction D2MOO montre que cette opération calcule le bonus local quand
le propriétaire de la liste est un item, puis empêche la statistique de
pourcentage correspondante d'être conservée dans la liste complète transmise au
porteur. Ce traitement est correct pour une arme mais incorrect pour une pièce
d'équipement hors arme.

La cible D2R 3.2 reste fermée : l'équivalent exact doit être prouvé dans
`D2R.exe 3.2.92777` avant toute écriture. Aucun RVA historique ne sera réutilisé
sans preuve.

## Solution retenue

Créer un plugin D2RLoader mod-local qui corrige la propagation au niveau du
getter central de stat, avant les formules finales de dégâts :

- cible exclusive `D2R.exe 3.2.92777` ;
- garde stricte du build et des octets attendus ;
- distinction native entre armes et objets hors arme ;
- comportement vanilla inchangé pour les armes ;
- restauration des composantes `%ED` manquantes pour casque, armure et
  bouclier ;
- aucune modification globale de `op=13` dans `itemstatcost.txt` ;
- refus sûr si la fonction, l'ABI ou les signatures ne correspondent pas.

Le correctif doit intervenir avant les formules finales de mêlée, missiles et
skills afin d'éviter des hooks divergents dans chaque chemin de dégâts.

## Implantation 3.2.92777

Le getter total `STATLIST_UnitGetStatValue` est identifié à la RVA
`0x002F5C60`. Son ABI est `(unit, statId, layer) -> int32`; l'index persistant
92777 dénombre 91 appelants directs. La fonction résout la stat list de l'unité
et l'enregistrement `ItemStatCost`, puis délègue au calcul récursif total à la
RVA `0x002F9B10`.

`EnhancedDamageMinMaxFix 1.0.0` intercepte ce getter avec la signature stricte :

```text
48 89 5C 24 10 48 89 6C 24 18 48 89 74 24 20
```

Seules les lectures layer 0 des stats 17 (`item_maxdamage_percent`) et 18
(`item_mindamage_percent`) d'un joueur ou monstre sont candidates. Pour chaque
item actif dont la stat list appartient à l'unité :

1. l'item type `Weapon` 45 et ses équivalences sont exclus avec le helper natif
   `ITEMS_CheckItemTypeId` ;
2. le pourcentage brut du host et de ses socket fillers est lu séparément ;
3. le pourcentage effectivement propagé par D2R est lu par le trampoline du
   getter original ;
4. seul le delta positif manquant est ajouté au résultat final.

Un garde thread-local empêche toute récursion, les additions sont saturées sur
`int32`, les parcours d'inventaire sont bornés à 4096 items et les armes
conservent intégralement le comportement vanilla. Aucune table TXT n'est
modifiée.

## Validation technique du 19 juillet 2026

- compilation Release x64 avec MSVC 19.44 et PluginSDK épinglé au commit
  `efcfaaa52eeec9e379b3fc2aad1013bb3dddc970` ;
- test `enhanced-damage-min-max-policy` réussi ;
- trois exports D2RLoader et ressource manifeste vérifiés ;
- octets attendus relus byte-exactement sur l'image déchiffrée 92777 ;
- SHA-256 source/runtime identique :
  `1CA34164F9FF7CDD66243673092AAA2CA1CA17889DD4FBE46E23AB05FADC197E` ;
- cold-start BKVince : hook accepté à `0x002F5C60`, plugin visible dans
  Extensions, 20/20 patches, 10/10 plugins et 24/24 étapes de démarrage ;
- smoke test runtime : Helena chargée en jeu, affichage Character et Inventory
  exercé avec le getter hooké, processus toujours répondant et aucune erreur,
  exception ou crash attribuable au plugin ;
- l'assertion RapidJSON tardive déjà connue est capturée après 24/24 et reste
  indépendante de ce plugin.

La matrice fonctionnelle des points 5 à 7 ci-dessous demeure à exécuter avec
des objets de test déterministes avant de clore la mission.

## Livrables

- `data-BKVince/d2rloader/plugins/EnhancedDamageMinMaxFix-src/` ;
- `data-BKVince/d2rloader/plugins/EnhancedDamageMinMaxFix.dll` ;
- configuration mod-locale uniquement si un réglage ou des diagnostics sont
  utiles ;
- commande console de diagnostic avec compteurs de corrections ;
- source, tests unitaires et documentation de l'ABI/RVA prouvés ;
- installation et cold-start dans le profil BKVince.

## Gate de validation

1. Localiser et documenter l'équivalent 92777 du traitement `op=13`, ses
   appelants et l'ABI retenue.
2. Compiler en Release x64 et réussir les tests unitaires de la politique.
3. Vérifier byte-exactement les signatures sur l'image déchiffrée et refuser un
   faux build ou une signature modifiée.
4. Charger le plugin à froid sous D2RLoader sans assertion ni crash.
5. Tester au minimum : `%ED` seul, `%ED/Max`, `%ED/Min`, `%ED/Min/Max`, joyaux
   séparés et ordres de sertissage inversés, sur casque, armure, bouclier et
   arme témoin.
6. Comparer dégâts minimum et maximum réels à des valeurs attendues
   déterministes, puis vérifier fiche de personnage et attaques effectives.
7. Couvrir mêlée, ranged, mercenaire, dual wield, sauvegarde/rechargement,
   équipement/déséquipement, souris/manette, solo, hôte et joiner, sans
   désynchronisation.
