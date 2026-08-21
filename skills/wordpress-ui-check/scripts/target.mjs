// Which Preview of the site is actually being looked at, and saying so out loud.
//
// A site managed by Tracy exists at two addresses at once: the live domain the public reaches, and
// a Preview on the fleet at `<label>.tracy.ai` — which is what the app's preview pane shows,
// and therefore what the person is looking at while they read the review. Reviewing the live site
// and pointing at the Preview would describe one page while showing another.
//
// So the Preview is the default when there is one, the live site is the fallback when there is not,
// and which one it was is written at the top of every review. A review that does not say which
// version it read is a review nobody can act on six weeks later.
//
// The label is COMPUTED here rather than asked of the app, because the app has no tool that
// answers it — `scan_now` and `reload_preview` are the whole surface an agent gets. It is the same
// construction the fleet uses: a readable form of the hostname, then eight hex digits of
// SHA-256 over that hostname, which is what actually carries identity. Verified against a live
// site on 2026-08-21: `juneflower.vn` → `juneflower-vn-7f6409d0`, which answers 200.
//
// Computing it is a guess until it answers, and that is exactly how it is treated: the address is
// probed, and only a Preview that responds is scanned.

import { createHash } from "node:crypto";

/** The fleet's zone. Overridable for a developer pointed at a relay serving a different one. */
const FLEET_ZONE = process.env.TRACY_FLEET_ZONE || "tracy.ai";

/** A hostname as one DNS label: readable prefix for a person, hash suffix for uniqueness. */
export function fleetLabel(host) {
  const readable = host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const hash = createHash("sha256").update(host.toLowerCase()).digest("hex").slice(0, 8);
  return `${readable.slice(0, 63 - hash.length - 1).replace(/-+$/, "")}-${hash}`;
}

/** Where this site's Preview would live, if it has one. */
export function previewUrl(siteOrigin) {
  return `https://${fleetLabel(new URL(siteOrigin).hostname)}.${FLEET_ZONE}`;
}

/**
 * What the Preview is currently serving, as one string.
 *
 * Two files, both published by the Tracy side of a managed site: one names the commit a deploy
 * landed, the other stamps a change made in the CMS database — which produces no commit at all, and
 * is where most content changes live. Read together they are "what this Preview is showing right now".
 *
 * `null` when neither answers, and that is a real and common answer rather than an error: measured
 * on juneflower's Preview on 2026-08-21, both files return 404. A site can be perfectly managed and
 * still publish neither, so nothing here may depend on a revision existing — the page fingerprints
 * are what carry the "has anything changed" question, and this is a cheap corroboration when it is
 * available.
 */
export async function revisionOf(origin, fetchText) {
  const parts = await Promise.all(
    ["/tracy-deployed.json", "/tracy-changed.json"].map(async (file, i) => {
      const res = await fetchText(`${origin}${file}?t=${Date.now()}`);
      if (!res.ok) return null;
      try {
        const value = JSON.parse(res.text)[i === 0 ? "commit" : "at"];
        return typeof value === "string" || typeof value === "number" ? String(value) : null;
      } catch {
        // A WordPress site with no such file answers with its 404 PAGE, which is HTML. That is a
        // "no" and not a malfunction.
        return null;
      }
    })
  );
  return parts.some((p) => p !== null) ? parts.map((p) => p ?? "-").join("/") : null;
}

/**
 * Decide what to scan, and report it in the shape the review file stores.
 *
 * `want` is `auto` (a Preview if it answers, otherwise the live site), `preview`, `live`, or an explicit
 * address for a Preview somewhere this construction would not find.
 *
 * `preview` refuses to fall back. Somebody who names the Preview is usually about to compare a review
 * against a change they made there, and quietly reviewing the live site instead would answer a
 * question they did not ask.
 */
export async function resolveTarget(siteOrigin, want, fetchText) {
  const live = { kind: "live", url: siteOrigin, revision: null, at: new Date().toISOString() };

  if (want === "live") return live;

  const explicit = /^https?:\/\//i.test(want ?? "");
  const url = explicit ? new URL(want).origin : previewUrl(siteOrigin);

  if (want === "auto" || want === "preview" || explicit) {
    const res = await fetchText(`${url}/`);
    if (res.ok) {
      return { kind: "preview", url, revision: await revisionOf(url, fetchText), at: live.at };
    }
    if (want === "auto") return { ...live, previewTried: url };
    return { kind: "unreachable", url, error: `${url} did not answer (status ${res.status})` };
  }

  return { kind: "unreachable", url: want, error: `unknown --target ${want}` };
}

/**
 * A Preview on the fleet does not serve the site at its own address. It serves a SNAPSHOT
 * SHELL: a Tracy bar across the top ("Invite a team member", "Download Tracy Desk") and the site
 * itself inside an iframe pointed at the same path with `__tracy_frame=1` on it.
 *
 * Measured 21/08 on juneflower's Preview. Fetching `https://<label>.tracy.ai/` returns 7.9KB of
 * chrome; the same path with the parameter returns the 129KB page. The shell is served on any
 * request that asks for `text/html`, which is every browser navigation and therefore every
 * screenshot — so without this, the review would have measured the Tracy bar on twenty pages and
 * reported that the whole site was empty. It nearly did: the first run against the Preview found
 * 119 of 120 pages identical, with no body class between them.
 *
 * The parameter is the fleet's, not this repo's, and it appears nowhere in the desk's source — so
 * it is used AND checked. `looksLikeSnapshotShell` is what turns "the fleet renamed it" from a
 * review full of nonsense into a refusal that says what happened.
 */
const SNAPSHOT_PARAM = "__tracy_frame";

const isFleetPreview = (url) => {
  try {
    return new URL(url).hostname.endsWith(`.${FLEET_ZONE}`);
  } catch {
    return false;
  }
};

/** The address that actually serves the page, rather than the frame around it. */
export function pageUrl(url, target) {
  if (target?.kind !== "preview" || !isFleetPreview(target.url)) return url;
  const u = new URL(url);
  u.searchParams.set(SNAPSHOT_PARAM, "1");
  return u.toString();
}

/** The shell, recognised by the frame it wraps the site in. */
export const looksLikeSnapshotShell = (html) =>
  /<iframe[^>]+id=["']tracy-frame["']/i.test(html) || /<div[^>]+id=["']tracy-bar["']/i.test(html);

/** The same path on whichever address is being scanned. */
export const onTarget = (url, siteOrigin, targetUrl) =>
  targetUrl === siteOrigin ? url : url.replace(siteOrigin, targetUrl);

/** The canonical path a finding is filed under, so a review survives moving between the two. */
export const pathOf = (url) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};
