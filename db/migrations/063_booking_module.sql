-- 063: Calendar Booking module (Phase 1 MVP).
--
-- A visitor picks a service and a time on a public booking page; the system
-- assigns an eligible consultant (single host or round-robin), checks that
-- consultant's calendar availability, creates a calendar event with a meeting
-- link, and shows the booking in the ForgeChat dashboard.
--
-- Scope of this migration (deliberately single-tenant, matching the rest of the
-- app — there is no tenant_id anywhere else in `coexistence`):
--   * services (a service == its own public booking page for the MVP)
--   * consultants (optionally linked to a Google OAuth credential for calendar)
--   * service <-> consultant eligibility
--   * short-lived holds (race-safe confirmation)
--   * bookings + an append-only booking_events audit trail
-- Payments, payouts, multi-tenant isolation and domain-wide delegation from the
-- full spec are intentionally out of scope here and left for later phases.

/* ------------------------------- consultants ------------------------------ */
CREATE TABLE IF NOT EXISTS coexistence.booking_consultants (
  id                   BIGSERIAL PRIMARY KEY,
  display_name         TEXT   NOT NULL,
  email                TEXT,                       -- Workspace email (attendee + calendar owner)
  -- Link to a connected Google account (migration 050's oauth_credentials).
  -- NULL => calendar checks/creates run through the mock adapter for this
  -- consultant, so the flow is fully testable before Google is wired up.
  google_credential_id BIGINT REFERENCES coexistence.oauth_credentials(id) ON DELETE SET NULL,
  calendar_id          TEXT   NOT NULL DEFAULT 'primary',
  time_zone            TEXT   NOT NULL DEFAULT 'Asia/Kolkata',
  -- Weekly working hours as JSON: { "1": [["09:00","17:00"]], ... } keyed by
  -- ISO weekday (1=Mon .. 7=Sun). Empty/absent weekday => not working that day.
  working_hours        JSONB  NOT NULL DEFAULT '{"1":[["09:00","17:00"]],"2":[["09:00","17:00"]],"3":[["09:00","17:00"]],"4":[["09:00","17:00"]],"5":[["09:00","17:00"]]}',
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* -------------------------------- services -------------------------------- */
CREATE TABLE IF NOT EXISTS coexistence.booking_services (
  id                    BIGSERIAL PRIMARY KEY,
  name                  TEXT    NOT NULL,
  slug                  TEXT    NOT NULL UNIQUE,     -- public page identifier
  description           TEXT,
  duration_minutes      INT     NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  buffer_before_minutes INT     NOT NULL DEFAULT 0  CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes  INT     NOT NULL DEFAULT 0  CHECK (buffer_after_minutes >= 0),
  minimum_notice_minutes INT    NOT NULL DEFAULT 120 CHECK (minimum_notice_minutes >= 0),
  booking_horizon_days  INT     NOT NULL DEFAULT 30 CHECK (booking_horizon_days BETWEEN 1 AND 365),
  slot_granularity_minutes INT  NOT NULL DEFAULT 30 CHECK (slot_granularity_minutes BETWEEN 5 AND 120),
  -- 'single' => always the first eligible consultant; 'round_robin' => spread by
  -- least-loaded among the free consultants.
  assignment_policy     TEXT    NOT NULL DEFAULT 'round_robin' CHECK (assignment_policy IN ('single','round_robin')),
  meeting_mode          TEXT    NOT NULL DEFAULT 'google_meet' CHECK (meeting_mode IN ('google_meet')),
  active                BOOLEAN NOT NULL DEFAULT FALSE,   -- page goes live only when an admin activates it
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coexistence.booking_service_consultants (
  service_id    BIGINT NOT NULL REFERENCES coexistence.booking_services(id)   ON DELETE CASCADE,
  consultant_id BIGINT NOT NULL REFERENCES coexistence.booking_consultants(id) ON DELETE CASCADE,
  priority      INT    NOT NULL DEFAULT 0,   -- lower = preferred for 'single'
  PRIMARY KEY (service_id, consultant_id)
);

/* --------------------------------- holds ---------------------------------- */
-- A hold reserves a (consultant, time) briefly so two visitors can't confirm the
-- same slot. Expired holds are ignored by availability and swept opportunistically.
CREATE TABLE IF NOT EXISTS coexistence.booking_holds (
  id            BIGSERIAL PRIMARY KEY,
  token         TEXT   NOT NULL UNIQUE,
  service_id    BIGINT NOT NULL REFERENCES coexistence.booking_services(id)   ON DELETE CASCADE,
  consultant_id BIGINT NOT NULL REFERENCES coexistence.booking_consultants(id) ON DELETE CASCADE,
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  status        TEXT   NOT NULL DEFAULT 'active' CHECK (status IN ('active','consumed','expired')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_booking_holds_slot ON coexistence.booking_holds(consultant_id, starts_at, ends_at) WHERE status = 'active';

/* -------------------------------- bookings -------------------------------- */
CREATE TABLE IF NOT EXISTS coexistence.bookings (
  id               BIGSERIAL PRIMARY KEY,
  service_id       BIGINT NOT NULL REFERENCES coexistence.booking_services(id)   ON DELETE RESTRICT,
  consultant_id    BIGINT NOT NULL REFERENCES coexistence.booking_consultants(id) ON DELETE RESTRICT,
  status           TEXT   NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','completed','no_show')),
  starts_at        TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ NOT NULL,
  time_zone        TEXT   NOT NULL DEFAULT 'Asia/Kolkata',
  visitor_name     TEXT   NOT NULL,
  visitor_email    TEXT,
  visitor_phone    TEXT,
  notes            TEXT,
  meeting_provider TEXT   NOT NULL DEFAULT 'google_meet',
  meeting_url      TEXT,
  google_calendar_id TEXT,
  google_event_id  TEXT,
  assignment_reason TEXT,                 -- why this consultant (audit)
  cancel_token     TEXT   NOT NULL UNIQUE, -- signed-ish opaque token for public cancel
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bookings_consultant_time ON coexistence.bookings(consultant_id, starts_at, ends_at) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_bookings_service         ON coexistence.bookings(service_id);
CREATE INDEX IF NOT EXISTS idx_bookings_starts          ON coexistence.bookings(starts_at);

/* ------------------------------ booking events ---------------------------- */
-- Append-only audit / domain-event log. Existing WhatsApp/email automation can
-- later subscribe to these (booking.confirmed, booking.cancelled, ...).
CREATE TABLE IF NOT EXISTS coexistence.booking_events (
  id          BIGSERIAL PRIMARY KEY,
  booking_id  BIGINT REFERENCES coexistence.bookings(id) ON DELETE CASCADE,
  type        TEXT   NOT NULL,
  actor_type  TEXT   NOT NULL DEFAULT 'system',
  actor_id    BIGINT,
  payload     JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_booking_events_booking ON coexistence.booking_events(booking_id);
