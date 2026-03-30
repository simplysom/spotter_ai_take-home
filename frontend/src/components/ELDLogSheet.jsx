import { useEffect, useRef } from 'react'

// ── Canvas layout constants ────────────────────────────────────────────────────
const CW = 1100   // canvas width
const CH = 780    // canvas height (taller for new fields)

const HDR_H   = 160   // header section height (expanded for FMCSA fields)
const TIME_H  = 28    // time-label row height
const ROW_H   = 42    // height of each duty-status row
const ROWS    = 4
const GRID_H  = ROW_H * ROWS   // 168

const GL      = 148   // grid left x
const GR      = CW - 30  // grid right x
const GW      = GR - GL  // grid width (~922)
const GT      = HDR_H + TIME_H  // grid top y

const HOUR_W  = GW / 24
const QRTR_W  = HOUR_W / 4

const REMARKS_TOP = GT + GRID_H + 10
const REMARKS_H   = 180
const TOTALS_TOP  = REMARKS_TOP + REMARKS_H + 8

// Row centers (y) for each duty status
const ROW_LABELS = ['1. Off Duty', '2. Sleeper Berth', '3. Driving', '4. On Duty\n(Not Driving)']
const STATUS_ROW = { off_duty: 0, sleeper: 1, driving: 2, on_duty: 3 }
const STATUS_COLOR = {
  off_duty: '#60a5fa',
  sleeper:  '#a78bfa',
  driving:  '#34d399',
  on_duty:  '#fb923c',
}

function rowY(row) {
  return GT + row * ROW_H + ROW_H / 2
}

function hourX(h) {
  return GL + (h / 24) * GW
}

// ── Drawing helpers ────────────────────────────────────────────────────────────

function setFont(ctx, size, weight = 'normal') {
  ctx.font = `${weight} ${size}px Inter, Arial, sans-serif`
}

function drawRect(ctx, x, y, w, h, fill, stroke) {
  if (fill)  { ctx.fillStyle   = fill;  ctx.fillRect(x, y, w, h) }
  if (stroke){ ctx.strokeStyle = stroke; ctx.strokeRect(x, y, w, h) }
}

function drawText(ctx, text, x, y, opts = {}) {
  const {
    size    = 11,
    weight  = 'normal',
    color   = '#e5e7eb',
    align   = 'left',
    baseline = 'alphabetic',
  } = opts
  setFont(ctx, size, weight)
  ctx.fillStyle    = color
  ctx.textAlign    = align
  ctx.textBaseline = baseline
  ctx.fillText(text, x, y)
}

function drawLine(ctx, x1, y1, x2, y2, color = '#374151', width = 1) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth   = width
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.restore()
}

// ── Main draw function ────────────────────────────────────────────────────────

function drawELDLog(canvas, logDay, meta = {}) {
  const ctx = canvas.getContext('2d')
  canvas.width  = CW
  canvas.height = CH

  // Background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CW, CH)

  drawHeader(ctx, logDay, meta)
  drawTimeLabels(ctx)
  drawGrid(ctx)
  drawRowLabels(ctx)
  drawEvents(ctx, logDay.events)
  drawBrackets(ctx, logDay.events)
  drawTotalColumn(ctx, logDay.totals)
  drawRemarks(ctx, logDay.remarks, logDay.total_miles)
  drawTotalsSection(ctx, logDay.totals)
}

// ── Header (expanded to match FMCSA paper log) ──────────────────────────────

