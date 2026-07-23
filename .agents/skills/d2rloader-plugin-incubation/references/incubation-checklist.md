# Checklist d'incubation PluginPack

## Propriétaires futurs

| Catégorie | DLL propriétaire |
|---|---|
| `items` | `plugin-items.dll` |
| `levels` | `plugin-levels.dll` |
| `misc` | `plugin-misc.dll` |
| `quests` | `plugin-quests.dll` |
| `skills` | `plugin-skills.dll` |

La confirmation de Vincent doit précéder toute écriture. Ne pas déduire son accord d'une catégorie techniquement évidente.

## Audit du module propriétaire

```powershell
npm.cmd run ref:d2rlplugins -- status
npm.cmd run ref:d2rlplugins -- search <terme>
npm.cmd run ref:d2rlplugins -- symbol <symbole>
```

Relever le commit épinglé, les fichiers du module, les clés existantes de `D2RPlugins.json`, les structures partagées, les callbacks, les RVA et chaque plage d'octets lue ou écrite. Citer commit, chemin et ligne dans la mission.

## Gates techniques

- Manifeste v2 et trois exports attendus vérifiés.
- Auteur exact `RuffnecKk`; crédits tiers conservés séparément.
- Description anglaise courte, visible par le joueur et sans détails internes.
- Build ciblé, signatures complètes, ABI et erreurs de chargement strictement contrôlés.
- Installation globale et mod-locale démontrée, sans `ModScopedOnly`.
- JSON autonome valide avec commentaires, priorité mod actif puis repli global.
- Configuration absente gérée par défaut; configuration présente mais invalide refusée explicitement.
- Aucun hook canonique sans propriétaire unique; aucune plage concurrente non auditée.

## Gate du ZIP public

Autoriser uniquement :

- la DLL autonome;
- le ou les JSON autonomes indispensables à son utilisation.

Interdire :

- README et documentation;
- sources, symboles et fichiers de build;
- TOML;
- logs et preuves;
- toute DLL d'eezstreet.

Lister les entrées après création, vérifier qu'elles sont à la racine attendue, puis calculer le SHA-256 du ZIP.
