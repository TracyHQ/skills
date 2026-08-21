// Turn the review into something a person opens.
//
// Two readers, one page. The owner wants a sentence that says what a visitor experiences and what
// it costs them; whoever builds the site wants the block, the numbers and the viewport. Writing
// two reports would mean maintaining two truths, so each finding carries both and the builder's
// half stays folded away until someone asks for it.
//
// Pointing is done here rather than by the reviewer. The reviewer names a block; this file looks
// up the rectangle that block occupied when the page was measured and lays a box over the
// screenshot at those coordinates. Asking a model for pixel coordinates gets you a box in
// approximately the right place, which is worse than no box at all — a reader trusts a box.
//
// The chrome is English because this repository is public and English is the rule here; the
// findings themselves are written by the reviewer in whatever language the person is speaking,
// and `language` in findings.json sets the page's lang attribute to match.
//
// Usage: node report.mjs --capture <dir> --findings <findings.json> [--out report.html]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

const CAPTURE = arg("capture");
const FINDINGS = arg("findings");
const OUT = arg("out");

if (!CAPTURE || !FINDINGS) {
  process.stderr.write("usage: report.mjs --capture <dir> --findings <findings.json> [--out report.html]\n");
  process.exit(2);
}

const outPath = OUT ?? path.join(CAPTURE, "report.html");
const index = JSON.parse(readFileSync(path.join(CAPTURE, "index.json"), "utf8"));
const review = JSON.parse(readFileSync(FINDINGS, "utf8"));

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Every block this capture recorded, so a finding can be turned into a rectangle. */
function blockIndex() {
  const byPage = new Map();
  for (const page of index.pages) {
    const file = path.join(CAPTURE, page.measurements);
    if (!existsSync(file)) continue;
    const data = JSON.parse(readFileSync(file, "utf8"));
    const perViewport = new Map();
    for (const [viewport, v] of Object.entries(data.viewports ?? {})) {
      const boxes = new Map();
      for (const group of ["sections", "images", "actions", "tinyText", "overflowingText"]) {
        for (const item of v[group] ?? []) if (item.id) boxes.set(item.id, item);
      }
      perViewport.set(viewport, { boxes, shot: v.screenshot, width: v.clientWidth, truncated: v.screenshotTruncated });
    }
    byPage.set(page.url, { slug: page.slug, title: data.viewports?.desktop?.title ?? page.url, perViewport });
  }
  return byPage;
}

/**
 * Where each named block lives on the page, as a css path rather than a rectangle.
 *
 * The report itself draws boxes from rectangles, which is all a saved screenshot needs. Anything
 * that wants to point at the same element on the LIVE page — highlighting it in an editor, checking
 * whether a fix landed — needs an address that survives a reload, and a rectangle is not that.
 */
const addresses = (f) => {
  const vp = blocks.get(f.page)?.perViewport.get(f.viewport ?? "desktop");
  return (f.blockIds ?? []).map((id) => vp?.boxes.get(id)?.selector).filter(Boolean);
};

const SEVERITY = {
  high: { label: "High", rank: 0 },
  medium: { label: "Medium", rank: 1 },
  low: { label: "Low", rank: 2 }
};

const blocks = blockIndex();

/** A screenshot with the named blocks boxed on top of it, scaled to whatever width it renders at. */
function shotWithBoxes(pageUrl, viewport, blockIds) {
  const page = blocks.get(pageUrl);
  const vp = page?.perViewport.get(viewport);
  if (!vp?.shot) return "";
  const rects = (blockIds ?? []).map((id) => vp.boxes.get(id)?.rect).filter(Boolean);
  const overlay = rects
    .map((r) => {
      const pct = (n, total) => `${((n / total) * 100).toFixed(3)}%`;
      return `<b style="left:${pct(r.x, vp.width)};top:${r.y}px;width:${pct(r.w, vp.width)};height:${r.h}px"></b>`;
    })
    .join("");
  const note = vp.truncated ? `<em class="cut">Shot cut at 6000px; the page runs longer.</em>` : "";
  return `<figure class="shot" style="--w:${vp.width}">
    <div class="frame"><img src="${esc(vp.shot)}" alt="">${overlay}</div>
    <figcaption>${esc(viewport)}${rects.length ? ` · ${rects.length} marked` : ""} ${note}</figcaption>
  </figure>`;
}

const findings = [...(review.findings ?? [])].sort(
  (a, b) => (SEVERITY[a.severity]?.rank ?? 3) - (SEVERITY[b.severity]?.rank ?? 3)
);
const fixed = findings.filter((f) => f.kind !== "free");
const free = findings.filter((f) => f.kind === "free");

const byPage = new Map();
for (const f of fixed) {
  if (!byPage.has(f.page)) byPage.set(f.page, []);
  byPage.get(f.page).push(f);
}

const card = (f) => `
<article class="finding sev-${esc(f.severity)}">
  <header>
    <span class="chip">${esc(SEVERITY[f.severity]?.label ?? f.severity)}</span>
    <p class="owner">${esc(f.forOwner)}</p>
  </header>
  ${f.forBuilder ? `<details><summary>Detail for whoever fixes it</summary><div class="builder"><p>${esc(f.forBuilder)}</p>
    <p class="meta">Check <code>${esc(f.id)}</code>${f.viewport ? ` · ${esc(f.viewport)}` : ""}${
      f.blockIds?.length ? ` · block ${f.blockIds.map((b) => `<code>${esc(b)}</code>`).join(", ")}` : ""
    }</p>
    ${shotWithBoxes(f.page, f.viewport ?? "desktop", f.blockIds)}</div></details>` : ""}
</article>`;

