# Custom content types

A custom type needs one schema and one registry entry.

## 1. The schema

```ts
// src/lib/schemas.ts
export const eventSchema = z.object({
  title: z.string().min(1, 'title is required'),
  slug: slugSchema,
  locale: localeSchema,
  startsAt: z.coerce.date({ required_error: 'startsAt is required' }),
  endsAt: z.coerce.date().optional(),
  venue: z.string().min(1, 'venue is required'),
  excerpt: z.string().max(400),
  draft: z.boolean().default(false),
  state: editorialStateSchema.default('draft'),
  transitions: z.array(transitionSchema).default([]),
});

export type Event = z.infer<typeof eventSchema>;
```

**Write the error messages.** They are shown to an editor in the review queue, who has to
know which box to fix. `"startsAt is required"` is useful; Zod's default is not.

## 2. Register it

```ts
export const CONTENT_TYPES = Object.freeze({
  // ...
  event: {
    id: 'event',
    label: 'Event',
    directory: 'events',
    schema: eventSchema,
    listed: false, // appears in feeds, sitemaps and archives?
    editorial: true, // moves through the editorial state machine?
  },
});
```

## 3. The collection

```ts
// src/content.config.ts
const events = defineCollection({
  loader: glob({
    pattern: '**/*.{md,mdx}',
    base: './src/content/events',
    generateId: localeAwareId,
  }),
});

export const collections = { posts, pages, authors, categories, events };
```

`generateId: localeAwareId` is not optional. Without it the loader's id is the file's
basename, so `events/en/launch.md` and `events/dv/launch.md` both become `launch` and the
second silently overwrites the first.

Astro is given **no schema** here on purpose. It bundles its own copy of Zod, and handing it
a schema built with this project's Zod means two instances validating the same data and
disagreeing at the edges. `src/lib/content.ts` validates instead, against the one
authoritative schema, and fails the build with the file path and the field name.

## 4. Loading it

```ts
export async function allEvents(): Promise<LoadedEvent[]> {
  const entries = await getCollection('events');
  return entries.map((entry) => ({
    id: entry.id,
    item: parseOrThrow<Event>('events', entry.id, eventSchema, entry.data),
    body: entry.body ?? '',
    entry,
  }));
}
```

## 5. A route

```astro
---
export async function getStaticPaths() {
  const events = await allEvents();
  return events
    .filter(({ item }) => !item.draft)
    .map((event) => ({
      params: { locale: localeParam(event.item.locale), slug: event.item.slug },
      props: { event },
    }));
}
---
```

Add it to `src/lib/routes.ts` so nothing else builds the URL by hand — that is the single
place a locale and a base path are joined, and `pnpm check:links` will catch you if a route
and a page file disagree.

## Guardrails and the editorial machine

Both work on any type that opts in. `editorial: true` gives it the full state machine with
actor-and-timestamp transitions; guardrails reading dotted paths (`required-fields`,
`banned-phrases`, `minimum-words`) work unchanged.

## Related

- [content-authoring.md](./content-authoring.md) · [guardrails.md](./guardrails.md)
