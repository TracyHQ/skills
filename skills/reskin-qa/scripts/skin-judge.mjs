// skin-judge.mjs — the verdicts behind `skin-diff`, kept free of any DOM or image so the
// test suite can reach them. `skin-diff.mjs` renders and measures; this file decides.
//
// WHY THIS COMPARISON IS NOT A PIXEL DIFF
//
// A dressed client page and the demo it was dressed from share a template and nothing else:
// different copy, different photographs, four pricing tiers where the demo has three. Diff
// them pixel for pixel and you get "99.4% changed" on a perfect dressing and "99.1% changed"
// on a broken one. The number is real and it answers no question anybody has.
//
// What CAN be compared is what the dressing was supposed to carry over: the template's
// palette, its type, and the container bands its layout is built on. Those are properties of
// the mold, and content cannot legitimately change them. The same discipline as the
// responsive tier, applied to appearance: compare what the demo defines, never what the
// content decides.

/** Squared euclidean distance in RGB. Cheap, and adequate for "is this the same brand red". */
function colourDistance(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

// 40 per channel, squared and summed. Wide enough to survive a theme's own hover/tint
// variants and a screenshot's colour management; narrow enough that a different brand blue
// is a different colour.
const SAME_COLOUR = 3 * 40 * 40;

/**
 * How much of the demo's palette the dressed page actually wears.
 *
 * Both palettes are lists of `{ rgb, share }` ordered by painted area. A colour counts as
 * carried over when the dressed page paints something within SAME_COLOUR of it — anywhere in
 * its palette, not at the same rank: a client whose photography is darker legitimately shifts
 * every share without losing a single colour.
 */
export function paletteCarryOver(refPalette, ownPalette) {
  const top = refPalette.slice(0, 5);
  if (!top.length) return { carried: 1, missing: [] };
  const missing = [];
  let weight = 0, carriedWeight = 0;
  for (const c of top) {
    weight += c.share;
    if (ownPalette.some((o) => colourDistance(o.rgb, c.rgb) <= SAME_COLOUR)) carriedWeight += c.share;
    else missing.push(c);
  }
  return { carried: weight ? carriedWeight / weight : 1, missing };
}

// Below this share of the demo's palette, the page is not wearing the demo's skin — some
// stylesheet did not land, or the template fell back to its unstyled default. Calibrated
// against the one thing that must not fail: a correct dressing whose photography differs
// wholesale still carries chrome, headings, buttons and background, which is well over half
// the painted weight.
export const PALETTE_FLOOR = 0.6;

/**
 * Judge one page × viewport of skin signatures against the demo's.
 *
 * Levels follow the same rule as every other gate here: FAIL is reserved for what the demo
 * DEFINES and the dress must therefore carry (its palette, its typeface, its container
 * bands). Everything content can legitimately move is a warn, so the report stays readable.
 */
export function judgeSkin({ sig, ref, viewport, path }) {
  const findings = [];
  const add = (level, what) => findings.push({ path, viewport, level, what });

  const hex = (rgb) => "#" + rgb.map((n) => n.toString(16).padStart(2, "0")).join("");

  const { carried, missing } = paletteCarryOver(ref.palette || [], sig.palette || []);
  if (carried < PALETTE_FLOOR)
    add("FAIL",
      `palette: only ${Math.round(carried * 100)}% of the demo's is on the page ` +
      `(missing ${missing.map((c) => hex(c.rgb)).join(", ")}) — a stylesheet did not land`);
  else if (missing.length)
    add("warn", `palette: ${missing.map((c) => hex(c.rgb)).join(", ")} from the demo is absent`);

  // The typeface is the loudest single signal that a dressing did not take: a page that fell
  // back to the browser's default serif looks wrong from across the room and passes every
  // geometry gate ever written.
  if (ref.fontFamily && sig.fontFamily && ref.fontFamily !== sig.fontFamily)
    add("FAIL", `type: body is ${sig.fontFamily}, the demo's is ${ref.fontFamily}`);

  if (ref.headingRatio && sig.headingRatio) {
    const drift = Math.abs(sig.headingRatio - ref.headingRatio) / ref.headingRatio;
    if (drift > 0.25)
      add("warn", `type scale: heading/body ratio ${sig.headingRatio} vs the demo's ${ref.headingRatio}`);
  }

  // Container bands: the fractions of the viewport that the template's sections occupy. A
  // dressed page that lost its wrapper renders every section at 100% — arranged validly, and
  // wrong. Content changes what is INSIDE a band, never which bands exist.
  //
  // The FAIL is judged over the CONSTRAINED bands only. Every template has a full-bleed 100%
  // band somewhere, so a page whose wrapper vanished entirely still shares that one with the
  // demo — measuring "did any band survive" would have made the failure unreachable. What
  // says the wrapper is gone is that none of the demo's sub-100% containers are left.
  const refBands = new Set(ref.bands || []);
  const ownBands = new Set(sig.bands || []);
  const lost = [...refBands].filter((b) => !ownBands.has(b));
  const constrained = [...refBands].filter((b) => b < 95);
  if (constrained.length && constrained.every((b) => !ownBands.has(b)))
    add("FAIL",
      `layout: none of the demo's container bands (${constrained.join("%, ")}%) survive — ` +
      `every section runs full width, so the wrapper is gone`);
  else if (lost.length)
    add("warn", `layout: container band(s) ${lost.join("%, ")}% from the demo are unused here`);

  return findings;
}

/**
 * Pair the demo's pages with the client's by POSITION in each --pages list.
 *
 * There is no way to derive the pairing: the demo's `/features` becomes the client's
 * `/what-we-do`, and only the mapping knows that. Position is what the reskin pipeline
 * already encodes, so position is what this uses — and the run PRINTS every pair it formed,
 * because a silently misaligned pairing produces a confident report about the wrong two
 * pages.
 */
export function pairPages(refPaths, ownPaths) {
  const n = Math.min(refPaths.length, ownPaths.length);
  const pairs = [];
  for (let i = 0; i < n; i++) pairs.push({ ref: refPaths[i], own: ownPaths[i] });
  return {
    pairs,
    unpaired: [
      ...refPaths.slice(n).map((p) => ({ side: "demo", path: p })),
      ...ownPaths.slice(n).map((p) => ({ side: "dressed", path: p })),
    ],
  };
}
