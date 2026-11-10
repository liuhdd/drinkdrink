CREATE TABLE `guandan_rooms` (
  `room_id` text PRIMARY KEY NOT NULL,
  `data` text NOT NULL,
  `version` integer NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `guandan_rooms_expires_at_idx` ON `guandan_rooms` (`expires_at`);
