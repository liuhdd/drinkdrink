CREATE TABLE `device_charades` (
	`device_id` text PRIMARY KEY NOT NULL,
	`question_order` text NOT NULL,
	`drawn` integer NOT NULL,
	`round` integer NOT NULL,
	`revision` integer NOT NULL,
	`generation` text NOT NULL,
	`last_request_id` text,
	`last_request_hash` text
);
