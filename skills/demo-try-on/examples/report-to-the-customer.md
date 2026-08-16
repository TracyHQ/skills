# Reporting a try-on: one that passes, two that fail

Per ADR 0053 §7. The failing versions matter more — they are the ones that sound right, which is
exactly what an agent produces when nothing tells it otherwise.

**These are written in English because this repository is public (ADR 0016). The real answer goes
back in the language the person wrote in.** What they teach is shape, not wording. Labels,
positions, fleet labels and the address stay verbatim in every language: they are addresses, not
prose.

---

## Passes

> Teline V's front page has 19 content slots. This try-on fills 3:
>
> - `news-home` — 11 of your articles (category Others)
> - `news-travel` — 4 (Learner Stories)
> - `whatsnew` — 1 (Actualités des apprenants)
>
> The other 64 articles are **generated**, marked as such, and removable in one step. 16 slots have
> no source on your side yet, so they still show the demo's own articles.
>
> Your 8 photographs were cropped to the template's 1.3 ratio. They fill 8 of 24 image frames.
>
> See it at: https://ja-teline-v-demo-joomlart-com-835ff2df--mentor-educazone-net.tracy.ai/
>
> This is a fitting room, not your site finished.

Why it passes: counts before adjectives; what is real and what is invented named separately; the
16 untouched slots stated rather than hidden; the address printed verbatim; the last line refuses
the reading the customer most wants to make.

---

## Fails — "sounds finished"

> Your site looks great in JA Teline V! The content came across nicely and the layout is very
> professional. Take a look.

Why it fails: no counts, so nothing is checkable. It implies completeness about a run that filled
3 of 19 slots. It never says a single word was generated — the customer finds out when they read a
paragraph nobody at their company wrote, and at that moment everything else in the report becomes
suspect too.

---

## Fails — "honest but useless"

> Ran try_on. Created 3 categories at offset 900100–900102, 26 rows carrying
> `note='try-on:mapped'`, 64 carrying `try-on:generated` plus the tag. Modules at news-home,
> news-travel and whatsnew retargeted via `news-featured[catid][]`. Verify reports 1 failure at
> check 2.

Why it fails: every fact is true and none of it answers the question. Offsets, note values and
parameter keys are how the machine keeps its promise, not what the customer is deciding on. And
"1 failure at check 2" reads like a defect in the template when it means *16 slots have no source
of yours yet* — the one sentence they needed.

Internals belong in the transcript. The report is for someone choosing whether to buy a template.
