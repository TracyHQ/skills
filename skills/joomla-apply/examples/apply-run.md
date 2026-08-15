# A worked Apply — one meta description, applied and reverted

The smallest real run: fixing one glossary page's duplicate meta description on joomlart.com.
Every number here is the shape of a real call; the mistakes at the end are the ones that look
right, which is the half that teaches.

## The run

**1. The inputs, before any tool call.** The deliverable (`deliverables/seo-meta-fixes/`) names
the page and the new description; the customer's yes is in the Task. The workspace's content map
says the page is article **2871** — Observed, so held loosely.

**2. One id for the whole deliverable**, minted from the task so no second run would pick it:
`apply_id: "seo-meta-fixes-t418"`.

**3. The step:**

```json
update_content {
  "applyId": "seo-meta-fixes-t418",
  "kind": "article",
  "id": 2871,
  "fields": {
    "metadesc": "What an admin template is in Joomla, how it differs from a site template, and when to replace the default one."
  }
}
```

The component answers `{ok:true}`. If the snapshot's id was stale it would answer
`{ok:false, error, message}` naming the missing row — that answer outranks the snapshot; look the
id up again, do not increment and guess.

**4. Report:** "Updated the meta description of the Admin template glossary page. Everything in
this run reverts with `revert_apply` on `seo-meta-fixes-t418`."

**5. When asked to undo:** `revert_apply { "applyId": "seo-meta-fixes-t418" }` — the page returns
to the byte, duplicate description and all. A revert restores what WAS, not what should be.

## The failing versions

**A fresh apply_id per step.**

```json
update_content { "applyId": "fix-1", "kind": "article", "id": 2871, "fields": { … } }
update_content { "applyId": "fix-2", "kind": "article", "id": 2874, "fields": { … } }
```

Each call succeeds — that is what makes it look right. But this deliverable now reverts in two
halves, and whoever runs `revert_apply` on "fix-1" honestly believes they undid the whole thing.
One deliverable, one id.

**Guessing the id from the URL.** `/glossary-joomla/admin-template` does not encode 2871, and a
database path is not a public URL in either direction. An id comes from the content map or from
the component telling you the one you tried is wrong — never from pattern-matching the slug.

**Writing a column the kind does not allow.** `fields: { "created_by": … }` on an article is
silently ignored, not refused — the whitelist drops it. If a field you wrote is not on the page
afterwards, this is the first thing to check, before blaming the cache.

**Applying without the approval on record.** The customer said "looks great!" about the draft.
That is enthusiasm for the deliverable, not an instruction to change the live site — the approval
this skill starts from is the explicit yes to APPLY. When in doubt, that is a question, not an
inference.
