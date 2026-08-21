// Which pages are worth looking at, and is this even WordPress.
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
// Usage: node survey.mjs --site <url> [--out survey.json] [--max-templates 12]

import { writeFileSync } from "node:fs";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

const SITE = arg("site");
const OUT = arg("out", "survey.json");
const MAX_TEMPLATES = Number(arg("max-templates", 12));
/** A review that opens fifty pages is a crawl again. Beyond this, the extra pages repeat. */
const MAX_PAGES = Number(arg("max-pages", 20));
const UA = "Mozilla/5.0 (compatible; TracyReview/1.0; +https://trytracy.com/bot)";

if (!SITE) {
  process.stderr.write("usage: survey.mjs --site <url> [--out survey.json]\n");
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

async function urlsFromSitemap() {
  const seen = new Set();
  const queue = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];
  const urls = [];
  while (queue.length > 0 && urls.length < 3000) {
    const at = queue.shift();
    if (seen.has(at)) continue;
    seen.add(at);
    const res = await get(at);
    if (!res.ok) continue;
    const isIndex = /<sitemapindex/i.test(res.text);
    for (const m of res.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const loc = m[1];
      if (isIndex) queue.push(loc);
      else if (loc.startsWith(origin)) urls.push(loc);
    }
  }
  return [...new Set(urls)];
}

/** WordPress publishes its own page list, and it is the cleanest source of the hand-built ones. */
async function urlsFromRest() {
  const out = [];
  for (const kind of ["pages", "posts"]) {
    const res = await get(`${origin}/wp-json/wp/v2/${kind}?per_page=100&_fields=link`);
    if (!res.ok) continue;
    try {
      for (const item of JSON.parse(res.text)) if (item?.link?.startsWith(origin)) out.push(item.link);
    } catch { /* a REST api that answers with something other than json tells us nothing */ }
  }
  return out;
}

/** Shallow first, then whatever is left, so a sample favours pages a visitor actually reaches. */
const byDepth = (a, b) => {
  const d = (u) => new URL(u).pathname.split("/").filter(Boolean).length;
  return d(a) - d(b) || a.localeCompare(b);
};

async function main() {
  const home = await get(`${origin}/`);
  if (!home.ok) {
    writeFileSync(OUT, JSON.stringify({ site: origin, reachable: false }, null, 2));
    process.stdout.write(JSON.stringify({ site: origin, reachable: false, isWordPress: false }) + "\n");
    return;
  }

  const rest = await get(`${origin}/wp-json/`);
  const signals = detectWordPress(home.text, rest.ok);
  if (signals.length === 0) {
    const result = { site: origin, reachable: true, isWordPress: false, signals: [] };
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }

  const candidates = [...new Set([`${origin}/`, ...(await urlsFromRest()), ...(await urlsFromSitemap())])].sort(byDepth);

  // Fetching every candidate would cost as much as the crawl this skill exists to avoid, so the
  // survey reads a shallow slice and lets the template groups fall out of it.
  const LOOK_AT = 120;
  const groups = new Map();
  const standalone = [];
  const looked = [];

  for (const url of candidates.slice(0, LOOK_AT)) {
    const res = await get(url, 12000);
    if (!res.ok) continue;
    const { template, bodyClass } = templateOf(res.text, res.url || url);
    const builders = handBuilt(res.text);
    looked.push(url);
    if (!groups.has(template)) groups.set(template, { template, count: 0, sample: url, bodyClass });
    groups.get(template).count += 1;
      if (PAGE_SHAPED.has(template)) standalone.push({ url, template, builders });
    await new Promise((r) => setTimeout(r, 250));
  }

  const templates = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, MAX_TEMPLATES);
  // Template samples first: each stands for many pages, so it earns its slot before any single
  // standalone page does.
  const wanted = [...new Set([...templates.map((t) => t.sample), ...standalone.map((p) => p.url)])];
  const pages = wanted.slice(0, MAX_PAGES);
  const dropped = wanted.length - pages.length;

  const result = {
    site: origin,
    reachable: true,
    isWordPress: true,
    signals,
    discovered: candidates.length,
    inspected: looked.length,
    templates,
    standalonePages: standalone,
    pagesToReview: pages,
    // Said out loud rather than trimmed in silence: a reader deserves to know the review looked at
    // a slice, and how big the slice was.
    droppedFromReview: dropped
  };
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  process.stdout.write(
    JSON.stringify({
      site: result.site,
      isWordPress: true,
      discovered: result.discovered,
      inspected: result.inspected,
      templates: templates.length,
      standalonePages: standalone.length,
      pagesToReview: pages.length,
      droppedFromReview: dropped
    }) + "\n"
  );
}

main().catch((e) => {
  process.stderr.write(`survey failed: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
