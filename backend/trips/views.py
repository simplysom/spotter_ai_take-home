import logging
import math
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from .hos_calculator import HOSCalculator

logger = logging.getLogger(__name__)


# ── Geocoding ──────────────────────────────────────────────────────────────────

def _photon_display_name(props: dict) -> str:
    """Build a readable display name from Photon GeoJSON properties."""
    parts = [props.get('name') or props.get('city') or '']
    for key in ('city', 'state', 'country'):
        val = props.get(key, '')
        if val and val not in parts:
            parts.append(val)
    return ', '.join(p for p in parts if p)


def geocode_address(address: str) -> dict:
    """
    Geocode an address using Photon (Komoot) — no API key, no IP restrictions.
    Falls back to Nominatim if Photon fails.
    Returns {'lat': float, 'lon': float, 'display_name': str}
    """
    # ── Primary: Photon ───────────────────────────────────────────────────────
    try:
        url = 'https://photon.komoot.io/api/'
        params = {'q': address, 'limit': 1, 'lang': 'en'}
        headers = {'User-Agent': 'Spotter-ELD-TripPlanner/1.0 (contact@spotter.app)'}
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        resp.raise_for_status()
        features = resp.json().get('features', [])
        # Filter to US results
        us_features = [f for f in features
                       if f.get('properties', {}).get('countrycode', '').upper() == 'US']
        hits = us_features or features
        if hits:
            f = hits[0]
            lon, lat = f['geometry']['coordinates']
            return {
                'lat':          float(lat),
                'lon':          float(lon),
                'display_name': _photon_display_name(f.get('properties', {})) or address,
            }
    except Exception as exc:
        logger.warning('Photon geocoding failed, trying Nominatim: %s', exc)

    # ── Fallback: Nominatim ───────────────────────────────────────────────────
    url = 'https://nominatim.openstreetmap.org/search'
    params = {'q': address, 'format': 'json', 'limit': 1, 'addressdetails': 0,
              'countrycodes': 'us'}
    headers = {'User-Agent': 'Spotter-ELD-TripPlanner/1.0 (contact@spotter.app)'}
    resp = requests.get(url, params=params, headers=headers, timeout=10)
    resp.raise_for_status()
    results = resp.json()
    if not results:
        raise ValueError(f'No results found for address: "{address}"')
    r = results[0]
    return {
        'lat':          float(r['lat']),
        'lon':          float(r['lon']),
        'display_name': r.get('display_name', address),
    }


def geocode_parallel(addresses: dict) -> dict:
    """
    Geocode multiple addresses in parallel using ThreadPoolExecutor.
    addresses: {'current': '...', 'pickup': '...', 'dropoff': '...'}
    Returns: {'current': {...}, 'pickup': {...}, 'dropoff': {...}}
    """
    results = {}
    errors = {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(geocode_address, addr): key
                   for key, addr in addresses.items()}
        for future in as_completed(futures):
            key = futures[future]
            try:
                results[key] = future.result()
            except ValueError as exc:
                errors[key] = str(exc)
            except requests.RequestException as exc:
                errors[key] = f'Geocoding service unavailable: {exc}'

    if errors:
        msg = '; '.join(f'{k}: {v}' for k, v in errors.items())
        raise ValueError(msg)

    return results


# ── Routing ────────────────────────────────────────────────────────────────────

