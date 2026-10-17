import { test, expect } from '@playwright/test';

test('navigation isolates the form and supports keyboard dismissal and focus wrapping', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const navigation = page.getByRole('navigation', { name: 'Site navigation' });
  await expect(navigation.getByRole('link', { name: 'Gateway Withdraw', exact: true })).toHaveAttribute('href', 'https://tools.traversa.dev/gateway');
  await expect(page.locator('main')).toHaveJSProperty('inert', true);
  await navigation.getByRole('link', { name: 'Twitter', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Toggle color theme' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(navigation.getByRole('link', { name: 'Twitter', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(navigation).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await expect(page.locator('main')).toHaveJSProperty('inert', false);
});

test('theme follows the saved preference, survives reload, and syncs across tabs', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const other = await context.newPage();
  await other.goto('./');
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('mobile layout fits the viewport and keeps the entire navigation reachable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('./');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeInViewport();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const lastTool = page.getByRole('navigation').getByRole('link', { name: 'Historical Tor Data' });
  await lastTool.scrollIntoViewIfNeeded();
  await expect(lastTool).toBeInViewport();
  const box = await lastTool.boundingBox();
  expect(box!.y + box!.height).toBeLessThan(620);
});
