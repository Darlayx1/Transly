CREATE TABLE `vault_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`key_id` text NOT NULL,
	`key_name` text NOT NULL,
	`model` text NOT NULL,
	`role` text NOT NULL,
	`outcome` text NOT NULL,
	`duration` integer NOT NULL,
	`attempt` integer NOT NULL,
	`request_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vault_events_owner_created` ON `vault_events` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `vault_health` (
	`owner` text NOT NULL,
	`scope` text NOT NULL,
	`model` text NOT NULL,
	`until` integer NOT NULL,
	`code` text NOT NULL,
	`failures` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`owner`, `scope`, `model`)
);
--> statement-breakpoint
CREATE TABLE `vault_jobs` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`hash` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`expires` integer NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `vault_jobs_owner_expires` ON `vault_jobs` (`owner`,`expires`);--> statement-breakpoint
CREATE TABLE `vault_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`project` text NOT NULL,
	`role` text NOT NULL,
	`priority` integer NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`ciphertext` text NOT NULL,
	`fingerprint` text NOT NULL,
	`suffix` text NOT NULL,
	`invalid` integer DEFAULT 0 NOT NULL,
	`tested_at` integer,
	`last_used` integer,
	`successes` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vault_owner_priority` ON `vault_keys` (`owner`,`priority`);--> statement-breakpoint
CREATE UNIQUE INDEX `vault_owner_fingerprint` ON `vault_keys` (`owner`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `vault_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`key_id` text NOT NULL,
	`project` text NOT NULL,
	`model` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vault_leases_project` ON `vault_leases` (`owner`,`project`,`model`,`expires`);--> statement-breakpoint
CREATE TABLE `vault_limits` (
	`owner` text NOT NULL,
	`scope` text NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`owner`, `scope`, `window`)
);
--> statement-breakpoint
CREATE TABLE `vault_settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'priority' NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL
);
