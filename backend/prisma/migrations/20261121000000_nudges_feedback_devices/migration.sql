-- US009 nudges (in-app, email, push-ready), US012 skipped + 1-5 ratings. Purely additive.
-- AlterTable
ALTER TABLE `PlanItem` ADD COLUMN `rating` INTEGER NULL,
    MODIFY `status` ENUM('SUGGESTED', 'NOT_INTERESTED', 'ATTENDED', 'SKIPPED') NOT NULL DEFAULT 'SUGGESTED';

-- AlterTable
ALTER TABLE `User` ADD COLUMN `nudgeEmails` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `unsubscribeToken` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `Nudge` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `kind` ENUM('SOCIAL_GAP') NOT NULL,
    `message` VARCHAR(500) NOT NULL,
    `eventIds` JSON NOT NULL,
    `emailedAt` DATETIME(3) NULL,
    `pushedAt` DATETIME(3) NULL,
    `seenAt` DATETIME(3) NULL,
    `dismissedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Nudge_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Device` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `pushToken` VARCHAR(200) NOT NULL,
    `platform` VARCHAR(10) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Device_pushToken_key`(`pushToken`),
    INDEX `Device_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `User_unsubscribeToken_key` ON `User`(`unsubscribeToken`);

-- AddForeignKey
ALTER TABLE `Nudge` ADD CONSTRAINT `Nudge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Device` ADD CONSTRAINT `Device_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

