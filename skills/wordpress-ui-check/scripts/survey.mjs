// Which pages are worth looking at, which Preview of the site to look at, and is this even WordPress.
//
// A thousand-page WordPress site is not a thousand designs. It is seven or eight templates with
// different words poured into them, plus a handful of pages somebody built by hand. Layout faults
// live in the template, so looking at one page per template sees almost everything for almost
// nothing — and the pages built by hand are the ones that have to be looked at individually,
// because each is its own arrangement.
//
// Grouping is done by what WordPress stamps on the body element, never by guessing from the url.
// A shop calls its cart /gio-hang/ in Vietnamese and /warenkorb/ in German; the body class says
// `woocommerce-cart` in both.
//
// Two jobs, and the second one only exists on a site that has been reviewed before. Given
// `--since <review.json>` this stops asking "which pages exist" and asks "which of the pages I
// already reviewed have changed" — twenty plain fetches, a few seconds, against the minutes a full
// capture costs. Everything unchanged keeps the decisions somebody already made about it.
//
// Usage: node survey.mjs --site <url> [--out survey.json] [--target auto|preview|live|<url>]
//        node survey.mjs --site <url> --since <review.json> [--out survey.json]

import { writeFileSync, readFileSync, existsSync } from "node:fs";

import { classifyReread, pageFingerprint } from "./fingerprint.mjs";
import { looksLikeSnapshotShell, onTarget, pageUrl, pathOf, resolveTarget } from "./target.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

const SITE = arg("site");
const OUT = arg("out", "survey.json");
/** The copy to read. `auto` prefers the Preview the app's preview shows — see target.mjs. */
const TARGET = arg("target", "auto");
const SINCE = arg("since");
const MAX_TEMPLATES = Number(arg("max-templates", 12));
/** A review that opens fifty pages is a crawl again. Beyond this, the extra pages repeat. */
const MAX_PAGES = Number(arg("max-pages", 20));
const UA = "Mozilla/5.0 (compatible; TracyReview/1.0; +https://trytracy.com/bot)";

if (!SITE) {
  process.stderr.write("usage: survey.mjs --site <url> [--out survey.json] [--target auto|preview|live|<url>]\n");
  process.exit(2);
}

const origin = new URL(SITE).origin;

async function get(url, timeoutMs = 15000) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xml,application/json,*/*" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    return res.ok ? { ok: true, status: res.status, url: res.url, text: await res.text() } : { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * WordPress leaves several signatures, and any one of them is enough. Asking for all of them
 * would refuse sites that merely hid one — a headless front end still ships `wp-content` urls,
 * and a security plugin often strips the generator tag while leaving everything else.
 */
