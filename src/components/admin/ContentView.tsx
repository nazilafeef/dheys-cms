import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import MarkdownEditor, { CharacterCount, useUnsavedChangesGuard } from './MarkdownEditor';
import { type GitHubClient } from '@lib/github';
import {
  listContent,
  saveContent,
  availableSlug,
  type ContentFile,
  type ContentListing,
} from '@lib/admin/repo';
import { slugify, isValidSlug } from '@lib/slug';
import { findLatinPunctuation, translator, formatDate, LOCALES, type LocaleCode } from '@lib/i18n';
import type { SiteDefinition } from '@lib/site-registry';
import type { FieldError, Post } from '@lib/schemas';

/**
 * The content screen: a list of everything in a locale, and an editor for one item.
 *
 * Every save is a commit, and the blob sha read with the file is handed back on write. If
 * somebody else changed the file in between, GitHub returns 409 and the editor says so
 * rather than overwriting their work.
 */

const META_TITLE_LIMIT = 60;
const META_DESCRIPTION_LIMIT = 155;

export interface ContentViewProps {
  client: GitHubClient;
  site: SiteDefinition;
  locale: LocaleCode;
  uiLocale: LocaleCode;
  login: string;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'list'; listing: ContentListing }
  | { kind: 'editing'; listing: ContentListing; file: ContentFile }
  | { kind: 'error'; message: string };

