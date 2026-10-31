import { normalizeChat, normalizeStatus } from '@byte_grounds/shared/protocol';

/** What a line typed into the chat box asks for. */
export type ChatInput =
  | { kind: 'say'; text: string }
  | { kind: 'busy' }
  | { kind: 'status'; text: string }
  | { kind: 'help' }
  | { kind: 'unknown'; name: string }
  | { kind: 'empty' };

/** Parse a chat box line: `/command args` or a message to say. */
export function parseChatInput(raw: string): ChatInput {
  const line = raw.trim();
  if (!line.startsWith('/')) {
    const text = normalizeChat(line);
    return text ? { kind: 'say', text } : { kind: 'empty' };
  }
  const [, name = '', rest = ''] = /^\/(\S*)\s*(.*)$/s.exec(line) ?? [];
  switch (name.toLowerCase()) {
    case 'busy':
    case 'afk':
      return { kind: 'busy' };
    case 'status':
      return { kind: 'status', text: normalizeStatus(rest) };
    case 'help':
    case '?':
      return { kind: 'help' };
    default:
      return { kind: 'unknown', name };
  }
}

/** Local calendar day, e.g. "2026-10-30" (a daily status is kept for that day only). */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The saved status line if it was set today, else '' (it resets every day). */
export function loadDailyStatus(raw: string | null, today: string): string {
  if (!raw) return '';
  try {
    const o = JSON.parse(raw) as { text?: unknown; day?: unknown };
    return o.day === today ? normalizeStatus(o.text) : '';
  } catch {
    return '';
  }
}

export function saveDailyStatus(text: string, today: string): string {
  return JSON.stringify({ text: normalizeStatus(text), day: today });
}
