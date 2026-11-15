CREATE TABLE `rate_limit_counters` (
	`scope` varchar(32) NOT NULL,
	`subject_hash` char(64) NOT NULL,
	`hits` int unsigned NOT NULL,
	`window_expires_at` datetime(3) NOT NULL,
	CONSTRAINT `rate_limit_counters_pk` PRIMARY KEY(`scope`,`subject_hash`)
);
--> statement-breakpoint
CREATE INDEX `rate_limit_counters_expiry_idx` ON `rate_limit_counters` (`window_expires_at`);