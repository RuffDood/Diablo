#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = {
    inventory: "Mission/memory-patches-portage-3.2.json",
    image: null,
    patchDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--inventory") {
      args.inventory = argv[++index];
    } else if (token === "--image") {
      args.image = argv[++index];
    } else if (token === "--patch-dir") {
      args.patchDir = argv[++index];
    } else if (token === "--help" || token === "-h") {
      console.log(
        "Usage: node scripts/migrate-bkvince/validate-memory-patch-targets.mjs " +
          "--image <decrypted-D2R.exe> [--inventory <json>] " +
          "[--patch-dir <D2RLoader-patches>]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.image) {
    throw new Error("--image is required");
  }
  return args;
}

function parsePe(buffer) {
  if (buffer.toString("ascii", 0, 2) !== "MZ") {
    throw new Error("The supplied image is not an MZ executable");
  }

  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
    throw new Error("The supplied image has no PE signature");
  }

  const sectionCount = buffer.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20);
  const optionalHeaderOffset = peOffset + 24;
  const sizeOfHeaders = buffer.readUInt32LE(optionalHeaderOffset + 60);
  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
  const sections = [];

  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionTableOffset + index * 40;
    const name = buffer
      .subarray(offset, offset + 8)
      .toString("ascii")
      .replace(/\0+$/, "");
    sections.push({
      name,
      virtualSize: buffer.readUInt32LE(offset + 8),
      virtualAddress: buffer.readUInt32LE(offset + 12),
      rawSize: buffer.readUInt32LE(offset + 16),
      rawOffset: buffer.readUInt32LE(offset + 20),
    });
  }

  function rvaToOffset(rva, size) {
    if (rva < sizeOfHeaders && rva + size <= sizeOfHeaders) {
      return rva;
    }

    const section = sections.find((candidate) => {
      const span = Math.max(candidate.virtualSize, candidate.rawSize);
      return (
        rva >= candidate.virtualAddress &&
        rva + size <= candidate.virtualAddress + span
      );
    });
    if (!section) {
      return null;
    }

    const delta = rva - section.virtualAddress;
    if (delta + size > section.rawSize) {
      return null;
    }
    return section.rawOffset + delta;
  }

  return { rvaToOffset };
}

function normalizeHex(value) {
  const normalized = value.replaceAll(/\s+/g, "").toUpperCase();
  if (!/^(?:[0-9A-F]{2})+$/.test(normalized)) {
    throw new Error(`Invalid expected-byte string: ${value}`);
  }
  return normalized;
}

