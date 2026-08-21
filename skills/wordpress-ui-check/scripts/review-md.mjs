// The review as something a person reads, rendered from the review file every time it changes.
//
// This replaces the HTML report the skill used to write, and losing the pictures is the point
// rather than a regression. The report was a dead file: it was opened once, it remembered nothing,
// and a second run threw away every decision somebody had made in front of it. What the person
// works through now is the conversation; this file is the record of it — what was decided, what is
// still open, and which Preview of the site it was all measured against.
//
// Markdown because the record lives in a git repository the customer's team shares. A diff between
// two Markdown reviews reads as "these three were fixed and this one is new"; a diff between two
// HTML files reads as nothing at all.
//
// The furniture is English because this repository is public. The findings are in whatever
// language the person is speaking, exactly as the reviewer wrote them.

const SEVERITY = { high: 0, medium: 1, low: 2 };
const rank = (f) => SEVERITY[f.severity] ?? 3;

const DECIDED = { saved: "To fix", ignored: "Ignored" };

/** Which Preview this was measured on, in one sentence, at the top where it cannot be missed. */
function provenance(review) {
  const at = review.scannedAgainst ?? {};
  const when = (at.at ?? "").slice(0, 10);
  if (at.kind === "preview") {
    // A Preview can sit behind the live site, in which case the review describes a version
    // nobody is looking at. Naming the address and the revision is what lets a reader notice.
    return `Read on the Preview **${at.url}**${at.revision ? ` (revision \`${at.revision}\`)` : " (the Preview publishes no revision)"}${when ? ` on ${when}` : ""}.`;
  }
  return `Read on the live site **${at.url ?? review.site}**${when ? ` on ${when}` : ""}${at.previewTried ? ` — no Preview answered at ${at.previewTried}.` : "."}`;
}

const finding = (f) => {
  const where = [f.page, f.viewport].filter(Boolean).join(" · ");
  const detail = f.forBuilder ? `\n  ${f.forBuilder}` : "";
  const blocks = f.selectors?.length ? `\n  \`${f.selectors.join("`, `")}\`` : "";
  return `- **${f.forOwner}**\n  ${where} · \`${f.checkId}\` · \`${f.id}\`${detail}${blocks}`;
};

const section = (title, list) =>
  list.length ? `\n## ${title} (${list.length})\n\n${[...list].sort((a, b) => rank(a) - rank(b)).map(finding).join("\n")}\n` : "";

export function renderReview(review) {
  const all = review.findings ?? [];
  const open = all.filter((f) => f.state === "new" || f.state === "seen");
  const saved = all.filter((f) => f.state === "saved");
  const ignored = all.filter((f) => f.state === "ignored");
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of all) if (counts[f.severity] !== undefined) counts[f.severity] += 1;

  const standing =
    review.status === "closed"
      ? `**Every finding has been decided.** ${saved.length} to fix, ${ignored.length} set aside.`
      : `**${open.length} of ${all.length} still to decide.** Continue where you left off rather than starting again.`;

  // Findings that a later run proved gone are counted rather than listed: the list of things that
  // are no longer wrong grows forever and is read by nobody, while the number is the one thing an
  // owner asks for — "is it getting better".
  const fixed = review.fixedCount ? `\n${review.fixedCount} finding(s) from an earlier run were gone when the page was read again.\n` : "";
  const dropped = review.droppedFromReview
    ? `\n${review.droppedFromReview} page(s) were left out of the review — say so rather than implying the whole site was seen.\n`
    : "";

  return `# Presentation review — ${review.site ?? ""}

${provenance(review)}
${review.pages?.length ?? 0} page(s) reviewed. ${counts.high} high · ${counts.medium} medium · ${counts.low} low.

${standing}
${fixed}${dropped}${review.summary ? `\n${review.summary}\n` : ""}${section(DECIDED.saved, saved)}${section("Still to decide", open)}${section(DECIDED.ignored, ignored)}
---

This file is written by \`review.mjs\` from \`review.json\`. Edit the JSON, not this — or better,
answer the questions and let the skill write both.
`;
}
