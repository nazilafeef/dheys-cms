/**
 * Admin session.
 *
 * The token-storage model, stated plainly (and again in docs/SECURITY.md):
 *
 *   The admin holds a GitHub fine-grained PAT in `sessionStorage`, and nowhere else.
 *
 * What that buys: the token dies with the browser tab, is not readable by another origin,
 * is never written to disk by this application, and never leaves the browser except in an
 * `Authorization` header to api.github.com.
 *
 * What it costs, honestly: `sessionStorage` is readable by any script running on this
 * origin. If an attacker gets script execution here -- through a compromised dependency,
 * a malicious Astro integration, or a stored-XSS hole -- they can read the token. There is
 * no way to hold a credential in a browser that survives that; `httpOnly` cookies would,
 * but they require a server, and this control plane deliberately has none.
 *
 * The mitigations that follow from accepting that:
 *   - the token is scoped by the operator to specific repositories, so its blast radius is
 *     the sites they chose, not their whole account;
 *   - it is session-scoped, so a shared or borrowed machine does not retain it;
 *   - nothing is persisted to `localStorage`, ever, including "remember me";
 *   - the app ships no `unsafe-eval` and no runtime schema compiler, so the usual route to
 *     script execution in a data-driven admin is closed.
 *
 * An operator who wants a stronger model should use the documented GitHub App path
 * (docs/SECURITY.md), which moves the credential out of the browser entirely.
 */

const TOKEN_KEY = 'dheys.session.token';
const LOGIN_KEY = 'dheys.session.login';

/** The storage this module uses. Injected so tests never touch a real Storage. */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Session {
  readonly token: string;
  readonly login: string;
}

function defaultStorage(): SessionStorageLike | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    // Storage can throw outright in some privacy modes rather than merely being absent.
    return undefined;
  }
}

/**
 * A token shaped like a GitHub credential.
 *
 * This is a typo check, not a security check -- only GitHub can say whether a token is
 * valid, and `verify()` asks it. Rejecting an obviously wrong string early saves the
 * operator a round trip and a misleading 401.
 */
export function looksLikeToken(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 20) return false;
  return /^(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})$/.test(trimmed);
}

export function readSession(
  storage: SessionStorageLike | undefined = defaultStorage(),
): Session | null {
  if (!storage) return null;
  try {
    const token = storage.getItem(TOKEN_KEY);
    const login = storage.getItem(LOGIN_KEY);
    if (!token || !login) return null;
    return { token, login };
  } catch {
    return null;
  }
}

export function writeSession(
  session: Session,
  storage: SessionStorageLike | undefined = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(TOKEN_KEY, session.token);
    storage.setItem(LOGIN_KEY, session.login);
  } catch {
    // Nothing to do: the session simply will not survive a reload. That is a degraded
    // experience, not a failure, and pretending otherwise would be worse.
  }
}

export function clearSession(storage: SessionStorageLike | undefined = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(TOKEN_KEY);
    storage.removeItem(LOGIN_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Redact a token for display. Never render the whole thing, not even to its owner. */
export function redact(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 12) return '••••';
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`;
}
