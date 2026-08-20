# A readiness run, end to end

What this skill does on one site, from the two tool calls to the report.

Constructed rather than captured: the site is fictional, so no customer's install is published
here. Everything else is real — every version, every registry answer and every sentence below
was produced by the scripts in this skill, run against the live registry on 2026-08-20 and
pasted rather than written.

Written because nobody could see what a finished report looked like without running one. The
first draft of this file **was** written by hand, and it got the PHP advice wrong in exactly the
way `php_step` exists to prevent. That is the third lesson at the bottom.

## What the tools returned

```
mcp__tracy-site__read_versions
  { "joomla": "5.2.5", "php": "8.2" }

mcp__tracy-site__list_extensions        (the non-core rows)
  K2                       com_k2          component  2.11.1  enabled
  JCE                      com_jce         component  2.9.99  enabled
  RSForm! Pro              com_rsform      component  3.1.9   enabled
  Xmap - K2 Plugin         com_k2          plugin     2.3.3   enabled   group: xmap
  Xmap - WebLinks Plugin   com_weblinks    plugin     2.3.3   enabled   group: xmap
  Some Custom Thing        com_inhouse     component  1.0.0   enabled
```

Plus the package manifest, which `list_extensions` cannot supply today:

```
administrator/manifests/packages/pkg_xmap.xml
  { "name": "Xmap Package", "element": "xmap", "version": "2.3.3",
    "children": [ {"type": "plugin", "element": "com_k2",       "group": "xmap"},
                  {"type": "plugin", "element": "com_weblinks", "group": "xmap"} ] }
```

## The engine

```python
state   = read_state(version="5.2.5", extensions=rows, registry=cat.records, packages=pkgs)
profile = profile_from_state(state, php="8.2")
verdict = decide(profile)

# counts: {'total': 7, 'core': 0, 'matched': 3, 'unrecognised': 2, 'part': 2}
# profile.php_note = ""      hops_to_six = 2      extensions_read = 7
```

Without `packages`, the two Xmap plugins are two more unknown products. With it they are two
`part` rows answered by one package, and the count a customer reads drops accordingly.

## The report

> ### Work needed
> **Some of what you run is not ready for Joomla 6 yet.**
>
> This verdict is calculated only over what we looked at: the 5 extensions installed on this
> site. It covers what the site reports as installed, looked up in the public extension
> directory. Anything the directory does not list is named above as unknown rather than treated
> as fine.
>
> **What blocks the upgrade**
>
> - This site runs Joomla 5.2.5, which is two upgrades away from Joomla 6, not one. Joomla's
>   update server refuses to skip a release line, so this is a staged migration and has to be
>   planned as one regardless of which products are ready.
> - Some Custom Thing: This is not in the public extension registry, so nothing is known about
>   its Joomla 6 status. That is not the same as it being fine.
> - Xmap Package: This is not in the public extension registry, so nothing is known about its
>   Joomla 6 status. That is not the same as it being fine.
> - K2: The extension directory records no Joomla 6 build for this.
>
> **What to do next**
>
> - Plan the move in stages rather than as one upgrade. Our migration service does exactly this
>   and can quote for it.
> - Some of what is installed is not in the public extension directory, so nobody has published
>   a Joomla 6 status for it. Ask whoever supplied it, or ask us and we will check it for you.
>   Please do not upgrade on the assumption that it is ready.
> - Where there is no Joomla 6 build, none has been announced either. Ask us about the options:
>   some of these can be replaced with a maintained product, some may run as they are, and we
>   will tell you which is which rather than leave you to find out on the live site.
>
> **What this report did not look at**
>
> - Whether each extension below is actually in use. It is installed; that is what was read.
> - 2 of 5 non-core extensions are not in the public registry, so their Joomla 6 status is
>   unknown rather than fine. The registry is keyed by directory listing and a site reports
>   element names; the two do not always meet.
>
> Extension directory read on 2026-08-04.

## Three things this example exists to show

**5.2 is two hops, not one.** A Joomla 6 package is offered only to 5.4, so this site must reach
its own launch point first. Counting majors gets this wrong, and this skill said one upgrade
until 2026-08-20.

**Nothing is said about PHP here, and that is the point.** `profile.php_note` is empty. The site
runs 8.2 and the next hop is 5.2 to 5.4, a point update inside one major, which requires no PHP
change at all. The 8.3 requirement belongs to the hop after it. Run the same site once it is on
5.4 and the note appears:

```
Set PHP to 8.3 or newer before the next step. The site is on 8.2, and Joomla 6.1 will not
install below 8.3. ...
```

The hand-written first draft of this file put that sentence in the report above, because 8.3 is
what Joomla 6 needs and this site is going to Joomla 6. A customer acting on it would have moved
PHP a rung early, on a live site, for a hop that did not ask for it. Ask the engine; do not
reason it out.

**The unknown is printed, not filled.** Two rows nobody has published a verdict for stay two
rows nobody has published a verdict for — in the blockers, in the next steps and in the count.
They are never rounded to fine.
