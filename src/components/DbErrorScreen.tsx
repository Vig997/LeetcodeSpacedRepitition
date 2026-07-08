interface Props {
  message: string
  path: string
}

/** Shown when SQLite cannot open the user DB — points at backup restore. */
export default function DbErrorScreen({ message, path }: Props) {
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16 text-gray-200">
      <h1 className="mb-2 text-xl font-semibold text-red-300">Couldn’t open your progress database</h1>
      <p className="mb-4 text-sm text-gray-400">
        The app couldn’t read <code className="text-gray-300">{path}</code>. Close the app, then try
        restoring from the backup in the same folder.
      </p>
      <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm text-gray-300">
        <li>Close this window completely.</li>
        <li>
          In <code className="text-gray-200">%APPDATA%\leetcode-sr\</code>, delete{' '}
          <code className="text-gray-200">data.db-wal</code> and{' '}
          <code className="text-gray-200">data.db-shm</code> if they exist.
        </li>
        <li>
          Copy <code className="text-gray-200">data.backup.db</code> over{' '}
          <code className="text-gray-200">data.db</code> (replace the broken file).
        </li>
        <li>Also delete any leftover <code className="text-gray-200">data.backup.db-wal</code> /{' '}
          <code className="text-gray-200">-shm</code> if present.</li>
        <li>Re-open the app.</li>
      </ol>
      <p className="rounded-lg border border-gray-800 bg-gray-900/60 p-3 font-mono text-xs text-red-200/90">
        {message}
      </p>
    </div>
  )
}
