import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { getDbOpenError, closeAndBackupUserDb } from './lib/db'
import DbErrorScreen from './components/DbErrorScreen'

declare global {
  interface Window {
    __leetcodeSrCloseDb?: () => Promise<void>
  }
}

const root = createRoot(document.getElementById('root')!)
const err = getDbOpenError()

if (err) {
  root.render(
    <StrictMode>
      <DbErrorScreen message={err.message} path={err.path} />
    </StrictMode>,
  )
} else {
  // Main-process close handler calls this for a WAL-safe backup + checkpoint.
  window.__leetcodeSrCloseDb = closeAndBackupUserDb

  // Lazy-load App so dataStore/seed never touch a failed DB open.
  void import('./App.tsx').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
}
