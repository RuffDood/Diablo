# Matrice de validation runtime

## Séquence Windows sûre

1. Découvrir le chemin du jeu et du profil depuis le contexte local gouverné.
2. Observer les processus concernés avec `Get-Process`.
3. Fermer les instances D2R/D2RLoader nécessaires, attendre leur terminaison et revérifier.
4. Copier chaque fichier explicitement nommé.
5. Comparer les hashes avec `Get-FileHash -Algorithm SHA256`.
6. Capturer l'heure de départ et l'état initial des logs.
7. Relancer exactement une instance si le test le demande.
8. Collecter les lignes/logs nouveaux, puis arrêter proprement l'instance si la matrice est terminée.

Ne pas intégrer de chemin absolu de poste dans un script versionné. Ne pas tuer d'autres processus que ceux identifiés comme appartenant au test.

## Tableau minimal

| Domaine | Cas | Attendu | Statut | Preuve |
|---|---|---|---|---|
| Déploiement | Hash source/runtime | Identiques | not run | SHA-256 |
| Chargement | Build et manifeste | Acceptés | not run | log frais |
| Hooks | Signatures et installation | Tous acceptés | not run | log frais |
| Plugins | active/rejected/failed | Valeurs attendues | not run | résumé startup |
| Config | mod-local | Prioritaire | not run | log + comportement |
| Config | repli global | Utilisé sans config mod | not run | log + comportement |
| Gameplay | chemin nominal | Effet visible attendu | not run | observation datée |
| Gameplay | bornes/erreurs | Refus ou clamp attendu | not run | observation datée |
| Périphériques | souris/clavier/manette | Cohérents | not run | observation datée |
| Réseau | solo/hôte/client | Stable et synchronisé | not run | observation datée |

## Règles de preuve

- `passed` exige une observation ou un artefact du test courant.
- `failed` décrit le résultat réel et conserve les logs avant correction.
- `blocked` nomme la dépendance précise.
- `not run` reste ouvert dans la mission et la ROADMAP.
- Une compilation ou un cold start réussi ne remplace pas une validation gameplay.
