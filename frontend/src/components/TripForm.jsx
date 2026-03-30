import { useState, useRef, useEffect, useCallback } from 'react'
import { geocodeSuggest } from '../api/tripApi'

// ── Debounce hook ─────────────────────────────────────────────────────────────
function useDebounce(fn, delay) {
  const timer = useRef(null)
  return useCallback((...args) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => fn(...args), delay)
  }, [fn, delay])
}

// ── Autocomplete input ────────────────────────────────────────────────────────
function LocationInput({ label, value, onChange, placeholder, icon }) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen]               = useState(false)
  const [loading, setLoading]         = useState(false)
  const wrapRef                       = useRef(null)

  const fetchSuggestions = useCallback(async (q) => {
    if (!q || q.length < 3) { setSuggestions([]); return }
    setLoading(true)
    try {
      const results = await geocodeSuggest(q)
      setSuggestions(results)
      setOpen(results.length > 0)
    } catch {
      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }, [])

  const debouncedFetch = useDebounce(fetchSuggestions, 350)

  function handleChange(e) {
    onChange(e.target.value)
    debouncedFetch(e.target.value)
  }

  function handleSelect(item) {
    onChange(item.display_name)
    setSuggestions([])
    setOpen(false)
  }

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={wrapRef} className="relative">
      <label className="label">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-base select-none">
          {icon}
        </span>
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="input-field pl-9"
          autoComplete="off"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <svg className="animate-spin h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          </span>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg
                        shadow-2xl overflow-hidden max-h-56 overflow-y-auto">
          {suggestions.map((s, i) => (
            <div
              key={i}
              className="autocomplete-item"
              onMouseDown={() => handleSelect(s)}
            >
              <div className="truncate">{s.display_name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main form ─────────────────────────────────────────────────────────────────
export default function TripForm({ onSubmit, loading }) {
  const [form, setForm] = useState({
    current_location:   '',
    pickup_location:    '',
    dropoff_location:   '',
    current_cycle_used: '',
  })
  const [errors, setErrors] = useState({})

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }))
    if (errors[key]) setErrors(e => ({ ...e, [key]: null }))
  }

  function validate() {
    const e = {}
    if (!form.current_location.trim())  e.current_location  = 'Required'
    if (!form.pickup_location.trim())   e.pickup_location   = 'Required'
    if (!form.dropoff_location.trim())  e.dropoff_location  = 'Required'
    const cyc = Number(form.current_cycle_used)
    if (form.current_cycle_used === '' || isNaN(cyc) || cyc < 0 || cyc > 70)
      e.current_cycle_used = 'Enter a number between 0 and 70'
    return e
  }

  function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    onSubmit({ ...form, current_cycle_used: Number(form.current_cycle_used) })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Current location */}
      <div>
        <LocationInput
          label="Current Location"
          value={form.current_location}
          onChange={v => setField('current_location', v)}
          placeholder="e.g. Chicago, IL"
          icon="📍"
        />
        {errors.current_location && (
          <p className="mt-1 text-xs text-red-400">{errors.current_location}</p>
        )}
      </div>

      {/* Arrow */}
      <div className="flex justify-center">
        <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Pickup */}
      <div>
        <LocationInput
          label="Pickup Location"
          value={form.pickup_location}
          onChange={v => setField('pickup_location', v)}
          placeholder="e.g. Indianapolis, IN"
          icon="📦"
        />
        {errors.pickup_location && (
          <p className="mt-1 text-xs text-red-400">{errors.pickup_location}</p>
        )}
      </div>

      {/* Arrow */}
      <div className="flex justify-center">
        <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Dropoff */}
      <div>
        <LocationInput
          label="Dropoff Location"
          value={form.dropoff_location}
          onChange={v => setField('dropoff_location', v)}
          placeholder="e.g. Columbus, OH"
          icon="🏁"
        />
        {errors.dropoff_location && (
          <p className="mt-1 text-xs text-red-400">{errors.dropoff_location}</p>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-gray-800 pt-4">
        <label className="label">Current Cycle Used (hrs)</label>
        <div className="relative">
          <input
            type="number"
            min="0"
            max="70"
            step="0.5"
            value={form.current_cycle_used}
            onChange={e => setField('current_cycle_used', e.target.value)}
            placeholder="0"
            className="input-field pr-16"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-medium">
            / 70 hrs
          </span>
        </div>
        {errors.current_cycle_used && (
          <p className="mt-1 text-xs text-red-400">{errors.current_cycle_used}</p>
        )}
        {/* Visual bar */}
        {form.current_cycle_used !== '' && !isNaN(Number(form.current_cycle_used)) && (
          <div className="mt-2">
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min((Number(form.current_cycle_used) / 70) * 100, 100)}%`,
                  background: Number(form.current_cycle_used) > 60
                    ? '#ef4444'
                    : Number(form.current_cycle_used) > 40
                    ? '#f59e0b'
                    : '#3b82f6',
                }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {(70 - Number(form.current_cycle_used)).toFixed(1)} hrs remaining in cycle
            </p>
          </div>
        )}
      </div>

      {/* HOS info hint */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 text-xs text-gray-400 space-y-1">
        <p className="font-semibold text-gray-300">HOS Rules Applied (70hr/8day)</p>
        <p>· Max 11 hrs driving · 14-hr window · 30-min break after 8 hrs</p>
        <p>· 10-hr rest required · Fuel every 1,000 mi</p>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Planning Trip…
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            Plan Trip & Generate Logs
          </>
        )}
      </button>
    </form>
  )
}
