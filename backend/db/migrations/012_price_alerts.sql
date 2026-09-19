-- Price alerts: the cloud watches a crop's mandi price while the farmer's phone is off.
-- Checked after every mandi sync (db/syncMandi.js) and whenever the member opens the app.
BEGIN;

CREATE TABLE app.price_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  crop_code text NOT NULL,
  -- Where to watch: the member's farm, else their profile region (fixed when the alert is made).
  region_code text NOT NULL,
  latitude double precision,
  longitude double precision,
  direction text NOT NULL CHECK (direction IN ('above', 'below')),
  threshold numeric(12, 2) NOT NULL CHECK (threshold > 0),
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered')),
  triggered_at timestamptz,
  triggered_price numeric(12, 2),
  triggered_market text,
  triggered_date date,
  seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_alerts_user_idx ON app.price_alerts(user_id, created_at DESC);
CREATE INDEX price_alerts_active_idx ON app.price_alerts(crop_code, region_code) WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE, DELETE ON app.price_alerts TO agrilink_app;

COMMIT;
