import { t } from './i18n.ts';

/** How long an invite stays open before it declines itself. */
export const INVITE_MS = 60_000;

export interface RoomChoice {
  key: string;
  name: string;
}

let card: HTMLDivElement | null = null;
let cleanup: (() => void) | null = null;

/** Close whichever invite card is open (form, prompt or password). */
export function closeInviteCard(): void {
  cleanup?.();
  cleanup = null;
  card?.remove();
  card = null;
}

/** A card centred near the top; Esc or `onCancel` closes it. */
function openCard(html: string, onCancel: () => void): HTMLDivElement {
  closeInviteCard();
  const el = (card = document.createElement('div'));
  el.className = 'invite-card';
  el.innerHTML = html;
  document.body.appendChild(el);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeInviteCard();
      onCancel();
    }
  };
  addEventListener('keydown', onKey);
  cleanup = () => removeEventListener('keydown', onKey);
  return el;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Invite `name`: pick the room (when there are several) and an optional password. */
export function openInviteForm(name: string, rooms: readonly RoomChoice[], onSend: (room: string, password: string) => void): void {
  const select =
    rooms.length > 1
      ? `<label>${t('invite.room')} <select class="invite-room">${rooms.map((r) => `<option value="${esc(r.key)}">${esc(r.name)}</option>`).join('')}</select></label>`
      : `<p class="invite-sub">${esc(rooms[0]!.name)}</p>`;
  const el = openCard(
    `<form>
      <b>${esc(t('invite.title', { name }))}</b>
      ${select}
      <input class="invite-pw" type="password" maxlength="40" autocomplete="new-password" placeholder="${esc(t('invite.passwordPlaceholder'))}" />
      <p class="invite-hint">${esc(t('invite.passwordHint'))}</p>
      <div class="invite-actions">
        <button type="button" class="invite-cancel">${esc(t('invite.cancel'))}</button>
        <button type="submit" class="primary">${esc(t('invite.send'))}</button>
      </div>
    </form>`,
    () => {},
  );
  const form = el.querySelector('form')!;
  el.querySelector('.invite-cancel')!.addEventListener('click', closeInviteCard);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const room = el.querySelector<HTMLSelectElement>('.invite-room')?.value ?? rooms[0]!.key;
    const password = el.querySelector<HTMLInputElement>('.invite-pw')!.value;
    closeInviteCard();
    onSend(room, password);
  });
  el.querySelector<HTMLInputElement>('.invite-pw')!.focus();
}

/** "Ana invites you to <room>": Accept / Decline; declines itself after `INVITE_MS`. */
export function showInvitePrompt(from: string, room: string, locked: boolean, onAnswer: (accept: boolean) => void): void {
  let answered = false;
  const answer = (accept: boolean) => {
    if (answered) return;
    answered = true;
    clearInterval(timer);
    closeInviteCard();
    onAnswer(accept);
  };
  const el = openCard(
    `<b>${esc(t('invite.prompt', { name: from, room }))}</b>
    ${locked ? `<p class="invite-sub">${esc(t('invite.lockedNote'))}</p>` : ''}
    <div class="invite-actions">
      <button type="button" class="invite-decline">${esc(t('invite.decline'))} <span class="invite-left"></span></button>
      <button type="button" class="primary invite-accept">${esc(t('invite.accept'))}</button>
    </div>`,
    () => answer(false),
  );
  const prevCleanup = cleanup;
  cleanup = () => {
    prevCleanup?.();
    if (!answered) {
      // Replaced by another card: this invite is declined.
      answered = true;
      clearInterval(timer);
      onAnswer(false);
    }
  };
  const left = el.querySelector<HTMLSpanElement>('.invite-left')!;
  const end = Date.now() + INVITE_MS;
  const tick = () => {
    const s = Math.ceil((end - Date.now()) / 1000);
    if (s <= 0) return answer(false);
    left.textContent = `(${s})`;
  };
  const timer = setInterval(tick, 500);
  tick();
  el.querySelector('.invite-decline')!.addEventListener('click', () => answer(false));
  el.querySelector('.invite-accept')!.addEventListener('click', () => answer(true));
}

/** "<room> is locked": ask for the password; `check` says whether it opens the door. */
export function askRoomPassword(room: string, check: (password: string) => Promise<boolean>): void {
  const el = openCard(
    `<form>
      <b>${esc(t('invite.lockedTitle', { room }))}</b>
      <input class="invite-pw" type="password" maxlength="40" autocomplete="off" placeholder="${esc(t('invite.password'))}" />
      <p class="invite-error"></p>
      <div class="invite-actions">
        <button type="button" class="invite-cancel">${esc(t('invite.cancel'))}</button>
        <button type="submit" class="primary">${esc(t('invite.enter'))}</button>
      </div>
    </form>`,
    () => {},
  );
  const input = el.querySelector<HTMLInputElement>('.invite-pw')!;
  const error = el.querySelector<HTMLParagraphElement>('.invite-error')!;
  el.querySelector('.invite-cancel')!.addEventListener('click', closeInviteCard);
  el.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    void check(input.value).then((ok) => {
      if (ok) return closeInviteCard();
      error.textContent = t('invite.wrongPassword');
      input.select();
    });
  });
  input.focus();
}

/** Whether an invite card is on screen (movement keys are typing then). */
export function inviteCardOpen(): boolean {
  return card !== null;
}
