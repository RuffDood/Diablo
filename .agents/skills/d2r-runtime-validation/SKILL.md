---
name: d2r-runtime-validation
description: Déployer un changement Diablo ou D2RLoader dans le profil runtime approprié, gérer les processus qui verrouillent les fichiers, collecter des logs frais et exécuter une matrice de validation technique et fonctionnelle. Utiliser ce skill pour synchroniser data-BKVince ou data-TCP vers un jeu installé, tester une DLL/configuration, réaliser un cold start ou confirmer un comportement en jeu.
---

# Validation runtime D2R

## Préparer une validation traçable

1. Identifier la source gouvernée, le profil runtime exact, le build D2R et la portée globale ou mod-locale. Ne jamais supposer un chemin d'installation à partir d'un autre poste.
2. Définir avant copie la liste fermée des fichiers autorisés et les résultats attendus.
3. Relever les hashes source et l'état des logs avant le test. Ne pas mélanger des logs anciens avec le démarrage courant.
4. Établir la matrice fonctionnelle depuis la mission; séparer les gates statiques, cold-start, visuels, gameplay et multijoueur.

## Libérer et synchroniser les fichiers

1. Si Diablo, D2RLoader ou le profil ciblé verrouille un fichier, fermer soi-même les instances concernées. Ne pas demander à Vincent de fermer le jeu.
2. Vérifier que les processus sont réellement terminés avant toute copie.
3. Copier uniquement les cibles gouvernées prévues. Refuser une synchronisation large qui emporterait des changements non liés.
4. Recalculer les SHA-256 dans le runtime et exiger leur égalité avec les sources.
5. Pour un plugin hybride, tester explicitement les portées requises et vérifier la neutralisation attendue des doublons par identifiant.

## Effectuer le cold start

1. Relancer une seule instance si la validation l'exige, avec le profil et les arguments établis par la mission ou la configuration locale.
2. Collecter uniquement les nouvelles lignes de log ou les fichiers dont l'horodatage appartient au test.
3. Vérifier le build accepté, la version du plugin, la résolution de configuration, les signatures, hooks et patches, les compteurs de plugins actifs/rejetés/échoués et la fin complète du démarrage.
4. Distinguer les erreurs causées par le changement des incidents déjà connus et documentés. Ne pas masquer un nouvel échec sous un bruit historique.

## Fermer la matrice fonctionnelle

1. Tester les valeurs par défaut, bornes, valeurs invalides et repli de configuration.
2. Tester les actions joueur, transitions, réouvertures, sauvegardes/reprises et périphériques pertinents.
3. Couvrir solo, hôte et client lorsque la fonctionnalité peut toucher le réseau ou l'état partagé.
4. Noter chaque case `passed`, `failed`, `blocked` ou `not run`, avec preuve et date. Ne jamais transformer `not run` en succès implicite.
5. Mettre à jour la mission et la ROADMAP avec les preuves obtenues et les gates restants; ne déclarer la livraison fonctionnelle qu'après observation en jeu.

Lire [references/validation-matrix.md](references/validation-matrix.md) pour la séquence processus-déploiement-logs et le format de matrice recommandé.
