#!/usr/bin/env node
/**
 * Database Initialization Script
 * Runs migrations on app startup
 * Called by Docker entrypoint before starting the server
 */

import { runMigrations, printMigrationStatus } from '../apps/api/services/migration-service';

async function main() {
  try {
    console.log('='.repeat(50));
    console.log('DATABASE INITIALIZATION');
    console.log('='.repeat(50));

    // Run migrations
    await runMigrations();

    // Print status
    await printMigrationStatus();

    console.log('✓ Database initialization complete');
    process.exit(0);
  } catch (error) {
    console.error('✗ Database initialization failed:', error);
    process.exit(1);
  }
}

main();
