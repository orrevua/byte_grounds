import { shortId } from './auth.ts';
import type { PeerId } from '@byte_grounds/shared/protocol';
import type { GrantsFeed, Perm } from './grants.ts';
import { t, type MsgKey } from './i18n.ts';

/** Someone clicked: their peer id, display name and (when their client sent it) auth uid. */
export interface MenuTarget {
  id: PeerId;
  name: string;
  uid?: string;
}

const TOGGLES: { perm: Perm; label: MsgKey }[] = [
  { perm: 'build', label: 'menu.allowBuild' },
  { perm: 'editor', label: 'menu.allowEditor' },
];

/**
 * The popup at a clicked avatar: who it is, "Invite to a meeting room" (when the map has a free
 * one), and for the admin (`setFeed`) the short id and one on/off toggle per permission. Closes on
 * an outside click or Esc. The database rejects grants from non-admins, so a failure is shown
 * inline rather than trusted away.
 */
export class AvatarMenu {
  private el: HTMLDivElement | null = null;
  private target: MenuTarget | null = null;
  private busy = false;
  private error = '';
  private feed: GrantsFeed | null = null;
  /** Invite the target into a meeting room; offered while `canInvite()` says so. */
  onInvite: ((target: MenuTarget) => void) | null = null;
  canInvite: () => boolean = () => false;

  /** The admin's grants: adds the permission toggles. */
  setFeed(feed: GrantsFeed): void {
    this.feed = feed;
    feed.onChange(() => this.render());
  }

  open(target: MenuTarget, clientX: number, clientY: number): void {
    this.close();
    this.target = target;
    this.error = '';
    this.el = document.createElement('div');
    this.el.id = 'avatar-menu';
    document.body.appendChild(this.el);
    this.render();
    const { width, height } = this.el.getBoundingClientRect();
    this.el.style.left = `${Math.max(4, Math.min(clientX, innerWidth - width - 4))}px`;
    this.el.style.top = `${Math.max(4, Math.min(clientY, innerHeight - height - 4))}px`;
    document.addEventListener('pointerdown', this.onOutside, true);
    addEventListener('keydown', this.onKey);
  }

  close(): void {
    if (!this.el) return;
    document.removeEventListener('pointerdown', this.onOutside, true);
    removeEventListener('keydown', this.onKey);
    this.el.remove();
    this.el = null;
    this.target = null;
  }

  private readonly onOutside = (e: PointerEvent): void => {
    if (this.el && !this.el.contains(e.target as Node)) this.close();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  private render(): void {
    const { el, target } = this;
    if (!el || !target) return;
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = target.name;
    el.replaceChildren(who);
    if (this.onInvite && this.canInvite()) {
      const invite = document.createElement('button');
      invite.type = 'button';
      invite.textContent = t('invite.menu');
      invite.addEventListener('click', () => {
        this.close();
        this.onInvite?.(target);
      });
      el.append(invite);
    }
    const { feed } = this;
    if (!feed) return;
    const { uid } = target;
    if (!uid) {
      // No uid: their silent anonymous sign-in failed (usually anonymous sign-ins are off in
      // the Supabase project), or their tab predates uids.
      el.append(
        note(
          'menu-note',
          "Can't grant: this player isn't signed in. Check that anonymous sign-ins are on in " +
            'Supabase (Authentication → Sign In / Providers), then have them reload.',
        ),
      );
      return;
    }
    const sid = document.createElement('span');
    sid.className = 'sid';
    sid.textContent = ` ${shortId(uid)}`;
    who.append(sid);
    for (const { perm, label } of TOGGLES) {
      const on = feed.has(uid, perm);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = on ? 'on' : '';
      b.textContent = `${t(label)}: ${t(on ? 'menu.on' : 'menu.off')}`;
      b.disabled = this.busy;
      b.addEventListener('click', () => void this.toggle(uid, perm, on));
      el.append(b);
    }
    if (this.error) el.append(note('menu-error', this.error));
  }

  private async toggle(uid: string, perm: Perm, on: boolean): Promise<void> {
    this.busy = true;
    this.error = '';
    this.render();
    try {
      await (on ? this.feed!.revoke(uid, perm) : this.feed!.grant(uid, perm));
    } catch (err) {
      this.error = t('menu.saveFailed', { msg: (err as { message?: string })?.message ?? String(err) });
    } finally {
      this.busy = false;
      this.render();
    }
  }
}

function note(className: string, text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  d.textContent = text;
  return d;
}
