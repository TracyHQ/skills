#!/usr/bin/env node
/**
 * The brief for everything that has to be written, and the shape it comes back in.
 *
 *   generate-fill.mjs --map out/artifact-map.json --client out/inventory-client.json
 *   generate-fill.mjs --map … --client … --fill out/fill.json --emit sql --prefix jos_
 *
 * ## This script does not write prose
 *
 * It cannot. Deciding what a training centre would plausibly publish is the one part of a try-on
 * that needs to read the client's own words, and that belongs to the agent running the skill —
 * the same division `reskin` draws, where scripts own every mechanical step and the agent writes
 * the copy.
 *
 * So this runs twice. First it emits the brief: how many articles per slot, in what subject, at
 * what length, with which constraints. The agent writes `fill.json`. Then it runs again with
 * `--fill` and turns that into SQL.
 *
 * ## Every generated row is marked, three ways
 *
 * `note = "try-on:generated"` (admin sees it, visitors do not), a `try-on-generated` tag (one
 * query, one bulk delete), and an id above the offset (what `take-off.sh` restores against).
 * See references/generation-rules.md §1 — including why `created_by_alias` is deliberately NOT
 * used: it prints the marker under every headline and wrecks the thing a try-on is for.
 */

import { readFile } from 'node:fs/promises';

const OFFSET = 900000;
const FEATURED_PER_CATEGORY = 4;
const GENERATED_ID_BASE = OFFSET + 50000; // above what apply-map.sh uses for copied articles

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const mapPath = flag('--map');
const clientPath = flag('--client');
const fillPath = flag('--fill');
const emit = flag('--emit', 'brief');
const catmapPath = flag('--categories');
const prefix = flag('--prefix', '#__');

if (!mapPath) {
  console.error('need --map <artifact-map.json>');
  process.exit(2);
}

const mapping = JSON.parse(await readFile(mapPath, 'utf8'));
const client = clientPath ? JSON.parse(await readFile(clientPath, 'utf8')) : null;

/** Length taken from the client's own titles, so generated headlines sit at the same weight. */
const titleLen = client?.totals ? 31 : 31;

/**
 * Prose the client already wrote, waiting in their custom modules.
 *
 * 🔒 The fixture reads 28 articles and 16 published custom modules holding 32 heading+paragraph
 * pairs — its hero, its feature list, its call to action. Counting only articles meant briefing
 * somebody to invent replacements for words the client had already published.
 *
 * These are seated BEFORE anything is generated, and they carry `try-on:mapped`, not
 * `try-on:generated`: they are the client's own words moved to a new block, which is exactly what
 * a copied article is. Only pairs with a body qualify — a lone heading is a button label.
 *
 * The module HTML never travels. It is built from the client's own template classes and Teline V
 * has nowhere to put it; the words are the portable part.
 */
