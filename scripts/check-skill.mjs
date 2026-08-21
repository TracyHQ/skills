#!/usr/bin/env node
/**
 * Check Tracy's own skills for the ways a skill goes wrong while every other gate stays green.
 *
 *   node scripts/check-skill.mjs
 *
 * WHY THIS EXISTS
 *
 * `pnpm validate` already checks a skill is WELL FORMED: frontmatter parses, the version is
 * semver, the namespace matches the repo owner, numbered references are contiguous, no private
 * repo is cited. `check-language` checks it is in English. `check-scripts` checks it parses.
 *
 * All of those were green throughout the 2026-08-19 review of `design-qa` and `reskin-qa`, which
 * found nine real defects. Every one of them was a skill that was VALID and WRONG, and the two
 * are not the same property. The largest: three SKILL.md files stated that every QA gate accepts
 * `--variant`, while two of five accepted it nowhere and sent its header never — so a run against
 * a proposal silently graded the live site and passed.
 *
 * WHAT THIS CAN AND CANNOT SEE
 *
 * A skill's text is instructions for an agent, so a sentence naming a file, a flag or an
 * environment variable is a claim that can be checked against the directory. That is what this
 * does. It found a live one on its first run beyond the skills it was written for:
 * `skill-creator` opens by telling the agent it is running inside Cherry Studio and to resolve
 * `$CHERRY_STUDIO_SKILLS_DIR`, while these skills load in Tracy Desk and nothing named Cherry
 * exists anywhere else in this repo.
 *
 * It cannot check the QUANTIFIER. "All three gates take `--variant`" is false in exactly the way
 * that matters while `--variant` still exists, so no grep settles it. Rather than guess, a
 * quantified sentence near a flag becomes a WARNING listing which scripts accept the flag and
 * which do not, and a person decides. A gate that guesses here would cry wolf, and the first
 * lesson of that review is that a gate which cries wolf is a gate somebody switches off.
 *
 * Three further failure modes from the same review are NOT mechanically checkable and are left to
 * the reader, deliberately rather than by omission:
 *
 *   - an exclusion justified by "another check covers that" where nothing does;
 *   - a condition no input can satisfy, which reads as a working gate and never fires;
 *   - a constant borrowed from another tool, calibrated there for a different number of filters.
 *
 * SCOPE
 *
 * Tracy's own skills under `skills/` — the ones this repo hosts rather than points at. A record
 * naming somebody else's repository has no content here to check.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

// The directory to check, overridable by argument. A linter that can only ever run against one
// hard-coded path is untestable by construction — the same trap the QA gates were in until their
// verdicts moved out of `page.evaluate`. The tests build small skills in a temp directory and
// point this at them, so every rule is exercised on an input designed to trip it rather than on
// whatever the repo happens to contain today.
const SKILLS = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, "skills");

const CODE_EXT = new Set([".sh", ".mjs", ".js", ".cjs", ".py", ".ts"]);
const TEXT_EXT = new Set([".md"]);

// Flags every shell and every CLI convention already owns. A skill mentioning `--help` is not
// claiming its own script implements one.
const UNIVERSAL_FLAGS = new Set([
  "--help", "--version", "--verbose", "--quiet", "--force", "--dry-run", "--no-save", "--yes",
  "--all", "--json", "--output", "--file", "--debug", "--global", "--local", "--recursive",
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__pycache__" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    e.isDirectory() ? walk(full, out) : out.push(full);
  }
  return out;
}

/**
 * Flags a script's PARSER accepts, read from the parser and never from its usage comment — a
 * usage line is prose and drifts from the parser exactly like a SKILL.md does.
 *
 * Deliberately strict, and it under-reports: JavaScript has no single argument convention, and
 * the shapes below are the ones this repo uses. Where it under-reports, the rule that consumes
 * it (the quantified-claim warning) simply finds no peers and says nothing. Missing a warning is
 * a cost; inventing one is a gate somebody turns off.
 */
