import { lazy, Suspense, useEffect, useState } from 'react'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import BootstrapBadge from './components/BootstrapBadge'
import { useProblems } from './hooks/useProblems'
import { checkDayRollover, undoLastRating } from './lib/dataStore'

// Problems tab is the heavy list — load on first open. Settings stays mounted
// (hidden) so draft slider state isn't lost when you switch tabs.
const Problems = lazy(() => import('./pages/Problems'))

type Tab = 'dashboard' | 'problems' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'problems', label: 'Problems' },
  { id: 'settings', label: 'Settings' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const snap = useProblems()

  // App left open past midnight: reconcile yesterday + assign a fresh Today.
  useEffect(() => {
    const id = setInterval(checkDayRollover, 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-6 pt-5 pb-16">
      <header className="mb-6 flex items-center gap-3">
        <nav className="flex gap-1 rounded-xl border border-gray-800 bg-gray-900/80 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                tab === t.id
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        {snap.canUndo && (
          <button
            type="button"
            onClick={() => undoLastRating()}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition hover:border-amber-700 hover:text-amber-300"
            title="Undo last rating (same calendar day, survives restart)"
          >
            Undo rating
          </button>
        )}
        {snap.bootstrapActive ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-700/60 bg-sky-900/40 px-3 py-1 text-xs font-medium text-sky-300">
            ⟳ Bootstrap Active
          </span>
        ) : (
          snap.bootstrapCompleted && (
            <BootstrapBadge completedOn={snap.bootstrapCompletedOn} />
          )
        )}
      </header>

      {tab === 'dashboard' && <Dashboard />}
      {tab === 'problems' && (
        <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
          <Problems />
        </Suspense>
      )}
      <div className={tab === 'settings' ? undefined : 'hidden'}>
        <Settings />
      </div>
    </div>
  )
}
