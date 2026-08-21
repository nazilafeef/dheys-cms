import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX, TargetedSubmitEvent } from 'preact';
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
  loadRegistry,
  sitesVisibleTo,
  capsFrom,
  type Registry,
  type SiteDefinition,
} from '@lib/site-registry';
import { githubRegistryFetcher } from '@lib/runner-env';
import {
  readRegistryLocation,
  writeRegistryLocation,
  clearRegistryLocation,
  parseRegistryLocation,
  toRegistrySource,
  type RegistryLocation,
} from '@lib/admin/registry-location';
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
  /*
   * Memoised because it is an effect dependency.
   *
   * `translator` returns a fresh closure each call, so an unmemoised `t` changes identity on
   * every render — and the registry effect below lists it as a dependency. That combination
   * refetched the registry on every render, replaced the registry object each time, handed
   * every child a new `site` prop, and quietly reset the editor mid-edit. The symptom was a
   * save that never reported "Saved"; the cause was three renders away from it.
   */
  const t = useMemo(() => translator(locale), [locale]);

  const [session, setSession] = useState<Session | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [view, setView] = useState<View>('dashboard');
  const [siteId, setSiteId] = useState<string | null>(null);
  const [contentLocale, setContentLocale] = useState<LocaleCode | null>(null);
  const [location, setLocation] = useState<RegistryLocation | null>(null);
  const [loaded, setLoaded] = useState<Registry | null>(null);
  const [registryStatus, setRegistryStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    setSession(readSession());
    setLocation(readRegistryLocation());
  }, []);

  /**
   * A registry injected at build time, if a *private* deployment chose to do that.
   *
   * Kept for the private-instance case, where the bundle is not public. It is never the
   * path a browser on the published site can use, which is what `loaded` is for.
   */
  const injected = useMemo<Registry | null>(() => {
    if (!registryJson) return null;
    try {
      return parseRegistry(registryJson);
    } catch {
      return null;
    }
  }, [registryJson]);

  const registry = loaded ?? injected;

  const client = useMemo(
    () =>
      session ? new GitHubClient({ token: session.token, userAgent: 'dheys-cms-admin' }) : null,
    [session],
  );

  const connect = useCallback(
    async (event: TargetedSubmitEvent<HTMLFormElement>) => {
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

  /**
   * Fetch the registry with the operator's own token.
   *
   * Runs whenever a session and a stored location are both present, which is why it is an
   * effect rather than something bolted onto the connect handler: an operator who saves a
   * location while already connected must not have to reconnect to see it take effect.
   */
  useEffect(() => {
    if (!client || !location) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    setRegistryStatus({ kind: 'working', message: t('admin.registry.loading') });
    loadRegistry(toRegistrySource(location), githubRegistryFetcher(client))
      .then((value) => {
        if (cancelled) return;
        setLoaded(value);
        setRegistryStatus({
          kind: 'ok',
          message: t('admin.registry.loaded', { count: String(value.sites.length) }),
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoaded(null);
        setRegistryStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [client, location, t]);

  const saveLocation = useCallback((next: RegistryLocation) => {
    const stored = writeRegistryLocation(next);
    setLocation(next);
    if (!stored) {
      setRegistryStatus({
        kind: 'error',
        message:
          'Saved for this page only — this browser refused to store it, so it will be forgotten on reload.',
      });
    }
  }, []);

  const forgetLocation = useCallback(() => {
    clearRegistryLocation();
    setLocation(null);
    setLoaded(null);
    setRegistryStatus({ kind: 'idle' });
  }, []);

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
        {/*
         * Every view renders, with or without a registry.
         *
         * This block used to read `{registry && view === '…' && …}` six times over, so with
         * no registry *nothing* rendered: clicking a tab updated the view state and the
         * screen never changed. It looked like dead JavaScript and was a total gate — and
         * it gated Settings too, which is the one screen that matters when you have no
         * sites, and the only place to tell the admin where the registry lives. The
         * chicken could not reach the egg.
         */}
        {view === 'settings' && (
          <Settings
            t={t}
            login={session.login}
            location={location}
            status={registryStatus}
            registry={registry}
            onSave={saveLocation}
            onForget={forgetLocation}
            onDisconnect={disconnect}
          />
        )}

        {view !== 'settings' && !registry && <NoRegistry t={t} status={registryStatus} />}

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

        {registry && view === 'runs' && <NotYetWired t={t} view={view} />}

        {registry && sites.length === 0 && view !== 'dashboard' && view !== 'settings' && (
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
  onSubmit: (event: TargetedSubmitEvent<HTMLFormElement>) => void;
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

function NoRegistry({ t, status }: { t: Translate; status: Status }): JSX.Element {
  return (
    <div class="admin__panel" data-testid="no-registry">
      <h2>{t('admin.dashboard.noSites')}</h2>
      {status.kind === 'error' ? (
        <p class="admin__status admin__status--error" data-testid="registry-error">
          {status.message}
        </p>
      ) : (
        <p>
          No registry is configured for this browser yet. Open{' '}
          <strong>{t('admin.nav.settings')}</strong> and point it at the private repository that
          holds <code>dheys-sites.json</code>.
        </p>
      )}
    </div>
  );
}

/**
 * Settings, and the only screen that has to work with nothing configured.
 *
 * It is where the registry location is entered, so gating it on having a registry made the
 * admin unusable from a standing start. It is also where Disconnect lives, for the same
 * reason: the two things you can always do are tell it where to look and stop looking.
 */
function Settings(props: {
  t: Translate;
  login: string;
  location: RegistryLocation | null;
  status: Status;
  registry: Registry | null;
  onSave: (location: RegistryLocation) => void;
  onForget: () => void;
  onDisconnect: () => void;
}): JSX.Element {
  const { t, login, location, status, registry, onSave, onForget, onDisconnect } = props;

  const [owner, setOwner] = useState(location?.owner ?? '');
  const [name, setName] = useState(location?.name ?? '');
  const [path, setPath] = useState(location?.path ?? 'dheys-sites.json');
  const [ref, setRef] = useState(location?.ref ?? 'main');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (event: TargetedSubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const parsed = parseRegistryLocation({ owner, name, path, ref });
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }
    setFormError(null);
    onSave(parsed.value);
  };

  return (
    <div class="admin__panel" data-testid="settings">
      <h2>{t('admin.nav.settings')}</h2>

      <section>
        <h3>{t('admin.settings.registryHeading')}</h3>
        <p>
          The registry is fetched in this browser with your own token, so it is never built into the
          published bundle. Only the <em>location</em> is remembered here; the registry itself and
          your token are not.
        </p>

        <form onSubmit={submit} class="admin__form" data-testid="registry-form">
          <label for="registry-owner">{t('admin.settings.owner')}</label>
          <input
            id="registry-owner"
            data-testid="registry-owner"
            value={owner}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => setOwner((event.currentTarget as HTMLInputElement).value)}
          />

          <label for="registry-name">{t('admin.settings.repository')}</label>
          <input
            id="registry-name"
            data-testid="registry-name"
            value={name}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)}
          />

          <label for="registry-path">{t('admin.settings.path')}</label>
          <input
            id="registry-path"
            data-testid="registry-path"
            value={path}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => setPath((event.currentTarget as HTMLInputElement).value)}
          />

          <label for="registry-ref">{t('admin.settings.ref')}</label>
          <input
            id="registry-ref"
            data-testid="registry-ref"
            value={ref}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => setRef((event.currentTarget as HTMLInputElement).value)}
          />

          <button type="submit" data-testid="registry-save">
            {t('admin.settings.save')}
          </button>
        </form>

        {formError && (
          <p class="admin__status admin__status--error" data-testid="registry-form-error">
            {formError}
          </p>
        )}

        {status.kind !== 'idle' && status.message && (
          <p
            class={status.kind === 'error' ? 'admin__status admin__status--error' : 'admin__status'}
            data-testid="registry-status"
          >
            {status.message}
          </p>
        )}

        {location && (
          <p data-testid="registry-current">
            Reading <code>{`${location.owner}/${location.name}`}</code> at{' '}
            <code>{location.path}</code> on <code>{location.ref}</code>
            {registry ? ` — ${registry.sites.length} site(s).` : '.'}{' '}
            <button
              type="button"
              class="admin__link-button"
              onClick={onForget}
              data-testid="registry-forget"
            >
              {t('admin.settings.forget')}
            </button>
          </p>
        )}

        <p class="admin__hint">
          <strong>A private repository, not a gist.</strong> A fine-grained token — the kind this
          screen asks for, and the kind you can scope to a single repository — cannot be given gist
          access at all; that permission exists only on classic tokens. A gist still works for the{' '}
          <em>runner</em>, which holds its own credential. It cannot work here, so it is not
          offered.
        </p>
      </section>

      <section>
        <h3>{t('admin.settings.sessionHeading')}</h3>
        <p data-testid="settings-identity">{t('admin.connectedAs', { login })}</p>
        <button type="button" onClick={onDisconnect} data-testid="settings-disconnect">
          {t('admin.disconnect')}
        </button>
      </section>
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
