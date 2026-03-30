import { useState, useRef, useCallback } from 'react'
import ELDLogSheet, { drawELDLog, CW, CH } from './ELDLogSheet'

export default function LogViewer({ dailyLogs }) {
  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState(false)

  const downloadPDF = useCallback(async () => {
    if (!dailyLogs || dailyLogs.length === 0) return
    setExporting(true)

    try {
      // Create an off-screen canvas for each day and convert to images
      const canvas = document.createElement('canvas')
      const images = []

      for (const logDay of dailyLogs) {
        drawELDLog(canvas, logDay, {})
        images.push(canvas.toDataURL('image/png'))
      }

      // Build a printable HTML document with all sheets
      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        alert('Please allow pop-ups to download ELD logs')
        return
      }

      const html = `<!DOCTYPE html>
<html><head>
<title>ELD Logs - ${dailyLogs[0]?.date || 'Trip'}</title>
<style>
  @media print { @page { size: landscape; margin: 0.25in; } }
  body { margin: 0; padding: 0; background: #fff; }
  .page { page-break-after: always; text-align: center; padding: 10px 0; }
  .page:last-child { page-break-after: avoid; }
  img { max-width: 100%; height: auto; }
</style>
</head><body>
${images.map((src, i) => `<div class="page"><img src="${src}" alt="Day ${i + 1}" /></div>`).join('\n')}
<script>window.onload = () => { window.print(); }</script>
</body></html>`

      printWindow.document.write(html)
      printWindow.document.close()
    } finally {
      setExporting(false)
    }
  }, [dailyLogs])

  if (!dailyLogs || dailyLogs.length === 0) {
    return (
      <div className="card p-8 text-center text-gray-500">
        No log data available.
      </div>
    )
  }

  const total = dailyLogs.length

  return (
    <div className="space-y-4">
      {/* Pagination header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">
          Daily ELD Logs
          <span className="ml-2 text-sm text-gray-400 font-normal">
            ({total} sheet{total > 1 ? 's' : ''})
          </span>
        </h2>
        <div className="flex items-center gap-3">
          {/* PDF/Print button */}
          <button
            onClick={downloadPDF}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700
                       text-gray-300 text-xs font-medium hover:bg-gray-700 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            {exporting ? 'Preparing...' : 'Print / PDF'}
          </button>

          {/* Pagination */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300
                         hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Page indicator — dots for ≤10 days, text for more */}
            {total <= 10 ? (
              <div className="flex gap-1.5">
                {dailyLogs.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    className={`h-2 rounded-full transition-all duration-200 ${
                      i === page
                        ? 'w-6 bg-blue-500'
                        : 'w-2 bg-gray-700 hover:bg-gray-600'
                    }`}
                  />
                ))}
              </div>
            ) : (
              <span className="text-xs text-gray-400 font-medium tabular-nums min-w-[3.5rem] text-center">
                {page + 1} / {total}
              </span>
            )}

            <button
              onClick={() => setPage(p => Math.min(total - 1, p + 1))}
              disabled={page === total - 1}
              className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300
                         hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Current sheet */}
      <ELDLogSheet
        logDay={dailyLogs[page]}
        dayNumber={page + 1}
        totalDays={total}
      />

      {/* All days overview */}
      {total > 1 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            All Days Overview
          </h3>
          <div className="space-y-2">
            {dailyLogs.map((log, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                            transition-colors ${
                              i === page
                                ? 'bg-blue-600/20 border border-blue-600/40'
                                : 'hover:bg-gray-800 border border-transparent'
                            }`}
              >
                <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full
                                  flex-shrink-0 ${
                                    i === page ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
                                  }`}>
                  {i + 1}
                </span>
                <span className="text-sm text-white font-medium flex-1">{log.date}</span>
                <div className="flex gap-3 text-xs text-gray-400">
                  <span className="text-green-400">{(log.totals?.driving || 0).toFixed(1)}h drive</span>
                  <span className="text-blue-400">{(log.totals?.off_duty || 0).toFixed(1)}h off</span>
                  <span className="text-gray-500">{log.total_miles ?? 0}mi</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
