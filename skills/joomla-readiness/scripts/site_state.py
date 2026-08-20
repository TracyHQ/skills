#!/usr/bin/env python3
"""What a site says about itself, joined to what the registry knows.

The two inputs are the whole point of this module existing. Both are available to anyone with
their own site connected to Tracy, and neither needs anything of JoomlArt's:

    component `info`            -> JVERSION, the core version, exact
    component `extension.list`  -> name, type, element, version, enabled
    registry.tracy.ai/platform  -> 5,604 Joomla extensions with isJ3..isJ6

The readiness report this replaces read JoomlArt's production database and a CSV on one
laptop. It could tell a customer what they had *downloaded*, on a machine only one team could
run. This reads what is *installed*, on anyone's.

## The gap this module is mostly about

The registry is keyed by JED listing slug. A site reports Joomla element names. There is no
shared key, and the mismatch is not small:

    k2            -> com_k2         the slug happens to be the element
    akeeba-backup -> com_akeeba     close, and not equal
    jomsocial     -> com_community  no textual relationship at all

Measured against the live registry on 2026-08-19: of 5,604 Joomla records, only **13% have a
single-word slug** with any chance of equalling an element. The other 87% are reachable, if at
all, through the human name. That is the ceiling this module works under, and it is why the
count of what could not be matched is a headline number rather than a footnote.

One more figure from the same read, because it is the reason this whole layer matters: **59%
of the registry says it has no Joomla 6 build**, against 40% that says it has. Third-party
extensions really are what blocks an upgrade, and the report this replaces could not see a
single one of them.

So this does not try to match everything. It matches what two independent routes can reach,
counts what neither could, and puts that count where nobody can miss it. A report that quietly
drops the half it did not recognise would be worse than one that admits the half.
"""
from __future__ import annotations

import re

CORE, MATCHED, UNRECOGNISED = "core", "matched", "unrecognised"

#: Element prefixes Joomla gives its own extension types. Stripped before comparing to a
#: listing slug, which never carries them.
_TYPE_PREFIXES = ("com_", "mod_", "plg_", "tpl_", "lib_", "pkg_", "file_")



