CREATE TABLE `merchant_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_by` text,
	`accepted_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_invitations_token_hash_unique` ON `merchant_invitations` (`token_hash`);--> statement-breakpoint
CREATE TABLE `merchant_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`user_subject` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `merchant_memberships_subject` ON `merchant_memberships` (`user_subject`,`merchant_id`);