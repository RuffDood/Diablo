# Checklist mission, archive et livraison

## Fraîcheur de mission

- La priorité courante de la ROADMAP correspond au contexte le plus récent.
- La mission distingue faits prouvés, hypothèses et gates non exécutés.
- Les décisions de Vincent et leurs dates sont consignées.
- Les versions, chemins, hashes et résultats de cold start correspondent aux artefacts présents.
- Toute case encore ouverte reste visible; aucune réussite n'est déduite d'un test voisin.

## Archive publique

- Une allowlist exacte a été définie avant création.
- Les fichiers proviennent du build et de la configuration réellement validés.
- La liste des entrées du ZIP a été inspectée après création.
- Aucun README, source, TOML, log ou fichier de preuve interdit n'est inclus pour un plugin incubé.
- Aucune DLL tierce n'est redistribuée sans autorisation et crédits appropriés.
- Le SHA-256 du ZIP et des artefacts distribués est consigné dans la mission.

## Contrôles dépôt

```powershell
git status --short --branch
git diff --check
git diff --stat
node scripts/validate-cartographie/validate.mjs
```

Ajouter les tests/builds spécifiques au composant. Si des fichiers ou dossiers ont été ajoutés, supprimés ou renommés, régénérer le cadastre avant son validateur.

## Gate Git

- Ne pas changer de branche, committer ou pousser de sa propre initiative.
- Une demande explicite de l’utilisateur courant suffit; aucune formule `GO`
  dédiée ni identité particulière n’est requise.
- Autoriser ensemble les actions clairement demandées ensemble, par exemple
  « commit ces changements puis push ».
- Une demande de livraison ou d’archive ne constitue pas automatiquement une
  demande de commit ou de push.
