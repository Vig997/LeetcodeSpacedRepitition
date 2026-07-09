import { useEffect, useState } from 'react'
import { useProblems } from '../hooks/useProblems'
import { saveSettings } from '../lib/dataStore'
import { parseGoalDateInput } from '../lib/dates'
import { SETTINGS_MAX } from '../lib/settings'
import type { AppSettings } from '../lib/types'

interface SliderProps {
  label: string
  hint: string
  value: number
  min: number
  max: number
  display?: (v: number) => string
  onChange: (v: number) => void
}

function SettingSlider({ label, hint, value, min, max, display, onChange }: SliderProps) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-medium text-gray-200">{label}</span>
        <span className="rounded-md bg-gray-800 px-2.5 py-0.5 text-sm font-semibold text-sky-300">
          {display ? display(value) : value}
        </span>
      </div>
      <p className="mb-3 text-xs text-gray-500">{hint}</p>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      <div className="mt-1 flex justify-between text-[10px] text-gray-600">
        <span>{display ? display(min) : min}</span>
        <span>{display ? display(max) : max}</span>
      </div>
    </div>
  )
}

function settingsEqual(a: AppSettings, b: AppSettings): boolean {
  return (
    a.goal_date === b.goal_date &&
    a.new_per_day === b.new_per_day &&
    a.review_daily_target === b.review_daily_target &&
    a.bootstrap_daily_cap === b.bootstrap_daily_cap
  )
}

export default function Settings() {
  const snap = useProblems()
  const [draft, setDraft] = useState<AppSettings>(snap.settings)
  const [goalDateText, setGoalDateText] = useState(snap.settings.goal_date)
  const [goalDateError, setGoalDateError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const saved = snap.settings

  // Sync from SQLite only when nothing unsaved is on the form.
  useEffect(() => {
    if (!dirty) {
      setDraft(saved)
      setGoalDateText(saved.goal_date)
      setGoalDateError(null)
    }
  }, [dirty, saved])

  const markDirty = (next: AppSettings): void => {
    setDraft(next)
    setDirty(!settingsEqual(next, saved))
  }

  const bind = (key: 'bootstrap_daily_cap' | 'review_daily_target' | 'new_per_day') => ({
    value: draft[key],
    onChange: (v: number) => markDirty({ ...draft, [key]: v }),
  })

  const validateGoalDateText = (raw: string): string | null => {
    const parsed = parseGoalDateInput(raw)
    if (!parsed) {
      setGoalDateError('Use YYYY-MM-DD or MM/DD/YYYY (today or later)')
      return null
    }
    setGoalDateError(null)
    setGoalDateText(parsed)
    return parsed
  }

  const handleGoalDateChange = (raw: string): void => {
    setGoalDateText(raw)
    setGoalDateError(null)
    const parsed = parseGoalDateInput(raw)
    if (parsed) {
      markDirty({ ...draft, goal_date: parsed })
    } else {
      setDirty(!settingsEqual(draft, saved) || raw.trim() !== saved.goal_date)
    }
  }

  const handleGoalDateBlur = (): void => {
    const parsed = validateGoalDateText(goalDateText)
    if (parsed) markDirty({ ...draft, goal_date: parsed })
  }

  const hasChanges = dirty || !settingsEqual(draft, saved)
  const canSave = hasChanges && !goalDateError && parseGoalDateInput(goalDateText) !== null

  const handleSave = (): void => {
    const parsed = parseGoalDateInput(goalDateText)
    if (!parsed) {
      setGoalDateError('Use YYYY-MM-DD or MM/DD/YYYY (today or later)')
      return
    }
    const toSave: AppSettings = { ...draft, goal_date: parsed }
    saveSettings(toSave)
    setDraft(toSave)
    setGoalDateText(parsed)
    setGoalDateError(null)
    setDirty(false)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {hasChanges && (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-4 py-2 text-sm text-amber-300">
          Unsaved Changes — Press Save to Apply
        </div>
      )}

      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-sm font-medium text-gray-200">Goal Date</span>
          <span className="rounded-md bg-gray-800 px-2.5 py-0.5 text-sm font-semibold text-sky-300">
            {draft.goal_date}
          </span>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Target date to master every problem in the Kept section — drives the
          review + new-problem pacing and the on-track message. Today is allowed
          if you already passed an older goal.
        </p>
        <input
          type="text"
          inputMode="numeric"
          placeholder="YYYY-MM-DD or MM/DD/YYYY"
          value={goalDateText}
          onChange={(e) => handleGoalDateChange(e.target.value)}
          onBlur={handleGoalDateBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className={`w-full rounded-lg border bg-gray-800 px-3 py-2 text-sm text-gray-200 outline-none focus:border-sky-600 ${
            goalDateError ? 'border-red-700' : 'border-gray-700'
          }`}
        />
        {goalDateError && (
          <p className="mt-1.5 text-xs text-red-400">{goalDateError}</p>
        )}
      </div>

      <SettingSlider
        label="New Problems Per Day"
        hint="How many undone Kept problems to add daily — Auto derives it from remaining problems ÷ days to goal"
        min={0}
        max={SETTINGS_MAX}
        display={(v) => (v === 0 ? 'Auto' : String(v))}
        {...bind('new_per_day')}
      />
      <SettingSlider
        label="Daily Review Target / Cap"
        hint="Ceiling for spaced-repetition reviews per day"
        min={1}
        max={SETTINGS_MAX}
        {...bind('review_daily_target')}
      />
      <SettingSlider
        label="Bootstrap Reviews Per Day"
        hint="Bootstrap reviews per day when you start a bootstrap from the Dashboard"
        min={1}
        max={SETTINGS_MAX}
        {...bind('bootstrap_daily_cap')}
      />

      <button
        type="button"
        onClick={handleSave}
        disabled={!canSave}
        className="w-full rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Save Settings
      </button>
    </div>
  )
}
