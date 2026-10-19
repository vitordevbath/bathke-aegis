CREATE TABLE `investigations` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`title` varchar(160) NOT NULL,
	`description` text,
	`conclusion` text,
	`status` enum('OPEN','IN_PROGRESS','CLOSED') NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`closed_at` datetime(3),
	CONSTRAINT `investigations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `investigations` ADD CONSTRAINT `investigations_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `investigations_workspace_created_idx` ON `investigations` (`workspace_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `investigations_workspace_status_created_idx` ON `investigations` (`workspace_id`,`status`,`created_at`,`id`);