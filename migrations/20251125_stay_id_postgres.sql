
-- Migration: stay_id unification (PostgreSQL)
-- Run in this order; verify backups before applying.

BEGIN;

-- payment
ALTER TABLE payment ADD COLUMN IF NOT EXISTS stay_id INTEGER;
UPDATE payment SET stay_id = COALESCE(stay_id, booking_id);
ALTER TABLE payment ALTER COLUMN stay_id SET NOT NULL;
ALTER TABLE payment ADD CONSTRAINT fk_payment_stay FOREIGN KEY (stay_id) REFERENCES booking(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS payment_booking_id;
ALTER TABLE payment DROP COLUMN IF EXISTS booking_id;
CREATE INDEX IF NOT EXISTS idx_payment_stay_id ON payment (stay_id);

-- booking_add_on
ALTER TABLE booking_add_on ADD COLUMN IF NOT EXISTS stay_id INTEGER;
UPDATE booking_add_on SET stay_id = COALESCE(stay_id, booking_id);
ALTER TABLE booking_add_on ALTER COLUMN stay_id SET NOT NULL;
ALTER TABLE booking_add_on ADD CONSTRAINT fk_booking_add_on_stay FOREIGN KEY (stay_id) REFERENCES booking(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS booking_add_on_booking_id;
ALTER TABLE booking_add_on DROP COLUMN IF EXISTS booking_id;
CREATE INDEX IF NOT EXISTS idx_booking_add_on_stay_id ON booking_add_on (stay_id);

-- outside_meta
ALTER TABLE outside_meta ADD COLUMN IF NOT EXISTS stay_id INTEGER;
UPDATE outside_meta SET stay_id = COALESCE(stay_id, booking_id);
ALTER TABLE outside_meta ALTER COLUMN stay_id SET NOT NULL;
ALTER TABLE outside_meta ADD CONSTRAINT fk_outside_meta_stay FOREIGN KEY (stay_id) REFERENCES booking(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS outside_meta_booking_id;
ALTER TABLE outside_meta DROP COLUMN IF EXISTS booking_id;
CREATE INDEX IF NOT EXISTS idx_outside_meta_stay_id ON outside_meta (stay_id);

-- tgx_meta
ALTER TABLE tgx_meta ADD COLUMN IF NOT EXISTS stay_id INTEGER;
UPDATE tgx_meta SET stay_id = COALESCE(stay_id, booking_id);
ALTER TABLE tgx_meta ALTER COLUMN stay_id SET NOT NULL;
ALTER TABLE tgx_meta ADD CONSTRAINT fk_tgx_meta_stay FOREIGN KEY (stay_id) REFERENCES booking(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS tgx_meta_booking_id;
ALTER TABLE tgx_meta DROP COLUMN IF EXISTS booking_id;
CREATE INDEX IF NOT EXISTS idx_tgx_meta_stay_id ON tgx_meta (stay_id);

-- commission
ALTER TABLE commission ADD COLUMN IF NOT EXISTS stay_id INTEGER;
UPDATE commission SET stay_id = COALESCE(stay_id, booking_id);
ALTER TABLE commission ALTER COLUMN stay_id SET NOT NULL;
ALTER TABLE commission ADD CONSTRAINT fk_commission_stay FOREIGN KEY (stay_id) REFERENCES booking(id) ON DELETE CASCADE;
ALTER TABLE commission DROP CONSTRAINT IF EXISTS commission_booking_id_key;
ALTER TABLE commission ADD CONSTRAINT commission_stay_id_key UNIQUE (stay_id);
ALTER TABLE commission DROP COLUMN IF EXISTS booking_id;

-- influencer_commission
ALTER TABLE influencer_commission ADD COLUMN IF NOT EXISTS stay_id INTEGER;
UPDATE influencer_commission SET stay_id = COALESCE(stay_id, booking_id);
ALTER TABLE influencer_commission ALTER COLUMN stay_id SET NOT NULL;
ALTER TABLE influencer_commission ADD CONSTRAINT fk_influencer_commission_stay FOREIGN KEY (stay_id) REFERENCES booking(id) ON DELETE CASCADE;
ALTER TABLE influencer_commission DROP CONSTRAINT IF EXISTS influencer_commission_booking_id_key;
ALTER TABLE influencer_commission ADD CONSTRAINT influencer_commission_stay_id_key UNIQUE (stay_id);
ALTER TABLE influencer_commission DROP COLUMN IF EXISTS booking_id;

-- discount_code
ALTER TABLE discount_code ADD COLUMN IF NOT EXISTS stay_id INTEGER;
UPDATE discount_code SET stay_id = COALESCE(stay_id, booking_id);
ALTER TABLE discount_code DROP COLUMN IF EXISTS booking_id;
CREATE INDEX IF NOT EXISTS idx_discount_code_stay_id ON discount_code (stay_id);
ALTER TABLE discount_code ADD CONSTRAINT fk_discount_code_stay FOREIGN KEY (stay_id) REFERENCES booking(id);

-- review
ALTER TABLE review ADD COLUMN IF NOT EXISTS stay_id INTEGER;
UPDATE review SET stay_id = COALESCE(stay_id, booking_id);
ALTER TABLE review ALTER COLUMN stay_id SET NOT NULL;
ALTER TABLE review ADD CONSTRAINT fk_review_stay FOREIGN KEY (stay_id) REFERENCES booking(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS review_booking_id;
ALTER TABLE review DROP COLUMN IF EXISTS booking_id;
CREATE INDEX IF NOT EXISTS idx_review_stay_id ON review (stay_id);

-- Indexes for stay_home / stay_hotel lookups
CREATE INDEX IF NOT EXISTS idx_stay_home_home_id ON stay_home (home_id);
CREATE INDEX IF NOT EXISTS idx_stay_home_host_id ON stay_home (host_id);
CREATE INDEX IF NOT EXISTS idx_stay_hotel_hotel_id ON stay_hotel (hotel_id);
CREATE INDEX IF NOT EXISTS idx_stay_hotel_room_id ON stay_hotel (room_id);

COMMIT;
