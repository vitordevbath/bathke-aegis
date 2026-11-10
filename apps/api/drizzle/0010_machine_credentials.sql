CREATE TABLE `machine_credentials` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`host_id` char(36) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`token_prefix` varchar(32) NOT NULL,
	`scopes` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`last_used_at` datetime(3),
	`revoked_at` datetime(3),
	`pairing_challenge_id` char(36),
	`rotated_from_credential_id` char(36),
	`active_host_id` char(36) GENERATED ALWAYS AS ((case when `revoked_at` is null then `host_id` end)) VIRTUAL,
	CONSTRAINT `machine_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `machine_credentials_active_host_unique` UNIQUE(`active_host_id`),
	CONSTRAINT `machine_credentials_challenge_unique` UNIQUE(`pairing_challenge_id`),
	CONSTRAINT `machine_credentials_rotated_from_unique` UNIQUE(`rotated_from_credential_id`)
);
--> statement-breakpoint
ALTER TABLE `machine_credentials` ADD CONSTRAINT `credentials_workspace_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `machine_credentials` ADD CONSTRAINT `credentials_host_fk` FOREIGN KEY (`host_id`,`workspace_id`) REFERENCES `hosts`(`id`,`workspace_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `machine_credentials` ADD CONSTRAINT `credentials_challenge_fk` FOREIGN KEY (`pairing_challenge_id`) REFERENCES `pairing_challenges`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `machine_credentials` ADD CONSTRAINT `credentials_rotated_from_fk` FOREIGN KEY (`rotated_from_credential_id`) REFERENCES `machine_credentials`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `machine_credentials_host_created_idx` ON `machine_credentials` (`host_id`,`workspace_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `machine_credentials_workspace_idx` ON `machine_credentials` (`workspace_id`);