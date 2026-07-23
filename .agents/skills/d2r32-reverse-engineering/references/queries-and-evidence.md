# Requêtes et modèle de preuve

## Workbench 92777

```powershell
npm.cmd run re:d2r32 -- status
npm.cmd run re:d2r32 -- self-test
npm.cmd run re:d2r32 -- known tome
npm.cmd run re:d2r32 -- function 0x5817BD
npm.cmd run re:d2r32 -- xrefs 0x46F090
npm.cmd run re:d2r32 -- bytes "41 B9 ?? ?? ?? ??"
npm.cmd run re:d2r32:ghidra -- status
npm.cmd run re:d2r32:ghidra -- function 0x441B10 180
```

Sous PowerShell, `npm.cmd` contourne un éventuel blocage de `npm.ps1` sans modifier la stratégie d'exécution système.

## Références épinglées

```powershell
npm.cmd run ref:d2moo -- status
npm.cmd run ref:d2moo -- search durability
npm.cmd run ref:d2moo -- symbol ITEMS_UpdateDurability
npm.cmd run ref:d2rlplugins -- status
npm.cmd run ref:d2rlplugins -- search sgptDataTables
npm.cmd run ref:d2rlplugins -- symbol D2UnitStrc
```

Les pins et politiques résident dans `reverse-engineering/references.json`; les clones locaux restent sous `analysis-cache/references/`.

## Preuve minimale avant implantation

- Build et hashes vérifiés par `status`.
- Fonction native bornée et rôle expliqué.
- Callsites/xrefs pertinents recensés.
- Octets `expected` assez stricts pour refuser un binaire incompatible.
- ABI et champs de structure démontrés par le code 92777.
- Plage exacte de lecture/écriture ou de hook, avec audit des collisions.
- Source primaire consignée dans la mission et dans `known-rvas.json` si stable.
- Validation runtime encore distinguée de la preuve statique.
