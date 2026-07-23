export interface SaveSnapshot {
  filename: string
  content: string
}

interface QueueCallbacks {
  onSaving?: () => void
  onSaved?: (snapshot: SaveSnapshot, hasPending: boolean) => void
  onError?: (error: unknown) => void
}

/** Serializes writes while keeping only the newest snapshot not yet written. */
export class LatestSaveQueue {
  private pending: SaveSnapshot | null = null
  private running: Promise<void> | null = null

  constructor(
    private readonly save: (snapshot: SaveSnapshot) => Promise<unknown>,
    private readonly callbacks: QueueCallbacks = {},
  ) {}

  enqueue(snapshot: SaveSnapshot): void {
    this.pending = snapshot
  }

  hasWork(): boolean {
    return Boolean(this.pending || this.running)
  }

  clearPending(filename?: string): void {
    if (!filename || this.pending?.filename === filename) this.pending = null
  }

  flush(): Promise<void> {
    if (this.running) return this.running

    const drain = async () => {
      while (this.pending) {
        const snapshot = this.pending
        this.pending = null
        this.callbacks.onSaving?.()
        try {
          await this.save(snapshot)
          this.callbacks.onSaved?.(snapshot, Boolean(this.pending))
        } catch (error) {
          // Keep a newer snapshot if one arrived during the failed write. The
          // failed snapshot is only retryable when it is still the latest one.
          if (!this.pending) this.pending = snapshot
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
