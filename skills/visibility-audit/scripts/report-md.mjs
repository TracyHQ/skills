// The audit as Markdown: the deliverable you can read in the terminal, paste into a ticket,
// or hand to a merchant before the PDF exists. Same numbers as audit.json, no extra judgement.

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
  L.push(`**Score ${pct(report.score)}** (${verdictText}) · ${report.coverage.scored}/${report.coverage.totalDefined} criteria scored`)
  L.push('')
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
