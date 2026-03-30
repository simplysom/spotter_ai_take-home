import { useState } from 'react'
import TripForm  from './components/TripForm'
import MapView   from './components/MapView'
import LogViewer from './components/LogViewer'
import { planTrip } from './api/tripApi'

const TABS = [
  {
    id: 'map',
    label: 'Route Map',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
      </svg>
    ),
  },
  {
    id: 'logs',
    label: 'ELD Logs',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
]

export default function App() {
  const [tripData, setTripData] = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [tab,      setTab]      = useState('map')

  async function handleSubmit(formData) {
    setLoading(true)
    setError(null)
    setTripData(null)
    try {
      const data = await planTrip(formData)
      setTripData(data)
      setTab('map')
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        'An unexpected error occurred. Please try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* ── Navbar ── */}
      <nav className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-white text-sm font-bold">
              S
            </div>
            <span className="text-white font-semibold text-base tracking-tight">Spotter</span>
            <span className="hidden sm:inline text-gray-600 text-sm">/ ELD Trip Planner</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="hidden sm:inline">FMCSA 70hr/8day</span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span>HOS Compliant</span>
          </div>
        </div>
      </nav>

      {/* ── Body ── */}
      <div className="flex-1 max-w-screen-xl mx-auto w-full px-4 sm:px-6 py-6">
        <div className="flex flex-col lg:flex-row gap-6 items-start">

          {/* ── Sidebar: form ── */}
          <aside className="w-full lg:w-80 flex-shrink-0">
            <div className="card p-5">
              <h1 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Trip Details
              </h1>
              <TripForm onSubmit={handleSubmit} loading={loading} />
            </div>

            {/* Error */}
            {error && (
              <div className="mt-3 bg-red-950/50 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3">
                <p className="font-semibold mb-0.5">Error</p>
                <p className="text-xs opacity-80">{error}</p>
              </div>
            )}
          </aside>

          {/* ── Main content ── */}
          <main className="flex-1 min-w-0">
            {!tripData && !loading && (
              <EmptyState />
            )}

            {loading && (
              <LoadingState />
            )}

            {tripData && (
              <div className="space-y-4">
                {/* Tabs */}
                <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
                  {TABS.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        tab === t.id
                          ? 'bg-blue-600 text-white shadow'
                          : 'text-gray-400 hover:text-white hover:bg-gray-800'
                      }`}
                    >
                      {t.icon}
                      {t.label}
                      {t.id === 'logs' && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                          tab === 'logs' ? 'bg-blue-500' : 'bg-gray-700'
                        }`}>
                          {tripData.daily_logs?.length || 0}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                {tab === 'map' && <MapView tripData={tripData} />}
                {tab === 'logs' && <LogViewer dailyLogs={tripData.daily_logs} />}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-800 mt-auto">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between text-xs text-gray-600">
          <span>Spotter ELD Trip Planner · FMCSA 49 CFR Part 395</span>
          <span>Property-carrying CMV · 70hr/8day cycle</span>
        </div>
      </footer>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="card flex flex-col items-center justify-center py-20 px-8 text-center min-h-[400px]">
      <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center text-3xl mb-5">
        🚛
      </div>
      <h2 className="text-lg font-semibold text-white mb-2">Ready to Plan Your Trip</h2>
      <p className="text-sm text-gray-400 max-w-sm leading-relaxed">
        Enter your current location, pickup, and dropoff addresses. We'll calculate
        HOS-compliant stops and generate ELD log sheets automatically.
      </p>
      <div className="mt-8 grid grid-cols-3 gap-4 w-full max-w-xs">
        {[
          { icon: '🗺️', label: 'Route Map' },
          { icon: '📋', label: 'ELD Logs' },
          { icon: '⏱️', label: 'HOS Tracking' },
        ].map(f => (
          <div key={f.label} className="bg-gray-800/50 rounded-lg p-3 text-center">
            <div className="text-2xl mb-1">{f.icon}</div>
            <div className="text-xs text-gray-400">{f.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Loading state ─────────────────────────────────────────────────────────────
function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="card p-5 flex items-center gap-4">
        <div className="relative">
          <div className="w-10 h-10 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
        </div>
        <div>
          <p className="text-sm font-medium text-white">Calculating trip…</p>
          <p className="text-xs text-gray-400">Geocoding locations, fetching route, applying HOS rules</p>
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="h-64 skeleton" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 skeleton rounded-xl" />
        ))}
      </div>
    </div>
  )
}
