// The review file, and the four things anyone ever asks it.
//
//   build     merge what was just seen into what was already known
//   overview  the numbers, before a single question is spent
//   next      the one finding to ask about now
//   decide    record an answer, and hand back the next one
//
// WHY THIS IS NOT A REPORT WRITER
//
// The skill used to end by rendering an HTML page and stopping. That page was a dead file: it
// remembered nothing, so the second run resurrected every fault the person had already looked at
// and dismissed, and there was nowhere to write down what they thought about any of it. The person
// did the reading; the tool kept none of it.
//
// So the artefact is a living document instead, and this file is the only thing allowed to write
// it. The agent never edits `review.json` by hand — it calls `decide`, which is one command per
// question rather than a read, an edit and a re-read. That matters more than tidiness: every round
// trip here is a round trip of a language model, and the design note this implements
// (2026-08-21-ui-check-living-review-design.md §8) names the number of questions as the risk most
// likely to make the experience unusable.
//
// `decide` printing the next finding is the same economy. One call, one question answered, the
// next question in hand.
//
// Usage: node review.mjs build --review <path> --capture <dir> --survey <file> --findings <file>
//        node review.mjs overview|next --review <path>
//        node review.mjs decide --review <path> --id f7[,f8] --state saved|ignored|seen

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { findingFingerprint } from "./fingerprint.mjs";
import { renderReview } from "./review-md.mjs";
import { pathOf } from "./target.mjs";

const CMD = process.argv[2];
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

const REVIEW = arg("review");
const SEVERITY = { high: 0, medium: 1, low: 2 };
const rank = (f) => SEVERITY[f.severity] ?? 3;
const OPEN = new Set(["new", "seen"]);
const isOpen = (f) => OPEN.has(f.state);

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const say = (o) => process.stdout.write(JSON.stringify(o, null, 2) + "\n");

if (!CMD || !REVIEW) {
  process.stderr.write(
    "usage: review.mjs build|overview|next|decide --review <review.json> [...]\n" +
      "  build   --capture <dir> --survey <survey.json> --findings <findings.json>\n" +
      "  decide  --id <f7[,f8]> --state saved|ignored|seen\n"
  );
  process.exit(2);
}

/**
 * Every block the capture measured, so a finding that names `b12` can be turned into an address.
 *
 * The reviewer names blocks and never writes selectors or coordinates itself — it is looking at a
 * picture, and a selector it invented is a guess about a DOM it never measured. Everything
 * downstream of the block id is derived here from what the browser actually recorded.
 */
function blockIndex(captureDir) {
  const index = read(path.join(captureDir, "index.json"));
  const byPage = new Map();
  for (const page of index.pages) {
    const file = path.join(captureDir, page.measurements);
    if (!existsSync(file)) continue;
    const data = read(file);
    const perViewport = new Map();
    for (const [viewport, v] of Object.entries(data.viewports ?? {})) {
      const boxes = new Map();
      for (const group of ["sections", "images", "actions", "tinyText", "overflowingText"]) {
        for (const item of v[group] ?? []) if (item.id) boxes.set(item.id, item);
      }
      perViewport.set(viewport, boxes);
    }
    byPage.set(page.url, perViewport);
    // Also reachable by path, because a finding is filed against `/contact/` while the capture
    // visited it on whichever copy was being read.
    byPage.set(pathOf(page.url), perViewport);
  }
  return byPage;
}

/** One finding as the review file stores it: what fired, where, and how to find it again. */
function resolve(f, blocks) {
  const page = pathOf(f.page);
  const viewport = f.viewport ?? "desktop";
  const found = (f.blockIds ?? [])
    .map((id) => blocks.get(f.page)?.get(viewport)?.get(id) ?? blocks.get(page)?.get(viewport)?.get(id))
    .filter(Boolean);
  const selectors = found.map((b) => b.selector).filter(Boolean);
  const hint = found.map((b) => b.textHint ?? "").join(" ").slice(0, 40);
  return {
    fingerprint: findingFingerprint({ page, checkId: f.id, viewport, selectors, hint }),
    checkId: f.id,
    kind: f.kind ?? "fixed",
    severity: f.severity,
    page,
    viewport,
    blockIds: f.blockIds ?? [],
    selectors,
    // The rectangle is what an editor needs to draw attention to the block on the page itself.
    // Kept even though nothing reads it yet — it exists only in the capture, and the capture is
    // overwritten by the next run.
    rects: found.map((b) => b.rect).filter(Boolean),
    forOwner: f.forOwner,
    forBuilder: f.forBuilder,
    state: "new",
    decidedAt: null
  };
}

