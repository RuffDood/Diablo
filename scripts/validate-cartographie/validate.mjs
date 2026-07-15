// Valide le cadastre ai-cartographie.json contre son schema (JSON Schema draft 2020-12).
// Usage : node validate.mjs   (depuis scripts/validate-cartographie/)
// Sortie : exit 0 + "VALID" si conforme, sinon exit 1 + liste des erreurs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repoRoot = new URL("../../", import.meta.url);
const schemaUrl = new URL("ai-cartographie.schema.json", repoRoot);
const dataUrl = new URL("ai-cartographie.json", repoRoot);

function loadJson(url) {
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch (err) {
    console.error(`Lecture/parse impossible : ${fileURLToPath(url)}`);
    console.error(`  ${err.message}`);
    process.exit(2);
  }
}

const schema = loadJson(schemaUrl);
const data = loadJson(dataUrl);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validate = ajv.compile(schema);
const ok = validate(data);

if (ok) {
  console.log("VALID : ai-cartographie.json est conforme a ai-cartographie.schema.json");
  process.exit(0);
}

console.error(`INVALID : ${validate.errors.length} erreur(s) de conformite`);
for (const e of validate.errors.slice(0, 30)) {
  console.error(`  ${e.instancePath || "/"} ${e.message}`);
}
process.exit(1);
