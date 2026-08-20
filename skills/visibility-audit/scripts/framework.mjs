// The Product-Visibility framework, hand-ported from the backend's own encoding
// (`backend/src/modules/website-audit/scorers/framework.constants.ts`). 40 criteria across
// 4 factors, with the weights, impact badges and merchant-facing copy the report prints.
//
// Why a copy and not an MCP fetch: the backend exposes the framework only through a
// *finished* audit (`get_website_audit_report`), and running one there is exactly the cost
// this skill exists to avoid. So it is duplicated BY HAND, and — unlike the source agent
// pack's own copy of this file — nothing here pins it against the backend automatically.
// The pack's `framework-drift.test.mjs` protects ITS copy, not this one, and that test does
// not exist in this repo (see SKILL.md, *Where this came from*, and FRAMEWORK.md). A re-port
// has to be checked against the backend source by hand; a drifted criterion here is caught
// late, on submit, as `[AGGREGATE_MISMATCH]` / `[COVERAGE_MISMATCH]` from the server's own
// re-computation — not by a local test failing.

export const TOTAL_CRITERIA = 40

export const FACTORS = {
  discoverability: {
    weightPct: 28,
    criteriaCount: 15,
    subGroups: {
      'access-findability': { pct: 30 },
      'content-readability': { pct: 25 },
      'machine-readability': { pct: 45 },
    },
  },
  content: {
    weightPct: 30,
    criteriaCount: 13,
    subGroups: {
      'product-facts': { pct: 30 },
      'decision-support': { pct: 25 },
      'ai-readiness': { pct: 25 },
      'questions-answered': { pct: 20 },
    },
  },
  'entity-trust': {
    weightPct: 30,
    criteriaCount: 10,
    subGroups: {
      'business-credibility': { pct: 25 },
      'reviews-buzz': { pct: 52 },
      'authority-recognition': { pct: 23 },
    },
  },
  merchant: {
    weightPct: 12,
    criteriaCount: 2,
    subGroups: { merchant: { pct: 100 } },
  },
}

const D = 'discoverability'
const C = 'content'
const E = 'entity-trust'
const M = 'merchant'

