CREATE TABLE `detection_rules` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` varchar(1000),
	`severity` enum('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`event_category` enum('PROCESS','NETWORK','SYSTEM') NOT NULL,
	`scope` enum('ALL_HOSTS','SELECTED_HOSTS') NOT NULL,
	`definition` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `detection_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `detection_rules` ADD CONSTRAINT `detection_rules_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `detection_rules_workspace_created_idx` ON `detection_rules` (`workspace_id`,`created_at`,`id`);