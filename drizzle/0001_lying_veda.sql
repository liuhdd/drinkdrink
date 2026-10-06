CREATE TABLE `device_ledgers` (
	`device_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`generation` text NOT NULL,
	`updated_at` integer NOT NULL,
	`cleanup_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `device_ledgers_updated_at_idx` ON `device_ledgers` (`updated_at`);--> statement-breakpoint
CREATE INDEX `device_ledgers_cleanup_at_idx` ON `device_ledgers` (`cleanup_at`);