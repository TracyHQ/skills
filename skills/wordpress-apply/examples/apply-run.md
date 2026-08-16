# A worked Apply — one meta description, applied and reverted

The smallest real run on WordPress: fixing one page's missing meta description. Every call here is
the shape of a real one; the mistakes at the end are the ones that look right, which is the half
that teaches.

## The run

**1. The inputs, before any tool call.** The deliverable (`deliverables/seo-meta-fixes/`) names the
page and the new description; the customer's yes is in the Task. The workspace's content map says
the page is post **412** — Observed, so held loosely.

**2. Which SEO plugin.** `surface/site.json` lists Yoast, so the key is `_yoast_wpseo_metadesc`.
Read, not guessed: Rank Math would be `rank_math_description`, and writing Yoast's key on a Rank
Math site stores a value nothing ever renders.

**3. One id for the whole deliverable**, minted from the task so no second run would pick it:
`apply_id: "seo-meta-fixes-t418"`.

**4. The step:**

```json
update_content {
  "applyId": "seo-meta-fixes-t418",
  "kind": "postmeta",
  "id": 412,
  "key": "_yoast_wpseo_metadesc",
  "fields": { "value": "Compare our three plans, what each includes, and when to move up." }
}
```

The plugin answers `{ok:true, created:true}` — `created` because this post had no description
before, which is also what makes the undo a delete rather than a restore. If the snapshot's id was
stale it would answer `{ok:false, error, message}` naming the missing post; that answer outranks
the snapshot. Look the id up again, do not increment and guess.

**5. Report:** "Added the meta description to the pricing page. Everything in this run reverts with
`revert_apply` on `seo-meta-fixes-t418`."

**6. When asked to undo:** `revert_apply { "applyId": "seo-meta-fixes-t418" }` — the page returns to
what it was, missing description and all. A revert restores what WAS, not what should be.

## A second shape: a plugin the deliverable needs

```json
install_plugin  { "url": "https://downloads.wordpress.org/plugin/wordpress-seo.14.0.zip" }
→ {"ok":true,"installed":{"file":"wordpress-seo/wp-seo.php","name":"Yoast SEO","version":"14.0"}}

activate_plugin { "file": "wordpress-seo/wp-seo.php" }
```

Two calls, not one, and the file comes from what `install_plugin` reported — not from the URL, and
not from the plugin's name. Neither call takes an `apply_id`: installing is additive and outside
the revert log, which is why the report has to say a plugin was added. It will not come off with
the rest.

## The failing versions

**A fresh apply_id per step.**

```json
update_content { "applyId": "fix-1", "kind": "postmeta", "id": 412, "key": "…", "fields": { … } }
update_content { "applyId": "fix-2", "kind": "postmeta", "id": 418, "key": "…", "fields": { … } }
```

Each call succeeds — that is what makes it look right. But this deliverable now reverts in two
halves, and whoever runs `revert_apply` on "fix-1" honestly believes they undid the whole thing.
One deliverable, one id.

**Writing the description into the post.**

```json
update_content { "applyId": "…", "kind": "post", "id": 412, "fields": { "post_excerpt": "Compare our three plans…" } }
```

This lands. The page even shows it, in themes that print the excerpt. And the search result never
changes, because Google reads the meta description, which is postmeta. "Both are the description"
is a sentence about English, not about WordPress.

**Guessing the post id from the URL.** `/pricing/` does not encode 412, and a permalink is not a
row id in either direction — a slug can be changed, reused, or served by a redirect. An id comes
from the content map or from the plugin telling you the one you tried is wrong.

**Writing a field the whitelist does not carry.**

```json
update_content { "applyId": "…", "kind": "post", "id": 412, "fields": { "post_author": 7 } }
```

Refused, with both lists named — deliberately, so a change that went nowhere cannot be mistaken for
one that landed. On Joomla the same mistake is silently dropped; here you get a sentence. Read it
and pick the field it offers.

**Setting an option that owns the site.**

```json
update_content { "applyId": "…", "kind": "option", "key": "siteurl", "fields": { "value": "https://staging.example.com" } }
```

Refused, and the refusal is the feature. A wrong `siteurl` moves the site to an address that may
not answer — including for the request that would have reverted it.

**Publishing by omission.** A new post with no `post_status` is created as a draft. If the
deliverable says the page goes live, say `"post_status": "publish"`. If it does not say, the draft
is the right answer and the customer publishes it themselves.

**Applying without the approval on record.** The customer said "looks great!" about the draft. That
is enthusiasm for the deliverable, not an instruction to change the live site — the approval this
skill starts from is the explicit yes to APPLY. When in doubt, that is a question, not an
inference.
