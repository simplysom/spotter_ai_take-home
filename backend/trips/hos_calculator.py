"""
FMCSA Hours of Service (HOS) Calculator
Property-carrying CMV drivers — 70 hour / 8 day cycle

Rules enforced (49 CFR Part 395):
  - 11-hour daily driving limit  [§395.3(a)(3)]
  - 14-hour driving window (wall-clock from first on-duty/driving)  [§395.3(a)(2)]
  - 30-minute mandatory break after 8 cumulative driving hours
    (may be off-duty, on-duty not driving, or sleeper berth)  [§395.3(a)(3)(ii)]
  - 10 consecutive hours off-duty required between shifts  [§395.3(a)(1)]
  - 70-hour / 8-day rolling cycle limit  [§395.3(b)]
  - 34-hour restart resets the 70-hour clock  [§395.3(c)]
  - Fuel stop at least every 1,000 miles (30 min on-duty stop)
  - 1 hour for pickup, 1 hour for dropoff
  - 30-minute pre-trip / post-trip inspections
"""

from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

# ── HOS constants ──────────────────────────────────────────────────────────────
SPEED_MPH             = 55.0   # average truck cruising speed
MAX_DAILY_DRIVING     = 11.0   # hours
MAX_WINDOW_HOURS      = 14.0   # 14-hour driving window
REST_REQUIRED         = 10.0   # consecutive off-duty hours to reset daily limits
BREAK_THRESHOLD       = 8.0    # cumulative driving hours before mandatory break
BREAK_DURATION        = 0.5    # 30-minute break
MAX_CYCLE_HOURS       = 70.0   # 70-hour / 8-day limit
RESTART_DURATION      = 34.0   # 34-hour restart resets 70-hr clock [§395.3(c)]
FUEL_INTERVAL_MILES   = 1000.0 # fuel stop interval
FUEL_STOP_DURATION    = 0.5    # 30 minutes for fueling
PICKUP_DURATION       = 1.0    # 1 hour at pickup
DROPOFF_DURATION      = 1.0    # 1 hour at dropoff
PRETRIP_DURATION      = 0.5    # 30-minute pre-trip inspection
POSTTRIP_DURATION     = 0.5    # 30-minute post-trip inspection


class TripEvent:
    __slots__ = ('status', 'start', 'end', 'location', 'activity', 'miles')

    def __init__(self, status: str, start: datetime, end: datetime,
                 location: str, activity: str, miles: float = 0.0):
        self.status   = status   # 'off_duty' | 'sleeper' | 'driving' | 'on_duty'
        self.start    = start
        self.end      = end
        self.location = location
        self.activity = activity
        self.miles    = miles

    @property
    def duration_hours(self) -> float:
        return (self.end - self.start).total_seconds() / 3600.0


