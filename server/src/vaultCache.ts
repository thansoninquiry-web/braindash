/**
 * One cached vault snapshot, invalidated by a directory watch instead of a TTL.
 *
 * A full scan reads every note, so a dashboard that polls once a minute should
 * not pay for one each time. While the watcher is alive an unchanged vault is
 * served straight from memory; a filesystem event marks the snapshot dirty and
 * the next request rescans. Without a watcher (an unsupported filesystem, a
 * failed `fs.watch`, or a platform that cannot watch recursively) the cache
 * falls back to the short TTL it used before, so a poll still notices changes.
 */

export interface VaultWatcher {
  close(): void;
}

export interface VaultCacheOptions<T> {
  /** Reads the whole vault. Only called when the cache is missing or dirty. */
  scan: () => Promise<T>;
  /**
   * Starts watching for changes. Return `null` when watching is unavailable;
   * call `onError` if a watcher that started later fails.
   */
  watch?: (onChange: () => void, onError: () => void) => VaultWatcher | null;
  /** Freshness window used only while no watcher is running. */
  fallbackTtlMs?: number;
  now?: () => number;
}

export class VaultCache<T> {
  private readonly scan: () => Promise<T>;
  private readonly watch?: (onChange: () => void, onError: () => void) => VaultWatcher | null;
  private readonly fallbackTtlMs: number;
  private readonly now: () => number;

  private entry: { snapshot: T; at: number } | null = null;
  private dirty = true;
  private pending: Promise<T> | null = null;
  private watcher: VaultWatcher | null = null;
  private watchTried = false;
  private watching = false;

  constructor(options: VaultCacheOptions<T>) {
    this.scan = options.scan;
    this.watch = options.watch;
    this.fallbackTtlMs = options.fallbackTtlMs ?? 5_000;
    this.now = options.now ?? Date.now;
  }

  /** True while a change event can invalidate the snapshot. */
  get isWatching(): boolean {
    return this.watching;
  }

  /** Forces the next `get` to read the vault, for an explicit Rescan action. */
  invalidate(): void {
    this.dirty = true;
  }

  async get(): Promise<T> {
    this.startWatching();

    // Requests during a rescan wait for the new read rather than taking the
    // snapshot it is replacing: stats and notes answered from one poll should
    // describe the same vault.
    if (this.pending) return this.pending;

    const entry = this.entry;
    if (entry && !this.dirty && (this.watching || this.now() - entry.at < this.fallbackTtlMs)) {
      return entry.snapshot;
    }

    // Cleared before the read starts: an event that lands while it runs sets
    // `dirty` again, so the next request takes a fresh snapshot.
    this.dirty = false;
    const pending = Promise.resolve()
      .then(() => this.scan())
      .then((snapshot) => {
        this.entry = { snapshot, at: this.now() };
        return snapshot;
      })
      .catch((error: unknown) => {
        // Nothing usable was produced; keep the snapshot dirty so the next
        // request tries again instead of serving the stale one.
        this.dirty = true;
        throw error;
      })
      .finally(() => {
        this.pending = null;
      });
    this.pending = pending;
    return pending;
  }

  /** Stops the watcher. The next `get` falls back to the TTL. */
  close(): void {
    this.watching = false;
    const watcher = this.watcher;
    this.watcher = null;
    try {
      watcher?.close();
    } catch {
      // A watcher that already failed cannot make shutdown fail.
    }
  }

  private startWatching(): void {
    if (this.watchTried || !this.watch) return;
    this.watchTried = true;
    try {
      const watcher = this.watch(
        () => {
          this.dirty = true;
        },
        () => this.watcherFailed(),
      );
      if (!watcher) return;
      this.watcher = watcher;
      this.watching = true;
    } catch {
      // `fs.watch` throws for an unsupported recursive mode or a vanished root;
      // the TTL keeps the cache correct, just less cheap.
      this.watching = false;
    }
  }

  private watcherFailed(): void {
    this.watching = false;
    // Events may have been missed before the watcher died, so the next request
    // must rescan once before trusting the TTL again.
    this.dirty = true;
    const watcher = this.watcher;
    this.watcher = null;
    try {
      watcher?.close();
    } catch {
      // Already gone.
    }
  }
}