function validatePatchDirectory(directory, image, pe) {
  const supportedOps = new Set([
    "bytes",
    "nop",
    "fill",
    "write-u8",
    "write-u16",
    "write-u32",
    "write-u64",
    "jmp-rel32",
    "call-rel32",
  ]);
  const writeSizes = new Map([
    ["write-u8", 1],
    ["write-u16", 2],
    ["write-u32", 4],
    ["write-u64", 8],
  ]);
  const files = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  const ranges = [];
  const failures = [];
  let validated = 0;

  for (const fileName of files) {
    const filePath = path.join(directory, fileName);
    const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (document.version !== 1 || !Array.isArray(document.patches)) {
      failures.push(`${fileName}: invalid version or patches array`);
      continue;
    }

    for (const [index, patch] of document.patches.entries()) {
      const label = `${fileName}#${index + 1}`;
      if (!supportedOps.has(patch.op)) {
        failures.push(`${label}: unsupported op ${JSON.stringify(patch.op)}`);
        continue;
      }

      const expected = normalizeHex(patch.expected);
      const expectedSize = expected.length / 2;
      const rva = Number.parseInt(patch.rva, 16);
      if (!Number.isSafeInteger(rva)) {
        failures.push(`${label}: invalid RVA ${JSON.stringify(patch.rva)}`);
        continue;
      }

      let outputSize = expectedSize;
      if (patch.op === "bytes") {
        outputSize = normalizeHex(patch.bytes).length / 2;
      } else if (patch.op === "nop" || patch.op === "fill") {
        outputSize = patch.size;
      } else if (writeSizes.has(patch.op)) {
        outputSize = writeSizes.get(patch.op);
      } else if (patch.op === "jmp-rel32" || patch.op === "call-rel32") {
        outputSize = patch.size ?? 5;
      }
      if (outputSize !== expectedSize) {
        failures.push(
          `${label}: output size ${outputSize} != expected size ${expectedSize}`,
        );
        continue;
      }

      const fileOffset = pe.rvaToOffset(rva, expectedSize);
      if (fileOffset === null) {
        failures.push(`${label}: RVA ${patch.rva} is not file-backed`);
        continue;
      }
      const actual = image
        .subarray(fileOffset, fileOffset + expectedSize)
        .toString("hex")
        .toUpperCase();
      if (actual !== expected) {
        failures.push(
          `${label} ${patch.rva}: expected=${expected} actual=${actual}`,
        );
        continue;
      }

      ranges.push({
        start: rva,
        end: rva + expectedSize,
        label,
      });
      validated += 1;
    }
  }

  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1];
    const current = ranges[index];
    if (current.start < previous.end) {
      failures.push(
        `overlap: ${previous.label} [0x${previous.start.toString(16)}, ` +
          `0x${previous.end.toString(16)}) and ${current.label} ` +
          `[0x${current.start.toString(16)}, 0x${current.end.toString(16)})`,
      );
    }
  }

  return { files: files.length, validated, failures };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inventoryPath = path.resolve(args.inventory);
  const imagePath = path.resolve(args.image);
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  const image = fs.readFileSync(imagePath);
  const pe = parsePe(image);

  const manifestPath = path.resolve(inventory.legacyManifest.path);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const trackedNames = new Set([
    ...manifest.MemoryConfigs.map((entry) => entry.Name),
    ...inventory.supplementalCandidates.map((entry) => entry.name),
  ]);
  const analyzedNames = inventory.targetAnalysis.entries.map(
    (entry) => entry.name,
  );
  const missingNames = [...trackedNames].filter(
    (name) => !analyzedNames.includes(name),
  );
  const extraNames = analyzedNames.filter((name) => !trackedNames.has(name));
  const duplicateNames = analyzedNames.filter(
    (name, index) => analyzedNames.indexOf(name) !== index,
  );

  if (
    missingNames.length > 0 ||
    extraNames.length > 0 ||
    duplicateNames.length > 0
  ) {
    throw new Error(
      `Inventory coverage failure: missing=${JSON.stringify(missingNames)} ` +
        `extra=${JSON.stringify(extraNames)} ` +
        `duplicates=${JSON.stringify(duplicateNames)}`,
    );
  }

  let validated = 0;
  let processOnly = 0;
  const failures = [];

  for (const entry of inventory.targetAnalysis.entries) {
    for (const site of entry.sites ?? []) {
      if (!site.expected) {
        continue;
      }
      if (site.source === "process") {
        processOnly += 1;
        continue;
      }

      const rva = Number.parseInt(site.rva, 16);
      const expected = normalizeHex(site.expected);
      const size = expected.length / 2;
      const fileOffset = pe.rvaToOffset(rva, size);
      if (fileOffset === null) {
        failures.push({
          entry: entry.name,
          rva: site.rva,
          expected,
          actual: "not-file-backed",
        });
        continue;
      }

      const actual = image
        .subarray(fileOffset, fileOffset + size)
        .toString("hex")
        .toUpperCase();
      if (actual !== expected) {
        failures.push({ entry: entry.name, rva: site.rva, expected, actual });
      } else {
        validated += 1;
      }
    }
  }

  console.log(`inventory=${inventoryPath}`);
  console.log(`image=${imagePath}`);
  console.log(`entries=${analyzedNames.length}`);
  console.log(`validatedFileSites=${validated}`);
  console.log(`processOnlySites=${processOnly}`);
  console.log(`failures=${failures.length}`);
  for (const failure of failures) {
    console.error(
      `${failure.entry} ${failure.rva}: expected=${failure.expected} ` +
        `actual=${failure.actual}`,
    );
  }

  if (args.patchDir) {
    const patchDirectory = path.resolve(args.patchDir);
    const patchResult = validatePatchDirectory(patchDirectory, image, pe);
    console.log(`patchDirectory=${patchDirectory}`);
    console.log(`patchFiles=${patchResult.files}`);
    console.log(`validatedPatchSites=${patchResult.validated}`);
    console.log(`patchFailures=${patchResult.failures.length}`);
    for (const failure of patchResult.failures) {
      console.error(failure);
    }
    failures.push(...patchResult.failures);
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
