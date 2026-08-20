#!/usr/bin/env node
/**
 * Syntax-check the executable parts of Tracy's own skills.
 *
 *   node scripts/check-scripts.mjs
 *
 * WHY THIS EXISTS
 *
 * `pnpm typecheck` covers `src/`, `bin/` and the site-scan engine. Everything else a skill
 * ships — the `.sh` wrappers, the `.mjs` measuring code, and the Python that two of the text
 * gates embed in a heredoc — was covered by nothing at all. A skill is published by copying
 * its directory to a host, so the first thing that ever parsed those files was the fleet, at
 * the moment somebody needed them.
 *
 * This is not a linter and does not want to be. It answers one question per file: does an
 * interpreter accept it? That is the failure that costs a QA run, and it is the one a machine
 * can settle for free.
 *
 * The Python check is skipped, loudly, where no python3 exists. A check that silently does
 * nothing is worse than one that is absent, because the green tick is the same either way.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKILLS = path.join(ROOT, "skills");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__pycache__") continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const files = fs.existsSync(SKILLS) ? walk(SKILLS) : [];
const rel = (f) => path.relative(ROOT, f);
const problems = [];
let checked = 0, skipped = 0;

function run(cmd, args, input) {
  try {
    execFileSync(cmd, args, { input, stdio: ["pipe", "pipe", "pipe"] });
    return null;
  } catch (e) {
    return String(e.stderr || e.stdout || e.message).trim().split("\n").slice(0, 3).join(" / ");
  }
}

const hasPython = run("python3", ["-c", "pass"]) === null;
if (!hasPython) console.warn("check-scripts: no python3 — embedded Python heredocs NOT checked");

for (const file of files) {
  if (file.endsWith(".sh")) {
    const err = run("bash", ["-n", file]);
    checked++;
    if (err) problems.push(`${rel(file)}: bash syntax: ${err}`);

    // Two text gates are a shell wrapper around a Python program delivered as a quoted
    // heredoc. `bash -n` proves the heredoc is well-formed and says nothing whatsoever about
    // the program inside it, which is where the actual logic lives.
    const body = fs.readFileSync(file, "utf8");
    for (const m of body.matchAll(/<<'(\w+)'\n([\s\S]*?)\n\1\n/g)) {
      if (!/^\s*(import|from|def |#!)/m.test(m[2])) continue; // not Python; leave it alone
      if (!hasPython) { skipped++; continue; }
      checked++;
      const err2 = run("python3", ["-c", "import sys,ast; ast.parse(sys.stdin.read())"], m[2]);
      if (err2) problems.push(`${rel(file)}: embedded python syntax: ${err2}`);
    }
  } else if (file.endsWith(".mjs") || file.endsWith(".js")) {
    checked++;
    const err = run(process.execPath, ["--check", file]);
    if (err) problems.push(`${rel(file)}: js syntax: ${err}`);
  }
}

for (const p of problems) console.error(`  ${p}`);
console.log(
  `check-scripts: ${checked} file(s) parsed, ${problems.length} problem(s)` +
    (skipped ? `, ${skipped} python block(s) skipped` : "")
);
process.exit(problems.length ? 1 : 0);
