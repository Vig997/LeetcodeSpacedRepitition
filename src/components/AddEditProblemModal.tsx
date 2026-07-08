import { useState } from 'react'
import { TOPICS } from '../lib/topics'
import type { Difficulty } from '../lib/types'

interface Props {
  onAdd: (input: {
    title: string
    slug: string
    difficulty: Difficulty
    topic: string
    url?: string
  }) => { added: boolean; message: string }
  onClose: () => void
}

function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
}

export default function AddEditProblemModal({ onAdd, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium')
  const [topic, setTopic] = useState<string>(TOPICS[0])
  const [url, setUrl] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const submit = (): void => {
    if (!title.trim()) {
      setMessage('Title is required')
      return
    }
    const res = onAdd({
      title,
      slug: slug.trim() || slugify(title),
      difficulty,
      topic,
      url: url || undefined,
    })
    if (res.added) {
      onClose()
    } else {
      setMessage(res.message)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 outline-none focus:border-sky-600'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold text-gray-100">Add Problem</h3>
        <div className="space-y-3">
          <label className="block text-sm text-gray-400">
            Title
            <input
              className={`mt-1 ${inputCls}`}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                if (!slugTouched) setSlug(slugify(e.target.value))
              }}
              placeholder="e.g. Design Hit Counter"
            />
          </label>
          <label className="block text-sm text-gray-400">
            Slug <span className="text-gray-600">(NeetCode slug match → Kept, else bonus)</span>
            <input
              className={`mt-1 ${inputCls}`}
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value)
                setSlugTouched(true)
              }}
            />
          </label>
          <div className="flex gap-3">
            <label className="block flex-1 text-sm text-gray-400">
              Difficulty
              <select
                className={`mt-1 ${inputCls}`}
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              >
                <option>Easy</option>
                <option>Medium</option>
                <option>Hard</option>
              </select>
            </label>
            <label className="block flex-1 text-sm text-gray-400">
              Topic
              <select
                className={`mt-1 ${inputCls}`}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              >
                {TOPICS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm text-gray-400">
            URL <span className="text-gray-600">(optional — defaults to leetcode.com/problems/slug)</span>
            <input
              className={`mt-1 ${inputCls}`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://leetcode.com/problems/..."
            />
          </label>
        </div>

        {message && <p className="mt-3 text-sm text-amber-400">{message}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
