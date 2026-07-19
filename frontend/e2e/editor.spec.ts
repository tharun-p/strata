import { expect, test } from '@playwright/test'

async function prepare(page: import('@playwright/test').Page) {
  page.on('console', (message) => console.log(`[browser:${message.type()}] ${message.text()}`))
  page.on('pageerror', (error) => console.log(`[browser:pageerror] ${error.message}`))
  await page.goto('/')
  const editor = page.locator('.cm-content')
  await expect(editor).toBeVisible()
  await page.waitForTimeout(250)
  const close = page.getByRole('button', { name: 'Close', exact: true })
  if (await close.isVisible().catch(() => false)) await close.click()
  return editor
}

test('selection remains text-only and query controls stay outside the editable document', async ({ page }) => {
  const editor = await prepare(page)
  const sql = 'SELECT customer_id FROM customers;\n\nSELECT order_id FROM orders;'
  await editor.fill(sql)
  await expect(page.locator('.sql-editor-shell')).toHaveAttribute('data-statement-count', '2')
  await expect(page.locator('.cm-query-control.full')).toHaveCount(2)

  await editor.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await expect(editor).toHaveText(sql.replace('\n\n', ''))
  await expect(page.locator('.cm-content .cm-query-control')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Run selection/ })).toBeVisible()

  await editor.click({ position: { x: 96, y: 54 } })
  await editor.dblclick({ position: { x: 96, y: 54 } })
  await expect(page.getByRole('button', { name: /Run selection/ })).toBeVisible()
})

test('worksheet content and Undo history remain isolated across immediate switches', async ({ page }) => {
  const editor = await prepare(page)
  await editor.fill('SELECT worksheet_one;')
  await page.getByRole('button', { name: 'New query' }).click()
  await editor.fill('SELECT worksheet_two;')
  await editor.press('End')
  await editor.press(' ')
  await editor.press('x')
  const tabs = page.locator('.query-tab')
  await tabs.nth(0).click()
  await expect(editor).toContainText('worksheet_one')
  await tabs.nth(1).click()
  await editor.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect(editor).toContainText('SELECT worksheet_two;')
  await expect(editor).not.toContainText('worksheet_one')
})

test('formatting uses an editor command and preserves keyboard editing', async ({ page }) => {
  const editor = await prepare(page)
  await editor.fill('select * from customers where id=1;')
  await page.getByRole('button', { name: 'Format' }).click()
  await expect(editor).toContainText('id = 1;')
  await editor.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect(editor).toHaveText('select * from customers where id=1;')
  await editor.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await expect(page.getByRole('button', { name: /Run selection/ })).toBeVisible()
})

test('200 open worksheets remain navigable', async ({ page }) => {
  await prepare(page)
  const add = page.getByRole('button', { name: 'New query' })
  for (let index = 1; index < 200; index += 1) await add.click()
  const tabs = page.locator('.query-tab')
  await expect(tabs).toHaveCount(200)
  await tabs.nth(0).click()
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await tabs.nth(199).click()
  await expect(tabs.nth(199)).toHaveAttribute('aria-selected', 'true')
})
