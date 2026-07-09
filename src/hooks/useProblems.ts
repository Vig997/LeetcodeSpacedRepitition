import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot } from '../lib/dataStore'
import type { Snapshot } from '../lib/dataStore'

/** Single shared data hook — every tab renders from the same SQLite snapshot. */
export function useProblems(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
