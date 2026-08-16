#!/usr/bin/env node
/**
 * Draft the artifact map. A person corrects it; `apply-map.sh` refuses to run without it.
 *
 *   propose-map.mjs --client out/inventory-client.json --demo out/inventory-demo.json \
 *                   [--language fr-FR] > out/artifact-map.json
 *
 * ## What it does, and what it cannot
 *
 * It orders client categories by article count, orders demo slots by appetite, and pairs them in
 * that order. That is mechanical, and every row says so in `why` — the draft is meant to be read
 * and moved, not trusted.
 *
 * 🔒 Pairing by NAME was tried first and matched 0 of 5 on the fixture: a template says
 * `news-health`, a site says `Learner Stories`. Nothing but a reader connects those, so this does
 * not pretend to. See references/artifact-map.md for the three things it is reliably wrong about.
 */

import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const clientPath = flag('--client');
const demoPath = flag('--demo');
if (!clientPath || !demoPath) {
  console.error('need --client <inventory-client.json> --demo <inventory-demo.json>');
  process.exit(2);
}

const client = JSON.parse(await readFile(clientPath, 'utf8'));
const demo = JSON.parse(await readFile(demoPath, 'utf8'));

/**
 * One language per run.
 *
 * 🔒 The fixture had `*` 12 / `fr-FR` 10 / `en-GB` 6 against a single-language demo. Mapping all
 * three produces a front page where a third of the blocks are in a language the visitor did not
 * choose. Default to the one with the most articles of its own; `*` is not a language, it is
 * "shows in all of them", so it never wins the choice but always joins the winner.
 */
const named = (client.languages ?? []).filter((l) => l.language !== '*');
const LANGUAGE = flag('--language') ?? (named[0]?.language ?? '*');

const flagged = (cat) => cat.language === LANGUAGE || cat.language === '*';

/**
 * How many of a category's articles this run can actually copy.
 *
 * 🔒 Not `cat.articles`. The fixture's "Our Blog" is flagged en-GB and holds four fr-FR articles;
 * counting the category's own total promised a block four articles and delivered none, because
 * apply-map selects on the article's language — correctly. The category's flag says nothing about
 * what is inside it.
 *
 * `*` counts: Joomla means "shows in every language" by it.
 */
const inLanguage = (cat) => {
  const by = cat.by_language;
  if (!by) return cat.articles; // inventory from before this was recorded
  return (by[LANGUAGE] ?? 0) + (by['*'] ?? 0);
};

/**
 * A category qualifies as a source only if it holds articles this run can copy.
 *
 * 🔒 Both halves are needed and they disagree on the fixture: "Our Blog" is flagged en-GB (passes
 * the label test) and holds nothing but fr-FR articles (fails this one). Offered as a source it
 * produced a block promising four articles and rendering none.
 */
const usable = (cat) => flagged(cat) && inLanguage(cat) > 0;

const categories = (client.categories ?? [])
  .filter(usable)
  .sort((a, b) => inLanguage(b) - inLanguage(a));

// Slots come pre-sorted by appetite from inventory-demo, but sort again so this script does not
// depend on that staying true.
const slots = (demo.slots ?? []).slice().sort((a, b) => b.wants - a.wants);

const rows = [];
let next = 0;

for (const slot of slots) {
  const cat = categories[next];

  if (!cat) {
    // Out of client categories. Everything after this point is a decision the mapper makes:
    // generate content for the block, or admit the client has nothing for it. The draft proposes
    // `empty` because it is the reversible one — turning `empty` into `generated` costs nothing,
    // while deleting generated content costs a run.
    rows.push({
      position: slot.position,
      module: slot.module,
      block: slot.block ?? null,
      wants: slot.wants,
      fill: 'empty',
      source: null,
      generate: 0,
      why: 'no client category left — decide: generate, or leave this block off'
    });
    continue;
  }

  next += 1;
  const short = Math.max(0, slot.wants - inLanguage(cat));
  rows.push({
    position: slot.position,
    module: slot.module,
    block: slot.block ?? null,
    wants: slot.wants,
    fill: short > 0 ? 'mixed' : 'client',
    source: { type: 'category', id: cat.id, title: cat.title,
              articles: inLanguage(cat), articles_all_languages: cat.articles },
    generate: short,
    why:
      short > 0
        ? `category #${next} by size; block wants ${slot.wants}, category has ${inLanguage(cat)} in ${LANGUAGE}`
        : `category #${next} by size; covers the block's ${slot.wants}`
  });
}

const totals = {
  slots: rows.length,
  from_client: rows.filter((r) => r.fill === 'client').length,
  mixed: rows.filter((r) => r.fill === 'mixed').length,
  empty: rows.filter((r) => r.fill === 'empty').length,
  articles_to_generate: rows.reduce((n, r) => n + r.generate, 0),
  // Both numbers, because they disagree and the disagreement is the point: `distinct_images` is
  // what the demo's blocks consume, `articles_with_image` is what a SQL count flatters you with.
  client_images: client.totals?.distinct_images ?? 0,
  client_articles: client.totals?.articles ?? 0
};

console.log(
  JSON.stringify(
    {
      client: client.client,
      demo: demo.demo,
      language: LANGUAGE,
      slots: rows,
      totals,
      note:
        'Draft. Every `why` is mechanical — read against the client digest and move rows before ' +
        'applying. `apply-map.sh` rejects a row with an empty `why`.'
    },
    null,
    2
  )
);
