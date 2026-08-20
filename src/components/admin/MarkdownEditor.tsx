import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { marked } from 'marked';
import type { LocaleCode } from '@lib/i18n';
import { LOCALES, translator } from '@lib/i18n';

/**
 * The Markdown editor: a textarea, a toolbar, and a live preview.
 *
 * The preview renders into an iframe with an empty `sandbox` attribute. That is a
 * deliberate choice over sanitising the HTML: `sandbox=""` disables scripts, forms,
 * popups, top-level navigation and same-origin access outright, so nothing in the preview
 * can execute or reach the token in `sessionStorage` — and it does it without a sanitiser
 * dependency whose allowlist has to be kept correct forever.
 *
 * It matters here specifically because the body being previewed is often *not* the
 * operator's own prose. It is a model's output, or an import from someone else's CMS.
 */

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  locale: LocaleCode;
  /** Rows for the textarea. */
  rows?: number;
}

interface ToolbarAction {
  readonly key: string;
  readonly label: string;
  readonly before: string;
  readonly after: string;
  /** Placeholder inserted when nothing is selected. */
  readonly placeholder: string;
  /** Applies to whole lines rather than a selection. */
  readonly linePrefix?: boolean;
}

export default function MarkdownEditor({
  value,
  onChange,
  locale,
  rows = 24,
}: MarkdownEditorProps): JSX.Element {
  const t = translator(locale);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const direction = LOCALES[locale].dir;

  const actions: ToolbarAction[] = useMemo(
    () => [
      {
        key: 'bold',
        label: t('admin.editor.bold'),
        before: '**',
        after: '**',
        placeholder: 'bold',
      },
      {
        key: 'italic',
        label: t('admin.editor.italic'),
        before: '_',
        after: '_',
        placeholder: 'italic',
      },
      {
        key: 'link',
        label: t('admin.editor.link'),
        before: '[',
        after: '](https://example.com)',
        placeholder: 'text',
      },
      {
        key: 'heading',
        label: t('admin.editor.heading'),
        before: '## ',
        after: '',
        placeholder: 'Heading',
        linePrefix: true,
      },
      {
        key: 'quote',
        label: t('admin.editor.quote'),
        before: '> ',
        after: '',
        placeholder: 'Quote',
        linePrefix: true,
      },
      { key: 'code', label: t('admin.editor.code'), before: '`', after: '`', placeholder: 'code' },
      {
        key: 'bullet',
        label: t('admin.editor.bulletList'),
        before: '- ',
        after: '',
        placeholder: 'Item',
        linePrefix: true,
      },
      {
        key: 'number',
        label: t('admin.editor.numberedList'),
        before: '1. ',
        after: '',
        placeholder: 'Item',
        linePrefix: true,
      },
    ],
    [t],
  );

  function apply(action: ToolbarAction): void {
    const element = textarea.current;
    if (!element) return;

    const start = element.selectionStart;
    const end = element.selectionEnd;
    const selected = value.slice(start, end) || action.placeholder;

    const inserted = action.linePrefix
      ? `${action.before}${selected}`
      : `${action.before}${selected}${action.after}`;

    const next = value.slice(0, start) + inserted + value.slice(end);
    onChange(next);

    // Leave the caret around the inserted text rather than at the end of the document,
    // which is where an editor loses their place.
    queueMicrotask(() => {
      element.focus();
      const caret = start + action.before.length;
      element.setSelectionRange(caret, caret + selected.length);
    });
  }

  /** Markdown → HTML for the preview. Never inserted into this document. */
  const previewHtml = useMemo(() => {
    const rendered = marked.parse(value, { async: false, gfm: true, breaks: false });
    const html = typeof rendered === 'string' ? rendered : '';
    return buildPreviewDocument(html, locale, direction);
  }, [value, locale, direction]);

  return (
    <div class="editor">
      <div class="editor__toolbar" role="toolbar" aria-label={t('admin.editor.body')}>
        {actions.map((action) => (
          <button
            type="button"
            key={action.key}
            title={action.label}
            aria-label={action.label}
            onClick={() => apply(action)}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div class="editor__panes">
        <textarea
          ref={textarea}
          class={dragging ? 'editor__input editor__input--dragging' : 'editor__input'}
          rows={rows}
          value={value}
          dir={direction}
          lang={locale}
          spellcheck
          aria-label={t('admin.editor.body')}
          onInput={(event) => onChange((event.currentTarget as HTMLTextAreaElement).value)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer?.files?.[0];
            if (!file) return;
            // The media library owns uploads; the editor only writes the reference, and
            // requires alt text by writing an empty slot the guardrail will catch.
            onChange(`${value}\n\n![](media/${file.name})\n`);
          }}
        />

        <iframe
          class="editor__preview"
          title={t('admin.editor.preview')}
          // Empty sandbox: no scripts, no forms, no navigation, no same-origin access.
          sandbox=""
          srcdoc={previewHtml}
        />
      </div>

      {dragging && <p class="editor__drop-hint">{t('admin.editor.dropImage')}</p>}
    </div>
  );
}

/**
 * The preview document.
 *
 * Self-contained, with its own minimal styling: it cannot inherit the admin's stylesheet
 * across the sandbox boundary, and giving it the theme tokens would mean serialising them
 * in, which is more machinery than a preview is worth.
 */
function buildPreviewDocument(html: string, locale: LocaleCode, direction: string): string {
  const style = `
    :root { color-scheme: light dark; }
    body {
      margin: 0; padding: 1rem;
      font: 16px/1.6 system-ui, sans-serif;
      color: #1a1a1a; background: #fff;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #ededed; background: #121212; }
      a { color: #7fb2ea; }
    }
    img { max-width: 100%; height: auto; }
    pre { overflow-x: auto; padding: .75rem; background: rgba(127,127,127,.15); }
    blockquote { margin-inline-start: 0; padding-inline-start: 1rem; border-inline-start: 3px solid rgba(127,127,127,.4); }
  `;

  return `<!doctype html><html lang="${locale}" dir="${direction}"><head><meta charset="utf-8"><style>${style}</style></head><body>${html}</body></html>`;
}

/**
 * Character counters for the SEO panel.
 *
 * The limits are what search results actually truncate at, not arbitrary. Over is a
 * warning rather than an error: a long meta description is a bad idea, not invalid data,
 * and blocking a save on it would be the wrong trade.
 */
export function CharacterCount({
  used,
  limit,
  locale,
}: {
  used: number;
  limit: number;
  locale: LocaleCode;
}): JSX.Element {
  const t = translator(locale);
  const over = used > limit;
  return (
    <span class={over ? 'counter counter--over' : 'counter'}>
      {over
        ? t('admin.seo.tooLong', { used, limit })
        : t('admin.seo.charactersUsed', { used, limit })}
    </span>
  );
}

/**
 * Warn before leaving with unsaved work.
 *
 * `beforeunload` only covers closing the tab or navigating away; the admin's own view
 * switching is guarded separately, in the component that owns the dirty flag.
 */
export function useUnsavedChangesGuard(dirty: boolean, message: string): void {
  useEffect(() => {
    if (!dirty) return undefined;

    const handler = (event: BeforeUnloadEvent): string => {
      event.preventDefault();
      // Browsers ignore the custom string now and show their own wording; it is still set
      // because a few older ones do not.
      event.returnValue = message;
      return message;
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, message]);
}
