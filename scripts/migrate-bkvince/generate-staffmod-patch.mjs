#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "../..");
const missionPath = path.join(root, "Mission/staffmods-portage-3.2.json");
const outputPath = path.join(
  root,
  "Mission/staffmod-skill-pools.reference.json",
);
const check = process.argv.slice(2).includes("--check");

function spacedHex(bytes) {
  return Buffer.from(bytes).toString("hex").toUpperCase().match(/../g).join(" ");
}

function validate(document) {
  if (document.version !== 1 || document.target?.build !== 92777) {
    throw new Error("The staffmod mission must target D2R build 92777");
  }
  const tiers = document.activeTierReqLevels;
  if (!Array.isArray(tiers) || tiers.length !== 6) {
    throw new Error("activeTierReqLevels must contain exactly six tier arrays");
  }
  const maximum = document.maximumSupportedReqLevel;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 255) {
    throw new Error("maximumSupportedReqLevel must be between 1 and 255");
  }
  const seen = new Set();
  for (const [tierIndex, levels] of tiers.entries()) {
    if (!Array.isArray(levels)) {
      throw new Error(`Tier ${tierIndex + 1} is not an array`);
    }
    for (const level of levels) {
      if (!Number.isInteger(level) || level < 1 || level > maximum) {
        throw new Error(`Invalid reqlevel ${level} in tier ${tierIndex + 1}`);
      }
      if (seen.has(level)) {
        throw new Error(`reqlevel ${level} belongs to more than one tier`);
      }
      seen.add(level);
    }
  }
  return { tiers, maximum };
}

function buildPatch(document) {
  const { tiers, maximum } = validate(document);
  const selector = Buffer.alloc(maximum, 6);
  for (const [tierIndex, levels] of tiers.entries()) {
    for (const level of levels) selector[level - 1] = tierIndex;
  }
  const caveRva = Number.parseInt(document.analysis.selectorCodeCave, 16);
  if (selector.length > document.analysis.selectorCodeCaveSize) {
    throw new Error("The selector does not fit in the verified code cave");
  }
  const displacement = Buffer.alloc(4);
  displacement.writeUInt32LE(caveRva);
  const upperBound = maximum - 1;

  return {
    version: 1,
    name: "Dynamic and Configurable Staffmod Skill Pools",
    description:
      "Uses the engine's existing dynamic class-skill pools for every class and classifies exact configurable reqlevel values without a fixed 30-skill or five-skills-per-tier layout.",
    patches: [
      {
        description: "Build dynamic staffmod tier pools for every class",
        op: "bytes",
        rva: "0x58B0CC",
        expected: "E8 DF 8F E7 FF",
        bytes: "B0 01 90 90 90",
      },
      {
        description: "Select staffmods from dynamic pools for every class",
        op: "bytes",
        rva: "0x58B358",
        expected: "E8 53 8D E7 FF",
        bytes: "B0 01 90 90 90",
      },
      {
        description: `Accept configured reqlevel indices through ${maximum}`,
        op: "bytes",
        rva: "0x58B226",
        expected: "83 F8 1D",
        bytes: spacedHex([0x3c, upperBound, 0x90]),
      },
      {
        description: "Redirect the reqlevel selector to the generated table",
        op: "bytes",
        rva: "0x58B23C",
        expected: "A0 B7 58 00",
        bytes: spacedHex(displacement),
      },
      {
        description: "Generated exact reqlevel-to-tier selector",
        op: "bytes",
        rva: document.analysis.selectorCodeCave,
        expected: spacedHex(Buffer.alloc(selector.length, 0xcc)),
        bytes: spacedHex(selector),
      },
    ],
  };
}

const mission = JSON.parse(fs.readFileSync(missionPath, "utf8"));
const content = `${JSON.stringify(buildPatch(mission), null, 2)}\n`;

if (check) {
  if (!fs.existsSync(outputPath)) throw new Error(`Missing ${outputPath}`);
  if (fs.readFileSync(outputPath, "utf8") !== content) {
    throw new Error("staffmod-skill-pools.reference.json is stale; run the generator");
  }
  console.log("VALID: staffmod patch matches the governed tier configuration");
} else {
  fs.writeFileSync(outputPath, content, "utf8");
  console.log(`WROTE: ${outputPath}`);
}