#: Every extension Joomla ships with itself, read from its own install SQL across the four
#: releases a site being examined can be on: 3.10.12, 4.4.14, 5.4.8 and 6.1.3. 265 names.
#:
#: The rule before this one was "its version equals the core's", which was inferred rather than
#: checked. Joomla's install SQL settles it: all 248 core rows in 6.1.3 ship with an empty
#: `manifest_cache`, so their version reads as null and not one of them would have matched.
#:
#: The list moves between releases, so the union is what a reader needs: 25 names in Joomla 3
#: are gone by Joomla 4, and Joomla 6 carries 65 that Joomla 4 did not.
#:
#: Worth the bytes. A Joomla 6 site holds 248 of these, 156 of them plugins. Failing to recognise
#: them floods a report with rows a customer can do nothing about and buries the few that matter.
_CORE_NAMES = frozenset((
    "atum", "beez3", "cassiopeia",
    "cassiopeia_extended", "com_actionlogs", "com_admin",
    "com_ajax", "com_associations", "com_banners",
    "com_cache", "com_categories", "com_checkin",
    "com_config", "com_contact", "com_content",
    "com_contenthistory", "com_cpanel", "com_fields",
    "com_finder", "com_guidedtours", "com_installer",
    "com_joomlaupdate", "com_languages", "com_login",
    "com_mails", "com_mailto", "com_media",
    "com_menus", "com_messages", "com_modules",
    "com_newsfeeds", "com_plugins", "com_postinstall",
    "com_privacy", "com_redirect", "com_scheduler",
    "com_search", "com_tags", "com_templates",
    "com_users", "com_workflow", "com_wrapper",
    "files_joomla", "mod_articles", "mod_articles_archive",
    "mod_articles_categories", "mod_articles_category", "mod_articles_latest",
    "mod_articles_news", "mod_articles_popular", "mod_banners",
    "mod_breadcrumbs", "mod_custom", "mod_feed",
    "mod_finder", "mod_footer", "mod_frontend",
    "mod_guidedtours", "mod_languages", "mod_latest",
    "mod_latestactions", "mod_logged", "mod_login",
    "mod_loginsupport", "mod_menu", "mod_messages",
    "mod_multilangstatus", "mod_popular", "mod_post_installation_messages",
    "mod_privacy_dashboard", "mod_privacy_status", "mod_quickicon",
    "mod_random_image", "mod_related_items", "mod_sampledata",
    "mod_search", "mod_stats", "mod_stats_admin",
    "mod_status", "mod_submenu", "mod_syndicate",
    "mod_tags_popular", "mod_tags_similar", "mod_title",
    "mod_toolbar", "mod_user", "mod_users_latest",
    "mod_version", "mod_whosonline", "mod_wrapper",
    "plg_actionlog_joomla", "plg_api-authentication_basic", "plg_api-authentication_token",
    "plg_authentication_cookie", "plg_authentication_gmail", "plg_authentication_joomla",
    "plg_authentication_ldap", "plg_behaviour_compat", "plg_behaviour_compat6",
    "plg_behaviour_taggable", "plg_behaviour_versionable", "plg_captcha_powcaptcha",
    "plg_captcha_recaptcha", "plg_captcha_recaptcha_invisible", "plg_content_confirmconsent",
    "plg_content_contact", "plg_content_emailcloak", "plg_content_fields",
    "plg_content_finder", "plg_content_joomla", "plg_content_loadmodule",
    "plg_content_pagebreak", "plg_content_pagenavigation", "plg_content_vote",
    "plg_editors-xtd_article", "plg_editors-xtd_contact", "plg_editors-xtd_fields",
    "plg_editors-xtd_image", "plg_editors-xtd_menu", "plg_editors-xtd_module",
    "plg_editors-xtd_pagebreak", "plg_editors-xtd_readmore", "plg_editors_codemirror",
    "plg_editors_none", "plg_editors_tinymce", "plg_extension_finder",
    "plg_extension_joomla", "plg_extension_joomlaupdate", "plg_extension_namespacemap",
    "plg_fields_calendar", "plg_fields_checkboxes", "plg_fields_color",
    "plg_fields_editor", "plg_fields_imagelist", "plg_fields_integer",
    "plg_fields_list", "plg_fields_media", "plg_fields_note",
    "plg_fields_number", "plg_fields_radio", "plg_fields_repeatable",
    "plg_fields_sql", "plg_fields_subform", "plg_fields_text",
    "plg_fields_textarea", "plg_fields_url", "plg_fields_user",
    "plg_fields_usergrouplist", "plg_filesystem_local", "plg_finder_categories",
    "plg_finder_contacts", "plg_finder_content", "plg_finder_newsfeeds",
    "plg_finder_tags", "plg_installer_folderinstaller", "plg_installer_override",
    "plg_installer_packageinstaller", "plg_installer_urlinstaller", "plg_installer_webinstaller",
    "plg_media-action_crop", "plg_media-action_resize", "plg_media-action_rotate",
    "plg_multifactorauth_email", "plg_multifactorauth_fixed", "plg_multifactorauth_totp",
    "plg_multifactorauth_webauthn", "plg_multifactorauth_yubikey", "plg_privacy_actionlogs",
    "plg_privacy_consents", "plg_privacy_contact", "plg_privacy_content",
    "plg_privacy_message", "plg_privacy_user", "plg_quickicon_autoupdate",
    "plg_quickicon_downloadkey", "plg_quickicon_eos", "plg_quickicon_eos310",
    "plg_quickicon_extensionupdate", "plg_quickicon_joomlaupdate", "plg_quickicon_overridecheck",
    "plg_quickicon_phpversioncheck", "plg_quickicon_privacycheck", "plg_sampledata_blog",
    "plg_sampledata_multilang", "plg_schemaorg_article", "plg_schemaorg_blogposting",
    "plg_schemaorg_book", "plg_schemaorg_custom", "plg_schemaorg_event",
    "plg_schemaorg_jobposting", "plg_schemaorg_organization", "plg_schemaorg_person",
    "plg_schemaorg_recipe", "plg_search_categories", "plg_search_contacts",
    "plg_search_content", "plg_search_newsfeeds", "plg_search_tags",
    "plg_system_accessibility", "plg_system_actionlogs", "plg_system_cache",
    "plg_system_debug", "plg_system_fields", "plg_system_guidedtours",
    "plg_system_highlight", "plg_system_httpheaders", "plg_system_jooa11y",
    "plg_system_languagecode", "plg_system_languagefilter", "plg_system_log",
    "plg_system_logout", "plg_system_logrotation", "plg_system_p3p",
    "plg_system_privacyconsent", "plg_system_redirect", "plg_system_remember",
    "plg_system_schedulerunner", "plg_system_schemaorg", "plg_system_sef",
    "plg_system_sessiongc", "plg_system_shortcut", "plg_system_skipto",
    "plg_system_stats", "plg_system_tasknotification", "plg_system_updatenotification",
    "plg_system_webauthn", "plg_task_checkfiles", "plg_task_deleteactionlogs",
    "plg_task_demotasks", "plg_task_globalcheckin", "plg_task_privacyconsent",
    "plg_task_requests", "plg_task_rotatelogs", "plg_task_sessiongc",
    "plg_task_sitestatus", "plg_task_updatenotification", "plg_twofactorauth_totp",
    "plg_twofactorauth_yubikey", "plg_user_contactcreator", "plg_user_joomla",
    "plg_user_profile", "plg_user_terms", "plg_user_token",
    "plg_webservices_banners", "plg_webservices_config", "plg_webservices_contact",
    "plg_webservices_content", "plg_webservices_installer", "plg_webservices_joomlaupdate",
    "plg_webservices_languages", "plg_webservices_media", "plg_webservices_menus",
    "plg_webservices_messages", "plg_webservices_modules", "plg_webservices_newsfeeds",
    "plg_webservices_plugins", "plg_webservices_privacy", "plg_webservices_redirect",
    "plg_webservices_tags", "plg_webservices_templates", "plg_webservices_users",
    "plg_workflow_featuring", "plg_workflow_notification", "plg_workflow_publishing",
    "protostar",
))