function write(review) {
  const dir = path.dirname(REVIEW);
  mkdirSync(dir, { recursive: true });
  writeFileSync(REVIEW, JSON.stringify(review, null, 2));
  writeFileSync(path.join(dir, "review.md"), renderReview(review));
}

/**
 * Merge what was just seen into what was already known.
 *
 * Three groups come out of it, and the middle one is the whole reason the file exists:
 *
 *   - a finding whose fingerprint was already here KEEPS its id and its state. Somebody decided
 *     about this once; asking again would teach them the review does not listen.
 *   - a finding on a page this run did NOT open is carried through untouched. That is what makes
 *     re-reading three changed pages cost three pages instead of twenty.
 *   - a finding that WAS here, on a page this run did open, and is not here now, was fixed. It
 *     leaves the file for the archive, and only its count stays behind.
 */
function build() {
  const survey = read(arg("survey"));
  const findings = read(arg("findings"));
  const blocks = blockIndex(arg("capture"));
  const prior = existsSync(REVIEW) ? read(REVIEW) : null;

  // The pages actually OPENED this run, which on a second look is only the ones that changed.
  // `survey.pages` is wider than that — it also carries the unchanged pages, so their fingerprints
  // stay current — and using it here would call every finding on an unopened page fixed.
  const scanned = new Set((survey.pagesToReview ?? []).map(pathOf));
  const fresh = (findings.findings ?? []).map((f) => resolve(f, blocks));
  const priorByFingerprint = new Map((prior?.findings ?? []).map((f) => [f.fingerprint, f]));

  let nextId = prior?.nextId ?? 1;
  const merged = fresh.map((f) => {
    const was = priorByFingerprint.get(f.fingerprint);
    return was
      ? { ...f, id: was.id, state: was.state, decidedAt: was.decidedAt }
      : { ...f, id: `f${nextId++}` };
  });

  const seenNow = new Set(merged.map((f) => f.fingerprint));
  const carried = [];
  const fixed = [];
  for (const f of prior?.findings ?? []) {
    if (seenNow.has(f.fingerprint)) continue;
    // Only a page that was actually opened again can prove a finding gone. A page nobody looked
    // at this run says nothing about the faults on it, and treating silence as a fix is how a
    // living document starts congratulating people for work they never did.
    (scanned.has(f.page) ? fixed : carried).push(f);
  }

  const pages = new Map((prior?.pages ?? []).map((p) => [p.url, p]));
  for (const p of survey.pages ?? []) pages.set(p.url, { url: p.url, fingerprint: p.fingerprint });

  const all = [...merged, ...carried];
  const review = {
    site: survey.site,
    scannedAgainst: survey.scannedAgainst,
    reviewedAt: new Date().toISOString(),
    language: findings.language ?? prior?.language ?? "en",
    summary: findings.summary ?? prior?.summary ?? "",
    status: all.some(isOpen) ? "in_progress" : "closed",
    nextId,
    pages: [...pages.values()],
    droppedFromReview: survey.droppedFromReview ?? 0,
    fixedCount: (prior?.fixedCount ?? 0) + fixed.length,
    findings: all
  };

  if (fixed.length) {
    const day = review.reviewedAt.slice(0, 10);
    const dir = path.join(path.dirname(REVIEW), "archive", day);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "fixed.json");
    const already = existsSync(file) ? read(file) : [];
    writeFileSync(file, JSON.stringify([...already, ...fixed.map((f) => ({ ...f, state: "fixed" }))], null, 2));
  }

  write(review);
  say({
    review: REVIEW,
    findings: all.length,
    carriedOver: carried.length,
    newSinceLastRun: prior ? merged.filter((f) => !priorByFingerprint.has(f.fingerprint)).length : 0,
    fixed: fixed.length,
    open: all.filter(isOpen).length
  });
}

