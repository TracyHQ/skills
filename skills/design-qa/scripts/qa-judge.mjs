// qa-judge.mjs — the JUDGMENT half of the browser gates, deliberately split from the
// measurement half.
//
// WHY THE SPLIT EXISTS
//
// Everything that reads a page runs inside `page.evaluate` — in the browser, with no
// module system and no way for a unit test to reach it. So for two years the only way to
// check a threshold was to render a real page and squint at the output, which is exactly
// the thing `references/qa-scans.md` § "Trusting a gate" says you must do and exactly the
// thing nobody does on a Friday.
//
// This file takes no measurements. It receives a plain object of numbers — the same object
// the browser handed back — and decides what is a defect. That makes every calibrated
// threshold in the toolkit reachable from `__tests__/`, which is where a gate stops being
// folklore. `browser-qa.mjs` does the rendering and calls in here for every verdict.
//
// Nothing in this file imports anything. That is load-bearing: the test suite must be able
// to import it without playwright installed, and the docker container must be able to run
// it without a package.json.

// ---------------------------------------------------------------------------
// Viewports
// ---------------------------------------------------------------------------

// Desktop is FIRST and that is not cosmetic: the responsive tier judges every smaller
// viewport against this side's OWN desktop layout, so the desktop entry for a block type
// must already be collected when a narrower viewport asks for it.
export const VIEWPORTS = {
  desktop: { name: "desktop", width: 1440, height: 900 },
  laptop: { name: "laptop", width: 1024, height: 800 },
  tablet: { name: "tablet", width: 768, height: 1024 },
  mobile: { name: "mobile", width: 375, height: 812 },
};

// Each tier's own viewport set, unchanged from when the three tiers were three scripts —
// so `--tiers visual` still renders exactly the three viewports visual-qa always rendered
// and writes exactly the same screenshot filenames. The union is only taken across the
// tiers actually requested.
export const TIER_VIEWPORTS = {
  visual: ["desktop", "tablet", "mobile"],
  layout: ["desktop", "mobile"],
  responsive: ["desktop", "laptop", "tablet", "mobile"],
};

export const TIERS = Object.keys(TIER_VIEWPORTS);

