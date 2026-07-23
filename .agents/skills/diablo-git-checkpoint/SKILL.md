---
name: diablo-git-checkpoint
description: Isoler, auditer, valider, committer et pousser des checkpoints Git cohérents dans le dépôt Diablo malgré un workspace sale ou activement modifié. Utiliser ce skill pour « next lot », « prépare le commit », « GO COMMIT », « GO PUSH », l'assainissement Git, le staging partiel de ROADMAP/cadastre/RVA, la détection de fichiers encore actifs et la validation exacte du contenu de l'index.
---

# Checkpoints Git Diablo

## Protéger le travail en cours

1. Lire `AGENTS.md`, la mission courante et les règles Git applicables avant toute mutation de l'index.
2. Traiter `HEAD`, l'index et le worktree comme trois états distincts. Ne jamais supposer que toutes les entrées sales appartiennent au même chantier.
3. Examiner l'index existant avant d'ajouter quoi que ce soit. Ne pas désindexer, remplacer ou absorber un lot préparé par un autre agent sans autorisation explicite.
4. Si l'utilisateur travaille encore sur le lot ou si ses fichiers continuent à changer, ne pas committer. Attendre son signal de fin, refaire l'audit puis actualiser l'index.
5. Ne jamais changer de branche. Appliquer exactement les gates d'identité et d'autorisation de commit/push définis par le dépôt.

## Inventorier le checkpoint

1. Exécuter `node .agents/skills/diablo-git-checkpoint/scripts/inspect-checkpoint.mjs` depuis la racine.
2. Identifier la mission, l'effet joueur ou l'objectif technique unique du prochain lot.
3. Définir une allowlist de fichiers et, pour les fichiers partagés, une allowlist de lignes ou d'objets. Exclure explicitement les builds, caches, sauvegardes, preuves locales et chantiers concurrents.
4. Traiter chaque fichier `mixed` comme un risque : la version indexée et la version de travail diffèrent. Vérifier les deux avant de poursuivre.
5. Pour un changement structurel, utiliser `diablo-tsv` afin de régénérer et valider le cadastre, mais ne jamais indexer en bloc les entrées d'autres chantiers présentes dans le cadastre généré.

## Construire l'index minimal

1. Ajouter les fichiers entièrement dédiés avec des chemins exacts. Éviter `git add .`, `git add -A` et les globs larges dans un workspace sale.
2. Utiliser un staging partiel pour `ROADMAP.html`, `ai-cartographie.json`, les manifestes gouvernés et les registres RVA partagés.
3. Pour un fichier partagé, reconstruire la version d'index à partir de `HEAD` et des seuls fragments autorisés; laisser le worktree intact.
4. Relire chaque contenu indexé avec `git diff --cached` ou `git show :chemin`. Prouver les comptes attendus, par exemple le nombre exact de RVA ou de nœuds du cadastre ajoutés.
5. Relancer l'inspecteur. Aucun fichier inattendu, conflit ou erreur `git diff --cached --check` ne doit subsister.

## Valider ce qui sera réellement committé

1. Exécuter d'abord les tests ciblés sur les sources du lot.
2. Exporter ensuite l'index avec `git checkout-index` dans un dossier unique sous `analysis-cache/`.
3. Initialiser un dépôt Git local dans ce snapshot avant les validations globales; sinon les scripts peuvent remonter jusqu'au `.git` du workspace parent et mesurer le mauvais état.
4. Installer ou relier les dépendances selon le niveau de preuve requis. Préférer `npm ci` pour une validation de livraison reproductible.
5. Exécuter les validateurs ciblés, le cadastre puis `npm run verify` lorsque le périmètre le justifie. Attribuer toute panne au snapshot, au worktree ou à une dette préexistante avec une preuve concrète.
6. Recontrôler le drift après les tests. Si un fichier allowlisté a changé, considérer l'index périmé et recommencer l'audit.

Lire [references/commands.md](references/commands.md) lorsqu'un staging partiel, un snapshot isolé ou un diagnostic de drift est requis.

## Présenter puis livrer

1. Résumer en langage simple l'effet du lot, les fichiers indexés, les tests réussis, les gates encore ouverts et ce qui reste volontairement hors lot.
2. Proposer un message de commit impératif et précis. Le mot « prototype » doit rester présent si des gates fonctionnels ou de distribution sont ouverts.
3. Ne committer qu'après l'autorisation exigée par `AGENTS.md`. Vérifier immédiatement le commit créé et l'état de la branche.
4. Ne pousser qu'après l'autorisation de push exigée par `AGENTS.md`. Vérifier ensuite que la branche locale et son upstream sont synchronisés.
5. Après le commit ou la fin d'une tâche significative, utiliser `diablo-roadmap-release` pour vérifier la fraîcheur de la mission et de la ROADMAP sans écraser les changements concurrents.
