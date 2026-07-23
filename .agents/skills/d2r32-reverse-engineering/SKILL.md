---
name: d2r32-reverse-engineering
description: Interroger l'atelier persistant de reverse engineering de D2R.exe 3.2.92777 et produire des preuves gouvernées de fonctions, RVA, signatures, structures, callbacks, hooks et ABI. Utiliser ce skill avant tout memory patch, plugin natif ou diagnostic binaire visant le build 92777, ainsi que pour promouvoir une identification stable dans known-rvas.json.
---

# Reverse engineering D2R 3.2.92777

## Franchir le gate du workbench

1. Exécuter obligatoirement `npm run re:d2r32 -- status` avant toute analyse native.
2. Arrêter l'analyse si l'image canonique ou l'index ne correspondent pas aux hashes gouvernés.
3. Si le statut est vérifié, réutiliser l'image, l'index SQLite et le projet Ghidra persistants. Ne pas redumper le processus, réimporter le binaire ni reconstruire un corpus équivalent.
4. Lire `reverse-engineering/d2r-3.2.92777/findings.md`, puis interroger `known` avant de lancer une recherche nouvelle.

## Construire une preuve compacte

1. Utiliser `known` pour retrouver les identifications, patches et missions existants.
2. Utiliser `function` pour borner et désassembler la fonction contenant un RVA.
3. Utiliser `xrefs` pour inventorier les appelants ou consommateurs et `bytes` pour vérifier une signature exacte ou à wildcards.
4. Utiliser `npm run re:d2r32:ghidra -- function ...` seulement lorsqu'une décompilation ciblée apporte une preuve supplémentaire. Ne pas lancer une analyse globale par défaut.
5. Prouver séparément le rôle, le RVA, les octets attendus, l'ABI, les champs de structure, les callbacks et la plage de hook nécessaires. Une similarité sémantique ne prouve ni adresse ni layout.

## Utiliser les références externes

1. Vérifier la référence épinglée avec `status` avant `search` ou `symbol`.
2. Citer chaque preuve externe avec le commit, le chemin et la ligne produits par l'outil.
3. Traiter D2MOO comme une référence sémantique Diablo II 1.10f uniquement. Ne transposer aucune adresse, ordinal, structure ni ABI 32 bits vers D2R.
4. Prouver indépendamment toute correspondance dans l'image 92777.

## Promouvoir et transmettre la preuve

1. Ajouter une identification stable à `reverse-engineering/d2r-3.2.92777/known-rvas.json` avec `rva`, `name`, `kind`, `confidence`, `source` et des `notes` précises.
2. Garder une hypothèse en confiance basse ou dans `findings.md` tant que son comportement ou son ABI n'est pas établi.
3. Mettre à jour la mission avec les commandes, callsites, signatures, structures et limites réellement prouvés.
4. Créer un workbench distinct pour tout nouveau build. Ne jamais réutiliser un RVA 92777 sans preuve propre au nouveau binaire.
5. Ne jamais versionner les images, projets Ghidra, index, corpus ou clones sous `analysis-cache/`.

Lire [references/queries-and-evidence.md](references/queries-and-evidence.md) pour les commandes exactes et le format minimal d'une preuve.