function drawHeader(ctx, logDay, meta) {
  // Top border stripe
  ctx.fillStyle = '#1e3a5f'
  ctx.fillRect(0, 0, CW, 5)

  // Title block
  drawText(ctx, "DRIVER'S DAILY LOG", CW / 2, 24, { size: 16, weight: 'bold', color: '#111827', align: 'center' })
  drawText(ctx, '(ONE CALENDAR DAY — 24 HOURS)', CW / 2, 40, { size: 9, color: '#6b7280', align: 'center' })

  // ── Row 1: Date & Total Miles ──
  const r1y = 54
  drawText(ctx, 'DATE:', 20, r1y, { size: 9, weight: '600', color: '#6b7280' })
  drawText(ctx, logDay.date, 54, r1y, { size: 11, weight: '700', color: '#111827' })

  drawText(ctx, 'TOTAL MILES DRIVING TODAY:', 180, r1y, { size: 9, weight: '600', color: '#6b7280' })
  drawText(ctx, String(logDay.total_miles ?? 0), 356, r1y, { size: 11, weight: '700', color: '#111827' })

  drawText(ctx, 'TOTAL MILES TODAY:', 440, r1y, { size: 9, weight: '600', color: '#6b7280' })
  drawText(ctx, String(logDay.total_miles ?? 0), 580, r1y, { size: 11, weight: '700', color: '#111827' })

  // ── Row 2: From / To ──
  const r2y = 72
  const fromLoc = meta.from_location || logDay.remarks?.[0]?.location || ''
  const toLoc = meta.to_location || logDay.remarks?.[logDay.remarks.length - 1]?.location || ''
  drawText(ctx, 'FROM:', 20, r2y, { size: 9, weight: '600', color: '#6b7280' })
  drawText(ctx, truncate(fromLoc, 40), 54, r2y, { size: 10, color: '#374151' })

  drawText(ctx, 'TO:', 440, r2y, { size: 9, weight: '600', color: '#6b7280' })
  drawText(ctx, truncate(toLoc, 40), 460, r2y, { size: 10, color: '#374151' })

  drawLine(ctx, 54, r2y + 3, 430, r2y + 3, '#d1d5db', 0.5)
  drawLine(ctx, 460, r2y + 3, CW - 20, r2y + 3, '#d1d5db', 0.5)

  // ── Row 3: Vehicle info & carrier ──
  const r3y = 90
  drawText(ctx, 'CARRIER:', 20, r3y, { size: 9, weight: '600', color: '#6b7280' })
  drawText(ctx, meta.carrier || 'Spotter ELD Trip Planner', 72, r3y, { size: 10, color: '#374151' })

  drawText(ctx, 'VEHICLE:', 440, r3y, { size: 9, weight: '600', color: '#6b7280' })
  drawText(ctx, meta.vehicle || 'CMV', 492, r3y, { size: 10, color: '#374151' })

  drawText(ctx, 'TRAILER:', 600, r3y, { size: 9, weight: '600', color: '#6b7280' })
  drawText(ctx, meta.trailer || '', 650, r3y, { size: 10, color: '#374151' })

  // ── Row 4: Shipping doc & 24hr period ──
  const r4y = 108
  drawText(ctx, 'SHIPPING DOC:', 20, r4y, { size: 9, weight: '600', color: '#6b7280' })
  drawText(ctx, meta.shipping_doc || '', 100, r4y, { size: 10, color: '#374151' })

  drawText(ctx, '24-HOUR PERIOD STARTING:', 440, r4y, { size: 9, weight: '600', color: '#6b7280' })
  drawText(ctx, 'MIDNIGHT', 588, r4y, { size: 10, weight: '600', color: '#374151' })

  // ── Row 5: Compliance badge ──
  const r5y = 126
  drawText(ctx, 'FMCSA 49 CFR Part 395  |  Property-Carrying CMV  |  70hr/8day Cycle', 20, r5y,
    { size: 8, color: '#9ca3af' })

  // HOS status indicator
  const totalOnDuty = (logDay.totals.on_duty || 0) + (logDay.totals.driving || 0)
  const isCompliant = (logDay.totals.driving || 0) <= 11.01 && totalOnDuty <= 14.01
  const badgeColor = isCompliant ? '#16a34a' : '#dc2626'
  const badgeText = isCompliant ? 'COMPLIANT' : 'REVIEW'
  ctx.fillStyle = badgeColor
  const bx = CW - 100, by2 = r5y - 12, bw2 = 80, bh2 = 18, br = 4
  ctx.beginPath()
  ctx.moveTo(bx + br, by2)
  ctx.lineTo(bx + bw2 - br, by2)
  ctx.quadraticCurveTo(bx + bw2, by2, bx + bw2, by2 + br)
  ctx.lineTo(bx + bw2, by2 + bh2 - br)
  ctx.quadraticCurveTo(bx + bw2, by2 + bh2, bx + bw2 - br, by2 + bh2)
  ctx.lineTo(bx + br, by2 + bh2)
  ctx.quadraticCurveTo(bx, by2 + bh2, bx, by2 + bh2 - br)
  ctx.lineTo(bx, by2 + br)
  ctx.quadraticCurveTo(bx, by2, bx + br, by2)
  ctx.closePath()
  ctx.fill()
  drawText(ctx, badgeText, CW - 60, r5y, { size: 9, weight: 'bold', color: '#ffffff', align: 'center' })

  // Separator line
  drawLine(ctx, 0, HDR_H - 2, CW, HDR_H - 2, '#d1d5db', 1)
}

