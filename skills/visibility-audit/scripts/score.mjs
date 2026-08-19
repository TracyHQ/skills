// Run the 40 scorers over what was collected, aggregate, write the prose, and emit the audit.
// This is the step that produces the deliverables:
//   audit.json   the full report (same shape the backend's `get_website_audit_report` returns,
//                plus a `source` + `dataSources` disclosure block)
//   report.md    the readable version
//   report.json  `{ meta, audit }` — the render-ready payload, written only when
//                `--report-json` is passed. This skill does not pass it: the shareable PDF is
//                exported by the backend after `submit_byok_website_audit`, so nothing here
//                renders locally. Kept because the shape is the backend renderer's input and
//                anyone driving these scripts by hand may still want it.
//
// Every input is optional except pages.json: no llm.json → the 15 LLM criteria go `na` (and
// shipping-competitive floors at 0, as on the backend); no offstore.json → the 8 off-store
// criteria go `na`. The score is always computed over what WAS measured, and coverage says so.
//
// Usage:
//   node score.mjs --pages pages.json --meta meta.json --llm llm.json --offstore offstore.json \
//     --narrative-route anthropic --out audit.json --md report.md

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { aggregateAudit } from './aggregate.mjs'
import {
  CRITERIA,
  CRITERION_TITLES,
  CRITERION_WHAT,
  CRITERION_WHY,
  FACTOR_UI,
  SUBGROUP_UI,
  verdictTier,
} from './framework.mjs'
import { pickRoute } from './llm.mjs'
import { generateNarratives } from './narrate.mjs'
import { renderMarkdown } from './report-md.mjs'
import { ALL_SCORERS } from './scorers.mjs'
import { resolveSubject } from './subject.mjs'
import { isMainModule, parseArgv, parseJsonLd } from './util.mjs'

const EMPTY_OFF_STORE = {
  reddit: null,
  googleReviews: null,
  trustpilot: null,
  video: null,
  press: null,
  entityDatabases: null,
}

export function buildContext({ pages, meta, llm, offstore }) {
  const subject = resolveSubject(meta, pages)
  const page = pages.page

  // Parse JSON-LD from the pre-JS HTML first: that is what a non-JS AI crawler reads, and
  // renderers sometimes strip ld+json. Fall back to the rendered copy only if raw had none.
  const rawLd = parseJsonLd(page.rawSourceHtml)
  const jsonLd = rawLd.product || rawLd.types.length > 0 ? rawLd : parseJsonLd(page.renderedHtml)

  const off = offstore ? { ...EMPTY_OFF_STORE, ...offstore } : { ...EMPTY_OFF_STORE }
  // press.count is filled by the LLM filter step, not by the collector.
  const pressCount = llm?.press?.count
  const press =
    off.press && typeof pressCount === 'number'
      ? { ...off.press, count: pressCount }
      : typeof off.press?.count === 'number'
        ? off.press
        : null

  return {
    subject,
    ctx: {
      shop: subject.shop,
      product: subject.product,
      pdpUrl: subject.pdpUrl,
      page,
      robots: pages.robots,
      jsonLd,
      storePages: pages.storePages ?? { about: null, contact: null, policies: {} },
      llmAnalysis: llm?.analysis ?? {},
      faq: llm?.faq ?? undefined,
      offStore: { ...off, press },
      feed: { googleMerchantFeed: offstore?.feed?.googleMerchantFeed ?? null },
      merchant: { competitorPrices: subject.competitorPrices },
      phase1: { language: subject.language },
    },
  }
}

export async function runScorers(ctx) {
  const evaluated = []
  for (const scorer of ALL_SCORERS) {
    const res = await scorer.score(ctx)
    evaluated.push({
      key: scorer.key,
      factor: scorer.factor,
      subGroup: scorer.subGroup,
      weight: scorer.weight,
      status: res.status,
      score: res.status === 'scored' ? res.score : null,
      evidence: res.status === 'scored' ? res.evidence : { reason: res.reason },
    })
  }
  return evaluated
}

function criterionDto(row, narratives) {
  return {
    key: row.key,
    title: CRITERION_TITLES[row.key] ?? row.key,
    factor: row.factor,
    subGroup: row.subGroup,
    whatIsThis: CRITERION_WHAT[row.key] ?? '',
    whyItMatters: CRITERION_WHY[row.key] ?? '',
    diagnosis: narratives.criteria[row.key]?.text ?? null,
    diagnosisSource: narratives.criteria[row.key]?.source ?? null,
    score: row.score === null ? null : Math.round(row.score),
    status: row.status,
    impact: CRITERIA[row.key]?.impact ?? 'Medium',
    impactRank: row.impactRank,
    reason: row.reason ?? null,
    evidence: row.evidence,
  }
}

