CREATE TABLE `incidents` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`title` varchar(160) NOT NULL,
	`description` text,
	`severity` enum('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL,
	`status` enum('OPEN','INVESTIGATING','RESOLVED','CLOSED') NOT NULL,
	`origin` enum('MANUAL','DETECTION_ENGINE') NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`resolved_at` datetime(3),
	CONSTRAINT `incidents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `incidents_workspace_created_idx` ON `incidents` (`workspace_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `incidents_workspace_status_created_idx` ON `incidents` (`workspace_id`,`status`,`created_at`,`id`);