// key → { factor, subGroup, weight (1|2|3), impact }
export const CRITERIA = {
  // ---- Factor 1 · Discoverability (15) ----
  'ai-bots-allowed': { factor: D, subGroup: 'access-findability', weight: 3, impact: 'Critical' },
  'google-merchant-feed': { factor: D, subGroup: 'access-findability', weight: 3, impact: 'Critical' },
  'internal-linking': { factor: D, subGroup: 'access-findability', weight: 1, impact: 'Medium' },
  'crawlable-text': { factor: D, subGroup: 'content-readability', weight: 2, impact: 'High' },
  'image-alt-text': { factor: D, subGroup: 'content-readability', weight: 1, impact: 'Medium' },
  'heading-hierarchy': { factor: D, subGroup: 'content-readability', weight: 1, impact: 'Medium' },
  'brand-in-title': { factor: D, subGroup: 'content-readability', weight: 3, impact: 'Critical' },
  'product-schema': { factor: D, subGroup: 'machine-readability', weight: 3, impact: 'Critical' },
  'product-schema-rich': { factor: D, subGroup: 'machine-readability', weight: 2, impact: 'High' },
  'review-schema': { factor: D, subGroup: 'machine-readability', weight: 2, impact: 'High' },
  'shipping-schema': { factor: D, subGroup: 'machine-readability', weight: 2, impact: 'High' },
  'faq-schema': { factor: D, subGroup: 'machine-readability', weight: 2, impact: 'High' },
  'organization-schema': { factor: D, subGroup: 'machine-readability', weight: 3, impact: 'Critical' },
  'breadcrumb-schema': { factor: D, subGroup: 'machine-readability', weight: 1, impact: 'Medium' },
  'video-schema': { factor: D, subGroup: 'machine-readability', weight: 1, impact: 'Medium' },
  // ---- Factor 2 · Content quality & coverage (13) ----
  specifications: { factor: C, subGroup: 'product-facts', weight: 3, impact: 'Critical' },
  'original-media': { factor: C, subGroup: 'product-facts', weight: 1, impact: 'Medium' },
  'compatibility-sizing': { factor: C, subGroup: 'product-facts', weight: 2, impact: 'High' },
  'safety-materials': { factor: C, subGroup: 'product-facts', weight: 2, impact: 'High' },
  'benefits-outcomes': { factor: C, subGroup: 'decision-support', weight: 2, impact: 'High' },
  'limitations-honest': { factor: C, subGroup: 'decision-support', weight: 1, impact: 'Medium' },
  'comparison-alternatives': { factor: C, subGroup: 'decision-support', weight: 2, impact: 'High' },
  'who-is-it-for': { factor: C, subGroup: 'decision-support', weight: 2, impact: 'High' },
  'faq-product': { factor: C, subGroup: 'questions-answered', weight: 3, impact: 'Critical' },
  'troubleshooting-care': { factor: C, subGroup: 'questions-answered', weight: 1, impact: 'Medium' },
  'unique-description': { factor: C, subGroup: 'ai-readiness', weight: 3, impact: 'Critical' },
  freshness: { factor: C, subGroup: 'ai-readiness', weight: 1, impact: 'Medium' },
  'answer-formatting': { factor: C, subGroup: 'ai-readiness', weight: 3, impact: 'Critical' },
  // ---- Factor 3 · Entity trust & authority (10) ----
  'about-page': { factor: E, subGroup: 'business-credibility', weight: 1, impact: 'Medium' },
  'contact-info': { factor: E, subGroup: 'business-credibility', weight: 2, impact: 'High' },
  'policies-quality': { factor: E, subGroup: 'business-credibility', weight: 2, impact: 'High' },
  'onsite-reviews': { factor: E, subGroup: 'business-credibility', weight: 1, impact: 'Medium' },
  'google-reviews': { factor: E, subGroup: 'reviews-buzz', weight: 2, impact: 'High' },
  trustpilot: { factor: E, subGroup: 'reviews-buzz', weight: 2, impact: 'High' },
  reddit: { factor: E, subGroup: 'reviews-buzz', weight: 3, impact: 'Critical' },
  'social-video-mentions': { factor: E, subGroup: 'reviews-buzz', weight: 2, impact: 'High' },
  'press-and-lists': { factor: E, subGroup: 'authority-recognition', weight: 3, impact: 'Critical' },
  'entity-databases': { factor: E, subGroup: 'authority-recognition', weight: 1, impact: 'Medium' },
  // ---- Factor 4 · Merchant competitiveness (2) ----
  'price-competitive': { factor: M, subGroup: 'merchant', weight: 2, impact: 'High' },
  'shipping-competitive': { factor: M, subGroup: 'merchant', weight: 1, impact: 'Medium' },
}

export const CRITERION_TITLES = {
  'ai-bots-allowed': 'AI crawler access',
  'google-merchant-feed': 'Google Shopping listing',
  'internal-linking': 'Internal links',
  'brand-in-title': 'Brand in title',
  'crawlable-text': 'AI-readable text',
  'image-alt-text': 'Image descriptions',
  'heading-hierarchy': 'Heading structure',
  'product-schema': 'Product schema',
  'product-schema-rich': 'Product identity',
  'review-schema': 'Review schema',
  'shipping-schema': 'Shipping schema',
  'faq-schema': 'FAQ schema',
  'organization-schema': 'Organization schema',
  'breadcrumb-schema': 'Breadcrumb schema',
  'video-schema': 'Video schema',
  specifications: 'Product Specifications',
  'original-media': 'Product media',
  'compatibility-sizing': 'Fit & compatibility',
  'safety-materials': 'Safety & ingredients',
  'benefits-outcomes': 'Customer benefits',
  'limitations-honest': 'Honest limitations',
  'comparison-alternatives': 'Product comparison',
  'who-is-it-for': 'Ideal buyer & uses',
  'faq-product': 'Product FAQ',
  'troubleshooting-care': "Owner's guide",
  'unique-description': 'Content originality',
  freshness: 'Content freshness',
  'answer-formatting': 'AI-ready formatting',
  'about-page': 'Brand story',
  'contact-info': 'Contact details',
  'policies-quality': 'Store policies',
  'onsite-reviews': 'Customer proof',
  'google-reviews': 'Google reviews',
  trustpilot: 'Trustpilot rating',
  reddit: 'Reddit mentions',
  'social-video-mentions': 'Video mentions',
  'press-and-lists': 'Press & best-of coverage',
  'entity-databases': 'Trusted databases',
  'price-competitive': 'Price competitiveness',
  'shipping-competitive': 'Shipping competitiveness',
}