function truncate(str, max) {
  if (!str) return ''
  return str.length > max ? str.slice(0, max - 3) + '...' : str
}

// ── Time labels ───────────────────────────────────────────────────────────────

function drawTimeLabels(ctx) {
  const y = HDR_H + TIME_H - 6
  const labels = ['M', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11',
                  'N', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', 'M']
  labels.forEach((lbl, i) => {
    const x = GL + (i / 24) * GW
    drawText(ctx, lbl, x, y, { size: 8, color: '#374151', align: 'center' })
  })
}

// ── Grid ──────────────────────────────────────────────────────────────────────

function drawGrid(ctx) {
  const gridBottom = GT + GRID_H

  // Background bands alternating light
  for (let r = 0; r < ROWS; r++) {
    const ry = GT + r * ROW_H
    ctx.fillStyle = r % 2 === 0 ? '#f9fafb' : '#f0f4f8'
    ctx.fillRect(GL, ry, GW, ROW_H)
  }

  // Horizontal row borders
  ctx.strokeStyle = '#9ca3af'
  ctx.lineWidth   = 1
  for (let r = 0; r <= ROWS; r++) {
    const y = GT + r * ROW_H
    ctx.beginPath(); ctx.moveTo(GL, y); ctx.lineTo(GR, y); ctx.stroke()
  }

  // Vertical: quarter-hour marks
  ctx.lineWidth = 0.4
  for (let q = 0; q <= 24 * 4; q++) {
    const x    = GL + (q / (24 * 4)) * GW
    const isHr = q % 4 === 0
    const isHf = q % 2 === 0
    ctx.strokeStyle = isHr ? '#6b7280' : (isHf ? '#c8ccd0' : '#e0e2e5')
    ctx.lineWidth   = isHr ? 1 : 0.5
    ctx.beginPath(); ctx.moveTo(x, GT); ctx.lineTo(x, gridBottom); ctx.stroke()
  }

  // Outer border
  ctx.strokeStyle = '#374151'
  ctx.lineWidth   = 1.5
  ctx.strokeRect(GL, GT, GW, GRID_H)
}

// ── Row labels ────────────────────────────────────────────────────────────────

function drawRowLabels(ctx) {
  ROW_LABELS.forEach((lbl, i) => {
    const y  = GT + i * ROW_H
    const cy = y + ROW_H / 2

    // Colored dot
    ctx.fillStyle = STATUS_COLOR[Object.keys(STATUS_ROW).find(k => STATUS_ROW[k] === i)]
    ctx.beginPath()
    ctx.arc(GL - 110, cy, 4, 0, Math.PI * 2)
    ctx.fill()

    // Label text (may have \n)
    const lines = lbl.split('\n')
    if (lines.length === 1) {
      drawText(ctx, lbl, GL - 100, cy + 4, { size: 9, weight: '600', color: '#1f2937' })
    } else {
      drawText(ctx, lines[0], GL - 100, cy - 2, { size: 9, weight: '600', color: '#1f2937' })
      drawText(ctx, lines[1], GL - 100, cy + 10, { size: 8, color: '#4b5563' })
    }
  })
}

// ── Events (duty-status line) ─────────────────────────────────────────────────

function drawEvents(ctx, events) {
  if (!events || events.length === 0) return

  ctx.save()
  ctx.lineJoin = 'round'

  let prevRow = null
  let prevX   = null

  events.forEach((ev) => {
    const row     = STATUS_ROW[ev.status] ?? 0
    const startX  = hourX(ev.start_hour)
    const endX    = hourX(ev.end_hour)
    const centerY = rowY(row)
    const color   = STATUS_COLOR[ev.status] || '#60a5fa'

    ctx.strokeStyle = color
    ctx.lineWidth   = 3

    // Vertical connector from previous row
    if (prevRow !== null && prevRow !== row) {
      ctx.strokeStyle = '#374151'
      ctx.lineWidth   = 2
      ctx.beginPath()
      ctx.moveTo(prevX ?? startX, rowY(prevRow))
      ctx.lineTo(prevX ?? startX, centerY)
      ctx.stroke()
    }

    // Horizontal segment
    ctx.strokeStyle = color
    ctx.lineWidth   = 3
    ctx.beginPath()
    ctx.moveTo(startX, centerY)
    ctx.lineTo(endX,   centerY)
    ctx.stroke()

    // Small dot at start
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(startX, centerY, 2.5, 0, Math.PI * 2)
    ctx.fill()

    prevRow = row
    prevX   = endX
  })

  // Final dot
  if (prevX !== null && prevRow !== null) {
    const color = STATUS_COLOR[Object.keys(STATUS_ROW).find(k => STATUS_ROW[k] === prevRow)] || '#60a5fa'
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(prevX, rowY(prevRow), 2.5, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

// ── Brackets (FMCSA notation for stationary periods) ──────────────────────────
// Per the instruction video: brackets denote sections where the truck didn't move

function drawBrackets(ctx, events) {
  if (!events || events.length === 0) return

  events.forEach((ev) => {
    // Draw bracket for non-driving on-duty events (pre-trip, post-trip, loading, etc.)
    if (ev.status === 'on_duty' && ev.duration > 0.08) {
      const startX  = hourX(ev.start_hour)
      const endX    = hourX(ev.end_hour)
      const row     = STATUS_ROW[ev.status]
      const bottomY = GT + (row + 1) * ROW_H - 3

      // Draw bracket: small cup shape at bottom of the row
      ctx.save()
      ctx.strokeStyle = '#f97316'
      ctx.lineWidth   = 1.5
      ctx.beginPath()
      ctx.moveTo(startX, bottomY - 6)
      ctx.lineTo(startX, bottomY)
      ctx.lineTo(endX, bottomY)
      ctx.lineTo(endX, bottomY - 6)
      ctx.stroke()
      ctx.restore()
    }
  })
}

// ── Total column (right side) ─────────────────────────────────────────────────

function drawTotalColumn(ctx, totals) {
  const tx     = GR + 10
  const labels = ['off_duty', 'sleeper', 'driving', 'on_duty']
  labels.forEach((key, i) => {
    const y   = GT + i * ROW_H + ROW_H / 2 + 4
    const val = (totals[key] || 0).toFixed(2)
    drawText(ctx, val, tx, y, { size: 9, weight: '600', color: '#111827' })
  })
  // Header
  drawText(ctx, 'HRS', tx + 4, GT - 6, { size: 8, color: '#6b7280', align: 'center' })
}

// ── Remarks section ───────────────────────────────────────────────────────────

function drawRemarks(ctx, remarks, totalMiles) {
  const y0 = REMARKS_TOP

  // Section header
  ctx.fillStyle = '#1e3a5f'
  ctx.fillRect(0, y0, CW, 18)
  drawText(ctx, 'REMARKS — Record city/state of each change in duty status', 10, y0 + 13,
    { size: 9, weight: 'bold', color: '#ffffff' })

  // Column headers
  const cols = [
    { label: 'TIME',     x: 10  },
    { label: 'LOCATION', x: 65  },
    { label: 'ACTIVITY', x: 420 },
  ]
  const hy = y0 + 32
  cols.forEach(c => drawText(ctx, c.label, c.x, hy, { size: 8, weight: '600', color: '#6b7280' }))
  drawLine(ctx, 0, hy + 4, CW, hy + 4, '#e5e7eb', 0.8)

  // Rows
  const visibleRemarks = (remarks || []).slice(0, 8)
  visibleRemarks.forEach((r, i) => {
    const ry = hy + 16 + i * 18
    const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb'
    ctx.fillStyle = bg
    ctx.fillRect(0, ry - 12, CW, 18)

    const loc = (r.location || '').length > 55
      ? r.location.slice(0, 52) + '...'
      : (r.location || '')
    const act = (r.activity || '').length > 60
      ? r.activity.slice(0, 57) + '...'
      : (r.activity || '')

    drawText(ctx, r.time || '',  10,  ry, { size: 9, color: '#374151' })
    drawText(ctx, loc,            65,  ry, { size: 9, color: '#374151' })
    drawText(ctx, act,           420,  ry, { size: 9, color: '#374151' })
  })

  if ((remarks || []).length > 8) {
    const more = remarks.length - 8
    const lastY = hy + 16 + 8 * 18
    drawText(ctx, `+ ${more} more entries`, 10, lastY + 4, { size: 8, color: '#9ca3af' })
  }

  drawLine(ctx, 0, y0 + REMARKS_H - 2, CW, y0 + REMARKS_H - 2, '#e5e7eb', 1)
}

// ── Totals section ────────────────────────────────────────────────────────────

function drawTotalsSection(ctx, totals) {
  const y0   = TOTALS_TOP
  const keys = ['off_duty', 'sleeper', 'driving', 'on_duty']
  const lbls = ['Off Duty', 'Sleeper', 'Driving', 'On Duty (ND)']

  ctx.fillStyle = '#f3f4f6'
  ctx.fillRect(0, y0, CW, CH - y0)

  drawText(ctx, 'TOTAL HOURS EACH LINE:', 10, y0 + 16, { size: 9, weight: '600', color: '#374151' })

  const bw = 120
  keys.forEach((k, i) => {
    const bx = 10 + i * (bw + 10)
    const by = y0 + 24

    // Box
    drawRect(ctx, bx, by, bw, 32, '#ffffff', '#d1d5db')

    // Colored top strip
    ctx.fillStyle = STATUS_COLOR[k]
    ctx.fillRect(bx, by, bw, 4)

    drawText(ctx, lbls[i],                   bx + 6, by + 16, { size: 8, color: '#6b7280' })
    drawText(ctx, (totals[k] || 0).toFixed(2), bx + 6, by + 28, { size: 11, weight: 'bold', color: '#111827' })
  })

  // On-duty total
  const onDutyTotal = ((totals.on_duty || 0) + (totals.driving || 0)).toFixed(2)
  const tx = 10 + 4 * (bw + 10) + 20
  drawText(ctx, 'TOTAL ON-DUTY HRS:', tx, y0 + 30, { size: 9, weight: '600', color: '#374151' })
  drawText(ctx, onDutyTotal, tx + 120, y0 + 30, { size: 14, weight: 'bold', color: '#1d4ed8' })

  // 24-hr total verification
  const totalAll = Object.values(totals).reduce((a, b) => a + (b || 0), 0)
  drawText(ctx, `24-HR TOTAL: ${totalAll.toFixed(2)}`, tx, y0 + 48, { size: 9, color: '#6b7280' })

  // Cert text
  drawText(ctx,
    'I hereby certify that my data entries and the information on this document are true and correct.',
    10, CH - 28, { size: 8, color: '#9ca3af' })
  drawLine(ctx, 10, CH - 14, 350, CH - 14, '#9ca3af', 0.8)
  drawText(ctx, 'Driver Signature', 10, CH - 4, { size: 8, color: '#9ca3af' })

  // Date/time printed
  drawLine(ctx, 400, CH - 14, 600, CH - 14, '#9ca3af', 0.8)
  drawText(ctx, 'Date', 400, CH - 4, { size: 8, color: '#9ca3af' })
}

// ── React Component ───────────────────────────────────────────────────────────

export default function ELDLogSheet({ logDay, dayNumber, totalDays, meta }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || !logDay) return
    drawELDLog(canvasRef.current, logDay, meta || {})
  }, [logDay, meta])

  return (
    <div className="card overflow-hidden">
      {/* Sheet header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <span className="bg-blue-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
            Day {dayNumber} / {totalDays}
          </span>
          <span className="text-sm font-semibold text-white">{logDay.date}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
            Drive {(logDay.totals.driving || 0).toFixed(1)}h
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
            Off {(logDay.totals.off_duty || 0).toFixed(1)}h
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-purple-400" />
            Sleeper {(logDay.totals.sleeper || 0).toFixed(1)}h
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-orange-400" />
            On-Duty {(logDay.totals.on_duty || 0).toFixed(1)}h
          </span>
          <span className="text-gray-500">{logDay.total_miles} mi</span>
        </div>
      </div>

      {/* Canvas */}
      <div className="eld-canvas-wrap bg-white">
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: 'auto', maxWidth: CW }}
        />
      </div>
    </div>
  )
}

// Export for PDF generation
export { drawELDLog, CW, CH }
