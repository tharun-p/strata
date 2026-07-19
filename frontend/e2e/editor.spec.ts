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
  await expect(page.locator('.cm-query-control-widget')).toHaveCount(2)
  await expect(page.locator('.cm-query-controls-layer .cm-query-control.full')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Run selection/ })).toBeVisible()

  await editor.click({ position: { x: 96, y: 54 } })
  await editor.dblclick({ position: { x: 96, y: 54 } })
  await expect(page.getByRole('button', { name: /Run selection/ })).toBeVisible()
})

test('typing keeps statement bands and query controls stable while indexing catches up', async ({ page }) => {
  const editor = await prepare(page)
  await editor.fill('SELECT customer_id FROM customers;\n\nS')
  await expect(page.locator('.sql-editor-shell')).toHaveAttribute('data-statement-count', '2')
  await expect(page.locator('.cm-query-control.full')).toHaveCount(2)
  await expect(page.locator('.cm-query-control.full').nth(1)).toContainText('Query 2')
  await expect(page.locator('.run-query span')).toHaveText('Run Query 2')

  await page.evaluate(() => {
    const control = document.querySelectorAll<HTMLElement>('.cm-query-control.full')[1]
    const toolbarLabel = document.querySelector<HTMLElement>('.run-query span')
    const editorRoot = document.querySelector('.cm-editor')
    if (!control || !toolbarLabel || !editorRoot) throw new Error('statement controls were not ready')
    const state: {
      control: HTMLElement
      toolbarLabel: HTMLElement
      controlMutations: number
      toolbarLabelMutations: number
      detached: boolean
      missingControls: boolean
      top: number
      observer?: MutationObserver
    } = {
      control,
      toolbarLabel,
      controlMutations: 0,
      toolbarLabelMutations: 0,
      detached: false,
      missingControls: false,
      top: control.getBoundingClientRect().top,
    }
    const observer = new MutationObserver((mutations) => {
      state.detached ||= !state.control.isConnected
      state.missingControls ||= document.querySelectorAll('.cm-query-control.full').length < 2
      state.controlMutations += mutations.filter((mutation) => (
        mutation.target === state.control
        || state.control.contains(mutation.target)
      )).length
      state.toolbarLabelMutations += mutations.filter((mutation) => (
        mutation.target === state.toolbarLabel
        || state.toolbarLabel.contains(mutation.target)
      )).length
    })
    observer.observe(document.querySelector('main') ?? editorRoot, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    })
    state.observer = observer
    ;(window as unknown as { __strataTypingStability: typeof state }).__strataTypingStability = state
  })

  await editor.press('End')
  await page.keyboard.type('ELECT order_id FROM orders', { delay: 16 })
  await expect(page.locator('.sql-editor-shell')).toHaveAttribute('data-statement-count', '2')
  await expect(page.locator('.cm-query-control.full')).toHaveCount(2)
  await expect(page.locator('.cm-query-control.full').nth(1)).toContainText('Query 2')
  await expect(page.locator('.run-query span')).toHaveText('Run Query 2')

  const stability = await page.evaluate(() => {
    const state = (window as unknown as {
      __strataTypingStability: {
        control: HTMLElement
        toolbarLabel: HTMLElement
        controlMutations: number
        toolbarLabelMutations: number
        detached: boolean
        missingControls: boolean
        top: number
        observer: MutationObserver
      }
    }).__strataTypingStability
    state.observer?.disconnect()
    const current = document.querySelectorAll<HTMLElement>('.cm-query-control.full')[1]
    const currentToolbarLabel = document.querySelector<HTMLElement>('.run-query span')
    return {
      detached: state.detached,
      controlMutations: state.controlMutations,
      toolbarLabelMutations: state.toolbarLabelMutations,
      missingControls: state.missingControls,
      sameControl: current === state.control,
      sameToolbarLabel: currentToolbarLabel === state.toolbarLabel,
      verticalShift: current ? Math.abs(current.getBoundingClientRect().top - state.top) : Number.POSITIVE_INFINITY,
    }
  })
  expect(stability).toEqual({
    detached: false,
    controlMutations: 0,
    toolbarLabelMutations: 0,
    missingControls: false,
    sameControl: true,
    sameToolbarLabel: true,
    verticalShift: 0,
  })
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
  await expect(editor.locator('.cm-line')).toHaveText('select * from customers where id=1;')
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
