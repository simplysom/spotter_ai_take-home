"""
Tests for the trip planning API views.

Tests cover:
  - Input validation (missing fields, invalid cycle values)
  - Geocoding utilities (parallel geocoding)
  - Route geometry utilities (haversine, cumulative distances, interpolation)
  - Response structure validation
"""

from unittest.mock import patch, MagicMock
from django.test import SimpleTestCase
from rest_framework.test import APIClient

from trips.views import (
    _haversine_miles,
    compute_cumulative_distances,
    interpolate_at_distance,
)


class TestHaversine(SimpleTestCase):
    def test_same_point(self):
        d = _haversine_miles(40.0, -90.0, 40.0, -90.0)
        self.assertAlmostEqual(d, 0.0, places=5)

    def test_known_distance(self):
        # Chicago (41.88, -87.63) to Indianapolis (39.77, -86.16)
        # Approx 165 miles
        d = _haversine_miles(41.88, -87.63, 39.77, -86.16)
        self.assertAlmostEqual(d, 165.0, delta=10.0)

    def test_symmetry(self):
        d1 = _haversine_miles(40.0, -90.0, 42.0, -88.0)
        d2 = _haversine_miles(42.0, -88.0, 40.0, -90.0)
        self.assertAlmostEqual(d1, d2, places=5)


class TestCumulativeDistances(SimpleTestCase):
    def test_empty_geometry(self):
        self.assertEqual(compute_cumulative_distances([]), [])

    def test_single_point(self):
        self.assertEqual(compute_cumulative_distances([[40, -90]]), [])

    def test_two_points(self):
        geom = [[40.0, -90.0], [41.0, -89.0]]
        result = compute_cumulative_distances(geom)
        self.assertEqual(len(result), 2)
        self.assertAlmostEqual(result[0][0], 0.0)
        self.assertGreater(result[1][0], 0.0)

    def test_monotonically_increasing(self):
        geom = [[40.0, -90.0], [40.5, -89.5], [41.0, -89.0], [41.5, -88.5]]
        result = compute_cumulative_distances(geom)
        for i in range(1, len(result)):
            self.assertGreater(result[i][0], result[i - 1][0])


class TestInterpolateAtDistance(SimpleTestCase):
    def setUp(self):
        geom = [[40.0, -90.0], [41.0, -89.0], [42.0, -88.0]]
        self.cum = compute_cumulative_distances(geom)

    def test_at_start(self):
        pt = interpolate_at_distance(self.cum, 0.0)
        self.assertAlmostEqual(pt[0], 40.0, places=1)

    def test_at_end(self):
        total = self.cum[-1][0]
        pt = interpolate_at_distance(self.cum, total + 100)
        self.assertAlmostEqual(pt[0], 42.0, places=1)

    def test_midpoint(self):
        total = self.cum[-1][0]
        pt = interpolate_at_distance(self.cum, total / 2)
        # Should be between start and end latitudes
        self.assertGreater(pt[0], 40.0)
        self.assertLess(pt[0], 42.0)

    def test_empty_list(self):
        self.assertIsNone(interpolate_at_distance([], 10.0))


