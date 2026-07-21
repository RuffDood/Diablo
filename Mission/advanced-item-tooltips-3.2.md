# Advanced Item Tooltips — D2R 3.2.92777

## Décision produit

Le tooltip d'un objet socketable affiche sa capacité réelle calculée par le
runtime. Un objet sans socket affiche `Maximum Sockets: N`; un objet déjà
socketé affiche `Sockets: courant / N`. Le maximum est rendu avec le gris
vanilla `ÿc5`.

Pour les objets identifiés seulement, les propriétés variables présentes sur
l'objet reçoivent leur plage source en vert `ÿcU[min - max]`, puis la couleur
bleue des propriétés est restaurée. La valeur roulée conserve son signe, mais
les bornes sont toujours présentées comme des magnitudes positives. Les
propriétés fixes et les correspondances ambiguës sont laissées intactes.

Les armures identifiées affichent également leur défense de base et la plage de
la base. La défense éthérée applique le facteur vanilla avant l'affichage. La
ligne est omise si la défense de base ne peut pas être isolée sûrement de la
défense finale.

## Implantation

Le plugin hybride `AdvancedItemTooltips.dll` 1.0.0 est attribué à `RuffnecKk`
et ne déclare pas `ModScopedOnly`. Il accepte uniquement le build 92777 et
refuse d'installer son hook si les 32 octets attendus ne correspondent pas.

- `ITEMS_GetStatsDescription`, RVA `0x2DC4B0`, est intercepté après le rendu
  vanilla afin de préserver le texte existant.
- `ITEMS_GetMaxSockets`, RVA `0x36EAD0`, calcule la capacité de l'objet concret,
  incluant son niveau, sa base et les limites de type. La logique n'est pas
  dupliquée dans le plugin.
- `STATLIST_UnitGetStatValue`, RVA `0x2F5C60`, fournit le nombre de sockets et la
  défense finale.
- `UNITS_GetItemData`, RVA `0x34A500`, fournit la qualité, les flags et les IDs
  d'affixes. Le flag `0x10` interdit toute plage sur un objet non identifié.
- Les plages sont lues en lecture seule depuis les tables TXT du mod actif :
  `properties`, `itemstatcost`, préfixes, suffixes, automagic, uniques, sets et
  `armor`. `item-modifiers.json` contient uniquement les libellés localisés
  `TCPMaximumSockets`, `TCPSocketsCurrentMaximum`, `TCPBaseDefenseRange` et
  `TCPModifierRange` (IDs 65024–65027).

Une plage candidate doit correspondre à la fois à la valeur roulée et au
libellé `*Tooltip` de sa propriété. Le plugin préfère donc ne rien afficher
plutôt que d'associer une plage à la mauvaise ligne. Les propriétés calculées
ou provenant de sources encore non résolues conservent le rendu vanilla.

## Validation du 20 juillet 2026

- compilation Release x64 réussie;
- tests unitaires réussis, incluant signe négatif, plage positive, propriété
  fixe exclue et association par libellé;
- lecture réelle des tables BKVince validée avec Griffon's Eye (`*ID 336`) :
  défense `100–200`, dégâts foudre `10–15`, pierce foudre `8–15`, FCR fixe
  exclu et Diadem `50–60`;
- DLL finale SHA-256
  `C49F55E7B8E1E8F7F71CB55B64E51E98613C75E3B7FE726399CC78E40668324F`;
- cold-start D2RLoader : 12 plugins actifs, 0 rejet et 0 échec; partie BKVince
  atteinte sans crash;
- la capture visuelle finale d'un tooltip a été interrompue lorsque le contrôle
  Windows a détecté une intervention utilisateur. Elle reste le gate manuel
  avant de clore toute la matrice étendue de la ROADMAP.
