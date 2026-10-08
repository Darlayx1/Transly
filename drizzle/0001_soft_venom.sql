ALTER TABLE `vault_keys` ADD `provider` text DEFAULT 'gemini' NOT NULL;--> statement-breakpoint
ALTER TABLE `vault_keys` ADD `tested_model` text;