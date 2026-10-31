import { CHAT_MAX, STATUS_MAX, type StatusFields } from '@byte_grounds/shared/protocol';
import { CHAT_HELP, parseChatInput } from './chat.ts';

export interface HudActions {
  leave(): void;
  setStatus(text: string): void;
  toggleBusy(): void;
  sendChat(text: string): void;
}

/** Keep at most this many chat lines in the log. */
const LOG_LIMIT = 200;

/**
 * In-game HUD (top-left): Leave, the status pill (click to edit), Busy, and the chat toggle with
 * an unread count; the chat panel below it. Enter (outside a text field) jumps to the chat box.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly statusBtn: HTMLButtonElement;
  private readonly busyBtn: HTMLButtonElement;
  private readonly chatBtn: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private status = '';
  private unread = 0;

  constructor(
    private readonly actions: HudActions,
    initial: StatusFields,
    chatOpen: boolean,
  ) {
    const root = (this.root = document.createElement('div'));
    root.id = 'hud';
    root.innerHTML = `
      <div class="hud-bar">
        <button type="button" class="hud-leave" title="Back to character and map selection">← Leave</button>
        <button type="button" class="hud-status" title="Today's status (click to edit)"></button>
        <button type="button" class="hud-busy" title="Busy: zzZ over your avatar (or type /busy)">Busy</button>
        <button type="button" class="hud-chat" title="Chat (Enter)">Chat</button>
      </div>
      <div class="hud-panel">
        <div class="chat-log" aria-live="polite"></div>
        <form class="chat-form"><input maxlength="${CHAT_MAX}" placeholder="Message… (/help)" aria-label="Chat message" /></form>
      </div>`;
    this.statusBtn = root.querySelector('.hud-status')!;
    this.busyBtn = root.querySelector('.hud-busy')!;
    this.chatBtn = root.querySelector('.hud-chat')!;
    this.panel = root.querySelector('.hud-panel')!;
    this.log = root.querySelector('.chat-log')!;
    this.input = root.querySelector('.chat-form input')!;

    root.querySelector('.hud-leave')!.addEventListener('click', () => actions.leave());
    this.statusBtn.addEventListener('click', () => this.editStatus());
    this.busyBtn.addEventListener('click', () => actions.toggleBusy());
    this.chatBtn.addEventListener('click', () => this.setChatOpen(this.panel.classList.contains('hidden')));
    root.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.input.blur();
    });
    addEventListener('keydown', this.onKey);
    document.body.appendChild(root);
    this.setChatOpen(chatOpen);
    this.setSelfStatus(initial);
  }

  /** Reflect our status fields (status text, busy). */
  setSelfStatus(fields: StatusFields): void {
    this.status = fields.status;
    this.statusBtn.textContent = fields.status || 'Set a status…';
    this.statusBtn.classList.toggle('empty', !fields.status);
    this.busyBtn.classList.toggle('on', fields.busy);
    this.busyBtn.textContent = fields.busy ? 'Busy · zzZ' : 'Busy';
  }

  addChat(name: string, text: string, self: boolean): void {
    const line = document.createElement('div');
    line.className = self ? 'chat-line self' : 'chat-line';
    const who = document.createElement('b');
    who.textContent = name;
    line.append(who, document.createTextNode(` ${text}`));
    this.append(line);
    if (!self && this.panel.classList.contains('hidden')) {
      this.unread += 1;
      this.updateChatBtn();
    }
  }

  /** A local note in the log (command feedback). */
  note(text: string): void {
    const line = document.createElement('div');
    line.className = 'chat-line note';
    line.textContent = text;
    this.append(line);
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private append(line: HTMLDivElement): void {
    const atBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 24;
    this.log.appendChild(line);
    while (this.log.childElementCount > LOG_LIMIT) this.log.firstElementChild!.remove();
    if (atBottom || line.classList.contains('self')) this.log.scrollTop = this.log.scrollHeight;
  }

  private setChatOpen(open: boolean): void {
    this.panel.classList.toggle('hidden', !open);
    this.chatBtn.classList.toggle('on', open);
    if (open) {
      this.unread = 0;
      this.log.scrollTop = this.log.scrollHeight;
    }
    this.updateChatBtn();
  }

  private updateChatBtn(): void {
    this.chatBtn.textContent = this.unread ? `Chat (${this.unread})` : 'Chat';
  }

  private submit(): void {
    const cmd = parseChatInput(this.input.value);
    this.input.value = '';
    switch (cmd.kind) {
      case 'say':
        return this.actions.sendChat(cmd.text);
      case 'busy':
        return this.actions.toggleBusy();
      case 'status':
        this.actions.setStatus(cmd.text);
        return this.note(cmd.text ? `Status set: ${cmd.text}` : 'Status cleared');
      case 'help':
        return this.note(CHAT_HELP);
      case 'unknown':
        return this.note(`Unknown command /${cmd.name}. ${CHAT_HELP}`);
      case 'empty':
        return;
    }
  }

  /** Swap the status pill for a text field: Enter or leaving the field saves, Esc cancels. */
  private editStatus(): void {
    const field = document.createElement('input');
    field.className = 'hud-status-input';
    field.maxLength = STATUS_MAX;
    field.placeholder = 'What are you working on today?';
    field.value = this.status;
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      if (save) this.actions.setStatus(field.value);
      field.replaceWith(this.statusBtn);
    };
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    field.addEventListener('blur', () => finish(true));
    this.statusBtn.replaceWith(field);
    field.focus();
    field.select();
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' || e.repeat) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    if (t instanceof HTMLButtonElement) return;
    e.preventDefault();
    this.setChatOpen(true);
    this.input.focus();
  };
}
