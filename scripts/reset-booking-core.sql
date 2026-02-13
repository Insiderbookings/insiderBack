-- Reset manifest for Booking core (homes + Webbeds hotels)
-- Date: 2026-02-12
-- WARNING:
-- 1) Run only in non-production.
-- 2) This script drops every public table not listed in keep_tables.
-- 3) If app models still register legacy domains, sequelize.sync() can recreate them.

DO $$
DECLARE
  keep_tables text[] := ARRAY[
    -- Auth / user profile
    'user',
    'refresh_token',
    'host_profile',
    'guest_profile',

    -- Homes domain
    'home',
    'home_address',
    'home_amenity',
    'home_amenity_link',
    'home_bed_type',
    'home_bed_type_link',
    'home_media',
    'home_pricing',
    'home_calendar',
    'home_discount_rule',
    'home_policies',
    'home_security',
    'home_tag',
    'home_tag_link',
    'home_feature',
    'home_favorite',
    'home_favorite_list',
    'home_recent_view',

    -- Webbeds static
    'webbeds_country',
    'webbeds_city',
    'webbeds_hotel',
    'webbeds_hotel_image',
    'webbeds_hotel_amenity',
    'webbeds_hotel_geolocation',
    'webbeds_hotel_room_type',
    'webbeds_sync_log',
    'webbeds_currency',
    'webbeds_amenity_catalog',
    'webbeds_room_amenity_catalog',
    'webbeds_hotel_chain',
    'webbeds_hotel_classification',
    'webbeds_rate_basis',

    -- Booking core
    'booking',
    'stay_home',
    'stay_hotel',
    'booking_flows',
    'booking_flow_steps',
    'booking_user',
    'payment',

    -- Hotel favorites on Webbeds
    'hotel_favorite',
    'hotel_favorite_list',
    'hotel_recent_view',

    -- Currency config
    'currency_settings'
  ];
  row record;
BEGIN
  FOR row IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    IF NOT (row.tablename = ANY(keep_tables)) THEN
      EXECUTE format('DROP TABLE IF EXISTS %I CASCADE;', row.tablename);
    END IF;
  END LOOP;
END $$;
