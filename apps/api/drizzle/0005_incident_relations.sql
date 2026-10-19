CREATE TABLE `incident_detection_rules` (
	`incident_id` char(36) NOT NULL,
	`detection_rule_id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `incident_detection_rules_pk` PRIMARY KEY(`incident_id`,`detection_rule_id`)
);
--> statement-breakpoint
CREATE TABLE `incident_hosts` (
	`incident_id` char(36) NOT NULL,
	`host_id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `incident_hosts_pk` PRIMARY KEY(`incident_id`,`host_id`)
);
--> statement-breakpoint
ALTER TABLE `incident_detection_rules` ADD CONSTRAINT `incident_detection_rules_incident_id_incidents_id_fk` FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incident_detection_rules` ADD CONSTRAINT `incident_detection_rules_detection_rule_id_detection_rules_id_fk` FOREIGN KEY (`detection_rule_id`) REFERENCES `detection_rules`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incident_hosts` ADD CONSTRAINT `incident_hosts_incident_id_incidents_id_fk` FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incident_hosts` ADD CONSTRAINT `incident_hosts_host_id_hosts_id_fk` FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `incident_detection_rules_rule_idx` ON `incident_detection_rules` (`detection_rule_id`);--> statement-breakpoint
CREATE INDEX `incident_hosts_host_idx` ON `incident_hosts` (`host_id`);