export default function ContentView({
  client,
  site,
  locale,
  uiLocale,
  login,
}: ContentViewProps): JSX.Element {
  const t = translator(uiLocale);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('all');

  const refresh = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const listing = await listContent(client, site, locale);
      setPhase({ kind: 'list', listing });
    } catch (error) {
      setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, [client, site, locale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  if (phase.kind === 'editing') {
    return (
      <Editor
        client={client}
        site={site}
        uiLocale={uiLocale}
        login={login}
        file={phase.file}
        siblings={phase.listing.files}
        onClose={() => void refresh()}
      />
    );
  }

  const filtered = phase.listing.files.filter((file) => {
    const matchesQuery =
      query.trim() === '' ||
      file.item.title.toLowerCase().includes(query.toLowerCase()) ||
      file.item.slug.includes(query.toLowerCase());
    const matchesState = stateFilter === 'all' || file.item.state === stateFilter;
    return matchesQuery && matchesState;
  });

  return (
    <div class="admin__panel">
      <h2>{t('admin.nav.content')}</h2>

      <div class="admin__filters">
        <label class="visually-hidden" for="content-search">
          {t('admin.common.search')}
        </label>
        <input
          id="content-search"
          type="search"
          placeholder={t('admin.common.search')}
          value={query}
          onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
        />

        <label class="visually-hidden" for="content-state">
          {t('admin.common.status')}
        </label>
        <select
          id="content-state"
          value={stateFilter}
          onChange={(event) => setStateFilter((event.currentTarget as HTMLSelectElement).value)}
        >
          <option value="all">{t('admin.common.filter')}</option>
          {['draft', 'in-review', 'approved', 'scheduled', 'published', 'rejected'].map((state) => (
            <option key={state} value={state}>
              {t(`admin.state.${state}`)}
            </option>
          ))}
        </select>
      </div>

      {/*
        Files that exist but do not validate are shown, not hidden. An item the admin
        quietly skips is an item an editor cannot find or fix.
      */}
      {phase.listing.problems.length > 0 && (
        <div class="admin__problems">
          <h3>{phase.listing.problems.length} file(s) could not be read</h3>
          <ul>
            {phase.listing.problems.map((problem) => (
              <li key={problem.path}>
                <code>{problem.path}</code>
                <ul>
                  {problem.errors.map((error) => (
                    <li key={error.field}>
                      <strong>{error.field}</strong>: {error.message}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      {filtered.length === 0 ? (
        <p>{t('archive.empty')}</p>
      ) : (
        <table class="admin__table">
          <thead>
            <tr>
              <th scope="col">{t('admin.editor.title')}</th>
              <th scope="col">{t('admin.common.status')}</th>
              <th scope="col">{t('admin.common.author')}</th>
              <th scope="col">{t('article.publishedOn', { date: '' }).trim()}</th>
              <th scope="col">{t('admin.common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((file) => (
              <tr key={file.path}>
                <td>{file.item.title}</td>
                <td>
                  <span class={`state state--${file.item.state}`}>
                    {t(`admin.state.${file.item.state}`)}
                  </span>
                </td>
                <td>{file.item.author}</td>
                <td>{formatDate(file.item.publishedDate, uiLocale)}</td>
                <td>
                  <button
                    type="button"
                    class="admin__link-button"
                    onClick={() => setPhase({ kind: 'editing', listing: phase.listing, file })}
                  >
                    {t('admin.editor.save').replace(/.*/, 'Edit')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface EditorProps {
  client: GitHubClient;
  site: SiteDefinition;
  uiLocale: LocaleCode;
  login: string;
  file: ContentFile;
  siblings: readonly ContentFile[];
  onClose: () => void;
}

function Editor({
  client,
  site,
  uiLocale,
  login,
  file,
  siblings,
  onClose,
}: EditorProps): JSX.Element {
  const t = translator(uiLocale);

  const [item, setItem] = useState<Post>(file.item);
  const [body, setBody] = useState(file.body);
  const [status, setStatus] = useState<{
    kind: 'idle' | 'saving' | 'saved' | 'error';
    message?: string;
  }>({
    kind: 'idle',
  });
  const [errors, setErrors] = useState<readonly FieldError[]>([]);

  const dirty = item !== file.item || body !== file.body;
  useUnsavedChangesGuard(dirty, t('admin.editor.unsavedWarning'));

  const takenSlugs = useMemo(
    () =>
      siblings.filter((sibling) => sibling.path !== file.path).map((sibling) => sibling.item.slug),
    [siblings, file.path],
  );

  const slugClash = takenSlugs.includes(item.slug)
    ? siblings.find((sibling) => sibling.item.slug === item.slug)?.item.title
    : undefined;

  /**
   * Latin punctuation inside Thaana is a rendering bug, and the guardrail will block
   * publication over it. Saying so while the editor is still looking at the field is far
   * more useful than saying it at publish time.
   */
  const punctuationWarnings = useMemo(() => {
    if (LOCALES[item.locale].script === 'Latn') return [];
    return [
      ...findLatinPunctuation(item.title).map(
        (hit) => `title, position ${hit.index}: "${hit.char}"`,
      ),
      ...findLatinPunctuation(item.excerpt).map(
        (hit) => `excerpt, position ${hit.index}: "${hit.char}"`,
      ),
      ...findLatinPunctuation(body).map((hit) => `body, position ${hit.index}: "${hit.char}"`),
    ];
  }, [item.locale, item.title, item.excerpt, body]);

  async function save(): Promise<void> {
    setStatus({ kind: 'saving' });
    setErrors([]);

    try {
      const result = await saveContent(
        client,
        site,
        { ...file, item, body },
        {
          message: `edit: ${item.title}`,
          actor: { kind: 'human', id: login },
        },
      );

      if ('errors' in result) {
        setErrors(result.errors);
        setStatus({
          kind: 'error',
          message: t('admin.editor.saveFailed', { reason: 'validation' }),
        });
        return;
      }

      setStatus({ kind: 'saved' });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: t('admin.editor.saveFailed', {
          reason: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  }

  return (
    <div class="admin__panel editor-panel">
      <div class="editor-panel__bar">
        <button
          type="button"
          class="admin__link-button"
          onClick={() => {
            if (dirty && !window.confirm(t('admin.editor.unsavedWarning'))) return;
            onClose();
          }}
        >
          ← {t('admin.nav.content')}
        </button>

        <span class="editor-panel__state">{t(`admin.state.${item.state}`)}</span>

        <button
          type="button"
          class="editor-panel__save"
          disabled={status.kind === 'saving'}
          onClick={() => void save()}
          data-testid="save"
        >
          {status.kind === 'saving' ? t('admin.editor.saving') : t('admin.editor.save')}
        </button>
      </div>

      {status.kind === 'saved' && (
        <p class="admin__ok" role="status">
          {t('admin.editor.saved')}
        </p>
      )}
      {status.kind === 'error' && (
        <p class="admin__error" role="status">
          {status.message}
        </p>
      )}

      {errors.length > 0 && (
        <ul class="admin__error" data-testid="field-errors">
          {errors.map((error) => (
            <li key={error.field}>
              <strong>{error.field}</strong>: {error.message}
            </li>
          ))}
        </ul>
      )}

      {punctuationWarnings.length > 0 && (
        <div class="admin__warning" data-testid="punctuation-warning">
          <p>
            {t('guardrail.thaanaPunctuation', { site: site.name, item: item.title, index: '' })}
          </p>
          <ul>
            {punctuationWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div class="editor-panel__fields">
        <label for="field-title">{t('admin.editor.title')}</label>
        <input
          id="field-title"
          value={item.title}
          dir={LOCALES[item.locale].dir}
          lang={item.locale}
          onInput={(event) =>
            setItem({ ...item, title: (event.currentTarget as HTMLInputElement).value })
          }
        />

        <label for="field-slug">{t('admin.editor.slug')}</label>
        <div class="editor-panel__slug">
          <input
            id="field-slug"
            value={item.slug}
            onInput={(event) =>
              setItem({ ...item, slug: (event.currentTarget as HTMLInputElement).value })
            }
          />
          <button
            type="button"
            onClick={() =>
              setItem({ ...item, slug: availableSlug(slugify(item.title), takenSlugs) })
            }
          >
            {t('admin.editor.regenerateSlug')}
          </button>
        </div>
        {slugClash && (
          <p class="admin__error" data-testid="slug-clash">
            {t('admin.editor.slugTaken', { title: slugClash })}
          </p>
        )}
        {!isValidSlug(item.slug) && (
          <p class="admin__error">A slug must be lowercase letters, digits and single hyphens.</p>
        )}

        <label for="field-excerpt">{t('admin.editor.excerpt')}</label>
        <textarea
          id="field-excerpt"
          rows={2}
          value={item.excerpt}
          dir={LOCALES[item.locale].dir}
          lang={item.locale}
          onInput={(event) =>
            setItem({ ...item, excerpt: (event.currentTarget as HTMLTextAreaElement).value })
          }
        />

        <label for="field-category">{t('article.category')}</label>
        <input
          id="field-category"
          value={item.category}
          onInput={(event) =>
            setItem({ ...item, category: (event.currentTarget as HTMLInputElement).value })
          }
        />
      </div>

      <MarkdownEditor value={body} onChange={setBody} locale={item.locale} />

      <section class="editor-panel__seo">
        <h3>{t('admin.seo.heading')}</h3>

        <label for="field-meta-title">{t('admin.seo.metaTitle')}</label>
        <input
          id="field-meta-title"
          value={item.seo.title ?? ''}
          onInput={(event) =>
            setItem({
              ...item,
              seo: { ...item.seo, title: (event.currentTarget as HTMLInputElement).value },
            })
          }
        />
        <CharacterCount
          used={(item.seo.title ?? item.title).length}
          limit={META_TITLE_LIMIT}
          locale={uiLocale}
        />

        <label for="field-meta-description">{t('admin.seo.metaDescription')}</label>
        <textarea
          id="field-meta-description"
          rows={2}
          value={item.seo.description ?? ''}
          onInput={(event) =>
            setItem({
              ...item,
              seo: { ...item.seo, description: (event.currentTarget as HTMLTextAreaElement).value },
            })
          }
        />
        <CharacterCount
          used={(item.seo.description ?? item.excerpt).length}
          limit={META_DESCRIPTION_LIMIT}
          locale={uiLocale}
        />

        <label>
          <input
            type="checkbox"
            checked={item.seo.noindex}
            onChange={(event) =>
              setItem({
                ...item,
                seo: { ...item.seo, noindex: (event.currentTarget as HTMLInputElement).checked },
              })
            }
          />
          {t('admin.seo.noindex')}
        </label>

        <h4>{t('admin.seo.socialPreview')}</h4>
        <div class="social-preview">
          <p class="social-preview__title">{item.seo.title ?? item.title}</p>
          <p class="social-preview__description">{item.seo.description ?? item.excerpt}</p>
          <p class="social-preview__url">
            {site.name} · /{item.locale === site.defaultLocale ? '' : `${item.locale}/`}articles/
            {item.slug}
          </p>
        </div>
      </section>
    </div>
  );
}