class HOSCalculator:
    """
    Stateful calculator that walks through a trip, enforcing all HOS rules and
    producing a timeline of events grouped into per-day ELD log sheets.
    """

    def __init__(self, current_cycle_used: float,
                 start_time: Optional[datetime] = None):
        if not (0.0 <= current_cycle_used <= MAX_CYCLE_HOURS):
            raise ValueError(
                f'current_cycle_used must be between 0 and {MAX_CYCLE_HOURS}, '
                f'got {current_cycle_used}')

        self.cycle_hours = float(current_cycle_used)

        # ── per-shift state (reset after 10-hr rest) ──────────────────────────
        self.daily_driving          = 0.0
        self.shift_start: Optional[datetime] = None
        self.driving_since_break    = 0.0
        self.miles_since_fuel       = 0.0

        # Absolute time pointer
        if start_time is None:
            now = datetime.now()
            start_time = now.replace(hour=8, minute=0, second=0, microsecond=0)
            if start_time <= now:
                start_time += timedelta(days=1)
        self.current_time: datetime = start_time

        self.events: List[TripEvent] = []

    # ── public ────────────────────────────────────────────────────────────────

    def calculate_trip(self,
                       dist_to_pickup: float,
                       dist_pickup_to_dropoff: float,
                       current_location: str,
                       pickup_location: str,
                       dropoff_location: str) -> Dict[str, Any]:
        if dist_to_pickup < 0 or dist_pickup_to_dropoff < 0:
            raise ValueError('Distances must be non-negative')

        # ── pre-trip ──────────────────────────────────────────────────────────
        self._ensure_can_work(PRETRIP_DURATION, current_location)
        self._add_event('on_duty', PRETRIP_DURATION,
                        current_location, 'Pre-trip inspection')

        # ── drive to pickup ───────────────────────────────────────────────────
        if dist_to_pickup > 0.05:
            self._drive_segment(dist_to_pickup, current_location, pickup_location)

        # ── pickup (1 hour) ───────────────────────────────────────────────────
        self._ensure_can_work(PICKUP_DURATION, pickup_location)
        self._add_event('on_duty', PICKUP_DURATION,
                        pickup_location, 'Pickup / Loading')

        # ── drive to dropoff ──────────────────────────────────────────────────
        if dist_pickup_to_dropoff > 0.05:
            self._drive_segment(dist_pickup_to_dropoff, pickup_location, dropoff_location)

        # ── dropoff (1 hour) ──────────────────────────────────────────────────
        self._ensure_can_work(DROPOFF_DURATION, dropoff_location)
        self._add_event('on_duty', DROPOFF_DURATION,
                        dropoff_location, 'Dropoff / Unloading')

        # ── post-trip ─────────────────────────────────────────────────────────
        self._ensure_can_work(POSTTRIP_DURATION, dropoff_location)
        self._add_event('on_duty', POSTTRIP_DURATION,
                        dropoff_location, 'Post-trip inspection')

        return self._build_output()

    # ── internals ─────────────────────────────────────────────────────────────

    @property
    def _window_hours_used(self) -> float:
        """Wall-clock hours elapsed since shift start (14-hr window check)."""
        if self.shift_start is None:
            return 0.0
        return (self.current_time - self.shift_start).total_seconds() / 3600.0

    def _ensure_can_work(self, duration_hrs: float, location: str):
        """
        Before adding on-duty work (pickup, dropoff, inspections), check that
        the 70-hr cycle can accommodate it. If not, take rest first.

        Per FMCSA: non-driving on-duty work IS allowed after the 14-hr window
        closes (you just can't drive), so we only check cycle here.

        Since only a 34-hour restart resets cycle_hours, we force a restart
        when the cycle can't accommodate the needed duration.
        """
        if self.cycle_hours + duration_hrs <= MAX_CYCLE_HOURS + 0.001:
            return
        # Cycle can't accommodate — need a 34-hour restart
        self._add_event('off_duty', RESTART_DURATION,
                        location, '34-hour restart (resets 70-hr cycle)')
        self.cycle_hours         = 0.0
        self.daily_driving       = 0.0
        self.driving_since_break = 0.0
        self.shift_start         = None

    def _add_event(self, status: str, duration_hrs: float,
                   location: str, activity: str, miles: float = 0.0):
        if duration_hrs <= 0:
            return

        # Starting any work begins the 14-hr shift window
        if status in ('driving', 'on_duty') and self.shift_start is None:
            self.shift_start = self.current_time

        start = self.current_time
        end   = start + timedelta(hours=duration_hrs)

        self.events.append(TripEvent(status, start, end, location, activity, miles))
        self.current_time = end

        # Accumulate counters
        if status == 'driving':
            self.daily_driving       += duration_hrs
            self.driving_since_break += duration_hrs
            self.cycle_hours         += duration_hrs
        elif status == 'on_duty':
            self.cycle_hours += duration_hrs

    def _take_rest(self, location: str):
        """
        Rest period — chooses between:
        - 10-hour off-duty rest: resets daily driving + 14-hr window
        - 34-hour restart [§395.3(c)]: also resets the 70-hr cycle clock

        A 34-hour restart is used when the 70-hr cycle is exhausted, since
        a 10-hour rest alone does NOT reduce cycle hours.
        """
        if self.cycle_hours >= MAX_CYCLE_HOURS - 0.001:
            self._add_event('off_duty', RESTART_DURATION,
                            location, '34-hour restart (resets 70-hr cycle)')
            self.cycle_hours = 0.0
        else:
            self._add_event('off_duty', REST_REQUIRED,
                            location, '10-hour mandatory rest period')
        self.daily_driving       = 0.0
        self.driving_since_break = 0.0
        self.shift_start         = None

    def _take_30min_break(self, location: str):
        """
        Mandatory 30-minute break per §395.3(a)(3)(ii).
        Per FMCSA (April 2022 guide, p.10): the break may be taken either
        on-duty (not driving), off-duty, or in the sleeper berth.
        We use off-duty since that's most common and doesn't accumulate
        toward the 70-hr cycle.
        """
        self._add_event('off_duty', BREAK_DURATION,
                        location, '30-minute mandatory break')
        self.driving_since_break = 0.0

    def _take_fuel_stop(self, location: str):
        """
        30-minute on-duty fuel stop.  Per FMCSA, consecutive on-duty not-driving
        time of 30+ minutes also satisfies the 30-min break requirement.
        """
        self._add_event('on_duty', FUEL_STOP_DURATION,
                        location, 'Fuel stop')
        self.miles_since_fuel = 0.0
        # Fuel stop is 30 min of consecutive non-driving on-duty time,
        # which satisfies the §395.3(a)(3)(ii) break requirement
        self.driving_since_break = 0.0

    def _available_driving_hours(self) -> float:
        """Maximum contiguous driving hours before next mandatory stop."""
        remaining_daily    = MAX_DAILY_DRIVING - self.daily_driving
        remaining_window   = MAX_WINDOW_HOURS  - self._window_hours_used
        remaining_cycle    = MAX_CYCLE_HOURS   - self.cycle_hours
        remaining_to_break = BREAK_THRESHOLD   - self.driving_since_break

        return min(remaining_daily, remaining_window,
                   remaining_cycle, remaining_to_break)

    def _must_rest(self) -> bool:
        if self.cycle_hours >= MAX_CYCLE_HOURS:
            return True
        if self.daily_driving >= MAX_DAILY_DRIVING:
            return True
        if self.shift_start and self._window_hours_used >= MAX_WINDOW_HOURS:
            return True
        return False

    def _drive_segment(self, distance_miles: float,
                       from_label: str, to_label: str):
        """
        Generate events to cover `distance_miles`, inserting breaks / rests /
        fuel stops whenever HOS limits are reached.
        """
        if distance_miles <= 0.05:
            return

        remaining = distance_miles
        safety    = 1000  # absolute loop guard (supports up to ~50,000 miles)

        while remaining > 0.05 and safety > 0:
            safety -= 1
            pct = int((1.0 - remaining / distance_miles) * 100)

            if pct < 5:
                cur_loc = f"Departing {from_label}"
            elif pct > 95:
                cur_loc = f"Near {to_label}"
            else:
                cur_loc = f"En route to {to_label} ({pct}% complete)"

            # ── must rest? ────────────────────────────────────────────────────
            if self._must_rest():
                self._take_rest(cur_loc)
                continue

            # ── must take 30-min break? ───────────────────────────────────────
            if self.driving_since_break >= BREAK_THRESHOLD - 0.001:
                self._take_30min_break(cur_loc)
                continue

            avail_hrs = self._available_driving_hours()

            if avail_hrs <= 0.001:
                if self.driving_since_break >= BREAK_THRESHOLD - 0.001:
                    self._take_30min_break(cur_loc)
                else:
                    self._take_rest(cur_loc)
                continue

            # ── how far until next fuel stop? ─────────────────────────────────
            miles_until_fuel  = FUEL_INTERVAL_MILES - self.miles_since_fuel
            hours_until_fuel  = miles_until_fuel / SPEED_MPH

            # ── drive the smallest of all constraints ─────────────────────────
            drive_hrs   = min(avail_hrs, hours_until_fuel, remaining / SPEED_MPH)
            drive_miles = drive_hrs * SPEED_MPH

            if drive_hrs <= 0.001:
                self._take_fuel_stop(cur_loc)
                continue

            end_pct = int((1.0 - (remaining - drive_miles) / distance_miles) * 100)
            if end_pct >= 99:
                end_loc = to_label
            else:
                end_loc = f"En route to {to_label} ({end_pct}% complete)"

            self._add_event('driving', drive_hrs, end_loc,
                            f'Driving to {to_label}', miles=drive_miles)
            self.miles_since_fuel += drive_miles
            remaining             -= drive_miles

            # Post-drive: check fuel
            if self.miles_since_fuel >= FUEL_INTERVAL_MILES - 0.1:
                self._take_fuel_stop(f"Fuel stop – near {to_label}")

        if safety <= 0:
            raise RuntimeError(
                f'HOS calculation exceeded safety limit. '
                f'Remaining: {remaining:.1f} miles of {distance_miles:.1f}')

    # ── output builders ───────────────────────────────────────────────────────

    def _build_output(self) -> Dict[str, Any]:
        daily_logs = self._build_daily_logs()

        stops = [
            {
                'type':           e.status,
                'activity':       e.activity,
                'location':       e.location,
                'start':          e.start.isoformat(),
                'end':            e.end.isoformat(),
                'duration_hours': round(e.duration_hours, 2),
            }
            for e in self.events
            if e.status != 'driving'
        ]

        total_miles = sum(e.miles for e in self.events if e.status == 'driving')
        total_drive = sum(e.duration_hours for e in self.events if e.status == 'driving')
        total_rest  = sum(e.duration_hours for e in self.events
                         if e.status in ('off_duty', 'sleeper'))

        return {
            'daily_logs': daily_logs,
            'stops':      stops,
            'summary': {
                'total_distance_miles': round(total_miles, 1),
                'total_drive_hours':    round(total_drive, 2),
                'total_rest_hours':     round(total_rest,  2),
                'total_days':           len(daily_logs),
                'start_time':           self.events[0].start.isoformat() if self.events else None,
                'end_time':             self.events[-1].end.isoformat()   if self.events else None,
            },
        }

    def _build_daily_logs(self) -> List[Dict]:
        # Split events that cross midnight
        flat: List[TripEvent] = []
        for ev in self.events:
            flat.extend(self._split_at_midnight(ev))

        # Group by calendar date
        by_date: Dict[str, List[TripEvent]] = {}
        for ev in flat:
            key = ev.start.strftime('%Y-%m-%d')
            by_date.setdefault(key, []).append(ev)

        daily_logs = []
        sorted_dates = sorted(by_date.keys())
        for idx, date_str in enumerate(sorted_dates):
            evs = by_date[date_str]
            totals = {'off_duty': 0.0, 'sleeper': 0.0, 'driving': 0.0, 'on_duty': 0.0}
            events_out = []
            remarks    = []

            for ev in evs:
                dur = ev.duration_hours
                totals[ev.status] = totals.get(ev.status, 0.0) + dur

                start_h = ev.start.hour + ev.start.minute / 60.0
                end_h   = ev.end.hour   + ev.end.minute   / 60.0
                # Handle midnight-boundary events that end exactly at 0.0 → 24.0
                if end_h == 0.0 and dur > 0:
                    end_h = 24.0

                events_out.append({
                    'status':      ev.status,
                    'start_hour':  round(start_h, 4),
                    'end_hour':    round(end_h,   4),
                    'duration':    round(dur, 3),
                    'activity':    ev.activity,
                    'location':    ev.location,
                    'miles':       round(ev.miles, 1),
                })
                remarks.append({
                    'time':     ev.start.strftime('%H:%M'),
                    'location': ev.location,
                    'activity': ev.activity,
                })

            daily_logs.append({
                'date':        date_str,
                'events':      events_out,
                'totals':      {k: round(v, 2) for k, v in totals.items()},
                'total_hours': round(sum(totals.values()), 2),
                'total_miles': round(sum(e['miles'] for e in events_out), 1),
                'remarks':     remarks,
            })

        # Merge phantom last-day remnants (midnight-split artifacts with no
        # driving and < 1 hour total) back into the previous day.
        if (len(daily_logs) >= 2
                and daily_logs[-1]['totals'].get('driving', 0) == 0
                and daily_logs[-1]['total_hours'] < 1.0):
            last = daily_logs.pop()
            prev = daily_logs[-1]
            prev['events'].extend(last['events'])
            prev['remarks'].extend(last['remarks'])
            for k in prev['totals']:
                prev['totals'][k] = round(
                    prev['totals'][k] + last['totals'].get(k, 0), 2)
            prev['total_hours'] = round(
                prev['total_hours'] + last['total_hours'], 2)
            prev['total_miles'] = round(
                prev['total_miles'] + last['total_miles'], 1)

        return daily_logs

    @staticmethod
    def _split_at_midnight(ev: TripEvent) -> List[TripEvent]:
        """Split a TripEvent that spans midnight into day-boundary segments."""
        result = []
        cur = ev
        while cur.start.date() != cur.end.date():
            midnight = (cur.start + timedelta(days=1)).replace(
                hour=0, minute=0, second=0, microsecond=0)
            total_secs = max((cur.end - cur.start).total_seconds(), 1)
            ratio = (midnight - cur.start).total_seconds() / total_secs
            first_miles = cur.miles * ratio
            result.append(TripEvent(
                cur.status, cur.start, midnight,
                cur.location, cur.activity, first_miles))
            cur = TripEvent(
                cur.status, midnight, cur.end,
                cur.location, cur.activity, cur.miles - first_miles)
        result.append(cur)
        return result