export const CRITERION_WHAT = {
  'ai-bots-allowed': 'Are AI crawlers allowed to reach this page?',
  'google-merchant-feed': 'Is it live and approved on Google Shopping?',
  'internal-linking': 'Is this page linked from other pages in your store?',
  'crawlable-text': 'Is your text readable by AI, not just human visitors?',
  'image-alt-text': "Can AI understand what's in your images?",
  'heading-hierarchy': 'Can AI follow how your page is organized?',
  'brand-in-title': 'Can AI tell which brand you sell from your title?',
  'product-schema': "Does AI get your product's core facts?",
  'product-schema-rich': 'Is your exact product identifiable to AI?',
  'review-schema': 'Is your rating visible to AI?',
  'shipping-schema': 'Is your shipping info visible to AI?',
  'faq-schema': 'Is your FAQ readable to AI?',
  'organization-schema': 'Is your brand information clear to AI?',
  'breadcrumb-schema': "Is your product's category path clear to AI?",
  'video-schema': 'Are your product videos readable to AI?',
  specifications: 'Does your page list specific specs with real numbers and units?',
  'original-media': 'Does your product have enough photos and a video AI can read?',
  'compatibility-sizing': "Does your page show if the product fits the buyer's size or device?",
  'safety-materials': 'Does your page show safety certs and a full ingredient list?',
  'benefits-outcomes': 'Does your copy explain the benefits buyers get, not just features?',
  'limitations-honest': 'Does your page admit any honest limitations, not just all-positives?',
  'comparison-alternatives': 'Does your page compare the product to other options with a clear verdict?',
  'who-is-it-for': 'Does your page name who the product is for and when to use it?',
  'faq-product': 'Does your FAQ answer real buyer questions with complete answers?',
  'troubleshooting-care': 'Does your page help owners care for, fix, and maintain the product?',
  'unique-description': 'Is your description in your own words, not copied from the manufacturer?',
  freshness: 'Does your page show AI a recent update date it can read?',
  'answer-formatting': 'Is your content broken into short chunks and tables AI can lift?',
  'about-page':
    'Does your About page tell AI a real story of who you are, your mission, and the people behind the store?',
  'contact-info':
    'Can AI confirm your store is a real, reachable business with genuine contact details?',
  'policies-quality':
    'Can AI find clear, specific policies for returns, shipping, and refunds on your store?',
  'onsite-reviews':
    'Does your store show real customer reviews and named testimonials AI can read on the page?',
  'google-reviews':
    'Does your store have a Google Business Profile with strong, recent reviews AI can cite?',
  trustpilot: 'Does your store have a Trustpilot profile with a healthy score AI can cite?',
  reddit: 'Is your brand talked about across Reddit threads that AI reads?',
  'social-video-mentions':
    'Are other people posting videos about your brand on YouTube, TikTok, and Instagram?',
  'press-and-lists':
    "Do trusted publications and 'best of' lists feature your store where AI can find them?",
  'entity-databases':
    'Do authoritative databases like Wikipedia, Wikidata, and Crunchbase recognize your brand as a real entity?',
  'price-competitive': 'Is your price in line with rivals selling the same product?',
  'shipping-competitive': 'Do you offer competitive or free shipping buyers can see?',
}

