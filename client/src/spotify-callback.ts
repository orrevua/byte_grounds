import { PENDING_KEY, exchangeCode, saveTokens, type Pending } from './spotify.ts';
import { applyDocLang, t } from './i18n.ts';

/**
 * Spotify sends the connect popup here with `?code&state`. Check the state against the one saved
 * when connecting, exchange the code (PKCE verifier) for tokens and store them: the game, in the
 * other window, hears it through the `storage` event. Then close (or go back to the game).
 */
applyDocLang();
const msg = document.querySelector<HTMLParagraphElement>('#msg')!;

async function finish(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const pending = (() => {
    try {
      return JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as Pending | null;
    } catch {
      return null;
    }
  })();
  localStorage.removeItem(PENDING_KEY);
  if (q.get('error')) throw new Error(t('spotify.cancelled'));
  const code = q.get('code');
  if (!code || !pending || q.get('state') !== pending.state) throw new Error(t('spotify.badState'));
  saveTokens(await exchangeCode(code, pending.verifier));
}

finish()
  .then(() => {
    msg.textContent = t('spotify.connectedClose');
    if (window.opener) setTimeout(() => window.close(), 800);
    else setTimeout(() => location.replace('/'), 1200);
  })
  .catch((err: unknown) => {
    msg.textContent = err instanceof Error ? err.message : String(err);
    msg.classList.add('error');
  });
