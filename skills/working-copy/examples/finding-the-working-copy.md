# Example — "where is this site's copy?"

The most common thing this skill is asked, and the one it was written after getting wrong.

## Fails

> **Migration is done.** It finished today at 14:16. There is a database dump of 4.7 MB covering
> 49 tables, and the file is stored at `deliverables/migrate/db-dump.sql`.

Everything in it is true, and none of it answers the question.

What went wrong is not the facts — it is the route. The agent had no record of the working copy,
searched the workspace for anything matching, found the one file whose name looked relevant, and
described it. The file was an unrelated database dump left by a plugin's own scheduler. No tool
was called. No address was reported.

The failure mode to recognise is the tone: a **precise, sourced, confident** answer about the
wrong object. That is what a filesystem search produces when the thing being asked about was never
in the filesystem. It reads exactly like a correct answer, which is why it survives review.

## Passes

> This site's working copy is at `https://<label>.tracy.ai`, and something is answering there. The
> address is also recorded in `facts/working-copy.json`.

One `find_working_copy` call. The address came from the tool, not from a file that happened to
match, and not from a rule assembled by hand.

## Also passes — nothing there

> Nothing is answering at `https://<label>.tracy.ai`, which is where this site's working copy would
> be. Either it was never built or it is no longer standing. I can build it with
> `build_working_copy`; it takes minutes and reads the live site, but writes nothing to it.

The address is still reported even though no copy stands: it is derived from the site's hostname,
so it is a fact either way. What is *not* claimed is that a copy exists.

## Fails, more subtly

> No build is on the books for this site, so this site has never had a working copy.

`working_copy_status` answering `none` means nothing was recorded **in this session**. The record
is held in memory and an app restart empties it while every copy stays standing. Reading `none` as
"no copy exists" turns a restart into a wrong answer — and the next step it invites, running
`build_working_copy` to "fix" it, rebuilds over a copy somebody may have been working on.

## Fails, and worth naming separately

> The live copy is at `https://<label>.tracy.ai`.

A Site has a **live site** (the customer's own, out on the internet) and a **working copy** (this
one). "Live copy" collapses the two in the one place where confusing them is expensive: someone
reading that sentence may believe a change landed on the customer's real site, or that it is safe
to make one because "it is only the copy". Name the working copy, or name the live site. Never a
word that could be either.