export const CRITERION_WHY = {
  'ai-bots-allowed':
    'If AI crawlers are blocked, your product stays invisible to AI no matter how good everything else is.',
  'google-merchant-feed':
    "AI shopping assistants pull from Google's feed, so if you're not listed, they won't suggest you.",
  'internal-linking':
    'Unlinked pages look like dead ends, so AI is less likely to find and trust them.',
  'crawlable-text': "Text AI can't read is text it can't quote or match to what shoppers ask.",
  'image-alt-text':
    "AI relies on descriptions to understand your visuals, so undescribed images simply don't count.",
  'heading-hierarchy':
    'Well-structured pages get quoted more, while a wall of text is easy for AI to skip.',
  'brand-in-title':
    "Shoppers ask AI for a brand by name, so a title without it means AI can't tell you sell it.",
  'product-schema':
    "Every store shows a price, but AI only reads it reliably when it's written in proper schema.",
  'product-schema-rich':
    "Without brand and barcode in schema, AI can't tell you sell the exact product shoppers ask for.",
  'review-schema':
    "Your reviews may look great on the page, but AI can't actually read them without proper schema.",
  'shipping-schema':
    "You may state your shipping, but AI only shows it in shopping panels when it's in schema.",
  'faq-schema': "Your FAQ answers shoppers, but AI can only quote it directly when it's in schema.",
  'organization-schema':
    "Your brand is real, but AI only trusts it as a distinct business when it's defined in schema.",
  'breadcrumb-schema':
    'Your product sits in a category, but AI only understands that context when the path is in schema.',
  'video-schema': "A product video engages shoppers, yet to AI it's just a blank box without schema.",
  specifications:
    "Without numbers AI can't match you to filtered searches and picks a rival who listed them.",
  'original-media':
    'AI needs images to see the product and captions to read your video, or that media stays invisible to it.',
  'compatibility-sizing':
    "'Will it fit me?' decides the sale, so without size or compatibility info AI recommends a rival who spells it out.",
  'safety-materials':
    "AI won't recommend something it can't confirm is safe, so missing certs or ingredients drops you from those answers.",
  'benefits-outcomes':
    "Shoppers ask AI for the best product for their goal, so feature lists alone don't tell AI you fit.",
  'limitations-honest':
    'All-positive copy reads like an ad, so AI trusts and cites pages that name a real tradeoff.',
  'comparison-alternatives':
    "Shoppers ask AI 'X vs Y', so comparison content gets you cited in those answers instead of only your rivals.",
  'who-is-it-for':
    "AI matches products to 'best for [person/situation]' queries, so naming your buyers gets you into more of those answers.",
  'faq-product':
    'AI lifts full FAQ answers word for word, so complete Q&A gets you cited while one-liners get skipped.',
  'troubleshooting-care':
    'AI recommends stores that cover the full product lifecycle, so care and fix info builds that trust.',
  'unique-description':
    'AI groups identical descriptions and often ignores the whole cluster, so copied text makes you invisible.',
  freshness: 'AI cites fresh content far more, but only if it can see a recent date on your page.',
  'answer-formatting':
    'AI pulls out short, single-idea paragraphs and tables, so walls of text get skipped no matter how good the content.',
  'about-page':
    'AI leans toward stores that read like a real, named business. An empty or placeholder About page makes you look anonymous and easy to skip.',
  'contact-info':
    'AI trusts stores it can verify as real and contactable. A lone contact form with no email, phone, or address reads as anonymous.',
  'policies-quality':
    'Buyers ask AI about returns and shipping before they trust a store. Empty template policies make you look careless and unsafe to recommend.',
  'onsite-reviews':
    'Reviews are what AI quotes to justify a recommendation. Named proof beats anonymous praise and backs up your star rating.',
  'google-reviews':
    'Google reviews are a top source AI checks to recommend where to buy. No profile or thin reviews means AI has little proof to vouch for you.',
  trustpilot:
    'Trustpilot is the review platform AI cites most. A strong profile makes AI far more likely to name your store; none leaves you nearly invisible.',
  reddit:
    'Reddit is the #1 source AI pulls from for recommendations. Being mentioned there strongly lifts your odds of being suggested; silence there is a real gap.',
  'social-video-mentions':
    'Creators talking about you across platforms is a strong validation signal AI rewards. No third-party videos means one less way AI hears about you.',
  'press-and-lists':
    "Being written up by real publications and named in 'best' lists is the strongest signal AI uses to recommend where to buy. Self-posted press releases don't count.",
  'entity-databases':
    'These are the sources AI treats as fact. Being listed makes AI far more confident your brand is real and worth naming.',
  'price-competitive':
    'AI leans toward stores priced fairly for the same item, so being the pricey outlier gets you skipped.',
  'shipping-competitive':
    'Shipping cost and speed sway the buy decision, so weak terms make AI favor a rival with better ones.',
}

