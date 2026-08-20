import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { GitHubClient, GitHubError } from '@lib/github';
import ContentView from './ContentView';
import ReviewQueue from './ReviewQueue';
import {
  clearSession,
  looksLikeToken,
  readSession,
  writeSession,
  type Session,
} from '@lib/admin/session';
import {
  parseRegistry,
  sitesVisibleTo,
  capsFrom,
  type Registry,
  type SiteDefinition,
} from '@lib/site-registry';
import { summariseSpend, format as formatUsd, type CostLedgerEntry } from '@lib/cost';
import { translator, LOCALES, type LocaleCode } from '@lib/i18n';

/**
 * The admin.
 *
 * A single Preact island, mounted on /admin only. The rest of the site ships no
 * component-framework JavaScript at all, which is how an article page stays under the
 * 30 KB budget while this screen gets to be a real application.
 *
 * Three constraints shape it:
 *
 *  - It talks to `api.github.com` and to nothing else. There is no backend to talk to.
 *  - It never touches an AI provider. Commissioning dispatches a workflow and polls the
 *    run; the keys live in Actions secrets where a browser cannot reach them.
 *  - No `unsafe-eval`: no runtime schema compiler, no template evaluator. Validation uses
 *    the same Zod schemas the build uses, compiled ahead of time.
 */

type View = 'dashboard' | 'queue' | 'content' | 'runs' | 'sites' | 'settings';

export interface AdminAppProps {
  locale: LocaleCode;
  /** Registry JSON, when the deployment injected one at build time. */
  registryJson?: string | undefined;
}

interface Status {
  kind: 'idle' | 'working' | 'error' | 'ok';
  message?: string;
}

