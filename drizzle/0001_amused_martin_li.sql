CREATE TABLE `campaign_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`data` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_users` (
	`project_id` integer NOT NULL,
	`user_id` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`project_type` text NOT NULL,
	`share_token` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_share_token_unique` ON `projects` (`share_token`);