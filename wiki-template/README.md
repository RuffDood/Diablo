# wiki-template — références pour le Wiki des 3 Mods (cible I4)

Dossier de références et de gabarits pour la construction du wiki de consultation/comparaison des mods (incrément I4 du plan).

## Inspirations

### BTDiablo — wiki du mod BT (`data-BT`)

- **Lien** : https://btd.miraheze.org/wiki/Main_Page
- Mod D2R solo de **BTNeandertha1**. Wiki communautaire (MediaWiki / Miraheze).
- **Organisation** (taxonomie de mod D2 à reprendre) :
  - **Items** : Overview, Prefix/Suffix, Runes, Gems, Corruptions, Socket List
  - **Unique Weapons** : par type (Axes, Bows, Crossbows, Daggers, Javelins, Maces, Polearms, Scepters, Spears, Staves, Swords, Throwing, Wands) + Class Weapons
  - **Unique Others** : Amulets, Rings, Charms, Jewels, Helms, Chests, Shields, Gloves, Belts, Boots + Class Armors
  - **Sets** (Normal / Expansion), **Runewords** (Helms / Weapons / Chests / Shields)
  - **Cube** : Crafting, Recipes
  - **Skills** : par classe (Amazon, Assassin, Barbarian, Druid, Necromancer, Paladin, Sorceress)
  - **Éditorial** : General Changes, How to Install, Bug Reporting, Future Ideas, Credits, Patch Notes
- **Principe d'or à reprendre** : *« tout ce qui n'est pas documenté est identique au vanilla »* → le wiki ne montre que les **écarts vs vanilla**. C'est exactement notre approche **diff-vs-vanilla** pour comparer BK / BT / TCP.
- **Index des pages** : [`btdiablo-wiki-index.json`](btdiablo-wiki-index.json) — les 1233 pages du wiki extraites du sitemap (`{title, url}`), comme référence de couverture et de navigation pour I4.

## Note d'implémentation

Nos pages se **génèrent depuis les `.txt`** (`uniqueitems`, `sets`, `runes`, `cubemain`, `skills`…) ; l'éditorial (patch notes, install) se rédige. Comme le repo contient les `.txt` de BT (`data-BT`), on pourra **valider notre rendu généré contre ce wiki manuel**.
