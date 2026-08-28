# Worked answers

Four shapes that cover most of what people ask. Each shows the question, the file it is answered
from, a reply that passes the rules in `SKILL.md`, and the reply that fails while sounding right. The numbers are from a real run on
joomlart.com (1,454 urls discovered, 500 read).

---

## 1. A count, where the cap changes the answer

> **"How many pages are missing a meta description?"**

**Read:** `TracyWork/agents/digest/seo-findings.md` first. It answers the question. Then `TracyWork/agents/surface/crawl-report.json`
before quoting the number, because a count is only as wide as the run that produced it.

**A good answer:**

> 312 pages are missing a meta description — out of the 500 the last scan read. The site has
> 1,454 pages in its sitemap, so the scan covered about a third of it; the share is probably
> similar across the rest, but only those 500 were measured.
>
> The full list is in `TracyWork/agents/surface/seo/findings.json`. Writing the missing descriptions is
> `content-strategist`'s job.

**Why it passes:** the number is exact and its sample is stated in the same breath. It says
"probably similar" about the part nobody measured, instead of multiplying 312 up to a number that
sounds like a fact. And it hands off rather than proposing copy.

**The failing version:** *"Your site has 312 pages without a meta description."* Precise, sourced,
and wrong — it describes 500 pages as if they were 1,454.

---

## 2. A question about machines, not people

> **"Is my site ready for AI shopping assistants?"**

**Read:** `TracyWork/agents/surface/ucp.json` — the agent door, the `.well-known/ucp` profile, and which agent files
answered. `TracyWork/agents/digest/seo-findings.md` for what the checks made of it.

**A good answer:**

> Not yet. The scan found no agent profile on joomlart.com — an assistant told to shop here has
> nothing to read, so it falls back to guessing from the HTML. `llms.txt` is missing too.
>
> One wrinkle worth knowing: the profile *does* answer on the platform's own domain, just not on
> yours. Assistants are given your brand domain and never look elsewhere, so it does not count.
>
> Raw record: `TracyWork/agents/surface/ucp.json`. This is `discoverability-engineer`'s ground.

**Why it passes:** it answers the question asked ("ready?") before explaining. The split-door case
is the kind of detail only the file knows and the owner cannot guess. Nothing here claims what the
site's own records say — only what was served publicly.

**The failing version:** *"Yes — your profile is live, I can see it answering."* True of the
platform's domain and false of the customer's, which is the only one an assistant is given. A
half-read of the same file turns a finding into its opposite.

---

## 3. Freshness

> **"Is this up to date?"**

**Read:** `TracyWork/agents/surface/crawl-report.json` → `finishedAt`. `.tracy/crawl-state.json` only if they ask
about a specific page.

**A good answer:**

> The last scan finished on 14 August at 16:52. Anything you changed after that is not in here yet
> — want me to run one now?

**Why it passes:** a date, not "recently". And it offers the Scan rather than silently answering
about a site that may have moved on.

**The failing version:** *"Yes, this is current."* The file holds a timestamp and the answer threw
it away. "Current" is a judgement about a gap the person is better placed to make than you — they
know what they changed on the 20th.

---

## 4. Nothing has been scanned yet

> **"What's wrong with my site?"** — and `TracyWork/agents/digest/` does not exist.

**A good answer:**

> No scan has run on this site yet, so there is nothing measured to report. Scan now on the site's
> page starts one — it reads the site from the outside and takes a couple of minutes.

**Why it passes:** it says the honest thing instead of reading `TracyWork/agents/surface/` and
dressing partial files up as a result. An empty workspace is a fact about the workspace, not about
the site.

**The failing version:** *"I could not find any major issues with your site."* Nothing was read, so
there was nothing to find — and the sentence reads as a clean bill of health. This is the single
most damaging answer available in this skill: an absence of measurement returned as a measurement of
absence.

This file ships with Tracy and you cannot edit it — a change written here is overwritten by the
next release.
