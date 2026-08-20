// Save a client-scored audit ON THE SERVER, then export the branded PDF from there —
// the same ending the visibility report has (`submit_byok_check` → `export_..._pdf`).
//
// The backend runs no scorer and no LLM for this: it validates the payload, RE-COMPUTES every
// score with its own weights, re-runs the narrative guards over the prose, and stores a
// completed audit. So the audit gets a real `auditId`, a hosted PDF URL, and shows up in
// `get_website_audit_report` like any other — while still costing the backend nothing.
//
// Always validates first (`validate_byok_website_audit`, same rule set as submit) so a bad
// payload costs a round trip, not a rejected submit. The server's re-computed score comes back
// from that call: if it differs from ours, the skill is running a drifted framework and the
// submit is refused rather than silently overwritten.
//
// Usage:
//   node submit-audit.mjs --audit audit.json --meta meta.json --out submitted.json
//   node submit-audit.mjs --audit audit.json --meta meta.json --validate-only
//   node submit-audit.mjs --audit audit.json --meta meta.json --report-id <uuid>  # pair with Phase 1
//   node submit-audit.mjs --audit audit.json --meta meta.json --no-pdf
//
// This is the ONE step a missing MENTION_NETWORK_KEY can affect — collection, grading and
// scoring (P3-P5) never touch this file and never wait on it. Runs with or without a key: it
// calls out through mcp-client.mjs, which omits the Authorization header rather than refusing to
// call at all when none is stored (server-decided since 2026-08-19 — see mcp-client.mjs's
// header comment). Without a key this may still succeed as `anonymous`, or the server may
// decline it; either is a normal outcome of running this step, not a reason to skip running it.
// A STORED-BUT-WRONG key is worse than none (still a hard 401), so source the credential store
// first and `credentials.mjs check MENTION_NETWORK_KEY` before trusting one you haven't run yet.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { callTool } from './mcp-client.mjs'
import { isMainModule, parseArgv } from './util.mjs'

// audit.json nests criteria under factors → sub-groups; the wire format is flat, one entry
// per criterion. Flattening here (not in score.mjs) keeps the local report shape identical to
// the backend's own report DTO.
export function flattenCriteria(audit) {
  const out = []
  for (const factor of audit.factors ?? []) {
    for (const sg of factor.subGroups ?? []) {
      for (const c of sg.criteria ?? []) {
        out.push({
          key: c.key,
          status: c.status,
          score: c.status === 'scored' ? c.score : null,
          evidence: c.status === 'scored' ? (c.evidence ?? {}) : undefined,
          reason: c.status === 'scored' ? undefined : (c.reason ?? reasonFrom(c)),
          diagnosis: c.diagnosis ?? undefined,
          diagnosisSource: c.diagnosisSource ?? undefined,
        })
      }
    }
  }
  return out
}

// A skipped criterion must say WHY (the server rejects a bare `na`), and the reason already
// lives in the evidence the scorer wrote.
function reasonFrom(c) {
  const fromEvidence = c.evidence && typeof c.evidence.reason === 'string' ? c.evidence.reason : null
  return fromEvidence ?? `not measured in this run (${c.status})`
}

export function buildNarratives(audit) {
  const subGroups = {}
  const factors = {}
  for (const factor of audit.factors ?? []) {
    if (factor.summary) {
      factors[factor.key] = { text: factor.summary, source: factor.summarySource ?? 'llm' }
    }
    for (const sg of factor.subGroups ?? []) {
      if (sg.takeaway) {
        subGroups[sg.name] = { text: sg.takeaway, source: sg.takeawaySource ?? 'llm' }
      }
    }
  }
  const verdict = audit.summary
    ? { text: audit.summary, source: audit.summarySource ?? 'llm' }
    : null
  return { subGroups, factors, verdict }
}

