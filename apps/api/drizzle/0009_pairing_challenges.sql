CREATE TABLE `pairing_challenges` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`host_id` char(36) NOT NULL,
	`code_hash` char(64) NOT NULL,
	`created_by` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`consumed_at` datetime(3),
	`revoked_at` datetime(3),
	`open_host_id` char(36) GENERATED ALWAYS AS ((case when (`consumed_at` is null and `revoked_at` is null) then `host_id` end)) VIRTUAL,
	CONSTRAINT `pairing_challenges_id` PRIMARY KEY(`id`),
	CONSTRAINT `pairing_challenges_code_hash_unique` UNIQUE(`code_hash`),
	CONSTRAINT `pairing_challenges_open_host_unique` UNIQUE(`open_host_id`)
);
--> statement-breakpoint
ALTER TABLE `hosts` MODIFY COLUMN `connection_state` enum('UNPAIRED','ONLINE','OFFLINE','PAIRED') NOT NULL DEFAULT 'UNPAIRED';--> statement-breakpoint
ALTER TABLE `hosts` ADD CONSTRAINT `hosts_id_workspace_unique` UNIQUE(`id`,`workspace_id`);--> statement-breakpoint
ALTER TABLE `pairing_challenges` ADD CONSTRAINT `pairing_challenges_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pairing_challenges` ADD CONSTRAINT `pairing_challenges_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pairing_challenges` ADD CONSTRAINT `pairing_challenges_host_fk` FOREIGN KEY (`host_id`,`workspace_id`) REFERENCES `hosts`(`id`,`workspace_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `pairing_challenges_host_created_idx` ON `pairing_challenges` (`host_id`,`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `pairing_challenges_created_by_idx` ON `pairing_challenges` (`created_by`);