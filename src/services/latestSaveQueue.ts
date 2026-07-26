export interface SaveSnapshot {
  filename: string
  content: string
}

interface QueueCallbacks {
  onSaving?: () => void
  onSaved?: (snapshot: SaveSnapshot, hasPending: boolean) => void
  onError?: (error: unknown) => void
}

/** Serializes writes while keeping the newest pending snapshot for each file. */
export class LatestSaveQueue {
  private pending = new Map<string, SaveSnapshot>()
  private running: Promise<void> | null = null

  constructor(
    private readonly save: (snapshot: SaveSnapshot) => Promise<unknown>,
    private readonly callbacks: QueueCallbacks = {},
  ) {}

  enqueue(snapshot: SaveSnapshot): void {
    this.pending.set(snapshot.filename, snapshot)
  }

  hasWork(): boolean {
    return this.pending.size > 0 || Boolean(this.running)
  }

  clearPending(filename?: string): void {
    if (filename) this.pending.delete(filename)
    else this.pending.clear()
  }

  flush(): Promise<void> {
    if (this.running) return this.running

    const drain = async () => {
      while (this.pending.size > 0) {
        const next = this.pending.entries().next().value as [string, SaveSnapshot] | undefined
        if (!next) break
        const [filename, snapshot] = next
        this.pending.delete(filename)
        this.callbacks.onSaving?.()
        try {
          await this.save(snapshot)
          this.callbacks.onSaved?.(snapshot, this.pending.size > 0)
        } catch (error) {
          // Preserve a newer snapshot for the same file. Otherwise put the
          // failed write back at the front without discarding other files.
          if (!this.pending.has(filename)) {
            this.pending = new Map([[filename, snapshot], ...this.pending])
          }
          this.callbacks.onError?.(error)
          throw error
        }
      }
    }

    let running: Promise<void>
    running = drain().finally(() => {
      if (this.running === running) this.running = null
    })
    this.running = running
    return running
  }
}
