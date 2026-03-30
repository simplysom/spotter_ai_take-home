# Spotter — ELD Trip Planner

Full-stack app that takes truck driver trip details and generates:
- **Route map** with stop/rest/fuel markers (distance-based positioning)
- **FMCSA-compliant ELD daily log sheets** (canvas-rendered, matching official format)
- **Print/PDF export** for all ELD log sheets

Built with Django (backend) + React + Vite + Tailwind (frontend).

---

## Routing API Options

| Priority | Service | Profile | Key needed? |
|---|---|---|---|
| 1st | **GraphHopper** | Truck (height/weight/road restrictions) | Free tier: 500 req/day |
| 2nd | **OpenRouteService** | HGV (truck-aware) | Free tier: 2000 req/day |
| 3rd | **OSRM demo** | Car (fallback) | No key needed |

The app works out of the box with OSRM (no API key). For better truck-specific routing, add a free GraphHopper or ORS key to `backend/.env`.

| Service | Purpose | Key needed? |
|---|---|---|
| Nominatim (OpenStreetMap) | Geocoding / autocomplete | No |
| Leaflet + OSM tiles | Map display | No |

---

## Local Development

### Backend (Django)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py runserver        # http://localhost:8000
```

### Frontend (React + Vite)

Requires **Node 18+**. If using nvm:
```bash
nvm use 18
```

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://localhost:8000` automatically.

### Running Tests

```bash
cd backend
source venv/bin/activate
python manage.py test trips.tests -v2
```

52 tests covering:
- HOS calculator (11-hr limit, 14-hr window, 30-min breaks, 70-hr cycle, fuel stops, rest resets, midnight splits)
- API validation (missing fields, invalid inputs)
- Route geometry utilities (haversine, cumulative distances, interpolation)
- Full trip planning with mocked external APIs

---

## Production Deployment

### Backend (Railway / Render)

1. Push repo to GitHub
2. Create a new service pointed at the `backend/` directory
3. Set environment variables:
   ```
   SECRET_KEY=<generate a strong key>
   DEBUG=False
   ALLOWED_HOSTS=your-app.railway.app
   CORS_ALLOWED_ORIGINS=https://your-frontend.vercel.app
   GRAPHHOPPER_API_KEY=<optional, for truck routing>
   ORS_API_KEY=<optional, fallback truck routing>
   ```
4. Build command: `pip install -r requirements.txt`
   Start command: `gunicorn spotter.wsgi --workers 2`

### Frontend (Vercel)

1. Import repo on Vercel, set **Root Directory** to `frontend`
2. Set environment variable:
   ```
   VITE_API_URL=https://your-backend.railway.app
   ```
3. Build command: `npm run build`
   Output directory: `dist`

---

## HOS Rules Applied (FMCSA 49 CFR Part 395)

| Rule | Value | Regulation |
|---|---|---|
| Max driving per shift | 11 hours | SS 395.3(a)(3) |
| Driving window | 14 hours (wall-clock from shift start) | SS 395.3(a)(2) |
| Mandatory break | 30 min after 8 cumulative driving hours | SS 395.3(a)(3)(ii) |
| Rest required | 10 consecutive hours off duty | SS 395.3(a)(1) |
| Weekly cycle | 70 hours / 8 days (rolling) | SS 395.3(b) |
| Fuel stops | Every 1,000 miles (30 min on-duty) | Operational |
| Pickup / Dropoff | 1 hour each (On Duty) | Operational |
| Pre/Post trip inspection | 30 min each (On Duty) | Operational |

Key behaviors:
- **30-min break**: Can be satisfied by off-duty time OR consecutive on-duty not-driving time (e.g., fuel stop)
- **Fuel stops reset the break timer**: A 30-min fuel stop counts as a qualifying break per FMCSA rules
- **Cycle overflow protection**: On-duty activities (pickup, dropoff) check cycle limits before execution
- **Per-shift limits**: The 11-hr driving and 14-hr window limits are per-shift, not per-calendar-day

---

## Project Structure

```
Spotter/
├── backend/
│   ├── spotter/              Django project settings
│   ├── trips/
│   │   ├── hos_calculator.py  Core HOS logic (365 lines)
│   │   ├── views.py           API endpoints + route geometry utils
│   │   └── tests/
│   │       ├── test_hos_calculator.py  (30 HOS rule tests)
│   │       └── test_views.py           (22 API + geometry tests)
│   ├── requirements.txt
│   └── Procfile
└── frontend/
    └── src/
        ├── App.jsx
        ├── api/tripApi.js
        └── components/
            ├── TripForm.jsx       Location inputs + autocomplete
            ├── MapView.jsx        Leaflet route map + server-positioned stops
            ├── ELDLogSheet.jsx    Canvas ELD renderer (FMCSA format)
            └── LogViewer.jsx      Paginated viewer + Print/PDF export
```