def get_route_graphhopper(from_coords: dict, to_coords: dict, api_key: str) -> dict:
    """
    GraphHopper routing. Free tier supports car profile (500 req/day).
    Paid tiers support truck profile with vehicle restrictions.
    Still provides real road distances (better than straight-line).
    """
    url = 'https://graphhopper.com/api/1/route'
    params = {
        'point': [
            f"{from_coords['lat']},{from_coords['lon']}",
            f"{to_coords['lat']},{to_coords['lon']}",
        ],
        'profile': 'car',
        'locale': 'en',
        'calc_points': 'true',
        'points_encoded': 'false',
        'key': api_key,
    }
    resp = requests.get(url, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if 'paths' not in data or not data['paths']:
        raise ValueError('GraphHopper could not find a route')
    path = data['paths'][0]
    if 'points' not in path or 'coordinates' not in path['points']:
        raise ValueError('GraphHopper returned invalid path format')
    coords = path['points']['coordinates']  # [[lon,lat], ...]
    return {
        'distance_miles': path['distance'] / 1609.344,
        'duration_hours': path['time'] / 3_600_000,  # ms → hours
        'geometry':       [[c[1], c[0]] for c in coords],  # → [lat,lon] for Leaflet
    }


def get_route_ors(from_coords: dict, to_coords: dict, api_key: str) -> dict:
    """OpenRouteService routing (truck-optimized). Requires API key."""
    url = 'https://api.openrouteservice.org/v2/directions/driving-hgv/geojson'
    headers = {'Authorization': api_key, 'Content-Type': 'application/json'}
    body = {
        'coordinates': [
            [from_coords['lon'], from_coords['lat']],
            [to_coords['lon'],   to_coords['lat']],
        ],
    }
    resp = requests.post(url, json=body, headers=headers, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if 'features' not in data or not data['features']:
        raise ValueError('ORS returned no route features')
    feature = data['features'][0]
    props   = feature['properties']
    dist_m  = props['summary']['distance']
    dur_s   = props['summary']['duration']
    coords  = feature['geometry']['coordinates']  # [[lon,lat], ...]
    return {
        'distance_miles': dist_m / 1609.344,
        'duration_hours': dur_s / 3600.0,
        'geometry':       [[c[1], c[0]] for c in coords],  # → [lat,lon] for Leaflet
    }


def get_route_osrm(from_coords: dict, to_coords: dict) -> dict:
    """
    OSRM public demo routing. No API key required.
    Note: car-only profile (no truck restrictions) — used as last-resort fallback.
    """
    lon1, lat1 = from_coords['lon'], from_coords['lat']
    lon2, lat2 = to_coords['lon'],   to_coords['lat']
    url = (f'http://router.project-osrm.org/route/v1/driving/'
           f'{lon1},{lat1};{lon2},{lat2}')
    params = {'overview': 'full', 'geometries': 'geojson'}
    resp = requests.get(url, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if data.get('code') != 'Ok' or not data.get('routes'):
        raise ValueError('OSRM could not find a route')
    route  = data['routes'][0]
    coords = route['geometry']['coordinates']   # [[lon,lat], ...]
    return {
        'distance_miles': route['distance'] / 1609.344,
        'duration_hours': route['duration'] / 3600.0,
        'geometry':       [[c[1], c[0]] for c in coords],  # → [lat,lon]
    }


def get_route(from_coords: dict, to_coords: dict) -> dict:
    """
    Routing fallback chain:
    1. GraphHopper truck profile (best: actual truck restrictions)
    2. OpenRouteService HGV profile (good: truck-aware)
    3. OSRM demo (fallback: car-only, no API key needed)
    """
    gh_key  = getattr(settings, 'GRAPHHOPPER_API_KEY', '')
    ors_key = getattr(settings, 'ORS_API_KEY', '')

    if gh_key:
        try:
            return get_route_graphhopper(from_coords, to_coords, gh_key)
        except Exception as exc:
            logger.warning('GraphHopper routing failed, trying next provider: %s', exc)

    if ors_key:
        try:
            return get_route_ors(from_coords, to_coords, ors_key)
        except Exception as exc:
            logger.warning('ORS routing failed, trying OSRM fallback: %s', exc)

    return get_route_osrm(from_coords, to_coords)


# ── Route geometry utilities ──────────────────────────────────────────────────

def _haversine_miles(lat1, lon1, lat2, lon2):
    """Great-circle distance between two points in miles."""
    R = 3958.8  # Earth radius in miles
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def compute_cumulative_distances(geometry):
    """
    Build a cumulative distance array for a route geometry.
    Returns list of (cumulative_miles, [lat, lon]) pairs.
    """
    if not geometry or len(geometry) < 2:
        return []
    result = [(0.0, geometry[0])]
    total = 0.0
    for i in range(1, len(geometry)):
        prev, cur = geometry[i - 1], geometry[i]
        total += _haversine_miles(prev[0], prev[1], cur[0], cur[1])
        result.append((total, cur))
    return result


def interpolate_at_distance(cum_dists, target_miles):
    """Find the [lat, lon] at a target distance along a route."""
    if not cum_dists:
        return None
    if target_miles <= 0:
        return cum_dists[0][1]
    if target_miles >= cum_dists[-1][0]:
        return cum_dists[-1][1]
    for i in range(1, len(cum_dists)):
        if cum_dists[i][0] >= target_miles:
            d0, p0 = cum_dists[i - 1]
            d1, p1 = cum_dists[i]
            seg_len = d1 - d0
            if seg_len < 0.001:
                return p0
            t = (target_miles - d0) / seg_len
            return [
                p0[0] + t * (p1[0] - p0[0]),
                p0[1] + t * (p1[1] - p0[1]),
            ]
    return cum_dists[-1][1]


# ── Views ──────────────────────────────────────────────────────────────────────

class PlanTripView(APIView):
    """
    POST /api/trip/plan/

    Body (JSON):
      current_location   : string  - free-text address
      pickup_location    : string  - free-text address
      dropoff_location   : string  - free-text address
      current_cycle_used : number  - hours already used in the 70-hr cycle (0-70)
    """

    def post(self, request):
        body = request.data

        current_location   = (body.get('current_location')   or '').strip()
        pickup_location    = (body.get('pickup_location')    or '').strip()
        dropoff_location   = (body.get('dropoff_location')   or '').strip()
        raw_cycle          = body.get('current_cycle_used', 0)

        MAX_ADDR_LEN = 500
        if not current_location:
            return Response({'error': 'current_location is required'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not pickup_location:
            return Response({'error': 'pickup_location is required'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not dropoff_location:
            return Response({'error': 'dropoff_location is required'},
                            status=status.HTTP_400_BAD_REQUEST)
        for name, val in [('current_location', current_location),
                          ('pickup_location', pickup_location),
                          ('dropoff_location', dropoff_location)]:
            if len(val) > MAX_ADDR_LEN:
                return Response(
                    {'error': f'{name} exceeds max length ({MAX_ADDR_LEN} chars)'},
                    status=status.HTTP_400_BAD_REQUEST)

        try:
            cycle_used = float(raw_cycle)
            if not (0.0 <= cycle_used <= 70.0):
                raise ValueError()
        except (TypeError, ValueError):
            return Response(
                {'error': 'current_cycle_used must be a number between 0 and 70'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── geocode (parallel) ────────────────────────────────────────────────
        logger.info('Planning trip: %s → %s → %s (cycle: %.1fh)',
                     current_location, pickup_location, dropoff_location, cycle_used)
        try:
            coords = geocode_parallel({
                'current': current_location,
                'pickup':  pickup_location,
                'dropoff': dropoff_location,
            })
            cur_coords     = coords['current']
            pickup_coords  = coords['pickup']
            dropoff_coords = coords['dropoff']
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except requests.RequestException as exc:
            return Response(
                {'error': f'Geocoding service unavailable: {exc}'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # ── routing ───────────────────────────────────────────────────────────
        try:
            route1 = get_route(cur_coords, pickup_coords)
            route2 = get_route(pickup_coords, dropoff_coords)
        except requests.RequestException as exc:
            return Response(
                {'error': f'Routing service unavailable: {exc}'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        # ── HOS calculation ───────────────────────────────────────────────────
        try:
            calc      = HOSCalculator(cycle_used)
            trip_data = calc.calculate_trip(
                dist_to_pickup          = route1['distance_miles'],
                dist_pickup_to_dropoff  = route2['distance_miles'],
                current_location        = cur_coords['display_name'],
                pickup_location         = pickup_coords['display_name'],
                dropoff_location        = dropoff_coords['display_name'],
            )
        except (ValueError, RuntimeError) as exc:
            logger.error('HOS calculation failed: %s', exc)
            return Response({'error': f'Trip calculation failed: {exc}'},
                            status=status.HTTP_400_BAD_REQUEST)

        # ── compute distance-based stop positions ─────────────────────────────
        cum_dist1 = compute_cumulative_distances(route1['geometry'])
        cum_dist2 = compute_cumulative_distances(route2['geometry'])
        total_dist1 = cum_dist1[-1][0] if cum_dist1 else route1['distance_miles']
        total_dist2 = cum_dist2[-1][0] if cum_dist2 else route2['distance_miles']

        # Build a map of driving miles per event from HOS events to position
        # intermediate stops accurately along the route geometry.
        all_events = calc.events
        miles_driven_seg1 = 0.0
        miles_driven_seg2 = 0.0
        in_seg2 = False
        # Track which driving events correspond to which segment by walking
        # through events in order and accumulating driving miles
        event_cumulative_miles = {}  # event index → cumulative miles in segment
        for ev in all_events:
            activity_lower = ev.activity.lower()
            if 'pickup' in activity_lower or 'loading' in activity_lower:
                in_seg2 = True
            if ev.status == 'driving':
                if not in_seg2:
                    miles_driven_seg1 += ev.miles
                else:
                    miles_driven_seg2 += ev.miles

        # Walk through stops and assign lat/lon based on accumulated miles
        miles_in_seg1 = 0.0
        miles_in_seg2 = 0.0
        in_seg2 = False
        driving_idx = 0
        for stop in trip_data['stops']:
            activity = (stop.get('activity') or '').lower()
            if 'pickup' in activity or 'loading' in activity:
                stop['lat'] = pickup_coords['lat']
                stop['lon'] = pickup_coords['lon']
                in_seg2 = True
                continue
            if 'dropoff' in activity or 'unloading' in activity:
                stop['lat'] = dropoff_coords['lat']
                stop['lon'] = dropoff_coords['lon']
                continue
            if 'pre-trip' in activity:
                stop['lat'] = cur_coords['lat']
                stop['lon'] = cur_coords['lon']
                continue
            if 'post-trip' in activity:
                stop['lat'] = dropoff_coords['lat']
                stop['lon'] = dropoff_coords['lon']
                continue

            # Intermediate stops: interpolate along route geometry using
            # accumulated driving miles from preceding driving events
            # Walk forward through calc.events to find driving miles up to this stop's start time
            stop_start = stop.get('start', '')
            driving_miles_before = 0.0
            seg2_started = False
            for ev in all_events:
                ev_activity_lower = ev.activity.lower()
                if 'pickup' in ev_activity_lower or 'loading' in ev_activity_lower:
                    seg2_started = True
                if ev.start.isoformat() >= stop_start:
                    break
                if ev.status == 'driving':
                    driving_miles_before += ev.miles

            if not in_seg2:
                pt = interpolate_at_distance(cum_dist1, min(driving_miles_before, total_dist1))
                if pt:
                    stop['lat'] = pt[0]
                    stop['lon'] = pt[1]
            else:
                # Subtract segment 1 miles to get position within segment 2
                seg2_miles = max(driving_miles_before - route1['distance_miles'], 0.0)
                pt = interpolate_at_distance(cum_dist2, min(seg2_miles, total_dist2))
                if pt:
                    stop['lat'] = pt[0]
                    stop['lon'] = pt[1]

        # ── attach geo data for map ───────────────────────────────────────────
        trip_data['route'] = {
            'to_pickup':   route1['geometry'],
            'to_dropoff':  route2['geometry'],
        }
        trip_data['coordinates'] = {
            'current':  cur_coords,
            'pickup':   pickup_coords,
            'dropoff':  dropoff_coords,
        }
        trip_data['locations'] = {
            'current':  current_location,
            'pickup':   pickup_location,
            'dropoff':  dropoff_location,
        }
        trip_data['routing_meta'] = {
            'segment1_miles': round(route1['distance_miles'], 1),
            'segment2_miles': round(route2['distance_miles'], 1),
            'segment1_duration_hours': round(route1.get('duration_hours', 0), 2),
            'segment2_duration_hours': round(route2.get('duration_hours', 0), 2),
        }

        return Response(trip_data)


class HealthCheckView(APIView):
    """GET /api/health/ — lightweight liveness probe for load balancers."""

    def get(self, request):
        return Response({'status': 'ok'})


class GeocodeView(APIView):
    """
    GET /api/geocode/?q=<address>
    Autocomplete proxy using Photon (Komoot) — no IP restrictions, no API key.
    Returns top 5 US suggestions.
    """

    def get(self, request):
        q = (request.query_params.get('q') or '').strip()
        if len(q) < 3:
            return Response([])

        try:
            url = 'https://photon.komoot.io/api/'
            params = {'q': q, 'limit': 10, 'lang': 'en'}
            headers = {'User-Agent': 'Spotter-ELD-TripPlanner/1.0 (contact@spotter.app)'}
            resp = requests.get(url, params=params, headers=headers, timeout=8)
            resp.raise_for_status()
            features = resp.json().get('features', [])
            # Keep only US results, return up to 5
            results = []
            for f in features:
                props = f.get('properties', {})
                if props.get('countrycode', '').upper() != 'US':
                    continue
                lon, lat = f['geometry']['coordinates']
                results.append({
                    'display_name': _photon_display_name(props) or q,
                    'lat': float(lat),
                    'lon': float(lon),
                })
                if len(results) == 5:
                    break
            return Response(results)
        except Exception:
            # Autocomplete is best-effort — return empty on any failure
            return Response([])
