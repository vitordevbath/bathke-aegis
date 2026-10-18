CREATE TABLE `hosts` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`display_name` varchar(120) NOT NULL,
	`description` varchar(500),
	`agent_id` char(36),
	`hostname` varchar(255),
	`os_name` varchar(100),
	`os_version` varchar(100),
	`architecture` varchar(32),
	`connection_state` enum('UNPAIRED','ONLINE','OFFLINE') NOT NULL DEFAULT 'UNPAIRED',
	`last_seen_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `hosts_id` PRIMARY KEY(`id`),
	CONSTRAINT `hosts_agent_id_unique` UNIQUE(`agent_id`)
);
--> statement-breakpoint
ALTER TABLE `hosts` ADD CONSTRAINT `hosts_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `hosts_workspace_created_idx` ON `hosts` (`workspace_id`,`created_at`,`id`);