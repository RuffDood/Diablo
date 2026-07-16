# ItemStatCost — migration BK vers TCP

## Résultat technique

La migration copie uniquement `Save Bits` et `Save Add` depuis BK vers les statistiques communes de TCP concernées. Le fichier TCP complet n'est jamais remplacé.

- Source en lecture seule : `data-BK/global/excel/itemstatcost.txt`
- Cible : `data-TCP/global/excel/itemstatcost.txt`
- 372 statistiques communes
- 38 statistiques actuelles migrées
- 38 changements de `Save Bits`
- 28 changements textuels de `Save Add`, dont deux `0` devenus vides (valeur effective inchangée)
- 416 lignes TCP, 44 statistiques propres à TCP et tous les IDs conservés
- Champs `1.09-*`, transport réseau, affichage et autres colonnes laissés inchangés

La plage sauvegardable est calculée ainsi : `minimum = -Save Add` et `maximum = 2^Save Bits - 1 - Save Add`.

Le contrôle automatisé est lancé avec :

```text
npm run test:itemstatcost
```

Il doit afficher `VALID ItemStatCost BK -> TCP` et confirmer 36 références historiques, 30 cas uniques, 13 statistiques et aucun cas encore hors plage.

## Audit des 38 statistiques migrées

La notation `bits/add` regroupe les statistiques ayant la même transition.

| Avant TCP | Après BK | Nouvelle plage | Statistiques |
|---|---|---:|---|
| `9/0` | `10/0` | `0..1023` | `item_maxdamage_percent`, `item_mindamage_percent` |
| `6/0` | `10/100` | `-100..923` | `mindamage`, `secondary_mindamage`, `item_throw_mindamage`, `item_hp_perlevel`, `item_mana_perlevel`, `item_maxdamage_perlevel`, `item_maxdamage_percent_perlevel`, `item_tohit_perlevel`, `item_tohitpercent_perlevel` |
| `7/0` | `10/100` | `-100..923` | `maxdamage`, `secondary_maxdamage`, `item_throw_maxdamage` |
| `8/0` | `10/100` | `-100..923` | `damagepercent` |
| `8/0` | `9/0` | `0..511` | `armorclass_vs_hth`, `firemindam`, `magicmindam`, `coldmindam` |
| `6/0` | `9/0` | `0..511` | `lightmindam` |
| `7/30` | `10/100` | `-100..923` | `velocitypercent`, `attackrate` |
| `6/30` | `7/64` | `-64..63` | `hpregen` |
| `7/0` | `8/0` | `0..255` | `item_attackertakesdamage`, `item_kickdamage` |
| `9/100` | `10/300` | `-300..723` | `item_goldbonus` |
| `8/100` | `10/300` | `-300..723` | `item_magicbonus` |
| `7/0` | `10/300` | `-300..723` | `item_healafterkill`, `item_manaafterkill` |
| `4/4` | `10/100` | `-100..923` | `item_lightradius` |
| `7/20` | `10/100` | `-100..923` | `item_fasterattackrate`, `item_fastermovevelocity`, `item_fastergethitrate`, `item_fastercastrate` |
| `7/64` | `10/64` | `-64..959` | `item_levelreqpct` |
| `6/0` | `7/0` | `0..127` | `item_nonclassskill` |
| `3/0` | `4/0` | `0..15` | `item_singleskill` |
| `3/0` | `7/64` | `-64..63` | `item_allskills` |

## Matrice de validation sur sauvegarde neuve

Les 30 cas ci-dessous couvraient les 13 statistiques déjà observées hors de l'ancienne plage TCP. Les contrôles de table sont automatisés; les deux dernières colonnes restent à valider dans D2R.

| Statistique | Objets/propriétés à couvrir | Valeur(s) ciblée(s) | Ancienne plage | Nouvelle plage | Avant sauvegarde | Après rechargement |
|---|---|---:|---:|---:|:---:|:---:|
| `armorclass_vs_hth` | Haemosu's Adament — `ac-hth` | `300` | `0..255` | `0..511` | ☐ | ☐ |
| `coldmindam` | Demon's Arch, Elemental Union, Endlesshail — `dmg-cold`; Hellrack — `dmg-elem` | `300`, `400` | `0..255` | `0..511` | ☐ | ☐ |
| `firemindam` | Demon's Arch, Elemental Union, Grim's Burning Dead, Hexfire, Moonfall — `dmg-fire`; Hellrack — `dmg-elem` | `300`, `400` | `0..255` | `0..511` | ☐ | ☐ |
| `hpregen` | Hwanin's Splendor, Steelshade — `regen` | `51` | `-30..33` | `-64..63` | ☐ | ☐ |
| `item_attackertakesdamage` | Visceratuant — `thorns` | `150` | `0..127` | `0..255` | ☐ | ☐ |
| `item_fastercastrate` | Mang Song's Lesson — `cast2` | `115` | `-20..107` | `-100..923` | ☐ | ☐ |
| `item_magicbonus` | Charm Modifiers — `mag%` | `-199` | `-100..155` | `-300..723` | ☐ | ☐ |
| `item_nonclassskill` | Spellsteel — `oskill` | `100` | `0..63` | `0..127` | ☐ | ☐ |
| `item_singleskill` | Immortal King's Eternal Reign — `skill` | `10` | `0..7` | `0..15` | ☐ | ☐ |
| `lightmindam` | Demon's Arch — `dmg-ltng`; Elemental Union et Hellrack — `dmg-elem` | `69`, `300`, `400` | `0..63` | `0..511` | ☐ | ☐ |
| `magicmindam` | Djinnslayer — `dmg-mag` | `500` | `0..255` | `0..511` | ☐ | ☐ |
| `maxdamage` | Blood Thirst, Doombringer, Primal Gae Bolg — `dmg-norm` | `150`, `200` | `0..127` | `-100..923` | ☐ | ☐ |
| `mindamage` | Sigurd's Grip, Blood Thirst, Doombringer, Lightsabre, Primal Gae Bolg — `dmg-norm` | `75`, `100` | `0..63` | `-100..923` | ☐ | ☐ |

### Procédure en jeu

1. Sauvegarder les personnages importants hors du dossier de test.
2. Créer un personnage neuf après la migration.
3. Générer ou obtenir les objets de la matrice avec l'outillage de test habituel.
4. Vérifier chaque valeur avant de quitter la partie.
5. Sauvegarder, quitter complètement, relancer puis recharger le personnage.
6. Vérifier que les objets, valeurs et infobulles sont identiques après rechargement.
7. Ne reprendre les autres validations gameplay de l'Incrément 6 qu'après cette passe.

Les anciennes sauvegardes contenant ces statistiques peuvent être incompatibles avec le nouveau découpage binaire. Elles ne doivent pas servir de validation de référence.
