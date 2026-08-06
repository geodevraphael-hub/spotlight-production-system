CREATE TABLE `inventory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer,
	`data` text NOT NULL,
	`latitude` integer NOT NULL,
	`longitude` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'planner' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);