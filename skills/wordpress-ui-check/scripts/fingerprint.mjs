// What "the same thing" means across two runs, for a page and for a finding.
//
// This whole skill's memory rests on one question: is what I am looking at now the thing I looked
// at last time? Answer it well and a second review costs seconds, keeps every decision the person
// already made, and re-asks only about what actually changed. Answer it badly and either the
// review forgets everything (worthless) or it remembers a fault the person fixed (worse — it
// teaches them the review is lying).
//
// Two fingerprints, deliberately different in what they are sensitive to.
//
// A PAGE fingerprint is taken from raw HTML fetched over plain HTTP, never from a rendered DOM.
// That is the whole point of it: re-checking twenty pages has to cost a few seconds, and rendering
// them in a browser would cost the minutes the full review costs. So it hashes what a fetch can
// see — the page's own words, with the markup, the scripts and the styling taken out.
//
// A FINDING fingerprint is taken from what the finding POINTS AT, not from everything around it.
// It is the address of the block plus the first words in it plus which check fired. That coarseness
// is chosen: hashing a section's whole text would resurrect an ignored finding because somebody
// fixed a comma three paragraphs below it, and a review that re-asks about settled things is one
// nobody finishes twice.

import { createHash } from "node:crypto";

/** Half a SHA-256 is 64 bits of collision resistance against content nobody is attacking. */
const digest = (s) => `sha256:${createHash("sha256").update(s).digest("hex").slice(0, 16)}`;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", apos: "'" };

/**
 * The words a reader would see, as close as a regex gets without a browser.
 *
 * Everything removed here is removed because it changes without the page changing. `<script>`
 * carries nonces and cache-busting query strings; `<style>` carries generated class names; a
 * comment carries a plugin's build stamp; `<svg>` carries path data nobody reads. What survives is
 * prose, and prose is what "did this page change" is asking about.
 *
 * Lowercased and whitespace-collapsed so that a re-indent or a change of case in a heading is not
 * a change. It is not exact — an alt attribute is text a reader sees and this drops it. The cost of
 * being wrong is bounded and one-directional: a fingerprint that flips when nothing changed makes
 * the skill re-scan one page it did not need to, which is seconds. A fingerprint that fails to flip
 * would leave a page reviewed against yesterday's content, so anything doubtful is left IN.
 */
export function visibleText(html) {
  return String(html ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * One page's content, as a string that changes when the content does.
 *
 * A header and a footer are part of it, and that is correct rather than sloppy: a phone number
 * changing in the footer changes every page, and every page's findings genuinely do deserve
 * another look after that.
 */
export function pageFingerprint(html) {
  return digest(visibleText(html));
}

/**
 * One finding's identity: where it is, what fired, and what was there.
 *
 * `selectors` are the css paths of the blocks named in the finding — an address that survives a
 * reload, which a block id does not. `hint` is the handful of words the capture recorded for those
 * blocks; it is what makes an edited block read as a new finding, and it is short (forty
 * characters, as captured) on purpose.
 *
 * The viewport is part of the identity because the skill treats it that way everywhere else: text
 * too small at 390px and text too small everywhere are two different findings, and merging them
 * would let a decision made about the phone silently settle the desktop.
 */
export function findingFingerprint({ page, checkId, viewport, selectors = [], hint = "" }) {
  const parts = [
    page ?? "",
    checkId ?? "",
    viewport ?? "desktop",
    [...selectors].sort().join(","),
    String(hint).replace(/\s+/g, " ").trim().toLowerCase()
  ];
  return digest(parts.join("|"));
}

/**
 * What two reads of one page say about whether it changed.
 *
 * A page read twice can disagree with itself. Measured on juneflower on 2026-08-21: a WooCommerce
 * product page prints a different breadcrumb on consecutive reads of the same untouched page,
 * because the product sits in several categories and the theme picks one. Calling that "changed"
 * puts a false sentence in front of the customer — "1 page changed" on a site nobody has touched.
 *
 * So a difference has to hold still to count. Two reads that agree on something new mean the page
 * settled: changed. Two reads that disagree mean the page rotates: unstable, which is re-opened
 * anyway because a real edit could be hiding under the rotation, but never counted as a change.
 */
export function classifyReread(stored, first, second) {
  if (first === stored) return "unchanged";
  if (second === null || second === undefined) return "unstable";
  return first === second ? "changed" : "unstable";
}