class TestPlanTripValidation(SimpleTestCase):
    """Test input validation for POST /api/trip/plan/"""

    def setUp(self):
        self.client = APIClient()
        self.url = '/api/trip/plan/'

    def test_missing_current_location(self):
        resp = self.client.post(self.url, {
            'pickup_location': 'B',
            'dropoff_location': 'C',
            'current_cycle_used': 0,
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('current_location', resp.json()['error'])

    def test_missing_pickup_location(self):
        resp = self.client.post(self.url, {
            'current_location': 'A',
            'dropoff_location': 'C',
            'current_cycle_used': 0,
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('pickup_location', resp.json()['error'])

    def test_missing_dropoff_location(self):
        resp = self.client.post(self.url, {
            'current_location': 'A',
            'pickup_location': 'B',
            'current_cycle_used': 0,
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('dropoff_location', resp.json()['error'])

    def test_cycle_too_high(self):
        resp = self.client.post(self.url, {
            'current_location': 'A',
            'pickup_location': 'B',
            'dropoff_location': 'C',
            'current_cycle_used': 71,
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_cycle_negative(self):
        resp = self.client.post(self.url, {
            'current_location': 'A',
            'pickup_location': 'B',
            'dropoff_location': 'C',
            'current_cycle_used': -5,
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_cycle_not_a_number(self):
        resp = self.client.post(self.url, {
            'current_location': 'A',
            'pickup_location': 'B',
            'dropoff_location': 'C',
            'current_cycle_used': 'abc',
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_empty_string_locations(self):
        resp = self.client.post(self.url, {
            'current_location': '   ',
            'pickup_location': 'B',
            'dropoff_location': 'C',
            'current_cycle_used': 0,
        }, format='json')
        self.assertEqual(resp.status_code, 400)


class TestPlanTripMocked(SimpleTestCase):
    """Test full trip planning with mocked external APIs."""

    def setUp(self):
        self.client = APIClient()
        self.url = '/api/trip/plan/'

    @patch('trips.views.get_route')
    @patch('trips.views.geocode_parallel')
    def test_successful_trip(self, mock_geocode, mock_route):
        mock_geocode.return_value = {
            'current': {'lat': 41.88, 'lon': -87.63, 'display_name': 'Chicago, IL'},
            'pickup':  {'lat': 39.77, 'lon': -86.16, 'display_name': 'Indianapolis, IN'},
            'dropoff': {'lat': 39.96, 'lon': -82.99, 'display_name': 'Columbus, OH'},
        }
        mock_route.return_value = {
            'distance_miles': 180.0,
            'duration_hours': 3.0,
            'geometry': [[41.88, -87.63], [40.5, -86.9], [39.77, -86.16]],
        }

        resp = self.client.post(self.url, {
            'current_location': 'Chicago, IL',
            'pickup_location': 'Indianapolis, IN',
            'dropoff_location': 'Columbus, OH',
            'current_cycle_used': 10,
        }, format='json')

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('daily_logs', data)
        self.assertIn('stops', data)
        self.assertIn('summary', data)
        self.assertIn('route', data)
        self.assertIn('coordinates', data)
        self.assertIn('locations', data)
        self.assertIn('routing_meta', data)

    @patch('trips.views.geocode_parallel')
    def test_geocode_failure(self, mock_geocode):
        mock_geocode.side_effect = ValueError('No results for "xyz"')

        resp = self.client.post(self.url, {
            'current_location': 'xyz',
            'pickup_location': 'B',
            'dropoff_location': 'C',
            'current_cycle_used': 0,
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    @patch('trips.views.get_route')
    @patch('trips.views.geocode_parallel')
    def test_routing_failure(self, mock_geocode, mock_route):
        mock_geocode.return_value = {
            'current': {'lat': 41.88, 'lon': -87.63, 'display_name': 'A'},
            'pickup':  {'lat': 39.77, 'lon': -86.16, 'display_name': 'B'},
            'dropoff': {'lat': 39.96, 'lon': -82.99, 'display_name': 'C'},
        }
        mock_route.side_effect = ValueError('Route not found')

        resp = self.client.post(self.url, {
            'current_location': 'A',
            'pickup_location': 'B',
            'dropoff_location': 'C',
            'current_cycle_used': 0,
        }, format='json')
        self.assertEqual(resp.status_code, 400)


class TestGeocodeView(SimpleTestCase):
    """Test GET /api/geocode/"""

    def setUp(self):
        self.client = APIClient()
        self.url = '/api/geocode/'

    def test_short_query_returns_empty(self):
        resp = self.client.get(self.url, {'q': 'ab'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_empty_query(self):
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])
