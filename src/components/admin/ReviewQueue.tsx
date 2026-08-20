import { useCallback, useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { type GitHubClient } from '@lib/github';
import { listContent, transitionAndCommit, type ContentFile } from '@lib/admin/repo';
import { guardrailsFor, type SiteDefinition } from '@lib/site-registry';
import { mayPublish, reviewTimeRules, type GuardrailViolation } from '@lib/guardrails';
import { allowedNext } from '@lib/editorial';
import { translator, formatDate, type LocaleCode } from '@lib/i18n';

/**
 * The review queue.
 *
 * Everything awaiting a decision, across the locales of one site, with the guardrail
 * verdict computed for each item *before* anyone approves it. That ordering is the point:
 * an editor should learn that a piece is missing its affiliate disclosure while deciding
 * about it, not after approving it and watching the scheduler refuse to publish.
 *
 * Approving does not publish. It records a human decision in the item's history and
 * commits it; the scheduler publishes later, and re-checks the guardrails when it does.
 */

export interface ReviewQueueProps {
  client: GitHubClient;
  site: SiteDefinition;
  uiLocale: LocaleCode;
  login: string;
}

interface QueueRow {
  readonly file: ContentFile;
  readonly violations: readonly GuardrailViolation[];
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: readonly QueueRow[] }
  | { kind: 'error'; message: string };

export default function ReviewQueue({
  client,
  site,
  uiLocale,
  login,
}: ReviewQueueProps): JSX.Element {
  const t = translator(uiLocale);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const rows: QueueRow[] = [];

      // Everything first, then judge. The locale-completeness rule asks which languages a
      // logical item exists in, and that cannot be known from one locale's directory --
      // passing the site's full locale list instead would make the rule unfailable.
      const everything: ContentFile[] = [];
      for (const locale of site.locales) {
        const listing = await listContent(client, site, locale);
        everything.push(...listing.files);
      }

      /** Locales each logical item exists in, keyed by the original's slug. */
      const family = new Map<string, LocaleCode[]>();
      for (const file of everything) {
        const key = file.item.translationOf ?? file.item.slug;
        family.set(key, [...(family.get(key) ?? []), file.item.locale]);
      }

      for (const file of everything) {
        if (file.item.state !== 'in-review') continue;

        // Publish-time-only rules are excluded here. Judging human-review-required before
        // a human has decided is circular, and it disabled approval outright.
        const verdict = mayPublish(reviewTimeRules(guardrailsFor(site)), {
          siteId: site.id,
          siteName: site.name,
          item: file.item,
          body: file.body,
          availableLocales: family.get(file.item.translationOf ?? file.item.slug) ?? [
            file.item.locale,
          ],
          messageLocale: uiLocale,
        });

        rows.push({ file, violations: verdict.violations });
      }

      setPhase({ kind: 'ready', rows });
    } catch (error) {
      setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, [client, site, uiLocale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function decide(
    row: QueueRow,
    to: 'approved' | 'changes-requested' | 'rejected',
  ): Promise<void> {
    setBusy(row.file.path);
    try {
      const result = await transitionAndCommit(
        client,
        site,
        row.file,
        to,
        { kind: 'human', id: login },
        {
          now: new Date(),
          ...(note[row.file.path] ? { note: note[row.file.path] as string } : {}),
        },
      );

      if ('errors' in result) {
        setPhase({
          kind: 'error',
          message: result.errors.map((error) => `${error.field}: ${error.message}`).join('; '),
        });
        return;
      }

      await refresh();
    } catch (error) {
      setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  if (phase.kind === 'loading') return <p class="admin__panel">{t('admin.common.loading')}</p>;

  if (phase.kind === 'error') {
    return (
      <div class="admin__panel">
        <p class="admin__error">{phase.message}</p>
        <button type="button" onClick={() => void refresh()}>
          {t('admin.common.retry')}
        </button>
      </div>
    );
  }

  if (phase.rows.length === 0) {
    return (
      <div class="admin__panel">
        <h2>{t('admin.queue.heading')}</h2>
        <p>{t('admin.queue.empty')}</p>
      </div>
    );
  }

  return (
    <div class="admin__panel">
      <h2>{t('admin.queue.heading')}</h2>

      {phase.rows.map((row) => {
        const blocked = row.violations.length > 0;
        const canApprove = allowedNext(row.file.item.state).includes('approved');

        return (
          <article class="queue-item" key={row.file.path} data-testid="queue-item">
            <header class="queue-item__header">
              <h3>{row.file.item.title}</h3>
              <p class="meta">
                {row.file.item.author} · {row.file.item.locale} ·{' '}
                {formatDate(row.file.item.publishedDate, uiLocale)}
              </p>
            </header>

            <p class="queue-item__excerpt">{row.file.item.excerpt}</p>

            {row.file.item.provenance && (
              <p class="meta queue-item__provenance">
                {t('ai.attributionUnreviewed', { model: row.file.item.provenance.model })} ·{' '}
                {t('admin.runs.tokens', {
                  input: row.file.item.provenance.tokensIn,
                  output: row.file.item.provenance.tokensOut,
                })}{' '}
                · ${row.file.item.provenance.costUsd.toFixed(4)}
              </p>
            )}

            {blocked && (
              <div class="admin__warning" data-testid="guardrail-block">
                <p>
                  {row.violations.length === 1
                    ? t('admin.queue.blockedBy', { count: row.violations.length })
                    : t('admin.queue.blockedByPlural', { count: row.violations.length })}
                </p>
                <ul>
                  {row.violations.map((violation) => (
                    <li key={`${violation.rule}-${violation.message}`}>{violation.message}</li>
                  ))}
                </ul>
              </div>
            )}

            <label class="visually-hidden" for={`note-${row.file.item.slug}`}>
              {t('admin.queue.noteLabel')}
            </label>
            <textarea
              id={`note-${row.file.item.slug}`}
              rows={2}
              placeholder={t('admin.queue.noteLabel')}
              value={note[row.file.path] ?? ''}
              onInput={(event) =>
                setNote({
                  ...note,
                  [row.file.path]: (event.currentTarget as HTMLTextAreaElement).value,
                })
              }
            />

            <div class="queue-item__actions">
              <button
                type="button"
                data-testid="approve"
                disabled={busy === row.file.path || blocked || !canApprove}
                title={blocked ? row.violations[0]?.message : undefined}
                onClick={() => void decide(row, 'approved')}
              >
                {t('admin.queue.approve')}
              </button>

              <button
                type="button"
                data-testid="request-changes"
                disabled={busy === row.file.path}
                onClick={() => void decide(row, 'changes-requested')}
              >
                {t('admin.queue.requestChanges')}
              </button>

              <button
                type="button"
                class="queue-item__reject"
                data-testid="reject"
                disabled={busy === row.file.path}
                onClick={() => void decide(row, 'rejected')}
              >
                {t('admin.queue.reject')}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
