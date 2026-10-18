CREATE TABLE `memberships` (
	`user_id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`role` enum('OWNER','ADMIN','ANALYST','VIEWER') NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `memberships_user_workspace_pk` PRIMARY KEY(`user_id`,`workspace_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`email` varchar(254) NOT NULL,
	`cpf` char(11) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`),
	CONSTRAINT `users_cpf_unique` UNIQUE(`cpf`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` char(36) NOT NULL,
	`name` varchar(150) NOT NULL,
	`kind` enum('personal','demo','organization','lab') NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `workspaces_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `memberships_workspace_idx` ON `memberships` (`workspace_id`);