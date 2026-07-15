# Diablo — données du mod TCP

Dépôt de **données** pour le mod Diablo II Resurrected de Vincent (**TCP**), accompagné de ses mods de référence et des données vanilla. Ce n'est **pas** une application : aucun build, aucun serveur. Les fichiers sont des tables de données lues localement par le launcher **D2RLAN**.

## Nature du dépôt

Un dépôt de données (*data repo*) versionné avec git. Les tables du jeu sont des fichiers `.txt` (valeurs séparées par tabulation) que D2RLAN charge pour appliquer le mod. Git sert à versionner et à comparer ces données ; il n'y a aucune chaîne d'outillage applicative (ni application Node, ni pnpm, ni Turborepo).

## Structure

- `data-TCP/` — le mod de Vincent, **en développement** (la seule zone modifiable)
  - `global/excel/` — tables de gameplay (`.txt`) : armor, weapons, hireling, itemstatcost, runes, setitems…
  - `hd/` — visuels, sons et assets de présentation
  - `local/` — chaînes localisées (`local/lng`)
  - `D2RLAN/` — projet du launcher (**zone protégée**, ne pas modifier)
- `data-BK/`, `data-BT/` — mods externes de **référence / inspiration** (lecture seule)
- `excel-vanilla/` — tables `.txt` du jeu de base Diablo II (version 2.4), **référence** (lecture seule)
- `Mission/` — besoins et intentions du mod (trace humaine)
- `scripts/`
  - `generate-architecture.ps1` — (re)génère le cadastre `ai-cartographie.json`
  - `publish-tcp.ps1` — publication du mod TCP
  - `validate-cartographie/` — validateur du cadastre (Node + AJV)
- `ai-cartographie.json` — **cadastre** annoté du dépôt (arbre + rôles + accès agents)
- `ai-cartographie.schema.json` — schéma (JSON Schema draft 2020-12) du cadastre
- `AGENTS.md`, `CLAUDE.md` — orientation des agents

## Cadastre

`ai-cartographie.json` décrit tout l'arbre du dépôt et annote chaque zone d'un **rôle** (`mod-development`, `mod-reference`, `vanilla-reference`, `gameplay-data`, `protected-zone`…) et d'une **politique d'accès** pour les agents (`read-write` / `read-only` / `no-access`). C'est la source de vérité topologique du dépôt.

### Régénérer

```powershell
powershell -File scripts/generate-architecture.ps1
```

Le générateur ré-inventorie l'arbre et **préserve** les annotations manuelles existantes.

### Valider

```powershell
npm install --prefix scripts/validate-cartographie   # une seule fois
node scripts/validate-cartographie/validate.mjs
```

La commande doit afficher `VALID`. À exécuter après toute modification structurelle.

## Prérequis

- **PowerShell** (Windows PowerShell 5.1 convient) — pour les scripts `.ps1`
- **Node.js** — uniquement pour le validateur du cadastre

## Conventions

- Les items Diablo sont désignés par leur terme **anglais** : `ring`, `belt`, `amulet`, `gem`, `rune`…
- Fichiers versionnés en **UTF-8 sans BOM**.
