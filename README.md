# Diablo — atelier du mod TCP + plateforme des 3 mods

Deux choses dans un même dépôt :

1. Les **données** du mod Diablo II Resurrected de Vincent (**TCP**), plus ses références (**BK**, **BT**, **VNP**) et le vanilla — des tables `.txt` (TSV) lues par le launcher **D2RLAN**.
2. Une **plateforme web** (monorepo **npm + turbo**) par-dessus : un **éditeur** pour modifier ces tables confortablement, et (à venir) un **wiki** de comparaison des 3 mods.

Les `.txt` restent la **source de vérité** ; pas de base de données — git est la « base ».

## Structure

- `data-TCP/` — le mod de Vincent, **en développement** (seule zone de données modifiable)
  - `global/excel/` — tables de gameplay (`.txt`) : armor, weapons, hireling, runes, setitems…
  - `local/lng` — chaînes localisées, **versionnées**
  - `hd/` — assets HD **versionnés via Git LFS**
  - `D2RLAN/` — profil launcher local et intégration runtime de TCP, **modifiable mais non versionné**
- `data-BK/`, `data-BT/` — mods externes de **référence** (lecture seule) ; `local/` et `hd/` de BK sont versionnés, tandis que `hd/` de BT reste local
- `data-VNP/` — Mod Vanilla++ servant d'inspiration pour mon mod TCP (**lecture seule**, hors Comparateur) ; seuls `global/`, `local/` et `hd/` sont versionnés
- `excel-vanilla/` — tables du jeu de base D2 2.4 (référence, lecture seule)
- `apps/admin/` — **éditeur web** des tables (Vite + React)
- `schemas/` — schémas de colonnes des tables (typage + validation de l'éditeur)
- `scripts/` — `dev-server.js` (API locale de lecture/écriture des `.txt`), `build-data/` (parseur/écrivain TSV), `generate-architecture.ps1` (cadastre), `validate-cartographie/` (validateur), `publish-tcp.ps1`
- `guide/` — guide D2R communautaire (clone local, **non versionné**)
- `wiki-template/` — références pour le futur wiki (dont l'index du wiki BT)
- `Mission/` — besoins et intentions du mod
- `ai-cartographie.json` (+ `.schema.json`) — **cadastre** gouverné du dépôt (arbre + rôles + accès agents)
- `AGENTS.md`, `CLAUDE.md` — orientation des agents

## Démarrer l'éditeur

```powershell
npm install
npm run dev
```

Lance le serveur local (port 4000, lit/écrit les `.txt`) et l'éditeur sur **http://localhost:5173**. Clique une cellule pour l'éditer ; « Sauvegarder » réécrit le `.txt` en **préservant son format exact** (colonnes, CRLF, encodage).

## Cadastre

`ai-cartographie.json` décrit tout l'arbre du dépôt et annote chaque zone d'un **rôle** et d'une **politique d'accès** pour les agents. Après toute modification **structurelle** :

```powershell
powershell -File scripts/generate-architecture.ps1     # régénère
node scripts/validate-cartographie/validate.mjs        # valide -> VALID
```

## Atelier de données

Les dossiers `global/`, `local/` et `hd/` de TCP et BK sont versionnés. Les formats HD binaires et les quatre JSON de plus de 10 MiB sont stockés via **Git LFS** ; les autres JSON restent des fichiers Git ordinaires. Le profil local modifiable `data-TCP/D2RLAN/`, les assets HD de BT, les backups et les réglages utilisateur restent hors Git. Pour la référence read-only VNP, `global/`, `local/` et `hd/` restent également versionnés ; `D2RLAN/` et les assets propres à `VNP/` restent ignorés.

## Prérequis

- **Git LFS** — requis pour cloner et publier les assets HD TCP/BK (`git lfs install` une fois par poste)
- **Node.js** — l'éditeur et les scripts JS
- **PowerShell** (5.1 convient) — les scripts `.ps1`

## Conventions

- Items désignés par leur terme **anglais** : `ring`, `belt`, `amulet`, `gem`, `rune`…
- Code en **UTF-8 sans BOM** ; les tables `.txt` D2R en **CRLF** (épinglé par `.gitattributes`) — l'éditeur préserve le format à la sauvegarde.
