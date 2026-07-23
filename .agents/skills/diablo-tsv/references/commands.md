# Commandes TSV et cadastre

## API gouvernée

```js
const fs = require('fs');
const {
  parseTable,
  serializeTable,
  writeTable,
  ENCODING,
} = require('./scripts/build-data/tsv');

const raw = fs.readFileSync(filePath, ENCODING);
const table = parseTable(filePath);
assert.strictEqual(serializeTable(table), raw);
assert.strictEqual(table.eol, '\r\n');

// Modifier uniquement des cellules identifiées de façon non ambiguë.
writeTable(filePath, table);

const written = fs.readFileSync(filePath, ENCODING);
assert.strictEqual(serializeTable(parseTable(filePath)), written);
```

`ENCODING` vaut `latin1` comme transport réversible octet-caractère. Il ne faut pas le remplacer par une supposition UTF-8 lors d'un round-trip de table.

## Contrôles utiles

```powershell
npm.cmd run verify:data
npm.cmd run generate:schemas
git diff -- path/to/table.txt
git diff --check
```

Sous PowerShell, utiliser `npm.cmd` si la stratégie d'exécution bloque `npm.ps1`.

## Cadastre après changement structurel

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-architecture.ps1
node scripts/validate-cartographie/validate.mjs
```

Le générateur exclut notamment `.git`, `node_modules`, `guide`, `dist`, `.turbo`, `.netlify`, `analysis-cache` et `__pycache__`. Il préserve les annotations manuelles connues, mais toute nouvelle zone signifiante doit recevoir un `role`, un `summary` et un `agentAccess` explicites avant la validation finale.
