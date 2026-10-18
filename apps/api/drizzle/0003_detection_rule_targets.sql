CREATE TABLE `detection_rule_targets` (
	`detection_rule_id` char(36) NOT NULL,
	`host_id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `detection_rule_targets_pk` PRIMARY KEY(`detection_rule_id`,`host_id`)
);
--> statement-breakpoint
ALTER TABLE `detection_rule_targets` ADD CONSTRAINT `detection_rule_targets_detection_rule_id_detection_rules_id_fk` FOREIGN KEY (`detection_rule_id`) REFERENCES `detection_rules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `detection_rule_targets` ADD CONSTRAINT `detection_rule_targets_host_id_hosts_id_fk` FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `detection_rule_targets_host_idx` ON `detection_rule_targets` (`host_id`);