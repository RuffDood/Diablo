---
name: diablo-roadmap-release
description: Maintenir la mission courante et ROADMAP.html, séquencer une nouvelle tâche significative, préparer une archive publique et exécuter les contrôles avant livraison. Utiliser ce skill lorsqu'un chantier Diablo émerge, lorsqu'une tâche ou un commit est terminé, lorsqu'une mission doit refléter des preuves/gates à jour, ou avant de livrer un addon, un ZIP ou une release.
---

# Roadmap et livraison Diablo

## Retrouver la mission courante

1. Lire les incréments `EN COURS`, les notes de priorité et les gates ouverts dans `ROADMAP.html`.
2. Croiser ces informations avec les fichiers `Mission/`, le contexte de conversation et les changements Git récents.
3. Préférer la priorité explicite la plus récente. Si plusieurs missions restent réellement concurrentes, valider inline le prochain pas avec l'utilisateur.
4. Au début et à la fin d'une tâche, vérifier que la mission et la ROADMAP décrivent encore le même état.

## Traiter une nouvelle tâche significative

1. Proposer à l'utilisateur de l'ajouter à la ROADMAP.
2. Ne pas modifier la ROADMAP tant que l'utilisateur n'a pas confirmé cet ajout.
3. Après confirmation, analyser le placement selon la valeur métier et l'efficacité d'avancement pour le projet humain.
4. Produire deux séquencements logiques et cohérents, avec leurs dépendances et compromis, puis demander lequel retenir.
5. Insérer seulement l'option choisie, avec un identifiant stable, un propriétaire, des gates observables et le bon statut.

## Tenir les preuves à jour

1. Consigner dans la mission les décisions produit, preuves techniques, hashes, validations runtime et cases encore ouvertes.
2. Marquer un jalon livré seulement lorsque ses gates requis sont réellement fermés. Distinguer `livré techniquement`, `validé en jeu`, `abandonné` et `bloqué`.
3. Actualiser la date, la note de priorité et le résumé de bas de page de la ROADMAP sans écraser les changements concurrents.
4. Après une modification structurelle, exécuter le workflow cadastre du skill `diablo-tsv`.

## Préparer une livraison

1. Définir une allowlist explicite du contenu public. Pour un plugin incubé, appliquer le skill `d2rloader-plugin-incubation`.
2. Construire l'archive depuis des artefacts validés, inspecter ses entrées réelles et vérifier l'absence de sources, secrets, logs ou preuves non destinés au public.
3. Calculer les SHA-256 des artefacts et prouver leur égalité avec les fichiers testés dans le runtime.
4. Exécuter les tests ciblés, le build, la validation du cadastre si nécessaire, le cold start et la matrice fonctionnelle requise.
5. Examiner `git status`, `git diff --check` et le diff complet. Ne changer jamais de branche et ne jamais commit/push de sa propre initiative; une demande explicite de l’utilisateur courant suffit, sans formule `GO` dédiée ni identité particulière.
6. Rappeler à Vincent de commit et push par petits lots cohérents avec des messages clairs lorsque le travail est prêt.

Lire [references/release-checklist.md](references/release-checklist.md) pour le contrôle final d'archive, de mission, de ROADMAP et de Git.