#: The thirteen core rows whose `name` is a human title rather than a language key, matched on
#: type and element together. "Joomla! Platform" has element `joomla` and "PHPass" has `phpass`,
#: and putting those in a list matched by name alone would swallow any third-party extension
#: that happens to use them. Swallowing third-party products is the failure direction that hides
#: what an upgrade breaks, so the pair is used: no component or module can collide with a
#: library or a template.
_CORE_TYPED = frozenset((
    ("language", "en-GB"),
    ("library", "fof"),
    ("library", "idna_convert"),
    ("library", "joomla"),
    ("library", "phpass"),
    ("library", "phputf8"),
    ("package", "pkg_en-GB"),
    ("template", "atum"),
    ("template", "beez3"),
    ("template", "cassiopeia"),
    ("template", "hathor"),
    ("template", "isis"),
    ("template", "protostar"),
))

def _squash(text: str) -> str:
    """A name with every separator removed. The same rule the readiness report already uses
    for catalog names, and here for the same reason: two sources spell one product two ways."""
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _strip_type(element: str) -> str:
    low = (element or "").lower()
    for prefix in _TYPE_PREFIXES:
        if low.startswith(prefix):
            return low[len(prefix):]
    return low


#: Marks a key that more than one product answers to, so it can be dropped once the whole
#: registry has been walked rather than guessed at on the way through.
_AMBIGUOUS = object()


def _put(table: dict, key: str, record: dict) -> None:
    if not key:
        return
    table[key] = _AMBIGUOUS if key in table else record


def _index(registry: dict) -> tuple[dict, dict]:
    """Two lookup tables, because there are two routes in and they find different things.

    By slug, `k2` is reachable and `jomsocial` is not. By title, `JomSocial` is reachable.
    Neither route alone covers what a real site holds.
    """
    by_slug, by_title = {}, {}
    for slug, record in registry.items():
        _put(by_slug, _squash(record.get("slug") or slug), record)
        title = record.get("title")
        if title:
            _put(by_title, _squash(title), record)
    # A key two different products answer to is dropped rather than resolved to one of them.
    # Measured on the live registry 2026-08-19: 4 titles and 5 slugs collide, "Count Down"
    # against "Countdown", "Custom CSS" against "CustomCSS", "Backdoor" against "AdminExile".
    # Eight records, 0.2%, and picking whichever was seen first was silent. Rare is not
    # harmless: a wrong verdict is worse than an honest unknown, and "two products answer to
    # this name" is an honest unknown.
    return ({k: v for k, v in by_slug.items() if v is not _AMBIGUOUS},
            {k: v for k, v in by_title.items() if v is not _AMBIGUOUS})


