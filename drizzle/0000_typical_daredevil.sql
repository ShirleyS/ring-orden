CREATE TABLE `integration_events` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`provider` text NOT NULL,
	`event_type` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `integration_events_tenant` ON `integration_events` (`merchant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_owner_user_id_unique` ON `merchants` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `tenant_state` (
	`merchant_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
