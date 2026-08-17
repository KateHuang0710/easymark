import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/notes-hook-fixture.html')
  await expect(page.getByTestId('loading')).toHaveText('false')
  await expect(page.getByRole('listitem')).toHaveText('Body')
})

for (const scenario of [
  { action: 'create', visible: 'Created', hidden: '' },
  { action: 'rename', visible: 'Renamed', hidden: 'Body' },
  { action: 'delete', visible: '', hidden: 'Body' },
]) {
  test(`${scenario.action} remains successful and optimistic when the follow-up list refresh fails`, async ({ page }) => {
    await page.getByRole('button', { name: scenario.action }).click()
    await expect(page.getByTestId('result')).toHaveText('success')
    await expect(page.getByTestId('list-error')).toContainText('simulated refresh failure')
    if (scenario.visible) await expect(page.locator('li').filter({ hasText: scenario.visible })).toHaveCount(1)
    if (scenario.hidden) await expect(page.locator('li').filter({ hasText: scenario.hidden })).toHaveCount(0)
    if (!scenario.visible) await expect(page.getByRole('listitem')).toHaveCount(0)
  })
}
