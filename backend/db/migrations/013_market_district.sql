-- Preserve the district supplied by Agmarknet. Markets remain attached to the state region for
-- state-wide price discovery, while district_name lets the UI tell farmers where each mandi is.
BEGIN;

ALTER TABLE app.markets ADD COLUMN district_name text;
ALTER TABLE app.markets ADD CONSTRAINT markets_district_name_length
  CHECK (district_name IS NULL OR char_length(district_name) BETWEEN 1 AND 120);
CREATE INDEX markets_region_district_idx ON app.markets (region_id, district_name);

COMMIT;
