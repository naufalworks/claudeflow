#!/usr/bin/env node

/**
 * Add test usage data to see credits in dashboard
 */

import { saveRequestUsage } from './dist/lib/usageDb.js';

async function addTestUsage() {
  console.log('Adding test usage data...\n');

  // Add usage for first account
  await saveRequestUsage({
    accountId: 'kiro-7e045cfb9791d6e8',
    model: 'claude-sonnet-4',
    region: 'us-east-1',
    tokens: {
      input_tokens: 5000,
      output_tokens: 2000,
    },
    status: 'success',
  });
  console.log('✓ Added usage for kiro-7e045cfb9791d6e8: 7,000 tokens (~$0.11)');

  // Add more usage for first account
  await saveRequestUsage({
    accountId: 'kiro-7e045cfb9791d6e8',
    model: 'claude-sonnet-4',
    region: 'us-east-1',
    tokens: {
      input_tokens: 10000,
      output_tokens: 5000,
    },
    status: 'success',
  });
  console.log('✓ Added usage for kiro-7e045cfb9791d6e8: 15,000 tokens (~$0.23)');

  // Add usage for second account
  await saveRequestUsage({
    accountId: 'kiro-afb68e572f11e89e',
    model: 'claude-sonnet-4',
    region: 'us-east-1',
    tokens: {
      input_tokens: 8000,
      output_tokens: 3000,
    },
    status: 'success',
  });
  console.log('✓ Added usage for kiro-afb68e572f11e89e: 11,000 tokens (~$0.17)');

  console.log('\n✅ Test usage data added!');
  console.log('\nNow run: ./dist/cli/bin/claudeflow.js dashboard');
  console.log('You should see credits displayed for each account.\n');
}

addTestUsage().catch(console.error);
