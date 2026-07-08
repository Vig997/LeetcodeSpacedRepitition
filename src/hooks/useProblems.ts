import { useSyncExternalStore } from 'react'
import { subscribe, getVersion, getSnapshot } from '../lib/dataStore'
import type { Snapshot } from '../lib/dataStore'

/** Single shared data hook — every tab renders from the same SQLite snapshot. */
export function useProblems(): Snapshot {
  useSyncExternalStore(subscribe, getVersion)
  return getSnapshot()
}
