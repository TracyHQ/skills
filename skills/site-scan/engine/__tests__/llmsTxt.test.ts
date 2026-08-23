import { describe, expect, it } from 'vitest'

import { parseLlmsTxt } from '../harvest/llmsTxt'

const SAMPLE = `# JoomlArt

> Joomla templates and extensions since 2005.

## Docs

- [Pricing](https://a.com/pricing): plans and clubs
- [Templates](https://a.com/templates)
- [Elsewhere](https://other.com/page)
- [Pricing again](https://a.com/pricing)
`

describe('parseLlmsTxt', () => {
  it('reads the title, the summary and the deduped links of a well-formed file', () => {
    const parsed = parseLlmsTxt(SAMPLE)
    expect(parsed.hasTitle).toBe(true)
    expect(parsed.summary).toBe('Joomla templates and extensions since 2005.')
    expect(parsed.links.map((l) => l.url)).toEqual([
      'https://a.com/pricing',
      'https://a.com/templates',
      'https://other.com/page'
    ])
    expect(parsed.links[0].title).toBe('Pricing')
  })

  it('answers a linkless or heading-less file honestly instead of throwing', () => {
    const parsed = parseLlmsTxt('just some prose, no structure')
    expect(parsed.hasTitle).toBe(false)
    expect(parsed.links).toEqual([])
  })
})
