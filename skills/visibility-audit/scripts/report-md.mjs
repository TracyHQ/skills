// The audit as Markdown: the deliverable you can read in the terminal, paste into a ticket,
// or hand to a merchant before the PDF exists. Same numbers as audit.json, no extra judgement.

import { LLM_LANE_CRITERIA, OFFSTORE_LANE_CRITERIA, laneImpact } from './preflight.mjs'

const pct = (n) => (n === null || n === undefined ? '—' : `${Math.round(n)}/100`)
const STATUS_NOTE = {
  na: 'not measurable for this store',
  gated: 'not measured for this market',
  inactive: 'not implemented',
}

export function renderMarkdown(report) {
  const L = []
  const s = report.subject
  L.push(`# Website Audit — ${s.shop.name || s.shop.storeUrl}`)
  L.push('')
  // `report.verdict` is `null` exactly when nothing was scored (see framework.mjs
  // verdictTier) — that is "unknown", never "weak". Printing the tier only when one was
  // actually earned is what incident C required.
  const verdictText = report.verdict ?? 'unrated — nothing was scored'

  // The page never arrived: lead with that, before any number, and do not print a scorecard the
  // reader will act on. A merchant shown "22/100 · weak" plus a ten-item fix list does not read
  // the disclaimer underneath — they open a ticket about their product schema. Measured on
  // gymshark.com 2026-08-20; see `score.mjs` runScorers.
  if (report.notMeasured) {
    const why = {
      'bot-wall': 'The site answered with a bot check, not the product page',
      'js-shell': 'The site answered with an empty shell that builds its content in the browser',
      'empty-response': 'The site answered with an empty document',
    }[report.notMeasured.why] ?? 'The response was not the product page'
    const sig = report.notMeasured.signals
    L.push('## This audit did not measure your page')
    L.push('')
    L.push(`**No score.** ${why}${sig ? ` — ${sig.htmlLength.toLocaleString()} characters came back, but only ${sig.visibleTextLength} of them were text a reader would see, with ${sig.headings} heading${sig.headings === 1 ? '' : 's'} and ${sig.links} link${sig.links === 1 ? '' : 's'}.` : '.'}`)
    L.push('')
    L.push('Nothing below is a finding about your store. Every on-page criterion is `na` because there was no page to read — that is different from scoring badly, and it would be wrong to report it as a weakness.')
    L.push('')
    L.push('**To get a real audit, do one of these:**')
    L.push('')
    L.push('1. Open the product page in your browser, save the fully-loaded DOM to a file, and re-run with `--rendered-html <file>`. This is the reliable route for a store behind a bot check.')
    L.push('2. If your store is behind Cloudflare or similar, allow-list the machine running this audit, then re-run.')
    L.push('')
    L.push('Off-store signals were collected from elsewhere and are still valid — they are listed below and are the only rows here that say anything true about your brand.')
    L.push('')
  } else {
    L.push(`**Score ${pct(report.score)}** (${verdictText}) · ${report.coverage.scored}/${report.coverage.totalDefined} criteria scored`)
    L.push('')
  }
  // The score is the weighted mean over the SCORED rows only — `na`/`gated` leave the
  // denominator, they are not zeros (see FRAMEWORK.md, "How the score is built"; aggregate.mjs
  // is where the maths lives). Said once, in plain words, next to the number itself so a
  // fewer-than-40 run is never read as a complete one that happened to score low.
  // Suppressed when the page never arrived: the block above already said there is no score,
  // and explaining how a score nobody published was averaged reads as a contradiction.
  if (!report.notMeasured && report.coverage.scored < report.coverage.totalDefined) {
    L.push(
      `> This score is the weighted mean over the ${report.coverage.scored} criteria that were actually measured. The other ${report.coverage.totalDefined - report.coverage.scored} are \`na\`/\`gated\` and do not pull the number down — they are absent from the average, not zeros in it. See "Not scored" below for exactly which, and why.`,
    )
    L.push('')
  }
  if (report.summary) L.push(`> ${report.summary}`)
  L.push('')
  L.push(`- Product: ${s.product.title}`)
  L.push(`- Page: ${s.pdpUrl}`)
  L.push(`- Market: ${s.location.country ?? '—'}${s.location.city ? ` · ${s.location.city}` : ''} · ${s.language}`)
  L.push(`- Generated: ${report.generatedAt}`)
  L.push(
    `- Data: page ${report.dataSources.renderer}, off-store ${report.dataSources.offStoreRoute ?? 'none'}, grading ${report.dataSources.llmRoute ?? 'none'}, prose ${report.dataSources.narrativeRoute ?? 'templates'}`,
  )
  L.push(
    `- Source: \`${report.source}\` — collected and scored on this machine; the Mention Network backend re-computes the weights but never observed the page.`,
  )
  if (report.dataSources.renderer === 'plain') {
    L.push(
      '- ⚠️ Nothing rendered this page: every on-page signal below was read from the pre-JS HTML, which is what an AI crawler sees but less than a shopper sees. On a theme that builds its content in the browser, 8 criteria (crawlable text, internal links, image descriptions, heading structure, video schema, product media, content freshness, contact details) can read lower here than on a rendered run. Re-run with --rendered-html <saved DOM> to score them on the full page.',
    )
  }
  // Distinguishes "this lane ran and found nothing" from "this lane never completed" — both
  // leave the same criteria `na`/`0`, so a run that never measured half the store can look
  // exactly like a store that was measured and is genuinely thin. Audit incident H.
  const llmFailures = report.dataSources.llmBatchFailures ?? []
  if (llmFailures.length > 0) {
    L.push(
      `- ⚠️ ${llmFailures.length} LLM grading batch${llmFailures.length === 1 ? '' : 'es'} did not complete (${llmFailures.join(', ')}): those criteria read "not measured", not "measured and found nothing". Re-run \`analyze-llm.mjs\` before trusting a low content/credibility score.`,
    )
  }
  const offStoreFailures = report.dataSources.offStoreFailures ?? []
  if (offStoreFailures.length > 0) {
    L.push(
      `- ⚠️ ${offStoreFailures.length} off-store search${offStoreFailures.length === 1 ? '' : 'es'} did not complete (${offStoreFailures.join(', ')}): those criteria read "not measured", not "no buzz found". Re-run \`collect-offstore.mjs\` before trusting a low reviews/press score.`,
    )
  }
  // A NULL route means the lane never ran at all — no key, so the run was never asked to spend
  // one — which is a different situation from the failure warnings above (a lane that ran and
  // had some calls throw). Both leave the same criteria `na`, so both need to be said, not just
  // the first: a reader who only sees "no failures" could otherwise assume every available
  // signal was collected. Named lanes and weight come from `preflight.mjs`, the same lane
  // definitions the P1 preflight showed before this run started.
  if (!report.dataSources.llmRoute) {
    const impact = laneImpact(LLM_LANE_CRITERIA)
    L.push(
      `- ⚠️ Grading lane skipped (no LLM key at run time): ${impact.count} criteria are \`na\`, not scored low — ~${impact.weightPct}% of the total weight, including ${impact.criticalKeys.length} Critical ${impact.criticalKeys.length === 1 ? 'criterion' : 'criteria'} (${impact.criticalKeys.join(', ')}). Add \`ANTHROPIC_API_KEY\` / \`OPENAI_API_KEY\` / \`GEMINI_API_KEY\` and re-run \`analyze-llm.mjs\` + \`score.mjs\` to score them.`,
    )
  }
  if (!report.dataSources.offStoreRoute) {
    const impact = laneImpact(OFFSTORE_LANE_CRITERIA)
    L.push(
      `- ⚠️ Off-store lane skipped (no SerpApi key at run time): ${impact.count} criteria are \`na\`, not scored low — ~${impact.weightPct}% of the total weight, including ${impact.criticalKeys.length} Critical ${impact.criticalKeys.length === 1 ? 'criterion' : 'criteria'} (${impact.criticalKeys.join(', ')}). Add \`SERPAPI_API_KEY\` and re-run \`collect-offstore.mjs\` + \`score.mjs\` to score them.`,
    )
  }
  L.push('')

  L.push('## Scorecard')
  L.push('')
  L.push('| Factor | Weight | Score | Summary |')
  L.push('|---|---|---|---|')
  for (const f of report.factors) {
    L.push(`| ${f.label} | ${f.weightPct}% | ${pct(f.score)} | ${f.summary ?? ''} |`)
  }
  L.push('')

  L.push('## Fix these first')
  L.push('')
  if (report.topPriorities.length === 0) {
    L.push('_Nothing scored, so nothing to rank._')
  } else {
    L.push('| # | Criterion | Factor | Impact | Score | On your page |')
    L.push('|---|---|---|---|---|---|')
    report.topPriorities.slice(0, 10).forEach((c, i) => {
      L.push(`| ${i + 1} | ${c.title} | ${c.factor} | ${c.impact} | ${pct(c.score)} | ${c.diagnosis ?? ''} |`)
    })
  }
  L.push('')

  for (const f of report.factors) {
    L.push(`## ${f.label} — ${pct(f.score)}`)
    L.push('')
    L.push(`_${f.description}_`)
    L.push('')
    for (const sg of f.subGroups) {
      L.push(`### ${sg.label} (${sg.pct}% of factor) — ${pct(sg.score)}`)
      if (sg.takeaway) L.push(`${sg.takeaway}`)
      L.push('')
      L.push('| Criterion | Status | Score | On your page |')
      L.push('|---|---|---|---|')
      for (const c of sg.criteria) {
        const status = c.status === 'scored' ? 'scored' : `${c.status} (${STATUS_NOTE[c.status]})`
        const note = c.status === 'scored' ? (c.diagnosis ?? '') : (c.reason ?? '')
        L.push(`| ${c.title} | ${status} | ${c.status === 'scored' ? pct(c.score) : '—'} | ${note} |`)
      }
      L.push('')
    }
  }

  const skipped = report.factors
    .flatMap((f) => f.subGroups.flatMap((sg) => sg.criteria))
    .filter((c) => c.status !== 'scored')
  if (skipped.length > 0) {
    L.push('## Not scored')
    L.push('')
    L.push(`${skipped.length} of ${report.coverage.totalDefined} criteria could not be scored in this run:`)
    L.push('')
    for (const c of skipped) {
      L.push(`- **${c.title}** — ${c.status}: ${c.reason ?? STATUS_NOTE[c.status]}`)
    }
    L.push('')
  }
  return L.join('\n')
}
