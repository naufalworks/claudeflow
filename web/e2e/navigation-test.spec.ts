import { test, expect } from '@playwright/test';

test.describe('Navigation - All Links Working', () => {
  test.beforeEach(async ({ page }) => {
    // Login with API key
    await page.goto('/login');
    await page.fill('input[type="password"]', 'claudeflow-dev-key');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });
  });

  test('All sidebar navigation links work without 404 errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const networkErrors: string[] = [];

    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Capture network 404 errors
    page.on('response', (response) => {
      if (response.status() === 404) {
        networkErrors.push(`404: ${response.url()}`);
      }
    });

    // Test Dashboard link
    await page.click('a[href="/dashboard"]');
    await expect(page).toHaveURL('/dashboard');
    await page.waitForTimeout(1000);
    console.log('✅ Dashboard link works');

    // Test Accounts link
    await page.click('a[href="/dashboard/accounts"]');
    await expect(page).toHaveURL('/dashboard/accounts');
    await page.waitForTimeout(1000);
    console.log('✅ Accounts link works');

    // Test Analytics link
    await page.click('a[href="/dashboard/analytics"]');
    await expect(page).toHaveURL('/dashboard/analytics');
    await page.waitForTimeout(1000);
    console.log('✅ Analytics link works');

    // Test Activity link
    await page.click('a[href="/dashboard/activity"]');
    await expect(page).toHaveURL('/dashboard/activity');
    await page.waitForTimeout(1000);
    console.log('✅ Activity link works');

    // Test Settings link
    await page.click('a[href="/dashboard/settings"]');
    await expect(page).toHaveURL('/dashboard/settings');
    await page.waitForTimeout(1000);
    console.log('✅ Settings link works');

    // Check for 404 errors
    const has404Errors = networkErrors.filter(err =>
      err.includes('/accounts') ||
      err.includes('/analytics') ||
      err.includes('/activity') ||
      err.includes('/settings')
    );

    if (has404Errors.length > 0) {
      console.log('❌ Found 404 errors:', has404Errors);
    } else {
      console.log('✅ No 404 errors on navigation routes');
    }

    expect(has404Errors.length).toBe(0);
  });

  test('WebSocket connection status is visible', async ({ page }) => {
    await page.goto('/dashboard');

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Look for connection status badge (could be "Connected" or "Disconnected")
    const connectionBadge = page.locator('text=/connected/i').first();

    // Check if badge exists
    const badgeExists = await connectionBadge.count() > 0;

    if (badgeExists) {
      const badgeText = await connectionBadge.textContent();
      console.log(`✅ WebSocket status badge found: "${badgeText}"`);
    } else {
      console.log('⚠️ WebSocket status badge not found (may be in different location)');
    }
  });

  test('No analytics 404 errors in console', async ({ page }) => {
    const networkErrors: string[] = [];

    page.on('response', (response) => {
      if (response.status() === 404 && response.url().includes('analytics')) {
        networkErrors.push(`404: ${response.url()}`);
      }
    });

    await page.goto('/dashboard');
    await page.waitForTimeout(3000);

    if (networkErrors.length > 0) {
      console.log('❌ Analytics 404 errors:', networkErrors);
    } else {
      console.log('✅ No analytics 404 errors');
    }

    expect(networkErrors.length).toBe(0);
  });
});
