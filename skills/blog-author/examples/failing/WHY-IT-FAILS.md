# Six faults, and why each one reads fine

Every one of these came out of following the brief loosely instead of reading it. None of them
looks wrong on its own, which is the point.

## 1. Written in the wrong language

`"language": "en-GB"` on a German site whose every page addresses the reader as *Sie*. The brand
brief says `de-DE`. English is the default an agent falls into when nobody stops it, and the
client's own readers cannot use the result.

## 2. A number with no source

*"Studies show that 73% of relaunches fail"* with `sources: []`. There is no such file, no such
study, and the sentence has a percentage in it, which is exactly what makes a reader trust it. The
rule is not "hedge the claim", it is "the sentence goes".

## 3. A price, on a site that publishes no prices

*"Packages start at 4.900 EUR."* The brand brief lists prices as a taboo and the site publishes
none anywhere. Two costs at once: the number is invented, and it commits the client to something
in public.

## 4. A named client and a result claimed for them

*"Müller Maschinenbau saw a 40% increase in leads."* This site deliberately has no reference page.
Naming a client is a decision only they can make, and the 40% is the same fault as fault 2 wearing
a case-study costume.

## 5. An alias that will collide

`"alias": "relaunch"` is a single common word on a site that already has a `/leistungen/relaunch`
page. The alias is the public URL. The gate refuses the collision, but the deeper problem is that
this alias was never looked at next to the site's existing ones, because the mapping does not list
aliases at all.

## 6. Defaults where decisions belong

`catid: 9` and `created_by: 42` are not read from anything. They are the numbers that appear when
a shell article is created for a layout position, and they will file the article under whatever
category 9 happens to be on this site, signed by whoever user 42 is. Both belong in the mapping,
read from the content map and the brief.

## And the mapping itself

`failing/mapping.md` lists three titles and nothing else. No category, no language, no signing
account, no evidence for any topic, nothing decided against. A person cannot approve that, they
can only nod at it. Two of the three topics are ones the passing batch rejected on purpose, which
is what happens when the mapping is written as a table of contents instead of a record of
judgement.

## One thing that is not a fault

`publish_up` is set to a future date, which is what a client would want. It is listed here because
it interacts badly with the immediate render check, not because dating an article is wrong. See
`references/article-contract.md`.
