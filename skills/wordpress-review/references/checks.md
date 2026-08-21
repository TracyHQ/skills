# The fixed checks

Every check here has a stable id, so two runs of the same site can be compared and a merchant can
tell a fix from a mood. Each one says what to ask, where the answer shows up in the measurements,
where it shows up in the picture, and — the part that keeps a check honest — **when not to raise
it**. A check with no "leave it alone" clause turns into noise on its third site.

Severity is a default, not a rule. Move it when the page argues for it, and say why in the
builder's half of the finding.

## Contents

- [Missing](#missing) — something a reader expects and cannot find
- [Inconsistent](#inconsistent) — the site disagreeing with itself
- [Placeholder](#placeholder) — the site is not finished and says so
- [Presentation](#presentation) — it is all there, it just does not read well

---

## Missing

### `empty-block`
**Ask:** is there a section taking up real space with almost nothing in it?
**Numbers:** a `sections` entry with `words` under about 5 and `rect.h` over 80.
**Picture:** a band of colour or whitespace a reader scrolls past with nothing to read.
**Leave it alone when:** the section is carrying an image, a map, a video or a form — those are
content the word count cannot see. Check `images` and `links` on the same entry before raising it.
**Default:** medium.

### `page-missing-heading`
**Ask:** does the page tell the reader what it is?
**Numbers:** no `h1` among the text, or the largest text belongs to a shared block.
**Picture:** the content starts without a title.
**Leave it alone when:** the page is a front page whose hero image carries the name, or a shop
listing where the category name sits in the breadcrumb.
**Default:** medium.

### `contact-page-incomplete`
**Ask:** can a reader who wants to reach this business actually do so?
**Numbers:** the page's visible text has no street address, no opening hours, no email, and the
page carries no form.
**Picture:** a contact page that is a short list of social links.
**Leave it alone when:** the business is online-only and says so, or a chat widget is clearly the
intended channel.
**Default:** high on a page whose title or url says contact; otherwise skip.

### `dead-action`
**Ask:** does every button lead somewhere?
**Numbers:** an `actions` entry whose `href` is empty, `#`, `javascript:void(0)`, or the page's own
url.
**Picture:** a button that looks primary.
**Leave it alone when:** the control opens something on the page — a menu, an accordion, a tab.
Those legitimately have no destination. Prefer raising it when the label promises travel ("view
all", "contact us").
**Default:** medium; high when the label promises a purchase or an enquiry.

### `broken-image`
**Ask:** is every picture actually arriving?
**Numbers:** an `images` entry with `loaded: false`.
**Picture:** the broken-image glyph, or a gap where a picture belongs.
**Leave it alone when:** the image is a tracking pixel — a 1×1 with no alt.
**Default:** high when it is a product or hero image, medium otherwise.

### `thin-page`
**Ask:** is there enough on this page to have been worth publishing?
**Numbers:** `visibleText` barely longer than the header and footer of other pages.
**Picture:** a page that is mostly chrome.
**Leave it alone when:** the page is a deliberate landing page with one clear action, or a
thank-you page.
**Default:** medium.

---

## Inconsistent

These need more than one page, so they are judged after every page is captured. A disagreement is
only worth raising when a reader could plausibly meet both versions.

### `contact-details-disagree`
**Ask:** do the phone number, email and address match everywhere they appear?
**Numbers:** compare `visibleText` across pages, and header against footer within a page.
**Leave it alone when:** the numbers belong to different branches and the page says so.
**Default:** high — a reader who calls the wrong number is a lost sale.

### `brand-name-inconsistent`
**Ask:** is the business written the same way each time?
**Numbers:** the same name appearing with different spacing, capitalisation or spelling across
`visibleText` and `title`.
**Leave it alone when:** one form is plainly a logo wordmark and the other is running prose.
**Default:** low.

### `action-labels-inconsistent`
**Ask:** do buttons that do the same thing say the same thing?
**Numbers:** `actions` entries sharing an `href` shape but differing in `text`.
**Leave it alone when:** the wording is tuned to its surrounding sentence.
**Default:** low.

### `image-ratios-inconsistent`
**Ask:** do the pictures in one row or grid share a shape?
**Numbers:** `images` entries at similar `rect.y` whose `rect.w / rect.h` differ by more than about
15%.
**Leave it alone when:** the layout is deliberately a masonry or collage.
**Default:** low.

### `language-mixed`
**Ask:** is the interface speaking one language?
**Numbers:** English interface strings — "Add to cart", "Read more", "Showing 1–12 of", "Default
sorting" — inside a page whose `lang` and prose are another language.
**Leave it alone when:** the site is genuinely bilingual and offers a switcher.
**Default:** medium.

---

## Placeholder

### `placeholder-text`
**Ask:** is filler copy still live?
**Numbers:** "lorem ipsum", "consectetur adipiscing", "your text here", "insert text",
"sample page", "add your content".
**Leave it alone when:** the phrase appears inside an article that is *about* placeholder text.
**Default:** high — nothing says unfinished more loudly to a visitor.

### `placeholder-media`
**Ask:** are the theme's demo pictures still on the site?
**Picture:** stock photography that does not match the business — a generic landscape on a florist,
an office scene on a bakery.
**Numbers:** the same image reused across unrelated pages, or a filename that looks like a theme
sample.
**Leave it alone when:** you cannot tell. Guessing that a photo is stock is a good way to insult
someone's real photography; raise it only when the mismatch with the business is obvious.
**Default:** medium.

### `demo-page-live`
**Ask:** are the theme's own demo pages still published?
**Numbers:** page urls like `/price-table/`, `/message-box/`, `/logo/`, `/typography/`,
`/shortcodes/`, `/elements/`, or a page whose title matches a theme component.
**Picture:** a page that shows off widgets rather than saying anything.
**Leave it alone when:** the site is a theme demo or a documentation site.
**Default:** medium — harmless to a visitor who never finds it, embarrassing to one who does.

---

## Presentation

### `text-overflow`
**Ask:** is any text escaping the box that holds it?
**Numbers:** an `overflowingText` entry, `scrollWidth` meaningfully wider than `clientWidth`.
**Picture:** a word cut off, or spilling past a button's edge.
**Leave it alone when:** the element is a deliberate marquee or a screen-reader-only label — the
`Skip to content` link is the classic false positive and it is invisible to a reader.
**Default:** medium.

### `text-too-small`
**Ask:** can this be read on a phone?
**Numbers:** `tinyText` entries under 14px carrying real sentences rather than labels.
**Leave it alone when:** the text is a caption, a legal footnote or a badge. Small print is
allowed to be small; body copy is not.
**Default:** medium on mobile, low on desktop.

### `image-distorted`
**Ask:** is any picture squashed or stretched?
**Numbers:** an `images` entry whose displayed `rect.w / rect.h` differs from
`naturalWidth / naturalHeight` by more than about 10%.
**Picture:** faces or logos that look wrong.
**Leave it alone when:** the image is a background pattern or a decorative texture.
**Default:** medium.

### `mobile-cramped`
**Ask:** does the phone layout leave anything usable?
**Numbers:** on the mobile viewport, `scrollWidth` wider than `clientWidth`, or `actions`
rectangles overlapping each other.
**Picture:** floating buttons covering content, columns squeezed into slivers, a header with no
room for anything.
**Leave it alone when:** the overlap is a menu that is meant to sit on top.
**Default:** high — most visitors arrive on a phone.

---

## Writing a finding

Two readers, one finding. The owner's sentence says what a visitor runs into and why it costs
something; it never names a css class. The builder's half carries the block, the numbers and the
viewport, and may be as technical as it needs to be.

The owner's sentence is the harder half. "The section is empty" is a fact; "a visitor scrolling
your contact page hits a blank green band the height of their screen" is the same fact told to
someone who has to decide whether to pay for the fix.
