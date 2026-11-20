-- Sprint 3: Luma as a second event provider, provider categories (eventCategory),
-- "Not interested" instead of "Removed", attended tracking, and email codes.
-- Hand-edited from `prisma migrate diff` so renamed columns keep their data
-- (the generated version dropped and re-added them).

-- EventSource: generic provider columns. Existing rows are Eventbrite venues.
DROP INDEX `EventSource_eventbriteVenueId_eventbriteOrganizerId_key` ON `EventSource`;
ALTER TABLE `EventSource`
    CHANGE COLUMN `eventbriteVenueId` `externalId` VARCHAR(50) NOT NULL,
    CHANGE COLUMN `eventbriteOrganizerId` `organizerId` VARCHAR(20) NULL,
    ADD COLUMN `provider` ENUM('EVENTBRITE', 'LUMA') NOT NULL DEFAULT 'EVENTBRITE' AFTER `name`,
    ADD COLUMN `defaultEventCategory` VARCHAR(100) NULL AFTER `defaultCategory`;
CREATE UNIQUE INDEX `EventSource_provider_externalId_organizerId_key` ON `EventSource`(`provider`, `externalId`, `organizerId`);

-- Event: generic external ID plus the provider's own category name
DROP INDEX `Event_eventbriteId_key` ON `Event`;
ALTER TABLE `Event`
    CHANGE COLUMN `eventbriteId` `externalId` VARCHAR(50) NOT NULL,
    ADD COLUMN `provider` ENUM('EVENTBRITE', 'LUMA') NOT NULL DEFAULT 'EVENTBRITE' AFTER `id`,
    ADD COLUMN `eventCategory` VARCHAR(100) NULL AFTER `category`,
    MODIFY `isFree` BOOLEAN NULL; -- null = unknown (Luma feeds don't say)
CREATE UNIQUE INDEX `Event_provider_externalId_key` ON `Event`(`provider`, `externalId`);

-- PlanItem: REMOVED becomes NOT_INTERESTED. Widen the enum, move the rows, then narrow it.
ALTER TABLE `PlanItem` MODIFY `status` ENUM('SUGGESTED', 'REMOVED', 'NOT_INTERESTED', 'ATTENDED') NOT NULL DEFAULT 'SUGGESTED';
UPDATE `PlanItem` SET `status` = 'NOT_INTERESTED' WHERE `status` = 'REMOVED';
ALTER TABLE `PlanItem`
    MODIFY `status` ENUM('SUGGESTED', 'NOT_INTERESTED', 'ATTENDED') NOT NULL DEFAULT 'SUGGESTED',
    CHANGE COLUMN `removedAt` `respondedAt` DATETIME(3) NULL,
    ADD COLUMN `matchedInterests` JSON NULL AFTER `reason`;

-- User: email confirmation
ALTER TABLE `User` ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL AFTER `activityTypes`;

-- EmailCode: one-time codes for email confirmation and password reset
CREATE TABLE `EmailCode` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `purpose` ENUM('VERIFY_EMAIL', 'RESET_PASSWORD') NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmailCode_userId_purpose_idx`(`userId`, `purpose`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `EmailCode` ADD CONSTRAINT `EmailCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