/** Union of the viewports the requested tiers need, always desktop-first. */
export function viewportsFor(tiers) {
  const wanted = new Set();
  for (const t of tiers) for (const v of TIER_VIEWPORTS[t] || []) wanted.add(v);
  return Object.keys(VIEWPORTS)
    .filter((v) => wanted.has(v))
    .map((v) => VIEWPORTS[v]);
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse `--flag value` pairs against a declared spec.
 *
 * Unknown flags are an ERROR, never a shrug. The whole reason this toolkit needed
 * rebuilding is that `layout-qa.sh --variant x` used to die on "unknown arg" while
 * `layout-qa.sh` with no variant at all silently graded the wrong site and passed — so a
 * flag is either known and honoured, or it stops the run loudly.
 */
export function parseArgs(argv, spec) {
  const out = { ...spec.defaults };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    const name = key.slice(2);
    if (!(name in spec.defaults)) throw new Error(`unknown flag: ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`flag ${key} needs a value`);
    out[name] = value;
    i++;
  }
  for (const name of spec.required || []) {
    if (!out[name]) throw new Error(`missing required flag: --${name}`);
  }
  return out;
}

/** "a, b ,,c" -> ["a","b","c"] — the shape every --pages / --tiers value arrives in. */
export function splitList(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseTiers(value) {
  const tiers = splitList(value);
  const bad = tiers.filter((t) => !TIERS.includes(t));
  if (bad.length) throw new Error(`unknown tier(s): ${bad.join(", ")} (known: ${TIERS.join(", ")})`);
  return tiers.length ? tiers : ["visual"];
}

// ---------------------------------------------------------------------------
// Visual tier — geometry, assets, behaviour
// ---------------------------------------------------------------------------

/**
 * @param m measurements from measureInPage()
 * @param extra { interaction: string[], jsErrors: string[], assetErrors: {url,status}[] }
 */
export function judgeVisual(m, extra = {}) {
  const problems = [];
  // 8px, not 0: sub-pixel rounding on a scaled layout produces 1-3px of phantom scroll
  // width on pages that are visibly fine.
  if (m.overflowX > 8) problems.push(`overflow-x=${m.overflowX}px`);
  if (m.navOverlap?.length)
    problems.push("nav-overlap=" + m.navOverlap.map((o) => `${o.a}×${o.b}(${o.px}px)`).join(", "));
  if (m.edgeBleed?.length) problems.push(`edge-bleed=${m.edgeBleed.length}`);
  if (m.textClip?.length) problems.push(`text-clip=${m.textClip.length}`);
  if (m.brokenImg?.length) problems.push(`broken-img=${m.brokenImg.length}`);
  // The hole this closes: a CSS `background-image` that 404s was invisible to every gate.
  // `document.images` only sees <img>; the text tier only greps href=/src= out of the HTML;
  // and the console filter deliberately drops "Failed to load resource" on the grounds that
  // the image check would report it — which it could not, because the hero of a dressed page
  // is a background, not an <img>. Now the browser's own response stream is the witness.
  if (extra.assetErrors?.length)
    problems.push(
      "asset-404=" + extra.assetErrors.slice(0, 4).map((a) => `${a.url} (${a.status})`).join("; ") +
        (extra.assetErrors.length > 4 ? ` (+${extra.assetErrors.length - 4})` : "")
    );
  if (extra.interaction?.length) problems.push("interaction: " + extra.interaction.join("; "));
  if (extra.jsErrors?.length) problems.push("js-error: " + extra.jsErrors.slice(0, 2).join(" | "));
  return problems;
}

// ---------------------------------------------------------------------------
// Layout tier — the box model
// ---------------------------------------------------------------------------

export function judgeLayout(m, { minHeight = 500, baseline = null } = {}) {
  const problems = [];
  if (m.pageWidthOverflow > 8)
    problems.push(
      `page-width overflow=${m.pageWidthOverflow}px, culprits: ` +
        (m.overflowCulprits || []).map((c) => `${c.el}(+${c.px}px)`).join("; ")
    );
  // 97%, not 92%: full-bleed portfolio and landing layouts legitimately run to ~93% of the
  // viewport (measured on the live origin), and a gate the real site fails is a gate nobody
  // trusts. Only text nothing constrains at all — effectively the whole viewport — is the
  // defect. See qa-scans.md § "Calibrate a threshold against the real site".
  if (m.contentMeasure && m.contentMeasure.pct >= 97)
    problems.push(
      `content-measure=${m.contentMeasure.pct}% of viewport (${m.contentMeasure.px}px, ` +
        `"${m.contentMeasure.sample}") — text is not inside any container`
    );
  if (m.pageHeight < minHeight) problems.push(`page-height=${m.pageHeight}px (< ${minHeight}: shell?)`);
  if (m.overlaps?.length)
    problems.push("section-overlap: " + m.overlaps.map((o) => `${o.a}×${o.b}(${o.px}px)`).join("; "));
  if (m.escapes?.length)
    problems.push("parent-escape: " + m.escapes.map((e) => `${e.el}(+${e.px}px)`).join("; "));
  if (m.collapsed?.length) problems.push("collapsed-section: " + m.collapsed.join("; "));
  if (m.media?.length)
    problems.push("media-size: " + m.media.map((x) => `${x.src} ${x.why} ${x.w}x${x.h}`).join("; "));

  if (baseline) {
    const dh = Math.abs(m.pageHeight - baseline.pageHeight) / Math.max(baseline.pageHeight, 1);
    if (dh > 0.25)
      problems.push(`height-drift ${baseline.pageHeight}→${m.pageHeight}px (${Math.round(dh * 100)}%)`);
    if (m.sectionCount !== baseline.sectionCount)
      problems.push(`section-drift ${baseline.sectionCount}→${m.sectionCount}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Responsive tier — differential against the demo's own reference
// ---------------------------------------------------------------------------

/**
 * Judge one page × viewport of signatures against the reference.
 *
 * `collected` is THIS side's own accumulated signatures — the comparison is never
 * absolute. See the traps in qa-scans.md § "Trusting a gate": comparing raw column counts
 * produced 16 false failures because a customer with four pricing tiers "fails" against a
 * demo with three. What must match is the FOLD RHYTHM, each side measured against its own
 * desktop state.
 */
export function judgeResponsive({ sig, reference, collected, viewport, path }) {
  const findings = [];
  const add = (level, what) => findings.push({ path, viewport, level, what });

  if (!sig.hasViewportMeta)
    add("FAIL", "no <meta name=viewport> — the page cannot respond at all");

  for (const [type, s] of Object.entries(sig.blocks || {})) {
    const key = `${type}|${viewport}`;
    const ref = reference.blocks?.[key];
    if (!ref) {
      add("info", `${type}: not in reference`);
      continue;
    }
    if (!s.visible && ref.visible) continue; // a deliberate unpublish is the mapping's right
    if (s.hOverflow && !ref.hOverflow) add("FAIL", `${type}: scrolls horizontally, the demo's doesn't`);

    const refDesk = reference.blocks?.[`${type}|desktop`]?.cols || ref.cols;
    const ownDesk = collected.blocks?.[`${type}|desktop`]?.cols || s.cols;
    if (ref.visible && s.visible && viewport !== "desktop") {
      const refCollapsed = ref.cols <= 1 || ref.cols < refDesk;
      const ownCollapsed = s.cols <= 1 || s.cols < ownDesk;
      if (refCollapsed && !ownCollapsed)
        add("FAIL", `${type}: still ${s.cols} columns at ${viewport}; demo collapses ${refDesk}→${ref.cols}`);
      else if (!refCollapsed && ownCollapsed)
        add("warn", `${type}: collapsed to ${s.cols} at ${viewport}; demo keeps ${ref.cols}`);
    }
    if (ref.headingPx && s.headingPx && Math.abs(s.headingPx - ref.headingPx) / ref.headingPx > 0.25)
      add("warn", `${type}: heading ${s.headingPx}px vs demo ${ref.headingPx}px`);
  }

  for (const [what, s] of Object.entries(sig.chrome || {})) {
    const ref = reference.chrome?.[`${what}|${viewport}`];
    if (!ref) continue;
    if (what === "header") {
      if (s.hOverflow && !ref.hOverflow) add("FAIL", "header scrolls horizontally, the demo's doesn't");
      // The collapse contract: where the demo hides links behind a toggler, the dress must
      // too — a nav still showing every link at 375px is broken.
      if (ref.toggler && ref.navLinks <= 4 && s.navLinks > ref.navLinks + 4)
        add("FAIL", `nav shows ${s.navLinks} links at ${viewport}; demo collapses to ${ref.navLinks} behind the toggler`);
    }
    if (what === "footer" && s.cols !== ref.cols)
      add("warn", `footer: ${s.cols} column(s), demo has ${ref.cols} at ${viewport}`);
  }
  return findings;
}

/**
 * Guard a responsive reference before anything is compared against it.
 *
 * Two failures this closes, both of which used to end in a green run:
 *
 *   1. The reference file does not exist. The old script did `JSON.parse(readFileSync(...))`
 *      one line ABOVE the friendly "run reference first" message, so the message was dead
 *      code and the operator got an ENOENT stack trace instead.
 *   2. The reference was recorded against the SAME host now being judged. Running
 *      `--mode reference` at the client by mistake overwrites the demo's reference with the
 *      client's own behaviour — after which every compare passes, forever, silently. The
 *      reference has always carried `meta.host`; nothing ever read it.
 */
export function checkReference(reference, { host, exists }) {
  if (!exists) return "no responsive reference found — run --mode reference against the DEMO first";
  if (!reference || !reference.blocks || !Object.keys(reference.blocks).length)
    return "the responsive reference has no blocks — run --mode reference against the DEMO first";
  const refHost = reference.meta?.host;
  if (refHost && refHost === host)
    return `the reference was recorded against ${refHost}, which is the host being judged — ` +
      `comparing a site to itself always passes. Re-record it against the DEMO.`;
  return null;
}

// ---------------------------------------------------------------------------
// Pixel diff — the same page before and after
// ---------------------------------------------------------------------------

// 0.5% of pixels. Calibrated the way qa-scans.md demands: two consecutive renders of an
// unchanged page are not bit-identical — antialiased text, a lazy image that lands one frame
// later and a CSS animation mid-flight each move a few thousand pixels on a 1440×6000 page
// (~0.1-0.3%). Below 0.5% is render noise; above it something on the page moved.
export const PIXEL_DIFF_THRESHOLD_PCT = 0.5;

/**
 * Turn a raw changed-pixel count into a verdict.
 *
 * `dimsChanged` is separate from the percentage on purpose: when the page's height changes,
 * the two images cannot be compared pixel-for-pixel at all, and a percentage computed over
 * the overlapping region would understate a page that grew a whole missing section. A size
 * change is its own, louder finding.
 */
export function judgePixelDiff({ changed, total, dimsChanged, before, after }, threshold = PIXEL_DIFF_THRESHOLD_PCT) {
  if (dimsChanged)
    return {
      ok: false,
      pct: null,
      what: `page size changed ${before.width}×${before.height} → ${after.width}×${after.height}px ` +
        `— the images do not describe the same page`,
    };
  const pct = total ? (changed / total) * 100 : 0;
  const rounded = Math.round(pct * 1000) / 1000;
  return {
    ok: pct <= threshold,
    pct: rounded,
    what: `${rounded}% of pixels changed (${changed}/${total}, threshold ${threshold}%)`,
  };
}
