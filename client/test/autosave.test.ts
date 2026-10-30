import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAutosave, type SaveStatus } from '../src/autosave.ts';

/** A fake document: `edit()` makes it dirty, a finished save stores the version it started with. */
function setup(opts: { fail?: () => unknown; denied?: (err: unknown) => boolean } = {}) {
  let version = 0;
  let saved = 0;
  const statuses: SaveStatus[] = [];
  let release: (() => void) | null = null;
  let hold = false;
  const save = vi.fn(async () => {
    const v = version;
    if (hold) await new Promise<void>((r) => (release = r));
    const err = opts.fail?.();
    if (err) throw err;
    saved = v;
  });
  const autosave = createAutosave({
    delayMs: 1500,
    retryMs: 15000,
    isDirty: () => version !== saved,
    save,
    onStatus: (s) => statuses.push(s),
    isDenied: opts.denied,
  });
  return {
    autosave,
    save,
    statuses,
    edit() {
      version += 1;
      autosave.changed();
    },
    holdSaves() {
      hold = true;
    },
    finishSave() {
      hold = false;
      release?.();
      release = null;
    },
    get clean() {
      return version === saved;
    },
  };
}

describe('createAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves once, delayMs after the last of several quick changes', async () => {
    const t = setup();
    t.edit();
    await vi.advanceTimersByTimeAsync(1000);
    t.edit();
    t.edit();
    await vi.advanceTimersByTimeAsync(1499);
    expect(t.save).not.toHaveBeenCalled();
    expect(t.statuses.at(-1)).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.clean).toBe(true);
    expect(t.statuses.slice(-2)).toEqual(['saving', 'saved']);
  });

  it('saves exactly once more for changes made during a save', async () => {
    const t = setup();
    t.holdSaves();
    t.edit();
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.save).toHaveBeenCalledTimes(1);
    t.edit();
    t.edit();
    t.finishSave();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.save).toHaveBeenCalledTimes(2);
    expect(t.clean).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.save).toHaveBeenCalledTimes(2);
  });

  it('does not save a clean document', async () => {
    const t = setup();
    t.autosave.changed();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await t.autosave.flush()).toBe(true);
    expect(t.save).not.toHaveBeenCalled();
  });

  it('reports a failure, then retries after retryMs', async () => {
    let fails = 1;
    const t = setup({ fail: () => (fails-- > 0 ? new Error('offline') : null) });
    t.edit();
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.statuses.at(-1)).toBe('failed');
    expect(t.clean).toBe(false);
    await vi.advanceTimersByTimeAsync(14999);
    expect(t.save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.save).toHaveBeenCalledTimes(2);
    expect(t.clean).toBe(true);
    expect(t.statuses.at(-1)).toBe('saved');
  });

  it('stops retrying after a denial, even on further changes', async () => {
    const denial = { code: '42501' };
    const t = setup({ fail: () => denial, denied: (e) => (e as { code?: string }).code === '42501' });
    t.edit();
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.statuses.at(-1)).toBe('denied');
    t.edit();
    await vi.advanceTimersByTimeAsync(60000);
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.statuses.at(-1)).toBe('denied');
  });

  it('flush saves at once and resolves true when clean', async () => {
    const t = setup();
    t.edit();
    expect(await t.autosave.flush()).toBe(true);
    expect(t.save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.save).toHaveBeenCalledTimes(1);
  });

  it('flush resolves false when the save fails', async () => {
    const t = setup({ fail: () => new Error('offline') });
    t.edit();
    expect(await t.autosave.flush()).toBe(false);
  });
});
