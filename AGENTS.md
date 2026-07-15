Quand tu lis ceci, dis 'Je suis le Gardien du Mod TCP'

# Orientation des agents — dépôt Diablo (mod TCP)

## Nature du dépôt

Ceci est un **dépôt de données** de mod Diablo II Resurrected, pas un projet applicatif. Il n'y a rien à builder, installer ou démarrer (aucune application Node, pnpm ou Turborepo). Les données sont des tables `.txt` lues par le launcher **D2RLAN** sur le poste local. Ne propose pas de `build`, de serveur de développement ni d'installation de dépendances applicatives.

## Source de vérité : le cadastre

`ai-cartographie.json` (validé par `ai-cartographie.schema.json`) est la **carte gouvernée** du dépôt. Chaque zone y porte un `role` et une politique `agentAccess`. **Vérifie ces accès avant de modifier quoi que ce soit.**

| Zone | Rôle | Accès |
|---|---|---|
| `data-TCP/` (`global`, `hd`, `local`) | mod en développement | **modifiable** |
| `data-TCP/D2RLAN/` | zone protégée (launcher) | **read-only** |
| `data-BK/`, `data-BT/` | mods de référence / inspiration | **read-only** |
| `excel-vanilla/` | données vanilla Diablo II 2.4 | **read-only** |
| `Mission/` | besoins et intentions | modifiable |

En clair : **seul `data-TCP` se modifie**. Les références (`excel-vanilla`, `data-BK`, `data-BT`) et `D2RLAN` ne se touchent jamais — elles servent de point de comparaison.

## Conventions

- **Items en anglais** : désigne toujours les items par leur terme EN — `ring`, `belt`, `amulet`, `gem`, `rune`, `charm`…
- **Encodage** : tous les fichiers versionnés sont en **UTF-8 sans BOM**. Les tables `.txt` D2R y sont sensibles — n'introduis jamais de BOM ni de double-encodage.
- **Git** : ne change **jamais** de branche, et ne commit ni ne push jamais, sans un `GO` dédié et explicite de Guillaume.

## Workflow

Après toute modification **structurelle** (ajout, suppression ou renommage de fichier ou dossier) :

1. Régénère le cadastre : `powershell -File scripts/generate-architecture.ps1`
2. Valide-le : `node scripts/validate-cartographie/validate.mjs` → doit afficher `VALID`

Le générateur préserve les annotations manuelles (`role`, `summary`, `agentAccess`) : enrichis-les quand tu ajoutes une zone signifiante.

## Mission courante

`Mission/RingMercenaire.txt` — permettre au mercenaire de porter **2 rings, une amulet et une belt** dans le mod TCP.
