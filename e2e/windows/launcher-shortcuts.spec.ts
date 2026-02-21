import { test, expect, _electron as electron } from '@playwright/test';
const appPath = process.cwd();

test.describe('Windows launcher smoke', () => {
  test.skip(process.platform !== 'win32', 'Windows-only smoke suite');

  test('shows Ctrl-based actions shortcut in launcher footer', async () => {
    const electronApp = await electron.launch({
      args: [appPath],
      env: {
        ...process.env,
        NODE_ENV: 'development',
      },
    });

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');

      const onboardingVisible = await window.getByText('Get Started').count();
      test.skip(onboardingVisible > 0, 'Onboarding is active; run after onboarding completes once.');

      const searchInput = window.locator('input[placeholder="Search apps and settings..."]');
      await expect(searchInput).toBeVisible();

      await searchInput.click();
      await searchInput.press('Control+K');

      await expect(window.getByText('Actions')).toBeVisible();
      await expect(window.locator('kbd', { hasText: 'Ctrl' }).first()).toBeVisible();
      await expect(window.locator('kbd', { hasText: '⌘' })).toHaveCount(0);
    } finally {
      await electronApp.close();
    }
  });

  test('opens actions overlay with Ctrl+K and shows Open Command row', async () => {
    const electronApp = await electron.launch({
      args: [appPath],
      env: {
        ...process.env,
        NODE_ENV: 'development',
      },
    });

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');

      const onboardingVisible = await window.getByText('Get Started').count();
      test.skip(onboardingVisible > 0, 'Onboarding is active; run after onboarding completes once.');

      const searchInput = window.locator('input[placeholder="Search apps and settings..."]');
      await expect(searchInput).toBeVisible();
      await searchInput.click();
      await searchInput.press('Control+K');

      await expect(window.getByText('Open Command')).toBeVisible();
    } finally {
      await electronApp.close();
    }
  });
});
