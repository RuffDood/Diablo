---
name: diablo-tsv
description: Modifier, migrer, auditer ou régénérer les tables TXT/TSV Diablo du dépôt sans altérer leur encodage ni leur structure. Utiliser ce skill pour toute lecture ou écriture de table sous data-TCP ou data-BKVince, toute comparaison avec les sources read-only, toute évolution de schéma TXT, et toute modification structurelle exigeant la régénération du cadastre.
---

# Diablo TSV

## Respecter les sources gouvernées

1. Lire `ai-cartographie.json` avant toute écriture et identifier le runtime ciblé.
2. Modifier uniquement une zone dont `agentAccess` autorise l'écriture. Traiter `data-BK/`, `data-BT/`, `data-VNP/`, `excel-vanilla2.4/` et `data-vanilla3.2/` comme des références read-only.
3. Utiliser `data-TCP/` comme source historique 2.4 et `data-BKVince/` comme cible de développement D2RLoader 3.2. Ne jamais confondre une source du dépôt avec un profil runtime actif.
4. Consulter `schemas/*.json` pour les colonnes typées. Pour D2R 3.2, préférer les headers réels BKVince et `guide/d2rdoc/`; n'utiliser TCP 2.4 ou `guide/legacy/` qu'en repli.

## Préserver les octets

1. Lire et écrire toute table avec `scripts/build-data/tsv.js`. Ne pas réécrire une table avec un tableur, `Set-Content`, une conversion CSV ou un parseur ad hoc.
2. Vérifier avant mutation que `serializeTable(parseTable(path))` reproduit exactement le contenu lu.
3. Exiger `table.eol === '\r\n'` pour une table D2R gouvernée et préserver `hasFinalEol`, l'ordre des headers, le nombre de colonnes et les champs vides.
4. Modifier les cellules par clé stable et header explicite. Refuser une clé absente, ambiguë ou dupliquée.
5. Écrire avec `writeTable`, puis relire et vérifier le round-trip byte-exact.

## Valider la modification

1. Examiner le diff et prouver qu'il ne contient que les cellules ou lignes prévues.
2. Exécuter d'abord le validateur le plus ciblé sous `scripts/build-data/` ou `scripts/migrate-bkvince/`, puis élargir à `npm run verify:data` si le périmètre le justifie.
3. Régénérer les schémas avec `npm run generate:schemas` seulement lorsque les headers ou la documentation structurée changent; examiner chaque schéma généré avant de le conserver.
4. Après ajout, suppression ou renommage de fichier ou dossier, régénérer `ai-cartographie.json`, enrichir les métadonnées de toute nouvelle zone signifiante, puis exiger `VALID` du validateur.
5. Consigner la preuve et les gates restants dans la mission concernée. Ne pas déclarer un chargement D2R réussi sans validation runtime séparée.

Lire [references/commands.md](references/commands.md) pour l'API exacte de `tsv.js`, les commandes de validation et le workflow du cadastre.
