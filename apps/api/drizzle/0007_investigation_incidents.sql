CREATE TABLE `investigation_incidents` (
	`investigation_id` char(36) NOT NULL,
	`incident_id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `investigation_incidents_pk` PRIMARY KEY(`investigation_id`,`incident_id`)
);
--> statement-breakpoint
ALTER TABLE `investigation_incidents` ADD CONSTRAINT `investigation_incidents_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigation_incidents` ADD CONSTRAINT `investigation_incidents_incident_id_incidents_id_fk` FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `investigation_incidents_incident_idx` ON `investigation_incidents` (`incident_id`);