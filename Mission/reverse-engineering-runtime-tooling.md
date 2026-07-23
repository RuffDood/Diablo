# Atelier de reverse engineering et de validation runtime D2R 3.2

## Statut

Fondation livrée le 23 juillet 2026 pour `D2R.exe 3.2.92777` : toolchain MSVC déterministe, build uniforme des DLL CMake versionnées, capture de crash ou de gel et outils d'inspection runtime installés. Ghidra et le workbench `reverse-engineering/d2r-3.2.92777/` restent la source persistante de l'analyse statique.

## Outils installés

- x64dbg `2026.05.27` : breakpoints logiciels, matériels, mémoire et DLL, conditions, journalisation et tracing ciblé.
- Sysinternals Suite `2026-07-09` : ProcDump `12.01`, Process Monitor `4.04` et Process Explorer `17.12`.
- WinDbg `1.2606.22001.0` : analyse des dumps user-mode, piles, threads, modules et exceptions.

Le statut est reproductible sans dépendre du `PATH` du shell :

```powershell
npm.cmd run re:tools -- Status
```

Une nouvelle machine peut installer ou réparer le même ensemble de paquets :

```powershell
npm.cmd run re:tools -- Install
```

## Build natif uniforme

`Build-NativePlugins.ps1` découvre, trie et construit tous les projets CMake sous `data-BKVince/d2rloader/plugins/*-src` et `addons/*/src`. Il utilise exclusivement `vswhere` pour trouver Visual Studio Build Tools, importe `vcvars64.bat`, puis utilise les versions de CMake et Ninja livrées avec cette même installation. Le générateur est toujours Ninja x64, le runtime MSVC est explicite et `/Brepro` est appliqué à l'édition de liens.

Build Release complet avec les tests CTest disponibles :

```powershell
npm.cmd run native:build
```

Build propre ou ciblé :

```powershell
npm.cmd run native:build -- -Clean
npm.cmd run native:build -- -Project AdvancedItemTooltips,Transmogrify
npm.cmd run native:build -- -Configuration RelWithDebInfo -Project FloatingDamage
```

Les DLL, dépendances téléchargées et le manifeste SHA-256 sont produits sous `analysis-cache/native-build/`. Le script ne déploie rien dans `data-BKVince` ni dans le profil de jeu actif. Une synchronisation runtime reste une étape gouvernée séparée.

## Capture automatique des crashs et gels

Le moniteur par défaut attend `D2R.exe`, produit jusqu'à trois dumps MiniPlus sur exception non gérée ou fenêtre gelée, et les conserve dans `analysis-cache/runtime/dumps/` :

```powershell
npm.cmd run re:d2r32:capture
```

Pour laisser le moniteur tourner en arrière-plan avant de lancer D2RLoader :

```powershell
npm.cmd run re:d2r32:capture -- -Background
```

Valider la ligne de commande et le dossier de sortie sans attacher ProcDump :

```powershell
npm.cmd run re:d2r32:capture -- -DryRun
```

Pour isoler un cas ou demander toute la mémoire :

```powershell
npm.cmd run re:d2r32:capture -- -Mode Crash
npm.cmd run re:d2r32:capture -- -Mode Hang -DumpType Full -MaxDumps 1
```

Les dumps peuvent contenir des chemins, des chaînes, des identifiants ou d'autres données sensibles du processus. Ils sont gitignorés avec `analysis-cache/` et ne doivent jamais être commités ou partagés sans inspection.

Dans WinDbg, ouvrir le dump puis lancer au minimum :

```text
.symfix
.reload /f
!analyze -v
lm
~* k
```

Pour un crash dans `D2R.exe`, convertir l'adresse fautive en RVA avec `RIP - base du module D2R`, puis confronter ce RVA au workbench avec `npm.cmd run re:d2r32 -- function`, `xrefs`, `bytes` ou `known`. Pour un plugin construit en `RelWithDebInfo`, conserver le PDB local près de la DLL ou l'ajouter au chemin de symboles WinDbg.

## Tracing x64dbg

Utiliser x64dbg uniquement sur le runtime local D2RLoader hors ligne. Attacher `D2R.exe` après le démarrage, vérifier le build `92777`, puis utiliser la vue Modules pour confirmer les DLL chargées. Les sites connus se posent sous la forme `D2R.exe + RVA`; ne jamais convertir une adresse absolue d'une session en connaissance persistante.

Pour réduire le bruit :

- poser un breakpoint de chargement sur la DLL étudiée;
- conditionner un breakpoint par thread, argument, registre ou compteur de hits;
- journaliser sans interrompre avec une condition de pause à `0`;
- utiliser le tracing conditionnel seulement autour d'un site déjà borné par Ghidra ou le workbench;
- reporter toute identification stable dans `known-rvas.json` avec provenance et niveau de confiance.

## Fichiers, DLL et ordre de recherche

Dans Process Monitor, filtrer d'abord `Process Name is D2R.exe` ou `D2RLoader.exe`, puis limiter les opérations à `CreateFile`, `QueryOpen`, `Load Image` et aux accès de configuration pertinents. Comparer les chemins sous `<D2R>/mods/BKVince/` et `<D2R>/d2rloader/` pour prouver l'ordre mod/global; sauvegarder les traces PML uniquement sous `analysis-cache/runtime/procmon/`.

Dans Process Explorer, utiliser la recherche de handles et DLL pour identifier un fichier verrouillé, puis les onglets Image, Threads et DLLs de `D2R.exe` pour confirmer le chemin exact de chaque module. Fermer les instances D2R/D2RLoader directement lorsqu'une opération autorisée exige de libérer les fichiers, conformément aux règles du dépôt.

## Références officielles

- [Documentation x64dbg](https://help.x64dbg.com/)
- [Breakpoints conditionnels x64dbg](https://help.x64dbg.com/en/latest/introduction/ConditionalBreakpoint.html)
- [ProcDump](https://learn.microsoft.com/en-us/sysinternals/downloads/procdump)
- [Process Monitor](https://learn.microsoft.com/en-us/sysinternals/downloads/procmon)
- [Process Explorer](https://learn.microsoft.com/en-us/sysinternals/downloads/process-explorer)
- [Prise en main de WinDbg en user mode](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/getting-started-with-windbg)

## Décision d'outillage

Ghidra demeure propriétaire de l'analyse statique persistante. x64dbg, ProcDump, WinDbg, Process Monitor et Process Explorer fournissent les preuves dynamiques complémentaires. Aucun achat d'IDA Pro ou de Binary Ninja n'est justifié tant qu'une limitation concrète, reproductible et bloquante de Ghidra n'est pas documentée.