/**
 * The numbers, before a single question is spent.
 *
 * This exists so the conversation can open with something true and specific — "11 findings, 2 of
 * them serious, 6 you set aside last time" — rather than with a question. Findings already set
 * aside are COUNTED here and never asked about again: hiding them entirely would turn "skip this"
 * into a silent trapdoor, which is the one thing this skill promises never to do.
 */
function overview(review) {
  const all = review.findings ?? [];
  const open = all.filter(isOpen);
  const by = (list) => ({
    high: list.filter((f) => f.severity === "high").length,
    medium: list.filter((f) => f.severity === "medium").length,
    low: list.filter((f) => f.severity === "low").length
  });
  return {
    site: review.site,
    scannedAgainst: review.scannedAgainst,
    status: review.status,
    total: all.length,
    bySeverity: by(all),
    open: open.length,
    openBySeverity: by(open),
    saved: all.filter((f) => f.state === "saved").length,
    ignored: all.filter((f) => f.state === "ignored").length,
    fixedSinceLastRun: review.fixedCount ?? 0,
    pagesReviewed: review.pages?.length ?? 0,
    droppedFromReview: review.droppedFromReview ?? 0,
    reviewMarkdown: path.join(path.dirname(REVIEW), "review.md")
  };
}

/**
 * The one finding to ask about now — or, once only the small ones are left, all of them at once.
 *
 * Serious findings are worth a question each. Four cosmetic ones are not: four questions to settle
 * four things nobody would have named unprompted is where a person stops answering and closes the
 * window. So the low group arrives as a single question with a single answer covering all of it.
 */
function next(review) {
  const open = (review.findings ?? []).filter(isOpen).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  if (open.length === 0) return { done: true, ...overview(review) };
  const remaining = { open: open.length, high: open.filter((f) => f.severity === "high").length };
  if (open.every((f) => f.severity === "low")) return { mode: "batch", severity: "low", findings: open, remaining };
  return { mode: "one", finding: open[0], remaining };
}

function decide(review) {
  const ids = new Set((arg("id") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const state = arg("state");
  if (!ids.size || !["saved", "ignored", "seen"].includes(state)) {
    process.stderr.write("decide needs --id <f7[,f8]> and --state saved|ignored|seen\n");
    process.exit(2);
  }

  const at = new Date().toISOString();
  let touched = 0;
  for (const f of review.findings ?? []) {
    if (!ids.has(f.id)) continue;
    f.state = state;
    // `seen` is what "explain this to me" leaves behind: the person looked and has not decided, so
    // the next run asks again. Only a real decision gets a timestamp.
    f.decidedAt = state === "seen" ? null : at;
    touched += 1;
  }
  if (touched !== ids.size) {
    const known = new Set((review.findings ?? []).map((f) => f.id));
    const missing = [...ids].filter((id) => !known.has(id));
    process.stderr.write(`no such finding: ${missing.join(", ")}\n`);
    process.exit(2);
  }

  review.status = (review.findings ?? []).some(isOpen) ? "in_progress" : "closed";
  write(review);
  say({ decided: [...ids], state, next: next(review) });
}

if (CMD === "build") {
  build();
} else if (["overview", "next", "decide"].includes(CMD)) {
  if (!existsSync(REVIEW)) {
    process.stderr.write(`no review at ${REVIEW} — run a scan first\n`);
    process.exit(2);
  }
  const review = read(REVIEW);
  if (CMD === "overview") say(overview(review));
  else if (CMD === "next") say(next(review));
  else decide(review);
} else {
  process.stderr.write(`unknown command: ${CMD}\n`);
  process.exit(2);
}
