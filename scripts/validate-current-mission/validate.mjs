import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRepoRoot = fileURLToPath(new URL('../../', import.meta.url));

function section(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return '';
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, next < 0 ? lines.length : next).join('\n').trim();
}

function normalizeText(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-zA-Z0-9#]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateCurrentMission(repoRoot = defaultRepoRoot) {
  const errors = [];
  const missionRoot = path.join(repoRoot, 'Mission');
  const currentPath = path.join(missionRoot, 'CURRENT.md');
  const roadmapPath = path.join(repoRoot, 'ROADMAP.html');

  if (!fs.existsSync(currentPath)) {
    return { errors: ['Mission/CURRENT.md is missing.'] };
  }
  if (!fs.existsSync(roadmapPath)) {
    return { errors: ['ROADMAP.html is missing.'] };
  }

  const current = fs.readFileSync(currentPath, 'utf8');
  const priority = section(current, 'Priorité active');
  const nextGate = section(current, 'Prochain gate');
  const link = priority.match(/\[([^\]]+)\]\(([^)]+\.md)\)/);

  if (!priority) errors.push('The "Priorité active" section is empty or missing.');
  if (!nextGate) errors.push('The "Prochain gate" section is empty or missing.');
  if (!link) {
    errors.push('The active priority must link to a Markdown mission file.');
  } else {
    const [, label, target] = link;
    const canonicalLabel = label.trim().split(/\s+[—–-]\s+/u)[0];
    const resolvedTarget = path.resolve(missionRoot, target);
    const relativeTarget = path.relative(missionRoot, resolvedTarget);
    if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      errors.push(`The active mission link escapes Mission/: ${target}`);
    } else if (!fs.existsSync(resolvedTarget) || !fs.statSync(resolvedTarget).isFile()) {
      errors.push(`The active mission does not exist: Mission/${target}`);
    }

    const roadmap = fs.readFileSync(roadmapPath, 'utf8');
    const priorityParagraph = [...roadmap.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)]
      .map((match) => match[0])
      .find((paragraph) => paragraph.includes('Priorité courante')) || '';
    if (!priorityParagraph) {
      errors.push('ROADMAP.html has no "Priorité courante" paragraph.');
    } else if (!normalizeText(priorityParagraph).includes(canonicalLabel)) {
      errors.push(`ROADMAP.html does not name the active mission: ${canonicalLabel}`);
    }
  }

  return { errors };
}

export function main(repoRoot = defaultRepoRoot) {
  const { errors } = validateCurrentMission(repoRoot);
  if (errors.length === 0) {
    console.log('VALID : Mission/CURRENT.md est aligné avec ROADMAP.html');
    return 0;
  }
  console.error(`INVALID : Mission/CURRENT.md (${errors.length} erreur(s))`);
  for (const error of errors) console.error(`  ${error}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv[2] ? path.resolve(process.argv[2]) : defaultRepoRoot);
}
