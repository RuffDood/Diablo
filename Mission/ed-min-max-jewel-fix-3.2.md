# Correctif Enhanced Damage + Min/Max — BKVince D2RLoader 3.2

## Décision

Mission confirmée par Vincent le 19 juillet 2026. Le correctif doit être livré
comme plugin D2RLoader hybride, utilisable depuis le dossier global ou depuis
le dossier d'un mod, sans configuration TOML obligatoire.

## Défaut

Le défaut historique touche les dégâts réels, pas seulement l'affichage :

| Statistiques agrégées sur un objet hors arme | Comportement défectueux |
|---|---|
| `%ED` + Maximum Damage | la composante `%ED` maximum disparaît |
| `%ED` + Minimum Damage | la composante `%ED` minimum disparaît |
| `%ED` + Minimum et Maximum Damage | les deux composantes `%ED` disparaissent |

Le comportement local d'une arme doit rester vanilla.

Le cas déterministe fourni par le testeur est un joyau modifié à `500% ED`,
`+1 Minimum Damage` et `+2 Maximum Damage`, serti dans un casque, avec une hache
de main `3-6` et un barbare à `30 Strength`. L'attendu annoncé est `25-50`; le
résultat vanilla observé est `5-10`, confirmé par le journal de combat.

## Reconstruction moteur prouvée

La propriété `dmg%` utilise deux statistiques :

- 17, `item_maxdamage_percent` ;
- 18, `item_mindamage_percent`.

Dans `itemstatcost.txt`, les deux utilisent `op=13` avec les statistiques plates
de la borne correspondante. Le workbench persistant de `D2R.exe 3.2.92777`
permet maintenant de suivre toute la chaîne :

1. `0x2F5C60`, `STATLIST_UnitGetStatValue`, construit la clé packée sous la
   forme `(statId << 16) | layer` ;
2. `0x2F9B10`, `STATLIST_GetTotalStatValue`, lit simplement `FullStats` pour une
   liste étendue ; ce n'est pas l'évaluateur récursif ;
3. `0x2F8AD0`, `STATLIST_EvaluateStatOperations`, interprète les opérations
   ItemStatCost ; sa table de 13 opérations dirige `op=13` vers `0x2F9709` ;
4. `0x2FA430`, `STATLIST_EvaluateAndUpdateStat`, appelle l'évaluateur, rafraîchit
   les dépendances, puis écrit normalement le résultat avec `0x2F9DB0` ;
5. le switch de mise à jour à `0x2FA697` dirige `op=13` vers `0x2FA8C7` ;
6. cette branche compare `statList+0x08` à `UNIT_ITEM (4)` et, si la comparaison
   réussit, met le booléen de mise à jour à faux. La valeur vient donc d'être
   calculée, mais n'est pas conservée dans `FullStats`.

Cette dernière suppression est la cause moteur précise à corriger. Elle est
nécessaire pour le calcul local des armes, mais incorrecte lorsqu'une liste est
propagée depuis un casque, une armure ou un bouclier.

## Pourquoi les versions précédentes ne pouvaient pas fonctionner

### 1.0.0

La version 1.0.0 interceptait le wrapper `0x2F5C60`. Un test externe a prouvé
que cela ne corrigeait pas les attaques réelles.

### 1.1.0

La version 1.1.0 interceptait `0x2F9B10`, mais deux hypothèses étaient fausses :

- cette fonction est un getter de `FullStats`, pas l'évaluateur récursif ;
- le plugin décodait la clé packée comme `(layer << 16) | statId`, alors que le
  moteur utilise `(statId << 16) | layer`.

Pour les valeurs réelles `0x00110000` et `0x00120000`, le prédicat du plugin
était donc toujours faux. Le hook ne pouvait déclencher aucune correction. Le
second test externe négatif est cohérent avec cette erreur déterministe.

## Correctif 1.2.0

La nouvelle version abandonne entièrement le scan d'inventaire et le rattrapage
au getter. Elle intercepte `STATLIST_EvaluateAndUpdateStat` à `0x2FA430`, puis
laisse d'abord le moteur exécuter son calcul original. Elle restaure l'écriture
native via `STATLIST_UpdateUnitStat` seulement lorsque toutes les conditions
suivantes sont vraies :

- la statistique packée est 17 ou 18, layer 0 ;
- l'opération ItemStatCost est exactement 13 ;
- le type propriétaire de la liste est `UNIT_ITEM` ;
- l'objet effectif est résolu depuis l'unité active de la liste ou son
  propriétaire original ;
- cet objet n'est pas du type `Weapon` 45 ;
- la valeur calculée diffère encore de la valeur conservée dans `FullStats`.

Le dernier test évite une écriture en double lorsque le moteur n'a rien
supprimé. Les armes suivent intégralement la branche vanilla. Aucune table TXT
n'est modifiée et aucune autre statistique `op=13` n'est touchée.

## Télémétrie du testeur

La première correction réussie écrit une ligne anglaise dans le journal
D2RLoader avec le stat ID, la valeur retenue et la valeur évaluée. La commande
console `enhanced-damage-min-max-fix` affiche :

- le nombre de mises à jour `op=13` restaurées ;
- le détail minimum/maximum ;
- le nombre de mises à jour d'arme laissées vanilla ;
- les échecs éventuels de vérification après écriture.

## Validation technique

La validation locale autorisée est limitée à l'analyse statique, aux signatures
byte-exactes, à la compilation, aux tests unitaires et aux contrôles du binaire.
Vincent a explicitement demandé de ne pas lancer D2R localement : la validation
fonctionnelle appartient à son testeur personnel.

La matrice de référence demandait au minimum :

1. le cas `500% ED / +1 min / +2 max` sur casque produit les dégâts attendus ;
2. `%ED/Max`, `%ED/Min` et `%ED/Min/Max` fonctionnent sur casque, armure et
   bouclier ;
3. le même joyau sur une arme conserve son comportement vanilla ;
4. le journal contient une première correction et zéro échec après écriture.

## Validation fonctionnelle externe — 20 juillet 2026

Le testeur personnel de Vincent confirme que la correction fonctionne in-game
sur les deux chemins de dégâts demandés :

- attaques avec melee weapons ;
- attaques avec throwable weapons.

Cette validation confirme que la restauration `op=13` atteint les dégâts réels
et ne se limite pas à l'affichage. La build `1.2.0-test1` est donc promue en
version finale `1.2.0`. Aucun lancement local de D2R n'a été effectué.

Le gate fonctionnel principal est fermé. Les variantes supplémentaires de la
matrice demeurent des tests de non-régression facultatifs et ne bloquent plus la
livraison.

## Livrables

- `data-BKVince/d2rloader/plugins/EnhancedDamageMinMaxFix-src/` ;
- `data-BKVince/d2rloader/plugins/EnhancedDamageMinMaxFix.dll` ;
- archive anglaise sans guide d'installation ;
- DLL hybride globale/mod-locale, sans flag `ModScopedOnly`.
