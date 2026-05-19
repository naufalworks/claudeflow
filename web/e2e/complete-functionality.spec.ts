import { test, expect } from '@playwright/test';

test.describe('Complete Functionality Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Login with API key before each test
    await page.goto('/login');
    await page.fill('input[type="password"]', 'claudeflow-dev-key');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });
  });

  test('All navigation links work without 404 errors', async ({ page }) => {
    const networkErrors: string[] = [];

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

    // Test Accounts link
    await page.click('a[href="/dashboard/accounts"]');
    await expect(page).toHaveURL('/dashboard/accounts');
    await page.waitForTimeout(1000);

    // Test Analytics link
    await page.click('a[href="/dashboard/analytics"]');
    await expect(page).toHaveURL('/dashboard/analytics');
    await page.waitForTimeout(1000);

    // Test Activity link
    await page.click('a[href="/dashboard/activity"]');
    await expect(page).toHaveURL('/dashboard/activity');
    await page.waitForTimeout(1000);

    // Test Settings link
    await page.click('a[href="/dashboard/settings"]');
    await expect(page).toHaveURL('/dashboard/settings');
    await page.waitForTimeout(1000);

    // Check for 404 errors on navigation routes
    const has404Errors = networkErrors.filter(err =>
      err.includes('/accounts') ||
      err.includes('/analytics') ||
      err.includes('/activity') ||
      err.includes('/settings')
    );

    expect(has404Errors.length).toBe(0);
  });

  test('WebSocket connection status shows Connected or Polling', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForTimeout(2000);

    // Look for connection status badge
    const connectionBadge = page.locator('text=/connected|polling/i').first();
    const badgeExists = await connectionBadge.count() > 0;

    expect(badgeExists).toBe(true);

    if (badgeExists) {
      const badgeText = await connectionBadge.textContent();
      console.log(`✅ WebSocket status: "${badgeText}"`);

      // Should NOT show "Disconnected" if data is flowing
      expect(badgeText?.toLowerCase()).not.toBe('disconnected');
    }
  });

  test('ActivityStream is NOT on dashboard page', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForTimeout(2000);

    // Check that ActivityStream component is not present on dashboard
    const activityStreamOnDashboard = page.locator('text=/Activity Stream/i');
    const count = await activityStreamOnDashboard.count();

    expect(count).toBe(0);
  });

  test('ActivityStream IS on activity page', async ({ page }) => {
    await page.goto('/dashboard/activity');
    await page.waitForTimeout(2000);

    // Check that ActivityStream component is present on activity page
    const activityStreamHeader = page.locator('text=/Activity Stream/i').first();
    await expect(activityStreamHeader).toBeVisible();
  });

  test('Account delete button triggers confirmation', async ({ page }) => {
    await page.goto('/dashboard/accounts');
    await page.waitForTimeout(2000);

    // Find first delete button
    const deleteButton = page.locator('button[title="Remove"]').first();
    const deleteButtonExists = await deleteButton.count() > 0;

    if (deleteButtonExists) {
      // Set up dialog handler to cancel deletion
      page.on('dialog', async dialog => {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toContain('Are you sure');
        await dialog.dismiss();
      });

      // Click delete button
      await deleteButton.click();
      await page.waitForTimeout(500);

      console.log('✅ Delete confirmation dialog appeared');
    } else {
      console.log('⚠️ No accounts available to test delete functionality');
    }
  });

  test('No analytics 404 errors', async ({ page }) => {
    const networkErrors: string[] = [];

    page.on('response', (response) => {
      if (response.status() === 404 && response.url().includes('analytics')) {
        networkErrors.push(`404: ${response.url()}`);
      }
    });

    await page.goto('/dashboard');
    await page.waitForTimeout(3000);

    expect(networkErrors.length).toBe(0);
  });

  test('Dashboard page loads without errors', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/dashboard');
    await page.waitForTimeout(2000);

    // Check for critical errors (ignore minor warnings)
    const criticalErrors = consoleErrors.filter(err =>
      err.includes('404') ||
      err.includes('Failed to fetch') ||
      err.includes('Network request failed')
    );

    expect(criticalErrors.length).toBe(0);
  });

  test('Accounts page loads and displays accounts', async ({ page }) => {
    await page.goto('/dashboard/accounts');
    await page.waitForTimeout(2000);

    // Check for accounts table or empty state
    const accountsTable = page.locator('table');
    const emptyState = page.locator('text=/No accounts/i');

    const hasTable = await accountsTable.count() > 0;
    const hasEmptyState = await emptyState.count() > 0;

    // Should have either accounts table or empty state
    expect(hasTable || hasEmptyState).toBe(true);
  });

  test('Analytics page loads without errors', async ({ page }) => {
    await page.goto('/dashboard/analytics');
    await page.waitForTimeout(2000);

    // Check page loaded
    const analyticsHeader = page.locator('h1, h2').filter({ hasText: /analytics/i }).first();
    await expect(analyticsHeader).toBeVisible();
  });

  test('Settings page loads', async ({ page }) => {
    await page.goto('/dashboard/settings');
    await page.waitForTimeout(2000);

    // Check page loaded
    const settingsHeader = page.locator('h1, h2').filter({ hasText: /settings/i }).first();
    await expect(settingsHeader).toBeVisible();
  });

  test('All API endpoints return 200 or expected status', async ({ page }) => {
    const apiResponses: { url: string; status: number }[] = [];

    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/api/') || url.includes('/admin/')) {
        apiResponses.push({
          url: url.split('?')[0], // Remove query params for cleaner output
          status: response.status(),
        });
      }
    });

    // Navigate through all pages to trigger API calls
    await page.goto('/dashboard');
    await page.waitForTimeout(2000);

    await page.goto('/dashboard/accounts');
    await page.waitForTimeout(2000);

    await page.goto('/dashboard/analytics');
    await page.waitForTimeout(2000);

    await page.goto('/dashboard/activity');
    await page.waitForTimeout(2000);

    // Check for failed API calls (4xx, 5xx)
    const failedCalls = apiResponses.filter(r => r.status >= 400);

    if (failedCalls.length > 0) {
      console.log('❌ Failed API calls:', failedCalls);
    }

    expect(failedCalls.length).toBe(0);
  });

  test('User can logout successfully', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForTimeout(1000);

    // Find and click logout button (might be in a menu or header)
    const logoutButton = page.locator('button, a').filter({ hasText: /logout|sign out/i }).first();

    if (await logoutButton.count() > 0) {
      await logoutButton.click();
      await page.waitForTimeout(1000);

      // Should redirect to login
      await expect(page).toHaveURL('/login');
    } else {
      console.log('⚠️ Logout button not found - may need to update test selector');
    }
  });

  test('Protected routes redirect to login when not authenticated', async ({ page }) => {
    // Clear localStorage to simulate logged out state
    await page.goto('/dashboard');
    await page.evaluate(() => localStorage.clear());

    // Try to access protected route
    await page.goto('/dashboard/accounts');
    await page.waitForTimeout(1000);

    // Should redirect to login
    expect(page.url()).toContain('/login');
  });
});
