CREATE TABLE `alerts` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`rule_id` char(36) NOT NULL,
	`event_id` char(36) NOT NULL,
	`host_id` char(36) NOT NULL,
	`incident_id` char(36),
	`severity` enum('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `alerts_rule_event_unique` UNIQUE(`rule_id`,`event_id`)
);
--> statement-breakpoint
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_workspace_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_rule_fk` FOREIGN KEY (`rule_id`) REFERENCES `detection_rules`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_event_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_host_fk` FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_incident_fk` FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `alerts_workspace_created_idx` ON `alerts` (`workspace_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `alerts_rule_host_created_idx` ON `alerts` (`rule_id`,`host_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `alerts_incident_idx` ON `alerts` (`incident_id`);