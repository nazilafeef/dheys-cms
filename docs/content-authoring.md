# Content authoring

Content is Markdown with YAML frontmatter. That is the storage format everywhere — what an
agent produces, what the admin commits, what the scheduler publishes.

Never bare JSON fragments. A brace-less fragment that a CMS re-wraps on read breaks any
consumer importing the file as real JSON, with a syntax error and no useful location.

## A post

```markdown
---
title: The tide gauge at the old harbour
slug: the-tide-gauge-at-the-old-harbour
category: environment
publishedDate: 2026-02-11T07:30:00.000Z
excerpt: A century of readings taken by hand, and the slow patient line they draw.
locale: en
author: Aminath Rasheed
sourceType: human
tags:
  - tides
  - archives
heroImageAlt: A brass tide gauge mounted on a stone harbour wall.
seo:
  description: What a century of hand-taken readings shows.
  noindex: false
state: published
approvalPolicy: human-required
---

The gauge was installed in 1912 and has been read, by hand, almost every day since.

## What the record actually shows

Nothing dramatic. That is the first thing to say.
```

## The eight required fields

`title` · `slug` · `category` · `publishedDate` · `excerpt` · `locale` · `author` ·
`sourceType`

An item missing any of them does not build, and an agent item missing any is rejected at
intake with the field named. `category` and `publishedDate` are the two that get forgotten,
which is exactly why they are required rather than defaulted.

## Optional

```yaml
updatedDate: 2026-03-01T00:00:00.000Z
tags: [tides]
series: the-harbour-notebooks
seriesIndex: 1
draft: false
featured: false
pinned: false
heroImage: /media/gauge.jpg
heroImageAlt: Required whenever heroImage is set.
translationOf: the-english-slug # for a translation
seo: { title, description, canonical, noindex, ogImage, ogImageAlt }
schedule: { at | window, embargoUntil, reviewDeadline }
affiliate: { hasOffers, disclosure, network }
```

## Slugs

Lowercase Latin letters, digits and single hyphens. Non-Latin titles are **transliterated**,
never percent-encoded:

```
ބަނދަރުގެ ދިޔަވަރު މާޕު  →  bandharuge-dhiyavaru-maapu
```

The editor generates one from the title and tells you if it collides with an existing item.

## Drafts and dates

`draft: true` is excluded from every build. So is a `publishedDate` in the future — that is
what makes scheduling mean anything, and it is checked in the front end and in every content
adapter.

An unlisted-but-live page is `seo.noindex: true`, which is a different thing: it renders and
is linkable, it simply stays out of search and out of the sitemap.

## Affiliate content

```yaml
affiliate:
  hasOffers: true
  disclosure: This article contains affiliate links. If you buy through one, this site may earn a commission at no extra cost to you.
  network: example-network
```

The schema will not let an item with `hasOffers: true` publish without a `disclosure`, and a
guardrail scans the body for affiliate markers in case nobody ticked the box. The disclosure
renders **above** the article — one a reader meets after the recommendation is a disclosure
in name only.

## Writing Dhivehi and Arabic

Use the right punctuation: `،` not `,` · `؛` not `;` · `؟` not `?`

A Latin comma inside a Thaana run renders with the wrong directional class and breaks the
line. The editor warns while you type and a guardrail blocks publication.

## Translations

Same article, own file, own slug, linked back:

```yaml
# src/content/posts/ar/mikyas-almad-fi-almina-alqadim.md
locale: ar
slug: mikyas-almad-fi-almina-alqadim
translationOf: the-tide-gauge-at-the-old-harbour
```

That drives the language switcher, `hreflang` and the locale-completeness guardrail.

## AI-authored content

Set `sourceType: ai` or `ai-assisted` and provenance is **required** — the schema rejects the
item by name without it. Provenance is written by the runner, never by the model.

The theme renders an attribution line from it. AI content is never published under a bare
human byline, and that is enforced in the schema rather than in the interface.

## Where files live

```
src/content/
  posts/{en,dv,ar}/<slug>.md
  pages/{en,dv,ar}/<slug>.md
  authors/<slug>.md
  categories/<slug>.md
```

The locale directory is part of the collection id, so `about.md` can exist in all three
without one silently overwriting another.
