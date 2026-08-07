import { expect, test } from '@playwright/test'

async function selectContents(page: Parameters<typeof test>[0]['page'], selector: string) {
  await page.locator(selector).evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/editor-fixture.html')
  await expect(page.locator('.editor-wysiwyg')).toBeVisible()
})

test('uses Chromium undo and redo for ordinary text edits', async ({ page }) => {
  const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  const editor = page.locator('.editor-wysiwyg')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' changed')
  await expect(editor).toContainText('Body changed')
  await expect(page.locator('#markdown-output')).toContainText('Body changed')

  await page.keyboard.press(`${primaryModifier}+Z`)
  await expect(editor).toContainText('Body')
  await expect(editor).not.toContainText('changed')

  await page.keyboard.press(`${primaryModifier}+Y`)
  await expect(editor).toContainText('Body changed')
})

test('keeps Enter and Shift+Enter behavior inside lists', async ({ page }) => {
  const editor = page.locator('.editor-wysiwyg')
  await selectContents(page, '.editor-wysiwyg p')
  await page.getByTitle(/无序列表/).click()
  await expect(editor.locator('ul > li')).toHaveCount(1)

  await editor.locator('li').first().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(editor.locator('ul > li')).toHaveCount(2)

  await editor.locator('li').last().click()
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('continuation')
  await expect(editor.locator('ul > li')).toHaveCount(2)
  await expect(editor.locator('ul > li').last()).toContainText('continuation')
  await expect(page.locator('#markdown-output')).toContainText('continuation')
})

test('creates a code block, changes its language, and exits cleanly', async ({ page }) => {
  const editor = page.locator('.editor-wysiwyg')
  await selectContents(page, '.editor-wysiwyg p')
  await page.getByTitle(/代码块 \/ 在代码块内点击可退出/).click()
  await expect(editor.locator('pre code')).toContainText('Body')

  await editor.locator('code').click()
  await page.getByTitle('代码块语言').click()
  await page.locator('.lang-picker-item', { hasText: 'python' }).click()
  await expect(editor.locator('pre')).toHaveAttribute('data-lang', 'python')
  await expect(page.locator('#markdown-output')).toContainText('```python')

  await page.keyboard.press('Control+Enter')
  await expect(editor.locator('.code-block-wrapper + p')).toHaveCount(1)
  await page.keyboard.type('After code')
  await expect(editor.locator('.code-block-wrapper + p')).toHaveText('After code')
  await expect(page.locator('#markdown-output')).toContainText('After code')
})

test('inserts and edits a visual table with Tab navigation', async ({ page }) => {
  await page.locator('.editor-wysiwyg p').click()
  await page.getByTitle('插入可视化表格').click()
  const editor = page.locator('.editor-wysiwyg')
  await expect(editor.locator('table thead th')).toHaveCount(3)
  await expect(editor.locator('table tbody td')).toHaveCount(6)

  await editor.locator('table tbody td').first().click()
  await expect(page.locator('.table-visual-tools')).toBeVisible()
  await expect(page.getByTitle('在下方添加一行')).toBeVisible()
  await page.getByTitle('在下方添加一行').click()
  await expect(editor.locator('table tbody tr')).toHaveCount(3)

  await editor.locator('table tbody td').first().click()
  await page.keyboard.press('Tab')
  await expect(page.getByTitle('按当前列升序排序')).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    const element = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement
    return element?.closest('td,th')?.cellIndex ?? -1
  })).toBe(1)
})
