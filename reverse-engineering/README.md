# Reverse engineering persistant

Ce dossier conserve les petits artefacts gouvernes qui evitent de recommencer
les analyses binaires a chaque session : manifestes de build, index de RVA,
notes et commandes reproductibles.

Les executables reconstruits depuis la memoire, projets Ghidra, bases SQLite et
clones de reference restent exclusivement dans `analysis-cache/`. Ce dossier
est ignore par Git et exclu du cadastre, car il contient des artefacts locaux
volumineux et potentiellement soumis aux droits du jeu.

Le workbench actif est [d2r-3.2.92777](d2r-3.2.92777/README.md).