export const FACTOR_UI = {
  discoverability: {
    label: 'Discoverability',
    description: 'Can AI find, read, and understand this product listing?',
    why: "The entry gate. If AI can't crawl and read this page, nothing else about your store counts.",
  },
  content: {
    label: 'Content Quality',
    description: 'Does the listing give AI rich, complete content to work with?',
    why: 'AI can only recommend what it can quote. Thin or copied content gives it nothing to pull.',
  },
  'entity-trust': {
    label: 'Entity & Trust',
    description: 'Does your store look like a real, trusted, recognized business?',
    why: "AI won't vouch for a store it can't verify. Reviews and mentions are the proof it checks.",
  },
  merchant: {
    label: 'Merchant',
    description: 'Are your price and shipping competitive for this product?',
    why: 'Shoppers ask AI for the best deal. Lagging on price or shipping gives it a reason to skip you.',
  },
}

export const SUBGROUP_UI = {
  'access-findability': {
    label: 'Access & Findability',
    description: 'Can AI crawlers access and find this page?',
  },
  'content-readability': {
    label: 'Content Readability',
    description: 'Can AI read the text and content on this page?',
  },
  'machine-readability': {
    label: 'Machine Readability',
    description: 'Are your key details labeled for AI to read?',
  },
  'product-facts': {
    label: 'Product facts',
    description: "Does the page give AI the product's key facts?",
  },
  'decision-support': {
    label: 'Decision support',
    description: 'Does the content help shoppers pick it with confidence?',
  },
  'questions-answered': {
    label: 'Questions answered',
    description: 'Does the page answer the questions buyers actually ask?',
  },
  'ai-readiness': {
    label: 'AI-readiness',
    description: 'Is your content original, extractable, and fresh enough for AI to use?',
  },
  'business-credibility': {
    label: 'Business credibility',
    description: 'Does your store look like a legitimate, reliable business?',
  },
  'reviews-buzz': {
    label: 'Reviews & buzz',
    description: 'Are people reviewing and talking about you around the web?',
  },
  'authority-recognition': {
    label: 'Authority & recognition',
    description: 'Do trusted publications and databases recognize your brand?',
  },
  merchant: { label: 'Reseller levers', description: '' },
}

// Σ of the 1/2/3 labels inside each factor — the denominator of the global weight.
const FACTOR_LABEL_SUM = (() => {
  const acc = { discoverability: 0, content: 0, 'entity-trust': 0, merchant: 0 }
  for (const def of Object.values(CRITERIA)) acc[def.factor] += def.weight
  return acc
})()

// Global weight % = factor budget × (this criterion's label / Σ labels in the factor).
// Σ over the 40 criteria = 100.
export function globalWeight(key) {
  const def = CRITERIA[key]
  if (!def) return 0
  return FACTORS[def.factor].weightPct * (def.weight / FACTOR_LABEL_SUM[def.factor])
}

// `null` is "nothing was scored", not a low score — it must not read as a judgement of the
// store. Before this fix a `total: null` run (an empty page, or every lane unavailable) was
// tiered `weak`, the same label an honestly-measured failing store gets, so a report that
// measured NOTHING said "weak" instead of "unknown" (audit incident C). RECOVERY.md already
// says such a report should never be delivered — this stops the artifact from asserting the
// judgement in the first place, in case it is anyway.
export function verdictTier(total) {
  if (total === null) return null
  if (total < 50) return 'weak'
  if (total < 80) return 'moderate'
  return 'strong'
}

export function factorLabel(key) {
  return FACTOR_UI[key]?.label ?? key
}