const pageSections = [...byPage.entries()]
  .map(([url, list]) => {
    const meta = blocks.get(url);
    return `<section class="page">
      <h2>${esc(meta?.title ?? url)}</h2>
      <p class="url"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></p>
      ${list.map(card).join("")}
    </section>`;
  })
  .join("");

const freeSection = free.length
  ? `<section class="page free">
      <h2>Further observations</h2>
      <p class="note">These are observations, not measurements. They are left out of the tally and may
      differ between two runs. Anything that keeps recurring across sites has earned a real check.</p>
      ${free.map(card).join("")}
    </section>`
  : "";

const counts = { high: 0, medium: 0, low: 0 };
for (const f of fixed) if (counts[f.severity] !== undefined) counts[f.severity] += 1;

const html = `<!doctype html>
<html lang="${esc(review.language ?? "en")}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Presentation review — ${esc(review.site ?? "")}</title>
<style>
:root { --ink:#16181d; --muted:#6b7280; --line:#e5e7eb; --bg:#fff; --high:#dc2626; --medium:#d97706; --low:#6b7280; }
@media (prefers-color-scheme: dark) {
  :root { --ink:#e8eaed; --muted:#9aa0a6; --line:#2c2f36; --bg:#15171c; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
.wrap { max-width: 900px; margin: 0 auto; padding: 40px 20px 80px; }
h1 { font-size: 28px; margin: 0 0 6px; }
.sub { color: var(--muted); margin: 0 0 28px; }
.tally { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:32px; }
.tally span { border:1px solid var(--line); border-radius:999px; padding:6px 14px; font-size:14px; }
.summary { border-left:3px solid var(--line); padding:4px 0 4px 18px; margin:0 0 40px; color:var(--ink); }
.page { margin: 0 0 44px; }
.page h2 { font-size:19px; margin:0 0 2px; }
.url { margin:0 0 16px; font-size:13px; }
.url a { color: var(--muted); }
.note { color:var(--muted); font-size:14px; margin:0 0 16px; }
.finding { border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin-bottom:12px; }
.finding header { display:flex; gap:12px; align-items:flex-start; }
.owner { margin:0; flex:1; }
.chip { font-size:12px; font-weight:600; padding:3px 9px; border-radius:999px; white-space:nowrap; color:#fff; }
.sev-high .chip { background: var(--high); }
.sev-medium .chip { background: var(--medium); }
.sev-low .chip { background: var(--low); }
details { margin-top:12px; }
summary { cursor:pointer; color:var(--muted); font-size:14px; }
.builder { padding-top:10px; }
.builder p { margin:0 0 10px; }
.meta { color:var(--muted); font-size:13px; }
code { background:rgba(127,127,127,.14); padding:1px 5px; border-radius:4px; font-size:13px; }
.shot { margin:12px 0 0; }
.frame { position:relative; display:block; border:1px solid var(--line); border-radius:6px; overflow:hidden; }
.frame img { display:block; width:100%; height:auto; }
.frame b { position:absolute; border:2px solid var(--high); background:rgba(220,38,38,.12); border-radius:2px; }
figcaption { color:var(--muted); font-size:12px; margin-top:6px; }
.cut { color: var(--medium); font-style:normal; }
</style></head>
<body><main class="wrap">
<h1>Presentation review</h1>
<p class="sub">${esc(review.site ?? "")} · ${esc(review.reviewedAt ?? index.capturedAt ?? "")} · ${index.pages.length} pages</p>
<div class="tally">
  <span>High: <strong>${counts.high}</strong></span>
  <span>Medium: <strong>${counts.medium}</strong></span>
  <span>Low: <strong>${counts.low}</strong></span>
  <span>Observations: <strong>${free.length}</strong></span>
</div>
${review.summary ? `<p class="summary">${esc(review.summary)}</p>` : ""}
${pageSections || "<p>The fixed checks found nothing.</p>"}
${freeSection}
</main></body></html>`;

writeFileSync(outPath, html);

/**
 * The same findings with every block already resolved to an address, a rectangle and a shot.
 *
 * The reviewer names blocks, which keeps its job small and its output checkable; anyone consuming
 * the review afterwards would otherwise have to open the measurement file for every page and do
 * the lookup again. Doing it once here means a later session, or an editor that wants to highlight
 * these elements on the live page, reads one file and has everything.
 */
const resolvedPath = path.join(path.dirname(outPath), "findings.resolved.json");
const resolved = {
  site: review.site,
  reviewedAt: review.reviewedAt,
  language: review.language,
  summary: review.summary,
  capturedAt: index.capturedAt,
  findings: findings.map((f) => {
    const vp = blocks.get(f.page)?.perViewport.get(f.viewport ?? "desktop");
    return {
      ...f,
      blocks: (f.blockIds ?? [])
        .map((id) => vp?.boxes.get(id))
        .filter(Boolean)
        .map((b) => ({ id: b.id, selector: b.selector, textHint: b.textHint, rect: b.rect })),
      screenshot: vp?.shot ?? null
    };
  })
};
writeFileSync(resolvedPath, JSON.stringify(resolved, null, 2));

process.stdout.write(
  JSON.stringify({ report: outPath, resolved: resolvedPath, findings: fixed.length, notes: free.length }) + "\n"
);
