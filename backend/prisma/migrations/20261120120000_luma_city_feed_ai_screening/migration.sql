-- AI screening for broad feeds, plus Luma's NYC city feed as the first one.

-- Existing events default to suitable; events from AI-screened sources start as NULL (not screened yet)
ALTER TABLE `Event` ADD COLUMN `isSuitable` BOOLEAN NULL DEFAULT true,
    ADD COLUMN `screenedAt` DATETIME(3) NULL;

ALTER TABLE `EventSource` ADD COLUMN `aiScreened` BOOLEAN NOT NULL DEFAULT false;

-- Luma's "What's Happening in New York" feed (luma.com/nyc). Added here, rather than by hand through
-- the admin API, so every environment gets it automatically. defaultCategory is only a placeholder:
-- the AI sets each event's real type and category, and unscreened events are never offered.
INSERT INTO `EventSource` (`name`, `provider`, `externalId`, `organizerId`, `defaultCategory`, `defaultEventCategory`, `metroArea`, `isActive`, `aiScreened`, `createdAt`)
SELECT 'Luma: What''s Happening in New York', 'LUMA', 'discplace-Izx1rQVSh8njYpP', NULL, 'Social', NULL, 'NYC', true, true, CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM `EventSource` WHERE `provider` = 'LUMA' AND `externalId` = 'discplace-Izx1rQVSh8njYpP');
