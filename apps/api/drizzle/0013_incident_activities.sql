CREATE TABLE `incident_activities` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`incident_id` char(36) NOT NULL,
	`kind` enum('OPENED','STATUS_CHANGED','SEVERITY_CHANGED','DETAILS_UPDATED','INVESTIGATION_LINKED','INVESTIGATION_UNLINKED','INVESTIGATION_CLOSED') NOT NULL,
	`actor` enum('USER','DETECTION_ENGINE','HISTORY_BACKFILL') NOT NULL,
	`actor_user_id` char(36),
	`from_value` varchar(32),
	`to_value` varchar(32),
	`investigation_id` char(36),
	`investigation_title` varchar(160),
	`fields` json,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `incident_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `incident_activities` ADD CONSTRAINT `incident_activities_workspace_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incident_activities` ADD CONSTRAINT `incident_activities_incident_fk` FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incident_activities` ADD CONSTRAINT `incident_activities_user_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incident_activities` ADD CONSTRAINT `incident_activities_investigation_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `incident_activities_incident_created_idx` ON `incident_activities` (`incident_id`,`created_at`,`id`);--> statement-breakpoint
INSERT INTO `incident_activities` (`id`, `workspace_id`, `incident_id`, `kind`, `actor`, `created_at`)
SELECT UUID(), `workspace_id`, `id`, 'OPENED', 'HISTORY_BACKFILL', `created_at` FROM `incidents`;--> statement-breakpoint
INSERT INTO `incident_activities` (`id`, `workspace_id`, `incident_id`, `kind`, `actor`, `investigation_id`, `investigation_title`, `created_at`)
SELECT UUID(), `inv`.`workspace_id`, `link`.`incident_id`, 'INVESTIGATION_LINKED', 'HISTORY_BACKFILL', `inv`.`id`, `inv`.`title`, `link`.`created_at`
FROM `investigation_incidents` `link` INNER JOIN `investigations` `inv` ON `inv`.`id` = `link`.`investigation_id`;--> statement-breakpoint
INSERT INTO `incident_activities` (`id`, `workspace_id`, `incident_id`, `kind`, `actor`, `investigation_id`, `investigation_title`, `created_at`)
SELECT UUID(), `inv`.`workspace_id`, `link`.`incident_id`, 'INVESTIGATION_CLOSED', 'HISTORY_BACKFILL', `inv`.`id`, `inv`.`title`, `inv`.`closed_at`
FROM `investigation_incidents` `link` INNER JOIN `investigations` `inv` ON `inv`.`id` = `link`.`investigation_id`
WHERE `inv`.`status` = 'CLOSED' AND `inv`.`closed_at` IS NOT NULL;
