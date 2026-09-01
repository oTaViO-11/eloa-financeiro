CREATE TABLE `card_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`paid_at` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_payments_user_idempotency_unique` ON `card_payments` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`limit_cents` integer NOT NULL,
	`closing_day` integer NOT NULL,
	`due_day` integer NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_user_name_unique` ON `cards` (`user_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `cards_user_idx` ON `cards` (`user_id`);--> statement-breakpoint
CREATE TABLE `conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`source_message_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_message_source_unique` ON `conversation_messages` (`user_id`,`source`,`source_message_id`,`role`);--> statement-breakpoint
CREATE INDEX `conversation_messages_user_idx` ON `conversation_messages` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `conversation_sessions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'idle' NOT NULL,
	`pending_action_json` text,
	`expires_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `financial_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_id` text,
	`input_json` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `financial_analyses_user_idx` ON `financial_analyses` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `installments` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`card_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`paid_cents` integer DEFAULT 0 NOT NULL,
	`due_date` text NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installments_purchase_sequence_unique` ON `installments` (`purchase_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `installments_card_due_idx` ON `installments` (`card_id`,`due_date`,`id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`whatsapp_number` text,
	`monthly_income_cents` integer DEFAULT 0 NOT NULL,
	`fixed_expenses_cents` integer DEFAULT 0 NOT NULL,
	`savings_goal_cents` integer DEFAULT 0 NOT NULL,
	`monthly_budget_cents` integer DEFAULT 0 NOT NULL,
	`alert_credit_utilization_percent` integer DEFAULT 80 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_whatsapp_number_unique` ON `profiles` (`whatsapp_number`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`description` text NOT NULL,
	`merchant` text,
	`location` text,
	`category` text DEFAULT 'outros' NOT NULL,
	`total_cents` integer NOT NULL,
	`payment_method` text NOT NULL,
	`installments_count` integer DEFAULT 1 NOT NULL,
	`card_id` text,
	`purchased_at` text NOT NULL,
	`source` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_user_idempotency_unique` ON `purchases` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `purchases_user_date_idx` ON `purchases` (`user_id`,`purchased_at`,`id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`provider_message_id` text PRIMARY KEY NOT NULL,
	`wa_id` text NOT NULL,
	`event_json` text NOT NULL,
	`processed_at` text NOT NULL,
	`response_text` text
);
