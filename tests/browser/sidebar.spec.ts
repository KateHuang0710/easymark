import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/sidebar-fixture.html')
  await expect(page.getByText('笔记', { exact: false }).first()).toBeVisible()
})

test('organizes notes with view filters without duplicating rows', async ({ page }) => {
  await expect(page.getByRole('listitem')).toHaveCount(4)
  await page.getByRole('button', { name: /已置顶/ }).click()
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByText('Project Plan')).toBeVisible()
  await page.getByRole('button', { name: /已收藏/ }).click()
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByText('Ideas')).toBeVisible()
})

test('searches, reports result count, and clears cleanly', async ({ page }) => {
  const search = page.getByRole('searchbox')
  await search.fill('meeting')
  await expect(page.locator('.sidebar-list-heading')).toHaveText(/搜索结果.*1/)
  await expect(page.locator('.sidebar-footer-text')).toHaveText('1 / 4 条笔记')
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await page.getByRole('button', { name: '清除搜索' }).click()
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
  await expect(page.getByRole('listitem')).toHaveCount(4)

  await search.fill('project')
  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
})

test('switches quick-access views with arrow, Home, and End keys', async ({ page }) => {
  const all = page.getByRole('button', { name: /^全部/ })
  await all.focus()
  await page.keyboard.press('ArrowRight')
  const recent = page.getByRole('button', { name: /^最近打开/ })
  await expect(recent).toBeFocused()
  await expect(recent).toHaveAttribute('aria-current', 'page')

  await page.keyboard.press('End')
  const pinned = page.getByRole('button', { name: /^已置顶/ })
  await expect(pinned).toBeFocused()
  await expect(pinned).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('listitem')).toHaveCount(1)

  await page.keyboard.press('Home')
  await expect(all).toBeFocused()
  await expect(all).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('listitem')).toHaveCount(4)
})

test('keeps row actions in a menu and supports rename and pin', async ({ page }) => {
  const row = page.getByRole('listitem').filter({ hasText: 'Meeting Notes' })
  await row.getByRole('button', { name: /更多操作/ }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.getByRole('menuitem', { name: '置顶' }).click()
  await expect(page.getByRole('button', { name: /已置顶/ })).toContainText('2')

  await row.getByRole('button', { name: /更多操作/ }).click()
  await page.getByRole('menuitem', { name: '重命名' }).click()
  const input = page.locator('input.sidebar-rename-input')
  await input.fill('Renamed Meeting')
  await input.press('Enter')
  await expect(page.getByText('Renamed Meeting')).toBeVisible()
})

test('keeps the top-row action menu clickable above following notes', async ({ page }) => {
  const row = page.getByRole('listitem').filter({ hasText: 'Project Plan' })
  await row.getByRole('button', { name: /更多操作/ }).click()

  const rename = page.getByRole('menuitem', { name: '重命名' })
  await expect(rename).toBeVisible()
  await rename.click()
  await expect(page.locator('input.sidebar-rename-input')).toHaveValue('Project Plan')
})

test('cancels the create-note input with Escape', async ({ page }) => {
  const createButton = page.getByRole('button', { name: '新建笔记' }).first()
  await createButton.click()
  const input = page.getByRole('textbox', { name: '笔记标题...' })
  await expect(input).toBeVisible()
  await expect(page.getByRole('button', { name: '创建笔记' })).toBeDisabled()
  await input.fill('temporary')
  await input.press('Escape')
  await expect(input).toHaveCount(0)
  await expect(page.getByText('temporary')).toHaveCount(0)
  await expect(createButton).toBeFocused()
})

test('supports safe keyboard actions on a focused note row', async ({ page }) => {
  const row = page.getByRole('listitem').filter({ hasText: 'Meeting Notes' })
  await row.focus()
  await page.keyboard.press('F2')
  await expect(page.locator('input.sidebar-rename-input')).toBeVisible()
  await page.keyboard.press('Escape')
  await row.focus()

  await page.keyboard.press('Backspace')
  await expect(page.getByRole('listitem')).toHaveCount(4)
  await page.keyboard.press('Delete')
  await expect(page.getByRole('listitem')).toHaveCount(3)
})

test('focuses sidebar search only when the shortcut originates inside the sidebar', async ({ page }) => {
  const row = page.getByRole('listitem').first()
  await row.focus()
  await page.keyboard.press('Control+K')
  await expect(page.getByRole('searchbox')).toBeFocused()
})


test('closes a row menu when filtering hides its note and does not reopen it later', async ({ page }) => {
  const row = page.getByRole('listitem').filter({ hasText: 'Meeting Notes' })
  await row.getByRole('button', { name: /更多操作/ }).click()
  await expect(page.getByRole('menu')).toBeVisible()

  await page.getByRole('searchbox').fill('project')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.getByRole('button', { name: '清除搜索' }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
})

test('serializes destructive operations and exposes pending state', async ({ page }) => {
  const meeting = page.getByRole('listitem').filter({ hasText: 'Meeting Notes' })
  await meeting.getByRole('button', { name: /更多操作/ }).click()
  await page.getByRole('menuitem', { name: '删除笔记' }).click()

  const sidebar = page.locator('.sidebar').first()
  await expect(sidebar).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('button', { name: '新建笔记' }).first()).toBeDisabled()
  await expect(page.getByTestId('delete-count')).toHaveText('1')

  const archive = page.getByRole('listitem').filter({ hasText: 'Archived Draft' })
  await archive.focus()
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('delete-count')).toHaveText('1')

  await expect(page.getByRole('listitem')).toHaveCount(3)
  await expect(sidebar).not.toHaveAttribute('aria-busy', 'true')
})

