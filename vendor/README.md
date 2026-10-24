# vendor/

Third-party material kept **unedited**, under its own licence, because something here is derived
from it.

Nothing in this directory is a skill this registry serves. A skill lives in `skills/` and has a
record in `registry/`; these have neither, on purpose — the test for a marketplace skill is *"who
would install this, and what are they trying to do for their website?"*, and nothing here passes it.

| | Why it is kept |
| --- | --- |
| `skill-creator/` | Anthropic's own skill-authoring skill. `skills/README.md` derives this repo's authoring rules from it, and `check-skill` exempts a vendored directory by the presence of `LICENSE.txt` — a rule written for this copy |

**Do not edit anything in here.** A local fix forks the copy from upstream: an upstream improvement
then never arrives, and the local one never travels back. That divergence is the exact state the
vendored Mention Network skills are already in, and it is the reason this directory exists rather
than the material simply being edited in place.