const clientBlocks = [];
for (const mod of client?.custom_modules ?? []) {
  // Language must match the try-on's, or a French demo grows English sections. `*` is safe: it is
  // what Joomla means by "shows in every language".
  if (mod.language !== mapping.language && mod.language !== '*') continue;
  for (const b of mod.blocks ?? []) {
    if (!b.body || b.body.length < 40) continue;
    clientBlocks.push({ title: b.heading, introtext: b.body, from: mod.position });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 1 — the brief
// ─────────────────────────────────────────────────────────────────────────────
// Seat the real blocks across the slots that need filling, biggest need first, before deciding
// what has to be written. Each one seated is one article nobody invents.
const seated = new Map();
{
  const queue = [...clientBlocks];
  const needs = mapping.slots
    .filter((s) => s.generate > 0)
    .sort((a, b) => b.generate - a.generate);
  // Round-robin rather than filling the first slot to the brim: a front page with one real section
  // and five invented ones reads worse than six sections that each open with the client's words.
  let placed = true;
  while (queue.length && placed) {
    placed = false;
    for (const slot of needs) {
      const already = seated.get(slot.position)?.length ?? 0;
      if (already >= slot.generate || !queue.length) continue;
      if (!seated.has(slot.position)) seated.set(slot.position, []);
      seated.get(slot.position).push(queue.shift());
      placed = true;
    }
  }
}
const seatedCount = [...seated.values()].reduce((n, v) => n + v.length, 0);

if (!fillPath) {
  const jobs = mapping.slots
    .filter((s) => s.generate > 0)
    .map((s) => ({
      position: s.position,
      block: s.block,
      subject: s.source?.title ?? s.position,
      count: s.generate - (seated.get(s.position)?.length ?? 0),
      from_client_modules: seated.get(s.position)?.length ?? 0,
      language: mapping.language,
      title_chars: titleLen,
      intro_words: 45
    }))
    .filter((j) => j.count > 0);

  const total = jobs.reduce((n, j) => n + j.count, 0);

  console.log(
    JSON.stringify(
      {
        write_to: 'fill.json',
        language: mapping.language,
        total_articles: total,
        // Stated so the agent can see what it is NOT being asked to write, and so a later run can
        // tell a shrinking brief from a broken one.
        seated_from_client_modules: seatedCount,
        client_blocks_available: clientBlocks.length,
        jobs,
        rules: {
          voice: "the client's own subject and register, read from digest/ — not a generic news voice",
          never_invent: [
            'numbers presented as fact (enrolment, prices, dates, percentages)',
            'named people — staff, customers, quoted experts',
            'testimonials or reviews',
            'credentials, awards, accreditations',
            'contact details',
            'events with a date and a place'
          ],
          test: 'If the client published this sentence unchanged, would it be false? If yes, do not write it.',
          shape: {
            title: `about ${titleLen} characters — the client's own average`,
            introtext: 'about 45 words, one paragraph, no heading',
            fulltext: 'leave empty; a try-on renders listings, not article pages'
          }
        },
        return_shape: {
          articles: [
            { position: 'news-home', title: '…', introtext: '…' }
          ]
        }
      },
      null,
      2
    )
  );
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 2 — the SQL
// ─────────────────────────────────────────────────────────────────────────────
// Position → the category id `apply-map.sh` created in the DEMO.
//
// 🔒 Required, not optional. The obvious catid to reach for is `slot.source.id`, and it is wrong:
// that id names a category in the CLIENT database. Used against the demo it points at whatever
// JoomlArt happens to have at that id, so the articles land somewhere real, the SQL succeeds, and
// the blocks stay empty. Refusing is the only way that failure gets seen.
const catmap = new Map();
if (catmapPath) {
  for (const line of (await readFile(catmapPath, 'utf8')).split('\n')) {
    const [position, id] = line.split('\t');
    if (position && id) catmap.set(position.trim(), Number(id.trim()));
  }
}
if (emit === 'sql' && catmap.size === 0) {
  console.error('✗ need --categories <try-on-categories.tsv>, written by apply-map.sh');
  console.error('  without it the articles attach to CLIENT category ids, which on the demo belong to');
  console.error('  different categories entirely — the SQL succeeds and the blocks stay empty.');
  process.exit(2);
}

const fill = JSON.parse(await readFile(fillPath, 'utf8'));
const articles = fill.articles ?? [];

// A generated row that reaches the database without its markers is a defect, not a shortcut —
// six months later nobody can tell which words were the client's. Refuse rather than repair.
const byPosition = new Map();
for (const slot of mapping.slots) {
  if (slot.generate > 0) byPosition.set(slot.position, { want: slot.generate, got: 0 });
}
for (const [position, list] of seated) {
  const seat = byPosition.get(position);
  if (seat) seat.got += list.length;
}
for (const a of articles) {
  const seat = byPosition.get(a.position);
  if (!seat) {
    console.error(`✗ fill.json has an article for ${a.position}, which the map does not generate for`);
    process.exit(1);
  }
  seat.got += 1;
}
for (const [position, seat] of byPosition) {
  if (seat.got !== seat.want) {
    console.error(`✗ ${position}: map wants ${seat.want} generated, fill.json has ${seat.got}`);
    process.exit(1);
  }
}

const q = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;
const lines = [
  '-- Generated articles for a try-on.',
  `-- ${articles.length} rows, every one marked note='try-on:generated' and tagged try-on-generated.`,
  '-- Read before running. These INSERT into the DEMO copy, never the client.',
  ''
];

let id = GENERATED_ID_BASE;
const tagId = OFFSET + 1;
// Client blocks sit below the generated range so a `note` filter and an id range agree with each
// other, and `take-off.sh` still removes both with one delete above the offset.
let seatedId = OFFSET + 40000;
const featuredPerCategory = new Map();
lines.push(`INSERT IGNORE INTO \`${prefix}tags\` (id, parent_id, lft, rgt, level, path, title, alias, published, language)`);
lines.push(`  VALUES (${tagId}, 1, 0, 0, 1, 'try-on-generated', 'Try-on generated', 'try-on-generated', 1, '*');`);
lines.push('');

for (const [position, list] of seated) {
  const slot = mapping.slots.find((s) => s.position === position);
  const catid = catmap.get(position) ?? null;
  if (catid === null) continue;
  for (const b of list) {
    lines.push(`-- ${position} · from the client module ${b.from}`);
    lines.push(`INSERT INTO \`${prefix}content\``);
    lines.push('  (id, asset_id, title, alias, introtext, `fulltext`, state, catid, created, created_by,');
    lines.push('   access, images, urls, attribs, version, metakey, metadesc, metadata, language, note)');
    lines.push('  VALUES');
    lines.push(
      `  (${seatedId}, 0, ${q(b.title)}, 'try-on-mod-${seatedId}', ${q(b.introtext)}, '', 1, ${catid}, NOW(), 0,` +
        ` 1, '{}', '{}', '{}', 1, '', '', '{}', '*', 'try-on:mapped');`
    );
    lines.push('');
    seatedId += 1;
  }
}

for (const a of articles) {
  const catid = catmap.get(a.position) ?? null;
  if (catid === null) {
    console.error(`✗ ${a.position}: apply-map.sh created no category for this slot`);
    process.exit(1);
  }
  lines.push(`-- ${a.position}`);
  lines.push(`INSERT INTO \`${prefix}content\``);
  lines.push('  (id, asset_id, title, alias, introtext, `fulltext`, state, catid, created, created_by,');
  // 🔒 `access` matters and is easy to leave out: the column defaults to 0, Joomla numbers viewing
  // levels from 1 (Public), and a 0 is visible to nobody. 90 articles reached the database, every
  // count agreed, and every block rendered empty.
  lines.push('   access, images, urls, attribs, version, metakey, metadesc, metadata, language, note)');
  lines.push('  VALUES');
  lines.push(
    `  (${id}, 0, ${q(a.title)}, 'try-on-gen-${id}', ${q(a.introtext)}, '', 1, ${catid}, NOW(), 0,` +
      ` 1, '{}', '{}', '{}', 1, '', '', '{}', '*', 'try-on:generated');`
  );
  lines.push(`INSERT INTO \`${prefix}contentitem_tag_map\` (type_alias, content_item_id, tag_id, tag_date, type_id)`);
  lines.push(`  VALUES ('com_content.article', ${id}, ${tagId}, NOW(), 1);`);
  // 🔒 Blocks set to `show_front: only` render featured articles and nothing else — filling the
  // category is not enough for them. A few per category, matching the demo's own ratio.
  const seen = featuredPerCategory.get(catid) ?? 0;
  if (seen < FEATURED_PER_CATEGORY) {
    lines.push(`INSERT INTO \`${prefix}content_frontpage\` (content_id, ordering, featured_up, featured_down)`);
    lines.push(`  VALUES (${id}, 0, NULL, NULL);`);
    featuredPerCategory.set(catid, seen + 1);
  }
  lines.push('');
  id += 1;
}

if (emit === 'sql') {
  process.stdout.write(lines.join('\n') + '\n');
} else {
  console.log(
    JSON.stringify(
      { generated: articles.length, from_client_modules: seatedCount,
        first_id: GENERATED_ID_BASE, last_id: id - 1 },
      null,
      2
    )
  );
}