test('starting note creation cancels an unfinished rename without saving it', async ({ page }) => {
  const meeting = page.getByRole('listitem').filter({ hasText: 'Meeting Notes' })
  await meeting.focus()
  await page.keyboard.press('F2')
  const renameInput = page.locator('input.sidebar-rename-input')
  await renameInput.fill('Should Not Be Saved')

  await page.getByRole('button', { name: '新建笔记' }).first().click()
  const createInput = page.getByRole('textbox', { name: '笔记标题...' })
  await expect(createInput).toBeVisible()
  await createInput.press('Escape')

  await expect(page.getByText('Meeting Notes')).toBeVisible()
  await expect(page.getByText('Should Not Be Saved')).toHaveCount(0)
})

test('orders recently opened notes by last-opened time', async ({ page }) => {
  await page.getByRole('button', { name: /最近打开/ }).click()
  const rows = page.getByRole('listitem')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Project Plan')
  await expect(rows.nth(1)).toContainText('Ideas')
})


test('moves through notes with arrow keys and jumps to the list edges', async ({ page }) => {
  const rows = page.getByRole('listitem')
  await rows.nth(0).focus()
  await page.keyboard.press('ArrowDown')
  await expect(rows.nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(rows.nth(3)).toBeFocused()
  await page.keyboard.press('Home')
  await expect(rows.nth(0)).toBeFocused()
})


test('keeps notes available while creating and cancels when clicking elsewhere', async ({ page }) => {
  await page.getByRole('button', { name: '新建笔记' }).first().click()
  await expect(page.getByRole('textbox', { name: '笔记标题...' })).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(4)
  await page.getByRole('listitem').filter({ hasText: 'Ideas' }).click()
  await expect(page.getByRole('textbox', { name: '笔记标题...' })).toHaveCount(0)
  await expect(page.getByRole('listitem').filter({ hasText: 'Ideas' })).toBeVisible()
})

test('supports keyboard navigation and quick creation when the sidebar is collapsed', async ({ page }) => {
  await page.getByRole('button', { name: '折叠侧边栏' }).click()
  const collapsedItems = page.locator('.sidebar-collapsed-item')
  await expect(collapsedItems).toHaveCount(4)
  await collapsedItems.nth(0).focus()
  await page.keyboard.press('ArrowDown')
  await expect(collapsedItems.nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(collapsedItems.nth(3)).toBeFocused()
  await page.getByRole('button', { name: '新建笔记' }).click()
  await expect(page.getByRole('textbox', { name: '笔记标题...' })).toBeVisible()
})

test('supports Escape and arrow navigation inside the note action menu', async ({ page }) => {
  const row = page.getByRole('listitem').filter({ hasText: 'Meeting Notes' })
  const more = row.getByRole('button', { name: /更多操作/ })
  await more.click()
  const menuItems = page.getByRole('menuitem')
  await expect(menuItems.nth(0)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menuItems.nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(menuItems.last()).toBeFocused()
  await page.keyboard.press('Home')
  await expect(menuItems.first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(more).toBeFocused()
})

test('resizes the note sidebar with the keyboard and persists the chosen width', async ({ page }) => {
  const separator = page.getByRole('separator', { name: '调整侧边栏宽度' })
  await expect(separator).toHaveAttribute('aria-valuenow', '278')
  await separator.focus()
  await page.keyboard.press('ArrowRight')
  await expect(separator).toHaveAttribute('aria-valuenow', '290')
  await expect(page.locator('.sidebar').first()).toHaveCSS('width', '290px')

  const handle = await separator.boundingBox()
  expect(handle).not.toBeNull()
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 80)
  await page.mouse.down()
  await page.mouse.move(handle!.x + handle!.width / 2 + 24, handle!.y + 80)
  await page.mouse.up()
  await expect(separator).toHaveAttribute('aria-valuenow', '314')

  await page.reload()
  const restoredSeparator = page.getByRole('separator', { name: '调整侧边栏宽度' })
  await expect(restoredSeparator).toHaveAttribute('aria-valuenow', '314')
  await restoredSeparator.dblclick()
  await expect(restoredSeparator).toHaveAttribute('aria-valuenow', '278')
})