export function assembleReport({ subject, agg, narratives, dataSources, auditId }) {
  const total = agg.total === null ? null : Math.round(agg.total)
  const factors = agg.factors.map((f) => {
    const ui = FACTOR_UI[f.key]
    return {
      key: f.key,
      label: ui.label,
      weightPct: f.weightPct,
      description: ui.description,
      why: ui.why,
      status: f.status,
      score: f.score === null ? null : Math.round(f.score),
      summary: narratives.factors[f.key]?.text ?? null,
      summarySource: narratives.factors[f.key]?.source ?? null,
      subGroups: f.subGroups.map((sg) => ({
        name: sg.name,
        label: SUBGROUP_UI[sg.name]?.label ?? sg.name,
        description: SUBGROUP_UI[sg.name]?.description ?? '',
        pct: sg.pct,
        score: sg.score === null ? null : Math.round(sg.score),
        takeaway: narratives.subGroups[sg.name]?.text ?? null,
        takeawaySource: narratives.subGroups[sg.name]?.source ?? null,
        criteria: agg.criteria
          .filter((c) => c.factor === f.key && c.subGroup === sg.name)
          .map((c) => criterionDto(c, narratives)),
      })),
    }
  })

  return {
    auditId,
    checkRunId: null,
    // Same label the backend stores (`website_audits.source`), so the local file and the
    // submitted audit describe themselves identically: these numbers rest on data this machine
    // collected. Say so wherever the report is shown to anyone else.
    source: 'byok',
    subject,
    score: total,
    verdict: verdictTier(total),
    summary: narratives.verdict?.text ?? null,
    summarySource: narratives.verdict?.source ?? null,
    generatedAt: new Date().toISOString(),
    auditNumber: null,
    coverage: agg.coverage,
    dataSources,
    factors,
    topPriorities: agg.topPriorities.map((c) => criterionDto(c, narratives)),
  }
}

export async function runAudit({ pages, meta, llm, offstore, narrativeRoute, model, timeoutMs, auditId }) {
  const { subject, ctx } = buildContext({ pages, meta, llm, offstore })
  const agg = aggregateAudit(await runScorers(ctx))
  const narratives = await generateNarratives(agg, { route: narrativeRoute, model, timeoutMs })
  const dataSources = {
    renderer: pages.page.renderer,
    offStoreRoute: offstore?.route ?? null,
    llmRoute: llm?.route ?? null,
    narrativeRoute: narrativeRoute ?? null,
    fetchedAt: pages.fetchedAt ?? null,
  }
  return assembleReport({ subject, agg, narratives, dataSources, auditId })
}

export async function main(argv) {
  const a = parseArgv(argv)
  if (!a.pages) throw new Error('--pages pages.json is required')
  const read = (p) => (p ? JSON.parse(readFileSync(p, 'utf8')) : null)
  const write = (p, text) => {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, text)
  }

  const report = await runAudit({
    pages: read(a.pages),
    meta: read(a.meta),
    llm: read(a.llm),
    offstore: read(a.offstore),
    // 'none' forces template-only prose. Omitted means "use a key if the user has one" —
    // null only survives when there is genuinely no key to write prose with.
    narrativeRoute: a['narrative-route'] === 'none' ? null : (a['narrative-route'] ?? pickRoute()),
    model: a.model ?? null,
    timeoutMs: a['timeout-ms'] ? Number(a['timeout-ms']) : 180000,
    auditId: a['audit-id'] ?? `local-${Date.now()}`,
  })

  if (a.out) write(a.out, JSON.stringify(report, null, 2))
  if (a.md) write(a.md, renderMarkdown(report))
  if (a['report-json']) {
    // Renderer input. Audit-only is fine: the renderer draws the audit pages and skips the
    // visibility ones.
    write(
      a['report-json'],
      JSON.stringify(
        {
          meta: {
            generatedAt: report.generatedAt,
            shopDomain: report.subject.shop.primaryDomain ?? report.subject.shop.storeUrl,
            template: 'default',
            reusedReport: false,
          },
          audit: report,
        },
        null,
        2,
      ),
    )
  }

  return {
    out: a.out ?? null,
    md: a.md ?? null,
    reportJson: a['report-json'] ?? null,
    score: report.score,
    verdict: report.verdict,
    coverage: report.coverage,
    topPriorities: report.topPriorities.slice(0, 3).map((c) => `${c.title} (${c.score})`),
  }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2))
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e.message)
      process.exit(1)
    })
}
