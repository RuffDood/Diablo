# Reverse engineering persistant

Ce dossier conserve les petits artefacts gouvernes qui evitent de recommencer
les analyses binaires a chaque session : manifestes de build, index de RVA,
notes et commandes reproductibles.

Les executables reconstruits depuis la memoire, projets Ghidra, bases SQLite et
clones de reference restent exclusivement dans `analysis-cache/`. Ce dossier
est ignore par Git et exclu du cadastre, car il contient des artefacts locaux
volumineux et potentiellement soumis aux droits du jeu.

Le workbench actif est [d2r-3.2.92777](d2r-3.2.92777/README.md).

## Références externes épinglées

Le registre [references.json](references.json) gouverne les clones de sources
externes conservés sous `analysis-cache/references/`. Il fixe leur dépôt amont,
leur commit, leur licence, leur portée et leur format de citation sans
versionner leurs sources dans Diablo.

D2MOO est la première référence enregistrée. Il décrit Diablo II 1.10f et sert
uniquement à retrouver l'intention gameplay, des noms et des formes de flux de
contrôle. Ses adresses, ordinals, structures et ABI 32 bits ne sont jamais des
preuves pour D2R 3.2.92777.

`eezstreet/D2RL-Plugins` est la référence d'intégration du PluginPack. Son clone
propre épinglé reste intact sous `analysis-cache/references/D2RL-Plugins`; les
prototypes RuffnecKk sont développés dans une copie de travail distincte du
workbench 92777. Les fichiers CMake, headers et sources du commit épinglé font
autorité pour le squelette réel. Le README amont peut être en retard sur le
code — au commit courant, il décrit encore une configuration INI et une DLL
partagée alors que les sources utilisent `D2RPlugins.json` et une bibliothèque
statique `plugin-shared`.

```powershell
npm run re:refs -- list
npm run ref:d2moo -- status
npm run ref:d2moo -- bootstrap
npm run ref:d2moo -- search durability
npm run ref:d2moo -- symbol ITEMS_UpdateDurability
npm run ref:d2moo -- update
npm run ref:d2rlplugins -- status
npm run ref:d2rlplugins -- search sgptDataTables
npm run ref:d2rlplugins -- symbol D2UnitStrc
```

`update` est volontairement explicite : il avance le clone local et le commit
du manifeste vers la branche amont configurée. Une preuve issue du clone est
citée sous la forme
`D2MOO@19019806df7f3e877fa105b05395d1e3597e2316:source/...:ligne`.
Une preuve PluginPack suit le même principe :
`D2RL-Plugins@dc75b49ffbb67b887d7757ee00ee9a03bcde5d8a:src/...:ligne`.