function detectWordPress(html, restOk) {
  const signals = [];
  if (/<meta[^>]+name=["']generator["'][^>]+WordPress/i.test(html)) signals.push("generator meta tag");
  if (/\/wp-content\//i.test(html)) signals.push("wp-content asset urls");
  if (/\/wp-includes\//i.test(html)) signals.push("wp-includes asset urls");
  if (/class=["'][^"']*\b(wp-|postid-|page-id-|home\b)/i.test(html)) signals.push("WordPress body classes");
  if (restOk) signals.push("wp-json REST api");
  return signals;
}

/**
 * The template a page was rendered with, read from the body element WordPress writes.
 *
 * Order matters: the most specific claim wins. WooCommerce stamps `woocommerce-cart` AND
 * `page-template-default` on the same cart page, and the first is the one that says what the page
 * is for. `page-id-` and `postid-` come last because they identify one page rather than a family,
 * and treating them as templates would put every page in a group of its own.
 */
const TEMPLATE_RULES = [
  [/\bwoocommerce-checkout\b/, "checkout"],
  [/\bwoocommerce-cart\b/, "cart"],
  [/\bwoocommerce-account\b/, "account"],
  [/\bsingle-product\b/, "product"],
  [/\b(post-type-archive-product|tax-product_cat|woocommerce-shop)\b/, "product-list"],
  [/\bsearch(-results|-no-results)?\b/, "search"],
  [/\berror404\b/, "404"],
  [/\bhome\b(?!page)/, "blog-list"],
  [/\barchive\b/, "archive"],
  [/\bsingle-post\b|\bsingle\b(?!-product)/, "post"],
  [/\bfront-page\b/, "front-page"],
  [/\bpage-template-(?!default)([a-z0-9-]+)/, "custom-template"],
  [/\bpage\b/, "page"]
];

/**
 * The language the site says it is in, from the `lang` attribute WordPress writes on `<html>`.
 *
 * Read here rather than after the capture because it decides what language the REVIEW is written
 * in, and the first sentence of the review is spoken before a single page has been rendered.
 * `vi-VN` and `vi` are the same answer to that question, so only the primary subtag is kept.
 */
function siteLanguage(html) {
  const value = /<html[^>]*\blang=["']([^"']+)["']/i.exec(html)?.[1];
  return value ? value.trim().toLowerCase().split(/[-_]/)[0] : null;
}

function templateOf(html, url) {
  const body = /<body[^>]*class=["']([^"']*)["']/i.exec(html)?.[1]?.toLowerCase() ?? "";
  try {
    if (new URL(url).pathname === "/") return { template: "front-page", bodyClass: body };
  } catch { /* an unparseable url is the caller's problem, not this rule's */ }
  for (const [re, name] of TEMPLATE_RULES) if (re.test(body)) return { template: name, bodyClass: body };
  return { template: "unknown", bodyClass: body };
}

/**
 * Which builder laid a page out, when it says so. This is a note for the report, not a selection
 * rule — see {@link PAGE_SHAPED} for why.
 *
 * The marks are CONTENT elements a builder writes into the body, never assets a theme enqueues
 * site-wide. A first draft matched `js_composer` and the `ux-` class prefix and called 112 of 120
 * juneflower pages hand-built, because Flatsome ships both on every page. Marking almost
 * everything is the same as marking nothing.
 */
const BUILDER_MARKS = [
  [/class=["'][^"']*\bvc_row\b/, "WPBakery"],
  [/class=["'][^"']*\belementor-section\b/, "Elementor"],
  [/class=["'][^"']*\bfl-builder-content\b/, "Beaver Builder"],
  [/class=["'][^"']*\bbrz-section\b/, "Brizy"],
  [/class=["'][^"']*\bux_banner\b/, "UX Builder"],
  [/class=["'][^"']*\bet_pb_section\b/, "Divi"]
];

/**
 * A WordPress **page** is a one-off by definition — that is the difference between a page and a
 * post. Posts and products are poured into a template a thousand at a time, so one sample stands
 * for all of them; pages are arranged individually, so each is its own design and each has to be
 * looked at.
 *
 * This replaces an earlier attempt to spot hand-built pages by their builder's fingerprint. On
 * Flatsome there is no such fingerprint: the theme writes the same classes whether an editor
 * arranged the page or the template did. Asking WordPress what KIND of thing a url is turns out
 * to answer the question the markers could not — and it needs no per-theme table to keep up to
 * date, which is the part that would have rotted.
 *
 * The demo leftovers a half-finished site is full of — /logo/, /price-table/, /message-box/ —
 * are pages, so this catches exactly the rubbish worth catching.
 */
const PAGE_SHAPED = new Set(["front-page", "page", "custom-template"]);

const handBuilt = (html) => BUILDER_MARKS.filter(([re]) => re.test(html)).map(([, n]) => n);

/**
 * Every url discovered is rewritten onto the copy being scanned.
 *
 * A Preview's WordPress publishes its own address in its sitemap and REST api, but not
 * always: a Preview taken from a live site keeps whatever `home_url` it was given, so half a sitemap
 * can point at the live domain while the pages themselves are served from the Preview. Keeping only
 * the path and putting the target's origin in front of it means the review reads one Preview
 * throughout, whatever the site says about itself.
 */
const ontoTarget = (url, target) => {
  try {
    const u = new URL(url);
    return `${target}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
};

async function urlsFromSitemap(target) {
  const seen = new Set();
  const queue = [`${target}/sitemap.xml`, `${target}/sitemap_index.xml`, `${target}/wp-sitemap.xml`];
  const urls = [];
  while (queue.length > 0 && urls.length < 3000) {
    const at = queue.shift();
    if (seen.has(at)) continue;
    seen.add(at);
    const res = await get(at);
    if (!res.ok) continue;
    const isIndex = /<sitemapindex/i.test(res.text);
    for (const m of res.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const loc = ontoTarget(m[1], target);
      if (!loc) continue;
      if (isIndex) queue.push(loc);
      else urls.push(loc);
    }
  }
  return [...new Set(urls)];
}

/** WordPress publishes its own page list, and it is the cleanest source of the hand-built ones. */
async function urlsFromRest(target) {
  const out = [];
  for (const kind of ["pages", "posts"]) {
    const res = await get(`${target}/wp-json/wp/v2/${kind}?per_page=100&_fields=link`);
    if (!res.ok) continue;
    try {
      for (const item of JSON.parse(res.text)) {
        const link = ontoTarget(item?.link ?? "", target);
        if (link) out.push(link);
      }
    } catch { /* a REST api that answers with something other than json tells us nothing */ }
  }
  return out;
}

/** Shallow first, then whatever is left, so a sample favours pages a visitor actually reaches. */
const byDepth = (a, b) => {
  const d = (u) => new URL(u).pathname.split("/").filter(Boolean).length;
  return d(a) - d(b) || a.localeCompare(b);
};

const finish = (result, summary) => {
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(summary) + "\n");
};

/**
 * A second look at a site already reviewed: which of the reviewed pages changed?
 *
 * Only those get captured again. Everything else keeps its findings and, more importantly, keeps
 * every decision the person made about them — which is the difference between a review they can
 * finish over two sittings and one that starts from nothing each time.
 *
 * A page that has stopped answering is reported as `gone` rather than as unchanged. Silently
 * treating a 404 as "nothing to do here" would leave findings standing for a page that no longer
 * exists, which is the quiet way a living document starts lying.
 *
 * A page whose words differ is READ AGAIN before it is called changed, and that is not caution for
 * its own sake. Measured on juneflower on 2026-08-21: a WooCommerce product page names a different
 * category in its breadcrumb on consecutive reads of the same unchanged page, because the product
 * sits in several categories and the theme picks one of them. Without the second read the review
 * would announce "1 page changed" on a site where nobody had touched anything, which is a false
 * sentence in front of the customer.
 *
 * Two reads that agree with each other mean the page settled on something new: genuinely changed.
 * Two reads that disagree mean the page rotates, so it is re-captured anyway (a real edit could be
 * hiding under the rotation) but reported apart from the changed ones and its stored fingerprint is
 * left alone — overwriting it with one of two rotating values only guarantees the same argument
 * next time.
 */
async function recheck(target) {
  const prior = JSON.parse(readFileSync(SINCE, "utf8"));
  const changed = [];
  const unchanged = [];
  const unstable = [];
  const gone = [];

  for (const page of prior.pages ?? []) {
    const url = pageUrl(onTarget(`${origin}${page.url}`, origin, target.url), target);
    const res = await get(url, 12000);
    if (!res.ok) {
      gone.push({ url: page.url, status: res.status });
      continue;
    }
    const fingerprint = pageFingerprint(res.text);
    let again = null;
    if (fingerprint !== page.fingerprint) {
      const confirm = await get(url, 12000);
      again = confirm.ok ? pageFingerprint(confirm.text) : null;
    }
    const verdict = classifyReread(page.fingerprint, fingerprint, again);
    if (verdict === "unchanged") unchanged.push({ url: page.url, scanUrl: url, fingerprint });
    else if (verdict === "changed") changed.push({ url: page.url, scanUrl: url, fingerprint });
    // Its stored fingerprint is left alone: overwriting it with one of two rotating values only
    // guarantees the same argument next time.
    else unstable.push({ url: page.url, scanUrl: url, fingerprint: page.fingerprint });
    await new Promise((r) => setTimeout(r, 120));
  }

  const result = {
    site: origin,
    mode: "recheck",
    since: SINCE,
    scannedAgainst: target,
    reachable: true,
    isWordPress: true,
    pages: [...changed, ...unstable, ...unchanged],
    changedPages: changed.map((p) => p.url),
    unchangedPages: unchanged.map((p) => p.url),
    // Read twice, disagreed with itself. Re-opened, but never counted as a change.
    unstablePages: unstable.map((p) => p.url),
    missingPages: gone,
    pagesToReview: [...changed, ...unstable].map((p) => p.scanUrl),
    droppedFromReview: 0
  };
  finish(result, {
    site: origin,
    mode: "recheck",
    scannedAgainst: target.kind,
    changed: changed.length,
    unchanged: unchanged.length,
    unstable: unstable.length,
    missing: gone.length,
    pagesToReview: result.pagesToReview.length
  });
}

async function main() {
  const target = await resolveTarget(origin, TARGET, get);
  if (target.kind === "unreachable") {
    // Asked for by name and not there: say which address was tried, because the usual cause is a
    // copy that has not been provisioned yet and the address is the thing to check.
    process.stderr.write(`${target.error}\n`);
    finish({ site: origin, reachable: false, scannedAgainst: target }, { site: origin, error: target.error });
    process.exit(2);
  }

  if (SINCE && existsSync(SINCE)) return recheck(target);

  const scan = target.url;
  const home = await get(pageUrl(`${scan}/`, target));
  if (!home.ok) {
    const result = { site: origin, scannedAgainst: target, reachable: false };
    finish(result, { site: origin, reachable: false, isWordPress: false });
    return;
  }

  const rest = await get(`${scan}/wp-json/`);
  const signals = detectWordPress(home.text, rest.ok);
  if (signals.length === 0) {
    const result = { site: origin, scannedAgainst: target, reachable: true, isWordPress: false, signals: [] };
    finish(result, result);
    return;
  }

  // The address answered, it looks like WordPress, and it is still not the site: a Preview
  // wraps the site in a frame, and reviewing the wrapper would report twenty identical empty
  // pages. Refuse rather than measure the furniture.
  if (looksLikeSnapshotShell(home.text)) {
    const error = `${scan} is serving the Tracy snapshot shell rather than the site itself. The address that reaches the page inside it has changed; this skill cannot read the copy until it is updated.`;
    process.stderr.write(`${error}\n`);
    finish({ site: origin, scannedAgainst: target, reachable: true, error }, { site: origin, error });
    process.exit(2);
  }

  const candidates = [
    ...new Set([`${scan}/`, ...(await urlsFromRest(scan)), ...(await urlsFromSitemap(scan))])
  ].sort(byDepth);

  // Fetching every candidate would cost as much as the crawl this skill exists to avoid, so the
  // survey reads a shallow slice and lets the template groups fall out of it.
  const LOOK_AT = 120;
  const groups = new Map();
  const standalone = [];
  const looked = [];
  // Taken here rather than at capture time on purpose: this is the hash a later run recomputes with
  // twenty plain fetches, so it has to be something a plain fetch can see.
  const fingerprints = new Map([[`${scan}/`, pageFingerprint(home.text)]]);

  let unreadable = 0;
  for (const url of candidates.slice(0, LOOK_AT)) {
    const res = url === `${scan}/` ? home : await get(pageUrl(url, target), 12000);
    if (!res.ok) continue;
    const { template, bodyClass } = templateOf(res.text, res.url || url);
    const builders = handBuilt(res.text);
    // WordPress stamps a class on every body element it renders. A page without one is not a page
    // this skill can group, and a run where most of them lack one is a run reading something other
    // than the site — which is exactly what a wrapper, a login wall or a cache page looks like.
    if (!bodyClass) unreadable += 1;
    looked.push(url);
    fingerprints.set(url, pageFingerprint(res.text));
    if (!groups.has(template)) groups.set(template, { template, count: 0, sample: url, bodyClass });
    groups.get(template).count += 1;
    if (PAGE_SHAPED.has(template)) standalone.push({ url, template, builders });
    if (res !== home) await new Promise((r) => setTimeout(r, 250));
  }

  if (looked.length >= 5 && unreadable > looked.length / 2) {
    const error = `${unreadable} of the ${looked.length} pages read at ${scan} carry no WordPress body class, so this is not the site itself — a wall, a cache page or a wrapper is being served instead. Nothing was reviewed.`;
    process.stderr.write(`${error}\n`);
    finish({ site: origin, scannedAgainst: target, reachable: true, isWordPress: true, error, inspected: looked.length }, { site: origin, error });
    process.exit(2);
  }

  const templates = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, MAX_TEMPLATES);
  // Template samples first: each stands for many pages, so it earns its slot before any single
  // standalone page does.
  const wanted = [...new Set([...templates.map((t) => t.sample), ...standalone.map((p) => p.url)])];
  const pages = wanted.slice(0, MAX_PAGES);
  const dropped = wanted.length - pages.length;

  const result = {
    site: origin,
    mode: "full",
    // Which Preview this review read, carried into review.json and printed at the top of the report.
    // A review that does not say this describes one version while the reader looks at another.
    scannedAgainst: target,
    reachable: true,
    isWordPress: true,
    signals,
    // What the site speaks. The review is written in this, not in whatever language the request
    // happened to arrive in — see SKILL.md.
    language: siteLanguage(home.text),
    discovered: candidates.length,
    inspected: looked.length,
    templates,
    standalonePages: standalone,
    // Paths rather than addresses, because a finding filed against `/contact/` survives the review
    // moving between the Preview and the live site; an address does not.
    pages: pages.map((url) => ({ url: pathOf(url), scanUrl: pageUrl(url, target), fingerprint: fingerprints.get(url) ?? null })),
    pagesToReview: pages.map((url) => pageUrl(url, target)),
    // Said out loud rather than trimmed in silence: a reader deserves to know the review looked at
    // a slice, and how big the slice was.
    droppedFromReview: dropped
  };
  finish(result, {
    site: result.site,
    scannedAgainst: `${target.kind}${target.kind === "preview" ? ` ${target.url}` : ""}`,
    isWordPress: true,
    discovered: result.discovered,
    inspected: result.inspected,
    templates: templates.length,
    standalonePages: standalone.length,
    pagesToReview: pages.length,
    droppedFromReview: dropped
  });
}

main().catch((e) => {
  process.stderr.write(`survey failed: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
