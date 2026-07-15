# Diablo

Monorepo Turborepo pour construire un mod personnalisé de Diablo II.

## Structure

- `apps/web` : application web principale
- `apps/docs` : documentation du projet
- `packages/ui` : composants React partagés
- `packages/eslint-config` : configuration ESLint commune
- `packages/typescript-config` : configuration TypeScript commune

## Prérequis

- Node.js 24 LTS ou une version compatible avec `package.json`
- pnpm 11

## Installation

```powershell
pnpm install
```

## Développement

Demarrer toutes les applications :

```powershell
pnpm dev
```

Construire l'ensemble du monorepo :

```powershell
pnpm build
```

Verifier le code et les types :

```powershell
pnpm lint
pnpm check-types
```

## Technologies

- Turborepo
- pnpm workspaces
- Next.js
- React
- TypeScript
- ESLint et Prettier
