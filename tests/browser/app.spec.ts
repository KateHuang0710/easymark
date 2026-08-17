import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/app-fixture.html')
  await expect(page.getByRole('button', { name: '新建笔记' }).first()).toBeVisible()
})

test('loads the editor and opens the command palette on first use', async ({ page }) => {
  await page.getByText('Project Plan', { exact: true }).click()
  await expect(page.locator('.editor-content')).toBeVisible()
  await expect(page.locator('.editor-content')).toBeFocused()

  await page.keyboard.press('Control+P')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByPlaceholder('搜索笔记或输入命令…')).toBeFocused()
  await expect(page.locator('.editor-content')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.editor-content')).toBeVisible()
})

test('opens and closes settings without covering the editor', async ({ page }) => {
  await page.getByText('Project Plan', { exact: true }).click()
  await expect(page.locator('.editor-content')).toBeVisible()

  const settingsButton = page.getByRole('button', { name: '设置' })
  await settingsButton.click()
  const dialog = page.getByRole('dialog', { name: '设置' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '外观' })).toBeFocused()
  await expect(page.locator('.editor-content')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(settingsButton).toBeFocused()
  await expect(page.locator('.editor-content')).toBeVisible()
})

test('keeps the Markdown drop target stable across nested drag events', async ({ page }) => {
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File(['# Dragged note'], 'dragged.md', { type: 'text/markdown' }))
    const main = document.querySelector('.app-main')!
    window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }))
    main.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }))
    main.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer, relatedTarget: document.body }))
  })
  await expect(page.locator('.markdown-drop-overlay')).toBeVisible()

  await page.evaluate(() => {
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File(['# Dragged note'], 'dragged.md', { type: 'text/markdown' }))
    window.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer }))
  })
  await expect(page.locator('.markdown-drop-overlay')).toHaveCount(0)
})

test('clears the Markdown drop target when the platform stops reporting drag items', async ({ page }) => {
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File(['# Dragged note'], 'dragged.md', { type: 'text/markdown' }))
    window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }))
  })
  await expect(page.locator('.markdown-drop-overlay')).toBeVisible()

  await page.evaluate(() => {
    window.dispatchEvent(new DragEvent('dragleave', { bubbles: true }))
  })
  await expect(page.locator('.markdown-drop-overlay')).toHaveCount(0)
})

async function openNoteComparison(page: import('@playwright/test').Page) {
  await page.getByText('Project Plan', { exact: true }).click()
  await page.getByRole('button', { name: '与其他笔记对比' }).click()
  await expect(page.locator('.dual-pane')).toBeVisible()
}

test('opens a useful note comparison immediately and excludes the current note', async ({ page }) => {
  await openNoteComparison(page)

  await expect(page.getByText('当前笔记', { exact: true })).toBeVisible()
  await expect(page.locator('.dual-pane-title')).toHaveText('Project Plan')
  const comparisonPicker = page.getByRole('combobox', { name: '对比笔记' })
  await expect(comparisonPicker).toHaveValue('ideas.md')
  await expect(comparisonPicker.locator('option')).toHaveText(['Ideas', 'Meeting Notes'])
  await expect(page.locator('.editor-content')).toHaveCount(2)
  await expect(page.locator('.editor-content').nth(1)).toContainText('Ideas')
})

test('saves the previous comparison note before switching the right pane', async ({ page }) => {
  await openNoteComparison(page)

  const rightEditor = page.locator('.editor-content').nth(1)
  await rightEditor.fill('Revised comparison content')
  await page.getByRole('combobox', { name: '对比笔记' }).selectOption('meeting.md')

  await expect(page.getByRole('combobox', { name: '对比笔记' })).toHaveValue('meeting.md')
  await expect(page.locator('.editor-content').nth(1)).toContainText('Meeting Notes')
  await expect.poll(() => page.evaluate(() => {
    const state = (window as unknown as {
      __easymarkAppTest: { getSaveCalls: () => Array<{ filename: string; content: string }> }
    }).__easymarkAppTest
    return state.getSaveCalls().some(call => call.filename === 'ideas.md' && call.content.includes('Revised comparison content'))
  })).toBe(true)
})

test('clicking the compared note in the sidebar swaps panes instead of duplicating it', async ({ page }) => {
  await openNoteComparison(page)

  await page.locator('.sidebar-note').filter({ hasText: 'Ideas' }).click()

  await expect(page.locator('.dual-pane-title')).toHaveText('Ideas')
  await expect(page.getByRole('combobox', { name: '对比笔记' })).toHaveValue('project.md')
  await expect(page.locator('.editor-content').nth(0)).toContainText('Ideas')
  await expect(page.locator('.editor-content').nth(1)).toContainText('Project Plan')
})

test('resizes note comparison with pointer and keyboard and resets to equal width', async ({ page }) => {
  await openNoteComparison(page)

  const comparison = page.locator('.dual-pane')
  const divider = page.getByRole('separator', { name: '调整对比宽度' })
  await expect(comparison).toHaveAttribute('data-split', '50')

  await divider.focus()
  await page.keyboard.press('End')
  await expect(comparison).toHaveAttribute('data-split', '72')
  await page.keyboard.press('Home')
  await expect(comparison).toHaveAttribute('data-split', '28')
  await page.keyboard.press('Enter')
  await expect(comparison).toHaveAttribute('data-split', '50')

  const comparisonBox = await comparison.boundingBox()
  const dividerBox = await divider.boundingBox()
  expect(comparisonBox).not.toBeNull()
  expect(dividerBox).not.toBeNull()
  await page.mouse.move(dividerBox!.x + dividerBox!.width / 2, dividerBox!.y + dividerBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(comparisonBox!.x + comparisonBox!.width * 0.64, dividerBox!.y + dividerBox!.height / 2)
  await page.mouse.up()
  await expect.poll(async () => Number(await comparison.getAttribute('data-split'))).toBeGreaterThan(60)

  await divider.dblclick()
  await expect(comparison).toHaveAttribute('data-split', '50')
})

test('deleting the compared note exits cleanly and comparison can be opened again', async ({ page }) => {
  await openNoteComparison(page)

  await page.getByRole('button', { name: '更多操作: Ideas' }).click()
  await page.getByRole('menuitem', { name: '删除笔记' }).click()

  await expect(page.locator('.dual-pane')).toHaveCount(0)
  const compareButton = page.getByRole('button', { name: '与其他笔记对比' })
  await expect(compareButton).toBeEnabled()
  await compareButton.click()
  await expect(page.getByRole('combobox', { name: '对比笔记' })).toHaveValue('meeting.md')
})
