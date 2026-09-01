PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_conversation_sessions` (
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`state` text DEFAULT 'idle' NOT NULL,
	`pending_action_json` text,
	`expires_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `source`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `conversation_sessions`;--> statement-breakpoint
ALTER TABLE `__new_conversation_sessions` RENAME TO `conversation_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
