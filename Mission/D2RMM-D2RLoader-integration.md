# D2RMM Custom — intégration BKVince/D2RLoader

## Décision

Le fork `yinyin333333/d2rmm` est retenu comme **outil de composition local** pour
exécuter des mods D2RMM avec D2RLoader. Il n'est pas une nouvelle source de
vérité du mod.

- version installable retenue : `1.9.1`;
- commit épinglé : `634a39199fb819d2228e8aba7924e1515a291316`;
- archive officielle : `D2RMM.Custom.1.9.1.zip`;
- SHA-256 : `1D09425B4DCF69190D4F01459FD61C66C49E9D5B3D0FB534AEE1C724BA7A7DC6`;
- la branche amont `1.9.2` a été auditée, mais elle reste non taguée et non
  publiée au moment de l'intégration.

## Frontières de propriété

1. `data-BKVince/` reste la source gouvernée et versionnée du gameplay/runtime.
2. `C:/Games/Diablo II Resurrected/mods/BKVince/` reste le runtime validé.
3. D2RMM Custom compose ses mods dans une sortie locale. Toute modification à
   conserver doit être analysée puis rejouée dans `data-BKVince` avec les outils
   du dépôt; une sortie D2RMM ne doit jamais être recopiée aveuglément.
4. Les DLL, patches et configurations D2RLoader importés par D2RMM sont des
   paquets gérés séparément. Les extensions déjà versionnées sous
   `data-BKVince/d2rloader/` demeurent prioritaires.

## Capacités auditées

Le fork sait :

- lancer `D2RLoader.exe` et sélectionner le mod de sortie;
- lire et mettre à jour `d2rloader/config/d2rloader.toml` en préservant les
  commentaires et fins de ligne;
- produire `modinfo.json` et les prérequis de données attendus par D2RLoader;
- importer des DLL, patches JSON, dossiers ou ZIP en paquets avec inventaire et
  SHA-256;
- refuser les DLL dépourvues de `D2RLoaderGetPluginInfo` ou
  `D2RLoaderLoadPlugin`;
- éditer les JSON gérés et déployer atomiquement lors de `Install Mods`.

## Installation et réglages

Exécuter :

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-d2rmm-d2rloader.ps1
```

L'installateur conserve D2RMM 1.8.0, installe la version custom dans un dossier
séparé et migre uniquement son catalogue `mods/`.

Dans D2RMM Custom :

1. Game directory : `C:/Games/Diablo II Resurrected`.
2. Output mod name : `BKVince`.
3. Activer `Use D2RLoader`.
4. Vérifier que `default_mod` vaut `BKVince`.
5. Garder la normalisation CRLF activée pour les tables TXT.
6. Exécuter `Install Mods`, puis `Run D2R`.

## Validation obligatoire avant adoption d'un mod D2RMM

- comparer byte-à-byte la sortie aux sources gouvernées;
- classer chaque fichier en data, asset, patch ou plugin;
- rejouer les TSV avec `scripts/build-data/tsv.js`;
- tester un démarrage à froid sous D2RLoader et le build D2R ciblé;
- ne conserver dans Git que les changements explicitement validés.