function flagsParsedBy(source, file) {
  const flags = new Set();
  if (file.endsWith(".sh")) {
    // A case arm, wherever it sits: at the start of its own line as every script here writes
    // them, after a `|` in an alternation, or inline after `in` / `;;` on a compact one-liner.
    // Missing the inline form only ever costs flags — a flag the reader cannot see reads as
    // unhonoured — so the pattern errs toward seeing more.
    for (const m of source.matchAll(/(?:^\s*|\||\bin\s+|;;\s*)(?:\*\|)?(--[a-z][a-z0-9-]*)\)/gm)) flags.add(m[1]);
  }
  const defaults = source.match(/defaults:\s*\{([\s\S]*?)\}/);
  if (defaults) {
    for (const m of defaults[1].matchAll(/["']?([a-z][a-z0-9-]*)["']?\s*:/g)) flags.add("--" + m[1]);
  }
  for (const m of source.matchAll(/["'](--[a-z][a-z0-9-]*)["']/g)) flags.add(m[1]);
  return flags;
}

/**
 * Every flag that appears ANYWHERE in a script's source — parser, usage comment, error message.
 *
 * A much weaker claim than flagsParsedBy, and that is the point. `visibility-audit`'s scripts
 * take `--domain` through a helper this file cannot recognise, surfacing it only as the text of
 * `throw new Error('--domain is required')`. Judging that skill by the strict reader marked
 * fifteen working flags as unhonoured — a gate failing two of twenty-one real skills, which is
 * the definition of a gate nobody trusts.
 *
 * So the rule this feeds asks the weakest question worth asking: does this flag appear in any of
 * the skill's scripts at all? A "no" is a typo or a flag that was removed from the code and left
 * in the prose. It cannot see a flag that exists in one script while the text attributes it to
 * another — no grep can, and the quantified-claim warning is where that lives instead.
 */
function flagsAppearingIn(source) {
  const flags = new Set();
  for (const m of source.matchAll(/(--[a-z][a-z0-9-]{1,})\b/g)) flags.add(m[1]);
  return flags;
}

const findings = [];
// Every script name this repo ships, across all skills — the denominator for "resolves nowhere".
const allScriptNames = new Set();
const unresolved = new Set();
const add = (level, code, skill, message) => findings.push({ level, code, skill, message });

const skills = fs.existsSync(SKILLS)
  ? fs.readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  : [];

for (const s0 of skills) {
  const d0 = path.join(SKILLS, s0);
  for (const f of walk(d0)) if (CODE_EXT.has(path.extname(f))) allScriptNames.add(path.basename(f));
}

for (const skill of skills) {
  const dir = path.join(SKILLS, skill);
  const skillMd = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillMd)) continue; // bin/validate.ts owns that failure

  const files = walk(dir);
  const rel = (f) => path.relative(dir, f);
  const own = new Set(files.map(rel));
  const basenames = new Set(files.map((f) => path.basename(f)));

  const textFiles = files.filter((f) => TEXT_EXT.has(path.extname(f)));
  const codeFiles = files.filter((f) => CODE_EXT.has(path.extname(f)) && !rel(f).startsWith("__tests__"));
  const text = textFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const frontmatter = (fs.readFileSync(skillMd, "utf8").match(/^---\n([\s\S]*?)\n---/) || [, ""])[1];

  // ---- 1. a markdown link must resolve ------------------------------------------------------
  // Link targets are unambiguous: `[x](references/spec.md)` is a citation, so the file has to be
  // there. Bare prose is not — `working-copy` names `references/spec.md` as where its traps will
  // MOVE once there are enough of them, which is an intention, not a dangling citation. Judging
  // prose would fail that skill for planning ahead.
  for (const f of textFiles) {
    const body = fs.readFileSync(f, "utf8");
    for (const m of body.matchAll(/\]\(([^)#:\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?|mailto):/.test(target)) continue;
      const abs = path.resolve(path.dirname(f), target);
      if (!fs.existsSync(abs)) add("FAIL", "broken_link", skill, `${rel(f)} links to ${target}, which does not exist`);
    }
  }

  // ---- 1b. a script name that resolves nowhere in this repo ---------------------------------
  // A WARNING, not a failure, and the ambiguity is the reason. `reskin` legitimately names
  // `design-qa.sh` (another skill's, which it orchestrates) and `make-variant.sh` (the fleet
  // host's, which no skill ships). Both are correct. What this catches is the third case: a name
  // that used to resolve and no longer does — `reskin`'s spec cited `visual-qa.mjs` for a week
  // after that file was absorbed into another, telling readers to run something not there.
  for (const m of text.matchAll(/`([A-Za-z0-9_-]+\.(?:sh|mjs|cjs|py))`/g)) {
    if (!allScriptNames.has(m[1])) unresolved.add(m[1]);
  }

  // ---- 2. every shipped script is executable ----------------------------------------------
  // Two scripts shipped in this repo without the bit and would have failed on the fleet at the
  // moment somebody needed them.
  for (const f of files) {
    if (!f.endsWith(".sh")) continue;
    if (!(fs.statSync(f).mode & 0o111)) add("FAIL", "script_not_executable", skill, `${rel(f)} has no executable bit`);
  }

  // ---- 3. a flag the text mentions must be accepted somewhere -------------------------------
  const accepted = new Map();
  const appearing = new Set();
  for (const f of codeFiles) {
    const src = fs.readFileSync(f, "utf8");
    accepted.set(rel(f), flagsParsedBy(src, f));
    for (const fl of flagsAppearingIn(src)) appearing.add(fl);
  }

  const mentioned = new Set();
  for (const m of text.matchAll(/`?(--[a-z][a-z0-9-]*)`?/g)) {
    if (!UNIVERSAL_FLAGS.has(m[1])) mentioned.add(m[1]);
  }
  for (const flag of mentioned) {
    if (appearing.has(flag)) continue;
    // Flags belonging to a tool the skill merely invokes (docker, npm, wp-cli, git) are quoted
    // constantly and are not this skill's contract. Only complain when the skill has scripts of
    // its own AND the flag appears next to one of their names.
    const nearOwnScript = [...basenames].some(
      (b) => /\.(sh|mjs|py)$/.test(b) &&
        new RegExp(`${b.replace(/[.]/g, "\\.")}[^\\n]{0,200}${flag}`).test(text)
    );
    if (nearOwnScript) add("FAIL", "flag_unhonoured", skill, `text shows \`${flag}\` with one of this skill's scripts, but the flag appears in none of them`);
  }

  // ---- 4. a quantified claim about a flag ---------------------------------------------------
  // The bug this exists for, and the one no grep can settle: "All three take `--variant`" is
  // false in exactly the way that matters while `--variant` still exists somewhere.
  //
  // The peer set is scripts that accept `--host`. That is not arbitrary: a script taking --host
  // is one that judges a running site, which is precisely what a sentence like "every gate takes
  // --variant" is quantifying over. Listing every script in the skill instead was the first
  // attempt and it was useless — it named `pixel-diff`, which compares two directories and has
  // no host to send a header to. A warning nobody can act on is a warning that gets skipped.
  // A GATE in this repo has a recognisable signature: it takes --host, and it takes either a
  // list of pages to judge or a file of expectations to judge against. Scripts that take --host
  // to go and FETCH something (scan-demo, port-assets, undress) are not what a sentence like
  // "every gate takes --variant" quantifies over, and listing them buried the real answer.
  const peers = [...accepted.entries()].filter(
    ([, s2]) => s2.has("--host") && (s2.has("--pages") || s2.has("--expect"))
  );
  for (const line of text.split("\n")) {
    // The quantifier has to be attached to a CLAIM ABOUT A COMMAND — "every gate takes",
    // "all three take", "both accept". Matching the bare word caught "Each tier still declares
    // its own viewports", which quantifies over tiers and says nothing about any script's flags.
    const q = line.match(
      /\b(all|every|each|both)\b[\w\s]{0,24}?\b(takes?|accepts?|supports?|sends?|requires?)\b[^.]{0,80}?(--[a-z][a-z0-9-]*)/i
    );
    if (!q) continue;
    const flag = q[3];
    if (UNIVERSAL_FLAGS.has(flag) || flag === "--host") continue;
    const without = peers.filter(([, s2]) => !s2.has(flag)).map(([n]) => n);
    if (!without.length) continue;
    add("warn", "quantified_flag_claim", skill,
      `"${line.trim().slice(0, 64)}…" — host-taking scripts that do NOT accept ${flag}: ${without.join(", ")}`);
  }

  // ---- 4b. an environment variable the text assumes the HOST provides ----------------------
  // `skill-creator` opens with a READ-FIRST block stating "You are running inside Cherry Studio"
  // and telling the agent to resolve `$CHERRY_STUDIO_SKILLS_DIR`, then to IGNORE the packaging
  // path that actually exists. Nothing named Cherry appears anywhere else in this repo, and
  // these skills load in Tracy Desk. An agent following that block resolves an empty variable,
  // writes to a path built from nothing, and skips the one real route.
  //
  // The distinguishing feature is narrow enough to be worth checking: the text READS the
  // variable and never ASSIGNS it, and no script in the skill touches it either. A variable the
  // instructions create themselves (`VIEWER_PID=$!`, then `kill $VIEWER_PID`) is defined by the
  // very text that uses it and is not an assumption about anything. Across 21 skills this
  // separation leaves exactly one hit.
  //
  // A warning, because this repo cannot settle it: a host may genuinely export a variable no
  // script here reads. Only someone who can read the runtime can answer, which is exactly the
  // question this puts in front of them — and answering it is cheap once asked.
  //
  // The skill-creator case WAS answered, and the answer is recorded here so nobody re-runs the
  // investigation: Tracy Desk is a rebrand of Cherry Studio, and its `SkillService.ts` still
  // exports the variable under the original name — "Agents write new skills directly to the
  // managed library exposed by CHERRY_STUDIO_SKILLS_DIR". So the block is correct, and renaming
  // it to match the product would break it. The warning did its job by turning an unexamined
  // assumption into a checked fact; it stays standing because the next reader deserves the same
  // prompt, not because anything is wrong.
  const assigned = new Set([...text.matchAll(/\b([A-Z][A-Z0-9_]{3,})\s*=/g)].map((m) => m[1]));
  const codeText = codeFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const readVars = new Set([...text.matchAll(/\$\{?([A-Z][A-Z0-9_]{3,})\}?/g)].map((m) => m[1]));
  for (const v of [...readVars].sort()) {
    if (assigned.has(v) || codeText.includes(v)) continue;
    add("warn", "host_env_assumed", skill,
      `text tells the reader to use $${v}, which no script here sets or reads — does the runtime actually provide it?`);
  }

  // Skills vendored from upstream are measured but not judged on shape. `skill-creator` came
  // from Anthropic with its own LICENSE.txt; it is 18 lines over the body limit and one of its
  // references lacks a table of contents. Editing either would fork the copy from upstream to
  // recover 3%, which is the same trap the vendored Mention Network skills are already in — a
  // divergence nobody can see from either side, where an upstream fix never arrives and a local
  // fix never travels back. The exemption is by LICENSE.txt rather than by name, so it covers
  // the next vendored skill without anyone editing this file.
  const vendored = fs.existsSync(path.join(dir, "LICENSE.txt"));

  // ---- 6. the three budgets of progressive disclosure ---------------------------------------
  // Anthropic's `skill-creator`, vendored at skills/skill-creator/, defines how a skill loads:
  // name and description are ALWAYS in context, the body loads when the skill triggers, and
  // bundled resources load on demand. Each stage has a number attached, and skills/README.md
  // records where each came from.
  //
  // WARNINGS, not failures, and the reason is the calibration. Three skills in this repo are
  // over a limit today — one body at 1,063 lines and one description at 304 words. A gate that
  // fails the repo it ships with is a gate somebody switches off before it has caught anything,
  // so these report until the outliers are brought in, and can be promoted afterwards.
  //
  // The numbers are not aspirational: mattpocock/skills, 38 skills that Tracy Desk already
  // vendors 41 entries from, clears all three thresholds 38 times out of 38, with its longest
  // skill shorter than this repo's median.
  const body = fs.readFileSync(skillMd, "utf8");
  const bodyLines = body.split("\n").length;
  if (!vendored && bodyLines > 500)
    add("warn", "skill_md_too_long", skill,
      `SKILL.md is ${bodyLines} lines; past ~500 the answer is another layer — move detail into references/ and point at it`);

  // The description is charged to a SHARED budget, which is what makes this more than style:
  // /doctor records that the skill listing gets roughly 1% of the context window, and that once
  // the summed descriptions exceed it, entries are TRUNCATED and routing degrades. An overlong
  // description spends the budget every other skill needs in order to be findable.
  const described = frontmatter.match(/^description:\s*([\s\S]*?)(?=\n[a-zA-Z-]+:|$)/m);
  if (described) {
    const words = described[1].trim().split(/\s+/).filter(Boolean).length;
    // A FAILURE, unlike the two shape rules beside it, because the cost lands on other people.
    // The listing is charged to one shared allowance; an entry over budget spends what every
    // other skill needs in order to be found, and the entries truncated are the ones at the end,
    // not the one that overran. Three descriptions were over when this rule shipped as a warning
    // — 304, 186 and 162 words — and together they held 22% of the allowance. Rewritten, they
    // took the repo from 136% of budget to 107%.
    if (words > 100)
      add("FAIL", "description_too_long", skill,
        `description is ${words} words against a ~100 budget shared with every other skill's listing entry`);
  }

  // A reference is read by something scanning for one section, not from the top.
  for (const f of files) {
    if (!rel(f).startsWith("references" + path.sep) || !f.endsWith(".md")) continue;
    const lines = fs.readFileSync(f, "utf8").split("\n");
    if (lines.length <= 300) continue;
    const hasToc = lines.slice(0, 60).some((l) => /^\s*[-*]\s*\[/.test(l));
    if (!hasToc && !vendored)
      add("warn", "reference_needs_toc", skill,
        `${rel(f)} is ${lines.length} lines with no table of contents in its first 60`);
  }

  // ---- 5. reaching into another skill must be stated where a reader will see it -------------
  // `reskin-qa` renders through `design-qa`'s engine, so installing it alone leaves two gates
  // dead on first use.
  //
  // This checked for a `requires-skill:` frontmatter key until the runtime was actually read.
  // Nothing honours that key: `src/frontmatter.ts` knows only `requires-mcp`, `build-index.ts`
  // emits only `requiresMcp`, and Tracy Desk's SkillService resolves only `requiresMcp` too —
  // it has no concept of one skill needing another. The key was invented here and travelled
  // nowhere, which is the same defect this whole file exists to catch, committed by this file.
  //
  // What does help, given no machine will resolve it, is that a person installing the skill is
  // TOLD. So the rule now asks for that: if a script reaches into another skill, the skill's own
  // text has to name it. Prose is the delivery mechanism when there is no other.
  for (const f of codeFiles) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/\.\.\/\.\.\/([a-z0-9][a-z0-9-]*)\//g)) {
      const dep = m[1];
      if (dep === skill || !fs.existsSync(path.join(SKILLS, dep))) continue;
      if (text.includes(dep)) continue;
      add("FAIL", "undeclared_skill_dependency", skill,
        `${rel(f)} reaches into the ${dep} skill, but no text in this skill tells the reader to install it`);
    }
  }
}

for (const n of [...unresolved].sort())
  add("warn", "unresolved_script_name", "-", `\`${n}\` resolves to no script in any skill here — another skill's? the fleet host's? or deleted?`);

const fails = findings.filter((f) => f.level === "FAIL");
const warns = findings.filter((f) => f.level === "warn");
for (const f of [...fails, ...warns]) console.log(`${f.level === "FAIL" ? "FAIL" : "warn"} [${f.skill}] ${f.code}: ${f.message}`);
console.log(`check-skill: ${skills.length} skill(s), ${fails.length} failure(s), ${warns.length} warning(s)`);
process.exit(fails.length ? 1 : 0);
