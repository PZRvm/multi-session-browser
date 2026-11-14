import { create } from 'zustand'
import type { UpdateSnapshot } from '../../../shared/updates'

let initialized = false
export const useUpdatesStore = create<{
  state: UpdateSnapshot | null
  init(): Promise<void>
}>((set) => ({
  state: null,
  async init() {
    if (initialized) return
    initialized = true
    const accept = (next: UpdateSnapshot): void => {
      set((current) =>
        current.state && current.state.revision > next.revision ? current : { state: next }
      )
    }
    const unsubscribe = window.api.updates.onChanged(accept)
    import.meta.hot?.dispose(unsubscribe)
    try {
      accept(await window.api.updates.getState())
    } catch {
      unsubscribe()
      initialized = false
    }
  }
}))