// `meta.json` is the file the skill already writes for scoring; the wire payload needs a shop
// identity on top of it. Nothing here is invented: a store that never onboarded through
// Shopify gets the `avs://<domain>` external id the Phase-1 lane uses for the same reason.
export function buildPayload(audit, meta, opts = {}) {
  const subject = audit.subject ?? {}
  const shop = meta.shop ?? subject.shop ?? {}
  const storeUrl = shop.primaryDomain ?? shop.storeUrl
  if (!storeUrl) throw new Error('meta.shop.storeUrl (or primaryDomain) is required to submit')
  const product = subject.product ?? {}

  return {
    idempotencyKey: opts.idempotencyKey ?? meta.idempotencyKey ?? `audit-${randomUUID()}`,
    shop: {
      platform: shop.platform ?? 'shopify',
      externalId: shop.externalId ?? `avs://${storeUrl}`,
      storeUrl,
      name: shop.name || storeUrl,
      primaryDomain: shop.primaryDomain ?? null,
      countryCode: meta.location?.country ?? null,
      currency: product.currency ?? shop.currency ?? null,
    },
    product: {
      externalProductId: product.externalProductId ?? null,
      title: product.title ?? 'Product',
      handle: product.handle ?? null,
      vendor: product.vendor ?? null,
      productType: product.productType ?? null,
      // The backend column is numeric; a storefront price is a string.
      price: product.price == null ? null : Number(product.price),
      currency: product.currency ?? null,
      imageUrl: product.imageUrl ?? null,
    },
    pdpUrl: subject.pdpUrl ?? meta.pdpUrl ?? null,
    locationCountry: (meta.location?.country ?? subject.location?.country ?? '').toUpperCase(),
    locationCity: meta.location?.city ?? subject.location?.city ?? null,
    language: meta.language ?? subject.language ?? 'en',
    reportId: opts.reportId ?? meta.reportId ?? null,
    criteria: flattenCriteria(audit),
    narratives: buildNarratives(audit),
    // Check figures, not inputs: the server computes its own and refuses a mismatch.
    claimedScore: audit.score ?? null,
    claimedCoverage: audit.coverage
      ? { scored: audit.coverage.scored, totalDefined: audit.coverage.totalDefined }
      : null,
    dataSources: audit.dataSources ?? null,
  }
}

function formatErrors(errors) {
  return errors
    .map((e) => `  [${e.code}] ${e.criterionKey ? `${e.criterionKey}: ` : ''}${e.message}`)
    .join('\n')
}

export async function main(argv, deps = {}) {
  const call = deps.callTool ?? callTool
  const a = parseArgv(argv)
  if (!a.audit) throw new Error('--audit audit.json is required')
  const audit = JSON.parse(readFileSync(a.audit, 'utf8'))
  const meta = a.meta ? JSON.parse(readFileSync(a.meta, 'utf8')) : {}
  const payload = buildPayload(audit, meta, {
    reportId: a['report-id'],
    idempotencyKey: a['idempotency-key'],
  })

  const check = await call('validate_byok_website_audit', {
    criteria: payload.criteria,
    narratives: payload.narratives,
    claimedScore: payload.claimedScore,
    claimedCoverage: payload.claimedCoverage,
  })
  if (check.errors?.length) {
    throw new Error(`payload rejected by the server:\n${formatErrors(check.errors)}`)
  }
  if (a['validate-only']) {
    return { validated: true, serverScore: check.score, coverage: check.coverage }
  }

  const submitted = await call('submit_byok_website_audit', payload)
  let pdf = null
  if (!a['no-pdf']) {
    pdf = await call('export_website_audit_pdf', { auditId: submitted.auditId })
  }

  const result = {
    auditId: submitted.auditId,
    score: submitted.score,
    coverage: submitted.coverage,
    measuredWeightPct: submitted.measuredWeightPct,
    // Prose the server's guards refused and replaced with a grounded template line.
    narrativesReplaced: submitted.narrativesReplaced,
    deduped: submitted.deduped,
    pdfUrl: pdf?.url ?? null,
    idempotencyKey: payload.idempotencyKey,
  }
  if (a.out) {
    mkdirSync(dirname(a.out), { recursive: true })
    writeFileSync(a.out, JSON.stringify(result, null, 2))
  }
  return result
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2))
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e.message)
      process.exit(1)
    })
}
