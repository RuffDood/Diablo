# Rejuvenation Auto Pickup — D2RLAN 2.4

Module runtime local pour `D2R.exe 1.2.69270.0`.

- Ramasse seulement les objets au sol `rvs` et `rvl`.
- Identifie ces objets par leurs Class IDs globaux TCP `515` et `516`.
- Parcourt la liste serveur remappée des items (`UNIT_ITEM` 4 → `pUnitList[3]`).
- Réutilise les chemins serveur normaux de ramassage et de transfert d'inventaire.
- Remplit d'abord les colonnes de ceinture autorisées, puis tente l'inventaire si elles sont pleines et que `OverflowToInventory=1`.
- Si les colonnes autorisées et l'inventaire sont pleins, le pickup échoue et la potion reste au sol.
- Accepte les quatre colonnes, l'une des deux moitiés ou une seule colonne via `RejuvenationAutoPickup.ini`.
- Ignore les objets bloqués par une collision.
- Refuse de s'activer si la version ou les signatures attendues du binaire ne correspondent pas.
- Restaure les handlers et la sélection vanilla des cases de ceinture au déchargement.

Déploiement actif : `C:\Games\D2RLAN\Launcher`.

Le module est chargé par le `D2RHUD-Loader.exe` de TCP à côté de `MercenaryCommand.dll`; le `D2RHUD.dll` officiel n'est pas remplacé.

SHA-256 :

- `RejuvenationAutoPickup.dll` : `60B4FD057F6A61BBA9A63F2F88C9464A54AE0D41D67A2821B835B36AD8424671`
- `D2RHUD-Loader.exe` : `D23D350515A3EA2BD7F3B3E664B39B16CD667E6B25F6C8510B71895BF7305D3A`

## Configuration des colonnes

Les numéros correspondent aux quatre colonnes de raccourcis de la ceinture :

- `Columns=1,2,3,4` : toute la ceinture, valeur livrée par défaut;
- `Columns=1,2` : première moitié;
- `Columns=3,4` : seconde moitié;
- `Columns=3` : une seule colonne.

Une colonne contenant déjà une healing/mana potion n'est ni vidée ni remplacée. Le module remplit d'abord les colonnes autorisées contenant déjà une rejuv, puis une colonne autorisée encore vide.
