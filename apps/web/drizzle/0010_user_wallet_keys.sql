-- Add private key and smart account columns to users table
-- for real keypair generation (demo users get real wallets)
ALTER TABLE `users` ADD COLUMN `private_key` text;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `smart_account_address` text;
