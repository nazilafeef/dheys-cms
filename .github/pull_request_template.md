## What this changes

<!-- What changed and why. Not what the diff shows — why it needed to. -->

## Why it was wrong before

<!-- If this fixes something subtle, say what was actually happening. That explanation is
     usually the most valuable part of the change, and it is the part a diff cannot carry. -->

## Checks

- [ ] `pnpm gate` passes
- [ ] `pnpm test:e2e` passes, if this touches the front end or the admin
- [ ] `pnpm lighthouse` passes, if this touches rendering
- [ ] Documentation in `docs/` updated, if behaviour an operator can see has changed
- [ ] A line added to `docs/DECISIONS.md`, if this involved a judgement call

## The rules

- [ ] No `any`
- [ ] No credential, real domain or foreign repository reference — in code, tests, docs
      **or the commit message**
- [ ] No test reaches a real AI provider or the real GitHub API
- [ ] Logical CSS properties only (`margin-inline-start`, never `margin-left`)
- [ ] Any regex over text includes `\p{M}`, so Thaana and Arabic vowels survive
- [ ] No threshold lowered to make something pass

## Right-to-left

<!-- If this touches rendering, say how you checked it in Dhivehi or Arabic.
     "Not applicable" is a fine answer when it genuinely is. -->
