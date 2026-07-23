import { describe, expect, it, vi } from 'vitest'
import { LatestSaveQueue } from './latestSaveQueue'
import type { SaveSnapshot } from './latestSaveQueue'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('LatestSaveQueue', () => {
  it('waits for the in-flight save and drains a newer snapshot before resolving', async () => {
    const first = deferred()
    const second = deferred()
    const writes: string[] = []
    const save = vi.fn((snapshot: SaveSnapshot) => {
      writes.push(snapshot.content)
      return snapshot.content === 'A' ? first.promise : second.promise
    })
    const queue = new LatestSaveQueue(save)

    queue.enqueue({ filename: 'note.md', content: 'A' })
    const flush = queue.flush()
    expect(writes).toEqual(['A'])

    queue.enqueue({ filename: 'note.md', content: 'B' })
    expect(queue.flush()).toBe(flush)

    first.resolve()
    await vi.waitFor(() => expect(writes).toEqual(['A', 'B']))

    let finished = false
    void flush.then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)

    second.resolve()
    await flush
    expect(queue.hasWork()).toBe(false)
  })

  it('retries only the newest snapshot when an older write fails', async () => {
    const first = deferred()
    const writes: string[] = []
    const save = vi.fn((snapshot: SaveSnapshot) => {
      writes.push(snapshot.content)
      return snapshot.content === 'A' ? first.promise : Promise.resolve()
    })
    const queue = new LatestSaveQueue(save)

    queue.enqueue({ filename: 'note.md', content: 'A' })
    const failedFlush = queue.flush()
    queue.enqueue({ filename: 'note.md', content: 'B' })
    const rejection = expect(failedFlush).rejects.toThrow('disk full')
    first.reject(new Error('disk full'))
    await rejection

    await queue.flush()
    expect(writes).toEqual(['A', 'B'])
    expect(queue.hasWork()).toBe(false)
  })
})
