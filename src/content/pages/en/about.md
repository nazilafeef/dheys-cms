---
title: About this demonstration
slug: about
locale: en
excerpt: What this site is, and what it is not.
updatedDate: 2026-06-20T00:00:00.000Z
state: published
seo:
  description: Dheys CMS is an open-source multi-site content platform. This front end is its demonstration.
  noindex: false
---

This is the front end that ships with **Dheys CMS**, rendering demonstration content so
that a new install shows something real rather than an empty shell.

Every article, author and category here is invented. The sites referenced in the example
registry — `example-news`, `demo-journal`, `sample-shop` — do not exist, and every URL in
the demo content points at an RFC 2606 reserved domain. That is enforced by a gate rather
than by care: `pnpm check:clean-room` fails the build if a real host, a foreign repository
reference, or anything shaped like a credential reaches a committed file.

## What this demonstrates

- Three locales, two of them right-to-left, with correct `dir` and `lang` throughout.
- An attribution line on AI-authored content, generated from provenance stored in
  frontmatter rather than typed by hand.
- An affiliate disclosure that the schema will not let an article publish without.
- A build with no third-party scripts, no telemetry, and no network call from an unfilled
  ad slot.

## What it is not

It is not a newspaper, and nothing here is reporting. The prose exists to give typography,
translation and layout something honest to work with.
