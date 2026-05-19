import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Set localStorage to skip onboarding tour
  await page.goto('http://localhost:3001');
  await page.evaluate(() => {
    localStorage.setItem('claudeflow_onboarding_completed', 'true');
  });

  await browser.close();
}

export default globalSetup;
