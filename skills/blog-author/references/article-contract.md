# The shape of a blog batch

Everything mechanical about an article, so `SKILL.md` can stay about judgement. Ships with the
skill because a prerequisite you cannot open is worse than no prerequisite at all.

## A batch is a proposal directory

```
proposals/<slug>/
  proposal.json    name, author, brief, carries, preview URL
  mapping.md       the decisions, reviewed by a person; jobs are refused without it
  jobs/NN-job.json one article per job, replayed in filename order
  files/           images, paths relative to webroot/
```

Three things about `jobs/` that are easy to get backwards:

1. **You do not author files into `jobs/`.** You call the fill step with a job. A job the mapping
   gate accepts is recorded there for you. A job it refuses leaves nothing behind, which is what
   keeps the directory replayable.
2. **The `client` block never appears in the directory.** It carries the connection and its
   password, it is filled on the fleet, and it is stripped before the job is written. This is
   enforced, not remembered.
3. **Filename order is dependency order.** An article whose verify markers mention another
   article's output has to run after it.

`carries` for a content batch is `["content"]`. That value is what makes the client the person who
approves it, on the preview, by comparing two tabs.

## The fields of one article

Named after the columns they land in, so nothing has to be translated twice.

| Field | Required | Notes |
|---|---|---|
| `title` | yes | |
| `alias` | yes | the public URL. Unique across the site, not just the batch |
| `catid` | yes | a category the site already has. Read it from the content map, never invent one |
| `language` | yes | from the brand brief. Never default to `en-GB` |
| `created_by` | yes | an account on the client's own site, not a Tracy account |
| `state` | yes | published inside the proposal, because the client has to see it |
| `publish_up` | yes | the intended date |
| `metadesc` | yes | 155 characters or fewer, one complete sentence |
| `introtext` | yes | the part before the readmore |
| `fulltext` | no | the part after it |
| `images` | no | intro and full image, pointing at files in `files/` |
| `basedOn` | yes | the mirror commit the article was written from |
| `sources` | yes | one entry per claim carrying a number, naming the file it came from |

`verify` on the job: `path` is the article's URL on the preview, `markers` are two or three
phrases only this article has, and `forbid` catches another article's copy or the demo's own text
leaking onto the page.

## Two traps worth knowing before you meet them

**The alias is the public URL.** A collision is refused, and it is refused for a good reason: the
loser silently becomes unreachable. Pick aliases deliberately, in the mapping, where a person can
see them next to each other.

**A future publish date and an immediate render disagree.** The fill step verifies by rendering
the page right after writing it. An article dated next week does not render, so a correct job
fails its own check. Until that is settled, publish inside the proposal with a date that has
passed and let the schedule live on the apply side.

## What `mapping.md` has to contain

It is the one review gate, so write it for the person, not for the machine.

- Where the batch lands: category and its id, menu (usually nothing new), language, signing account.
- One row per article: job filename, title, why this topic, and which page of theirs proves the gap.
- What was decided against, and why. A mapping that only lists what you are doing hides the
  judgement that mattered.
- The Sync commit the topics were derived from, so a reader knows which version of the site this
  was reasoned about.