def classify(extension: dict, registry: dict, *, core_version: str,
             index: tuple[dict, dict] | None = None) -> dict:
    """One installed extension: is it core, is it in the registry, and what does it say.

    Core is decided by its version matching the core's. That is the only signal the component
    gives us, and it is wrong in one direction: a third party shipping the same version string
    reads as core. Rare, and the safe way round, because a core row makes no claim at all while
    a wrong lookup would make a false one.
    """
    by_slug, by_title = index if index is not None else _index(registry)
    name = str(extension.get("name") or "")
    element = str(extension.get("element") or "")
    version = str(extension.get("version") or "")

    row = {
        "name": name,
        "element": element,
        "type": str(extension.get("type") or ""),
        "version": version,
        "enabled": bool(extension.get("enabled")),
        "state": UNRECOGNISED,
        "match": None,
        "isJ6": None,
    }

    # The name Joomla itself gives the extension, first. Then the version, which still catches a
    # core extension from a release this list does not cover or one renamed since.
    kind = str(extension.get("type") or "")
    if name in _CORE_NAMES or element in _CORE_NAMES or (kind, element) in _CORE_TYPED:
        row["state"] = CORE
        return row
    if core_version and version and version == core_version:
        row["state"] = CORE
        return row

    record = by_slug.get(_squash(_strip_type(element))) or by_title.get(_squash(name))
    if record is None:
        return row

    joomla = (record.get("platformData") or {}).get("joomla") or {}
    row["state"] = MATCHED
    row["match"] = record.get("slug")
    # None rather than False when the registry has the product but says nothing about Joomla 6.
    # "We have no reading" and "it does not support 6" are different answers to a customer.
    row["isJ6"] = joomla.get("isJ6") if "isJ6" in joomla else None
    return row


def read_state(*, version: str, extensions: list, registry: dict) -> dict:
    """The whole picture, with the counts that must never be quiet.

    `version` empty is a real state, not an error: in relay-only mode `list_extensions` works
    but the relay's own capability service says it cannot tell Joomla 4 from 5+, so the core
    stays unanswered while the extensions are still answerable. The report has to say which.
    """
    index = _index(registry)
    rows = [classify(e, registry, core_version=version, index=index) for e in (extensions or [])]

    counts = {
        "total": len(rows),
        "core": sum(1 for r in rows if r["state"] == CORE),
        "matched": sum(1 for r in rows if r["state"] == MATCHED),
        "unrecognised": sum(1 for r in rows if r["state"] == UNRECOGNISED),
    }

    warnings = []
    if not version:
        warnings.append(
            "The Joomla version could not be read, so nothing here is said about the core "
            "itself. Extensions are still answered.")
    if not rows:
        warnings.append(
            "No extensions were read from this site, so this is not a clean bill of health: "
            "it is a report with nothing to work from.")
    if counts["unrecognised"]:
        # Counted against what could be looked up, not against the whole install. A Joomla 5.4
        # site carries 241 core rows that were never going to be in a third-party directory, and
        # a first real run reported "1 of 249" where the honest figure was one in four.
        # Understating uncertainty is the same class of mistake as overstating a verdict.
        lookups = counts["total"] - counts["core"]
        warnings.append(
            f"{counts['unrecognised']} of {lookups} non-core extensions are not in the public "
            "registry, so their Joomla 6 status is unknown rather than fine. The registry is "
            "keyed by directory listing and a site reports element names; the two do not always "
            "meet.")

    return {
        "core": {"version": version, "known": bool(version)},
        "extensions": rows,
        "counts": counts,
        "warnings": warnings,
    }