export default function AdminApp({ locale, registryJson }: AdminAppProps): JSX.Element {
  const t = translator(locale);

  const [session, setSession] = useState<Session | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [view, setView] = useState<View>('dashboard');
  const [siteId, setSiteId] = useState<string | null>(null);
  const [contentLocale, setContentLocale] = useState<LocaleCode | null>(null);

  useEffect(() => {
    setSession(readSession());
  }, []);

  const registry = useMemo<Registry | null>(() => {
    if (!registryJson) return null;
    try {
      return parseRegistry(registryJson);
    } catch {
      return null;
    }
  }, [registryJson]);

  const client = useMemo(
    () =>
      session ? new GitHubClient({ token: session.token, userAgent: 'dheys-cms-admin' }) : null,
    [session],
  );

  const connect = useCallback(
    async (event: JSX.TargetedEvent<HTMLFormElement, Event>) => {
      event.preventDefault();
      const token = tokenInput.trim();

      if (!looksLikeToken(token)) {
        setStatus({
          kind: 'error',
          message: t('admin.connectionFailed', {
            reason:
              'that does not look like a GitHub token — a fine-grained token starts with github_pat_',
          }),
        });
        return;
      }

      setStatus({ kind: 'working', message: t('admin.connecting') });

      try {
        // Verify by resolving the token to an identity. A 200 from some other endpoint
        // would prove only that a request was answered, not whose credential this is.
        const probe = new GitHubClient({ token, userAgent: 'dheys-cms-admin' });
        const user = await probe.whoAmI();
        const next: Session = { token, login: user.login };
        writeSession(next);
        setSession(next);
        setTokenInput('');
        setStatus({ kind: 'ok', message: t('admin.connectedAs', { login: user.login }) });
      } catch (error) {
        setStatus({
          kind: 'error',
          message: t('admin.connectionFailed', {
            reason: error instanceof GitHubError ? error.message : String(error),
          }),
        });
      }
    },
    [tokenInput, t],
  );

  const disconnect = useCallback(() => {
    clearSession();
    setSession(null);
    setStatus({ kind: 'idle' });
  }, []);

  if (!session || !client) {
    return (
      <ConnectScreen
        t={t}
        status={status}
        tokenInput={tokenInput}
        onTokenInput={setTokenInput}
        onSubmit={connect}
      />
    );
  }

  const sites = registry ? sitesVisibleTo(registry, session.login) : [];
  const activeSite = sites.find((site) => site.id === siteId) ?? sites[0];
  const activeLocale =
    contentLocale && activeSite?.locales.includes(contentLocale)
      ? contentLocale
      : (activeSite?.defaultLocale ?? locale);

  return (
    <div class="admin">
      <header class="admin__bar">
        <strong class="admin__title">{t('admin.title')}</strong>
        <span class="admin__who" data-testid="connected-as">
          {t('admin.connectedAs', { login: session.login })}
        </span>
        <button type="button" class="admin__link-button" onClick={disconnect}>
          {t('admin.disconnect')}
        </button>
      </header>

      <nav class="admin__nav" aria-label={t('nav.menu')}>
        {(
          [
            ['dashboard', t('admin.nav.dashboard')],
            ['queue', t('admin.nav.queue')],
            ['content', t('admin.nav.content')],
            ['runs', t('admin.nav.runs')],
            ['sites', t('admin.nav.sites')],
            ['settings', t('admin.nav.settings')],
          ] as Array<[View, string]>
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            class={view === id ? 'admin__tab admin__tab--active' : 'admin__tab'}
            aria-current={view === id ? 'page' : undefined}
            data-testid={`tab-${id}`}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeSite && (view === 'content' || view === 'queue') && (
        <div class="admin__scope">
          <label for="scope-site">{t('admin.common.site')}</label>
          <select
            id="scope-site"
            value={activeSite.id}
            onChange={(event) => setSiteId((event.currentTarget as HTMLSelectElement).value)}
          >
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>

          {view === 'content' && (
            <>
              <label for="scope-locale">{t('admin.common.locale')}</label>
              <select
                id="scope-locale"
                value={activeLocale}
                onChange={(event) =>
                  setContentLocale((event.currentTarget as HTMLSelectElement).value as LocaleCode)
                }
              >
                {activeSite.locales.map((code) => (
                  <option key={code} value={code}>
                    {LOCALES[code].name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      <main class="admin__body">
        {!registry && <NoRegistry t={t} />}

        {registry && view === 'dashboard' && <Dashboard t={t} registry={registry} sites={sites} />}

        {registry && view === 'sites' && <Sites t={t} sites={sites} />}

        {registry && view === 'queue' && activeSite && (
          <ReviewQueue client={client} site={activeSite} uiLocale={locale} login={session.login} />
        )}

        {registry && view === 'content' && activeSite && (
          <ContentView
            client={client}
            site={activeSite}
            locale={activeLocale}
            uiLocale={locale}
            login={session.login}
          />
        )}

        {registry && (view === 'runs' || view === 'settings') && <NotYetWired t={t} view={view} />}

        {registry && sites.length === 0 && view !== 'dashboard' && (
          <p class="admin__panel">{t('admin.dashboard.noSites')}</p>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function ConnectScreen(props: {
  t: Translate;
  status: Status;
  tokenInput: string;
  onTokenInput: (value: string) => void;
  onSubmit: (event: JSX.TargetedEvent<HTMLFormElement, Event>) => void;
}): JSX.Element {
  const { t, status, tokenInput, onTokenInput, onSubmit } = props;

  return (
    <div class="admin admin--connect">
      {/*
        No sign-in vocabulary, no GitHub branding, no lock icons. A page that looks like a
        credential prompt is a page that gets reported as phishing, and this one is asking
        for a token the operator generated themselves.
      */}
      <h1>{t('admin.signInHeading')}</h1>
      <p class="admin__help">{t('admin.signInHelp')}</p>

      <form onSubmit={onSubmit} class="admin__form">
        <label for="admin-token">{t('admin.tokenLabel')}</label>
        <input
          id="admin-token"
          type="password"
          autocomplete="off"
          spellcheck={false}
          value={tokenInput}
          placeholder={t('admin.tokenPlaceholder')}
          onInput={(event) => onTokenInput((event.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" disabled={status.kind === 'working'} data-testid="connect">
          {status.kind === 'working' ? t('admin.connecting') : t('admin.connect')}
        </button>
      </form>

      <p class="admin__notice">{t('admin.sessionOnlyNotice')}</p>

      {status.message && (
        <p
          class={status.kind === 'error' ? 'admin__error' : 'admin__ok'}
          role="status"
          data-testid="connect-status"
        >
          {status.message}
        </p>
      )}
    </div>
  );
}

function NoRegistry({ t }: { t: Translate }): JSX.Element {
  return (
    <div class="admin__panel">
      <h2>{t('admin.dashboard.noSites')}</h2>
      <p>
        The site registry never lives in this repository. Point the deployment at a private gist, a
        private companion repository, or a repository secret — all three are documented in{' '}
        <code>docs/site-registry.md</code>.
      </p>
    </div>
  );
}

function Dashboard(props: {
  t: Translate;
  registry: Registry;
  sites: readonly SiteDefinition[];
}): JSX.Element {
  const { t, registry, sites } = props;

  // Runs are recorded by the runner into the control repository, not by this browser.
  // Showing zeroes against the real caps is honest and still useful.
  const ledger: CostLedgerEntry[] = [];
  const spend = summariseSpend(ledger, capsFrom(registry), new Date());

  return (
    <div class="admin__panel">
      <h2>{t('admin.dashboard.heading')}</h2>

      <dl class="admin__stats">
        <div>
          <dt>{t('admin.nav.sites')}</dt>
          <dd data-testid="site-count">{sites.length}</dd>
        </div>
        <div>
          <dt>{t('admin.dashboard.spendThisMonth')}</dt>
          <dd>{formatUsd(spend.globalSpentUsd)}</dd>
        </div>
      </dl>

      <p class="meta">
        {t('admin.dashboard.capRemaining', {
          amount: formatUsd(spend.globalRemainingUsd),
          cap: formatUsd(spend.globalCapUsd),
        })}
      </p>

      {sites.length === 0 && <p>{t('admin.dashboard.noSites')}</p>}
    </div>
  );
}

function Sites({ t, sites }: { t: Translate; sites: readonly SiteDefinition[] }): JSX.Element {
  return (
    <div class="admin__panel">
      <h2>{t('admin.nav.sites')}</h2>
      <table class="admin__table">
        <thead>
          <tr>
            <th scope="col">{t('admin.common.site')}</th>
            <th scope="col">{t('admin.common.locale')}</th>
            <th scope="col">{t('admin.commission.approval')}</th>
            <th scope="col">{t('admin.runs.model')}</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => (
            <tr key={site.id}>
              <td>{site.name}</td>
              <td>{site.locales.join(', ')}</td>
              <td>{site.publishing.defaultApprovalPolicy}</td>
              <td>{site.agents.enabled ? (site.agents.defaultModel ?? '—') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotYetWired({ t, view }: { t: Translate; view: View }): JSX.Element {
  return (
    <div class="admin__panel">
      <h2>{t(`admin.nav.${view}`)}</h2>
      <p>
        This screen is not wired up in this build. See <code>release/REPORT.md</code> for exactly
        what is and is not built.
      </p>
    </div>
  );
}
