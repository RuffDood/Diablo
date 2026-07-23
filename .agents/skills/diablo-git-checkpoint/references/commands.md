# Commandes de checkpoint Git

## Inspection en lecture seule

```powershell
node .agents/skills/diablo-git-checkpoint/scripts/inspect-checkpoint.mjs
node .agents/skills/diablo-git-checkpoint/scripts/inspect-checkpoint.mjs --json
```

L'inspecteur sépare les fichiers indexés, modifiés seulement dans le worktree,
non suivis, conflictuels et `mixed`. Un fichier `mixed` possède simultanément un
contenu préparé dans l'index et des changements plus récents dans le worktree.

Contrôles complémentaires :

```powershell
git status --short --branch
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
git diff --cached -- chemin/partage
git show :chemin/partage
```

## Staging minimal

Pour un fichier entièrement dédié au lot :

```powershell
git add -- chemin/exact/fichier
```

Pour un fichier partagé, préférer `git add -p -- chemin` lorsque l'interaction
est possible. En mode non interactif, construire un blob candidat à partir de
`HEAD`, vérifier son contenu, puis mettre uniquement ce blob dans l'index avec
`git hash-object -w --stdin` et `git update-index --cacheinfo`. Ne jamais
réécrire le worktree pour simuler un staging partiel.

Après toute opération partielle, relire la version de l'index et compter les
objets gouvernés attendus. Pour `ai-cartographie.json`, valider à la fois le JSON,
le schéma et la liste exacte des chemins ajoutés par rapport à `HEAD`.

## Snapshot exact de l'index

Créer un dossier unique et ignorable. Vérifier que le chemin résolu reste sous
`analysis-cache/` avant toute éventuelle suppression ultérieure.

```powershell
$checkpointRoot = Join-Path (Get-Location) `
  ('analysis-cache\staged-checkpoint-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $checkpointRoot | Out-Null
$checkpointFull = [IO.Path]::GetFullPath($checkpointRoot)
$prefix = ($checkpointFull + [IO.Path]::DirectorySeparatorChar).Replace('\','/')
git checkout-index --all --prefix=$prefix

Push-Location $checkpointFull
try {
  git init -q
  git config user.name 'Checkpoint Validation'
  git config user.email 'checkpoint-validation@local.invalid'
  git add .
  git commit -q -m 'validation snapshot'
  npm.cmd ci --ignore-scripts --no-audit --no-fund
  node scripts/validate-cartographie/validate.mjs
  npm.cmd run verify
} finally {
  Pop-Location
}
```

Le `git init` local est obligatoire pour les validateurs qui cherchent la racine
avec `git rev-parse`; sans lui, un snapshot placé sous le dépôt principal peut
inspecter accidentellement le workspace parent.

## Contrôle du drift

Exécuter l'inspecteur avant le staging, après le staging et après les tests.
Comparer en priorité la liste `mixed`. Pour un fichier critique, mémoriser son
blob de travail avec `git hash-object chemin`, puis recalculer ce blob avant le
commit. Tout changement signifie que le checkpoint doit être réaudité.

## Commit et push

Avant le commit :

```powershell
git diff --cached --check
git diff --cached --name-status
git diff --cached --stat
```

Après le commit, vérifier `git show --stat --oneline HEAD` et `git status
--short --branch`. Après le push, vérifier `git rev-list --left-right --count
HEAD...@{upstream}`. Les autorisations, l'identité requise et la séparation des
gates commit/push proviennent toujours de `AGENTS.md`.
