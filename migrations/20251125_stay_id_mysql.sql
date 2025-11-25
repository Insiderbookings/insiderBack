-- Migration: stay_id unification (MySQL/MariaDB)
-- Ensure you have backups before running.

START TRANSACTION;

-- payment
ALTER TABLE `payment` ADD COLUMN `stay_id` INT NULL;
UPDATE `payment` SET `stay_id` = COALESCE(`stay_id`, `booking_id`);
ALTER TABLE `payment` MODIFY `stay_id` INT NOT NULL;
ALTER TABLE `payment` ADD CONSTRAINT `fk_payment_stay` FOREIGN KEY (`stay_id`) REFERENCES `booking`(`id`) ON DELETE CASCADE;
DROP INDEX `booking_id` ON `payment`;
ALTER TABLE `payment` DROP COLUMN `booking_id`;
CREATE INDEX `idx_payment_stay_id` ON `payment` (`stay_id`);

-- booking_add_on
ALTER TABLE `booking_add_on` ADD COLUMN `stay_id` INT NULL;
UPDATE `booking_add_on` SET `stay_id` = COALESCE(`stay_id`, `booking_id`);
ALTER TABLE `booking_add_on` MODIFY `stay_id` INT NOT NULL;
ALTER TABLE `booking_add_on` ADD CONSTRAINT `fk_booking_add_on_stay` FOREIGN KEY (`stay_id`) REFERENCES `booking`(`id`) ON DELETE CASCADE;
DROP INDEX `booking_id` ON `booking_add_on`;
ALTER TABLE `booking_add_on` DROP COLUMN `booking_id`;
CREATE INDEX `idx_booking_add_on_stay_id` ON `booking_add_on` (`stay_id`);

-- outside_meta
ALTER TABLE `outside_meta` ADD COLUMN `stay_id` INT NULL;
UPDATE `outside_meta` SET `stay_id` = COALESCE(`stay_id`, `booking_id`);
ALTER TABLE `outside_meta` MODIFY `stay_id` INT NOT NULL;
ALTER TABLE `outside_meta` ADD CONSTRAINT `fk_outside_meta_stay` FOREIGN KEY (`stay_id`) REFERENCES `booking`(`id`) ON DELETE CASCADE;
DROP INDEX `booking_id` ON `outside_meta`;
ALTER TABLE `outside_meta` DROP COLUMN `booking_id`;
CREATE INDEX `idx_outside_meta_stay_id` ON `outside_meta` (`stay_id`);

-- tgx_meta
ALTER TABLE `tgx_meta` ADD COLUMN `stay_id` INT NULL;
UPDATE `tgx_meta` SET `stay_id` = COALESCE(`stay_id`, `booking_id`);
ALTER TABLE `tgx_meta` MODIFY `stay_id` INT NOT NULL;
ALTER TABLE `tgx_meta` ADD CONSTRAINT `fk_tgx_meta_stay` FOREIGN KEY (`stay_id`) REFERENCES `booking`(`id`) ON DELETE CASCADE;
DROP INDEX `booking_id` ON `tgx_meta`;
ALTER TABLE `tgx_meta` DROP COLUMN `booking_id`;
CREATE INDEX `idx_tgx_meta_stay_id` ON `tgx_meta` (`stay_id`);

-- commission
ALTER TABLE `commission` ADD COLUMN `stay_id` INT NULL;
UPDATE `commission` SET `stay_id` = COALESCE(`stay_id`, `booking_id`);
ALTER TABLE `commission` MODIFY `stay_id` INT NOT NULL;
ALTER TABLE `commission` ADD CONSTRAINT `fk_commission_stay` FOREIGN KEY (`stay_id`) REFERENCES `booking`(`id`) ON DELETE CASCADE;
ALTER TABLE `commission` DROP INDEX `booking_id`;
ALTER TABLE `commission` ADD UNIQUE KEY `commission_stay_id_key` (`stay_id`);
ALTER TABLE `commission` DROP COLUMN `booking_id`;

-- influencer_commission
ALTER TABLE `influencer_commission` ADD COLUMN `stay_id` INT NULL;
UPDATE `influencer_commission` SET `stay_id` = COALESCE(`stay_id`, `booking_id`);
ALTER TABLE `influencer_commission` MODIFY `stay_id` INT NOT NULL;
ALTER TABLE `influencer_commission` ADD CONSTRAINT `fk_influencer_commission_stay` FOREIGN KEY (`stay_id`) REFERENCES `booking`(`id`) ON DELETE CASCADE;
ALTER TABLE `influencer_commission` DROP INDEX `booking_id`;
ALTER TABLE `influencer_commission` ADD UNIQUE KEY `influencer_commission_stay_id_key` (`stay_id`);
ALTER TABLE `influencer_commission` DROP COLUMN `booking_id`;

-- discount_code
ALTER TABLE `discount_code` ADD COLUMN `stay_id` INT NULL;
UPDATE `discount_code` SET `stay_id` = COALESCE(`stay_id`, `booking_id`);
ALTER TABLE `discount_code` DROP COLUMN `booking_id`;
CREATE INDEX `idx_discount_code_stay_id` ON `discount_code` (`stay_id`);
ALTER TABLE `discount_code` ADD CONSTRAINT `fk_discount_code_stay` FOREIGN KEY (`stay_id`) REFERENCES `booking`(`id`);

-- review
ALTER TABLE `review` ADD COLUMN `stay_id` INT NULL;
UPDATE `review` SET `stay_id` = COALESCE(`stay_id`, `booking_id`);
ALTER TABLE `review` MODIFY `stay_id` INT NOT NULL;
ALTER TABLE `review` ADD CONSTRAINT `fk_review_stay` FOREIGN KEY (`stay_id`) REFERENCES `booking`(`id`) ON DELETE CASCADE;
DROP INDEX `booking_id` ON `review`;
ALTER TABLE `review` DROP COLUMN `booking_id`;
CREATE INDEX `idx_review_stay_id` ON `review` (`stay_id`);

-- Indexes for stay_home / stay_hotel lookups
CREATE INDEX `idx_stay_home_home_id` ON `stay_home` (`home_id`);
CREATE INDEX `idx_stay_home_host_id` ON `stay_home` (`host_id`);
CREATE INDEX `idx_stay_hotel_hotel_id` ON `stay_hotel` (`hotel_id`);
CREATE INDEX `idx_stay_hotel_room_id` ON `stay_hotel` (`room_id`);

COMMIT;
