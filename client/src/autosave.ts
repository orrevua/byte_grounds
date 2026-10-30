/** What the autosave is doing, for the status line. */
export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'failed' | 'denied';

export interface AutosaveOpts {
  /** Quiet time after the last change before saving. */
  delayMs: number;
  /** Wait before trying again after a failed save. */
  retryMs: number;
  isDirty(): boolean;
  save(): Promise<void>;
  onStatus(s: SaveStatus, err?: unknown): void;
  /** True for errors retrying can't fix (no permission): status 'denied', no automatic retry. */
  isDenied?(err: unknown): boolean;
}

export interface Autosave {
  /** Something changed: (re)start the debounce, or let the running save pick it up. */
  changed(): void;
  /** Save now (no debounce); resolves true when there is nothing left unsaved. */
  flush(): Promise<boolean>;
  dispose(): void;
}

/**
 * Debounced saving with one save in flight at a time: changes made during a save are saved right
 * after it. A failure retries after `retryMs` or on the next change, unless it is a denial.
 */
export function createAutosave(o: AutosaveOpts): Autosave {
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<boolean> | null = null;
  let denied = false;
  let disposed = false;

  const clearTimers = () => {
    if (debounce) clearTimeout(debounce);
    if (retry) clearTimeout(retry);
    debounce = retry = null;
  };

  /** Save until clean; stops at the first failure. */
  async function run(): Promise<boolean> {
    for (;;) {
      if (!o.isDirty()) {
        // Nothing left to save (e.g. the map was reloaded): a denial no longer blocks autosave.
        denied = false;
        o.onStatus('saved');
        return true;
      }
      o.onStatus('saving');
      try {
        await o.save();
        denied = false;
      } catch (err) {
        if (o.isDenied?.(err)) {
          denied = true;
          o.onStatus('denied', err);
        } else {
          o.onStatus('failed', err);
          if (!disposed) retry = setTimeout(() => void flush(), o.retryMs);
        }
        return false;
      }
      if (disposed) return !o.isDirty();
    }
  }

  function flush(): Promise<boolean> {
    clearTimers();
    inFlight ??= run().finally(() => (inFlight = null));
    return inFlight;
  }

  function changed(): void {
    if (disposed || denied || inFlight) return;
    clearTimers();
    if (!o.isDirty()) {
      o.onStatus('saved');
      return;
    }
    o.onStatus('pending');
    debounce = setTimeout(() => void flush(), o.delayMs);
  }

  return {
    changed,
    flush,
    dispose: () => {
      disposed = true;
      clearTimers();
    },
  };
}
