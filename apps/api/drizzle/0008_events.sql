CREATE TABLE `events` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`host_id` char(36) NOT NULL,
	`source_event_id` char(36) NOT NULL,
	`schema_version` smallint unsigned NOT NULL,
	`category` enum('PROCESS','NETWORK','SYSTEM') NOT NULL,
	`event_type` enum('PROCESS_STARTED','PROCESS_EXITED','NETWORK_CONNECTION','NETWORK_LISTEN','SYSTEM_BOOT','SYSTEM_SERVICE_STATE_CHANGED') NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	`ingested_at` datetime(3) NOT NULL,
	`payload` json NOT NULL,
	`fingerprint` char(64) NOT NULL,
	CONSTRAINT `events_id` PRIMARY KEY(`id`),
	CONSTRAINT `events_host_source_unique` UNIQUE(`host_id`,`source_event_id`)
);
--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_host_id_hosts_id_fk` FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `events_workspace_occurred_idx` ON `events` (`workspace_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `events_workspace_host_occurred_idx` ON `events` (`workspace_id`,`host_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `events_workspace_category_occurred_idx` ON `events` (`workspace_id`,`category`,`occurred_at`,`id`);