import { expect, test, type Page } from '@playwright/test'

async function signInCustomer(page: Page) {
  await page.goto('/')
  await page.getByLabel('Mobile number').fill('4165550182')
  await page.getByRole('button', { name: "I'm not a robot" }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  for (const [index, digit] of ['2', '4', '6', '8'].entries()) {
    await page.getByLabel(`Digit ${index + 1}`).fill(digit)
  }
  await expect(page.getByText('Welcome back, Jamie')).toBeVisible()
}

async function unlockStaff(page: Page) {
  await page.goto('/staff')
  for (const [index, digit] of ['4', '8', '2', '6'].entries()) {
    await page.getByLabel(`PIN digit ${index + 1}`).fill(digit)
  }
  await expect(page.getByText('Luxe Hair Studio').first()).toBeVisible()
}

async function unlockOwner(page: Page, tenant = 'juniper', pin = '7391') {
  await page.goto(`/admin?tenant=${tenant}`)
  for (const [index, digit] of pin.split('').entries()) {
    await page.getByLabel(`Owner PIN digit ${index + 1}`).fill(digit)
  }
  await expect(page.getByRole('heading', { name: 'Good afternoon.' })).toBeVisible()
}

test('customer signs in, opens identifier, and creates a redemption code', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInCustomer(page)
  await expect(page.getByText('6/8')).toBeVisible()
  await expect(page.getByRole('button', { name: /Add to Google Wallet/ })).toBeHidden()
  await expect(page.getByRole('button', { name: /Gallery/ })).toBeHidden()
  await page.getByRole('button', { name: 'Info', exact: true }).first().click()
  await expect(page.getByText('128 Ossington Avenue')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Opening hours' })).toBeVisible()
  await page.screenshot({ path: 'test-results/customer-info-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Perks & Rewards' }).click()
  await page.screenshot({ path: 'test-results/customer-wallet-mobile.png', fullPage: true })

  await page.getByRole('button', { name: 'Show member QR code' }).click()
  await expect(page.getByText('Hold your screen steady')).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()

  const productReward = page.locator('article').filter({ hasText: 'Complimentary Scalp Treatment' })
  await productReward.getByRole('button', { name: 'Redeem' }).click()
  await page.getByRole('button', { name: 'Use 5 stamps' }).click()
  await expect(page.getByText('Ask your cashier to scan this code')).toBeVisible()
  await expect(page.getByText(/Expires in/)).toBeVisible()
  await page.screenshot({ path: 'test-results/customer-redemption-mobile.png' })
})

test('staff unlocks, finds a customer, confirms a visit, and sees the audit entry', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 })
  await unlockStaff(page)
  await page.getByRole('button', { name: /Search/ }).click()
  await page.getByPlaceholder('Name or phone number').fill('Jamie')
  await page.getByRole('button', { name: /Jamie Chen/ }).click()
  await expect(page.getByRole('heading', { name: 'Jamie Chen' })).toBeVisible()
  await page.screenshot({ path: 'test-results/staff-action-tablet.png' })
  await page.getByRole('button', { name: 'Confirm +1 stamp' }).click()
  await expect(page.getByText('Transaction confirmed')).toBeVisible()
  await expect(page.getByText('Transaction confirmed')).toBeHidden({ timeout: 2_000 })

  await page.getByRole('button', { name: /Activity/ }).click()
  await expect(page.getByRole('heading', { name: 'Transaction log' })).toBeVisible()
  await expect(page.locator('.audit-row').filter({ hasText: 'Jamie Chen' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Undo/ }).first()).toBeVisible()
})

test('scan transactions debounce for 30 seconds and undo restores the balance', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { loyaltyStore } = await import('/src/lib/store.ts')
    const before = loyaltyStore.getSnapshot().profiles.find((profile) => profile.id === 'customer-amira')!.stamps
    const transaction = loyaltyStore.confirmTransaction({
      staffId: 'staff-maya',
      customerId: 'customer-amira',
      kind: 'visit',
      source: 'scan',
    })
    let duplicateMessage = ''
    try {
      loyaltyStore.confirmTransaction({
        staffId: 'staff-maya',
        customerId: 'customer-amira',
        kind: 'visit',
        source: 'scan',
      })
    } catch (error) {
      duplicateMessage = error instanceof Error ? error.message : ''
    }
    const undo = loyaltyStore.undoTransaction(transaction.id, 'staff-maya')
    const after = loyaltyStore.getSnapshot().profiles.find((profile) => profile.id === 'customer-amira')!.stamps
    return { before, after, duplicateMessage, reversesId: undo.reversesId }
  })

  expect(result.after).toBe(result.before)
  expect(result.duplicateMessage).toContain('Already scanned')
  expect(result.reversesId).toBeTruthy()
})

test('owner manages rewards, staff access, and customer balances', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await unlockOwner(page)
  await page.screenshot({ path: 'test-results/owner-overview-desktop.png', fullPage: true })

  await page.getByRole('button', { name: 'Rewards' }).click()
  await page.getByRole('button', { name: 'Add reward' }).click()
  await page.getByLabel('Reward name').fill('Express Treatment')
  await page.getByLabel('Description').fill('A quick restorative add-on.')
  await page.getByLabel('Stamp cost').fill('3')
  await page.getByRole('button', { name: 'Add reward' }).last().click()
  await expect(page.getByText('Express Treatment')).toBeVisible()

  await page.getByRole('button', { name: 'Staff' }).click()
  await page.getByRole('button', { name: 'Add staff' }).click()
  await page.getByLabel('First name').fill('Jordan')
  await page.getByLabel('Last name').fill('Bell')
  await page.getByLabel('4-digit access PIN').fill('5512')
  await page.getByRole('button', { name: 'Save staff access' }).click()
  await expect(page.getByText('Jordan Bell')).toBeVisible()

  await page.getByRole('button', { name: 'Customers' }).click()
  await page.getByPlaceholder('Search by name or phone').fill('Jamie')
  await page.getByRole('button', { name: /Jamie Chen/ }).click()
  const before = await page.locator('.profile-balances > div').filter({ hasText: 'Stamps' }).locator('strong').textContent()
  await page.getByLabel('Adjustment amount').fill('2')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('.profile-balances > div').filter({ hasText: 'Stamps' }).locator('strong')).toHaveText(String(Number(before) + 2))
})

test('tenant query isolates customer and owner data', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await unlockOwner(page, 'northline', '8642')
  await expect(page.locator('.owner-mobile-header').getByText('Northline Goods')).toBeVisible()
  await page.getByRole('button', { name: 'Customers' }).click()
  await expect(page.getByText('Nora Singh')).toBeVisible()
  await expect(page.getByText('Jamie Chen')).toBeHidden()
  await page.screenshot({ path: 'test-results/owner-customers-mobile.png', fullPage: true })
})

test('OTP requests are capped and identifier tokens rotate', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { loyaltyStore } = await import('/src/lib/store.ts')
    const phone = '+14165550999'
    loyaltyStore.requestOtp(phone, 'verified')
    loyaltyStore.requestOtp(phone, 'verified')
    loyaltyStore.requestOtp(phone, 'verified')
    let rateLimitMessage = ''
    try { loyaltyStore.requestOtp(phone, 'verified') } catch (error) { rateLimitMessage = error instanceof Error ? error.message : '' }
    const now = Date.now()
    const first = loyaltyStore.customerPayload('customer-jamie', now)
    const rotated = loyaltyStore.customerPayload('customer-jamie', now + 60_000)
    return { rateLimitMessage, first, rotated, firstValid: Boolean(loyaltyStore.parsePayload(first)) }
  })
  expect(result.rateLimitMessage).toContain('Too many codes')
  expect(result.first).not.toBe(result.rotated)
  expect(result.firstValid).toBe(true)
})

test('unknown tenant links expose no default-tenant data', async ({ page }) => {
  await page.goto('/?tenant=missing-business')
  await expect(page.getByText('Business unavailable')).toBeVisible()
  await expect(page.getByText('Luxe Hair Studio')).toBeHidden()
  await page.getByLabel('Mobile number').fill('4165550182')
  await page.getByRole('button', { name: "I'm not a robot" }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('This business link is invalid or no longer active.')).toBeVisible()
})

test('admin login appears after customer sign-out', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInCustomer(page)
  await expect(page.locator('.salon-bottom-nav button')).toHaveCount(2)
  await expect(page.locator('.salon-bottom-nav').getByText('Info')).toBeHidden()
  await page.getByRole('button', { name: 'Open salon menu' }).click()
  await expect(page.getByText('Member since')).toBeVisible()
  await expect(page.getByText('LUXE-0182')).toBeVisible()
  await expect(page.getByText('Ready now')).toBeVisible()
  await expect(page.getByRole('button', { name: /Salon information/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Owner admin login/ })).toBeHidden()
  await expect(page.getByRole('button', { name: /Staff scanner/ })).toBeHidden()
  await page.screenshot({ path: 'test-results/customer-admin-menu-mobile.png' })
  await page.getByRole('button', { name: /^Sign out/ }).click()
  await expect(page.getByRole('button', { name: /Open admin login/ })).toBeVisible()
  await page.screenshot({ path: 'test-results/customer-signed-out-mobile.png', fullPage: true })
  await page.getByRole('button', { name: /Open admin login/ }).click()
  await expect(page).toHaveURL(/\/admin\?tenant=juniper/)
  await expect(page.getByText('Owner access')).toBeVisible()
  for (const [index, digit] of ['7', '3', '9', '1'].entries()) {
    await page.getByLabel(`Owner PIN digit ${index + 1}`).fill(digit)
  }
  await expect(page.getByRole('heading', { name: 'Good afternoon.' })).toBeVisible()
})

test('admin controls remain touch-friendly on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await unlockOwner(page)
  await expect(page.locator('.owner-mobile-nav button')).toHaveCount(5)

  const navButton = await page.locator('.owner-mobile-nav button').first().boundingBox()
  expect(navButton?.height).toBeGreaterThanOrEqual(48)

  await page.getByRole('button', { name: 'Rewards' }).click()
  const addReward = page.getByRole('button', { name: 'Add reward' })
  await expect(addReward).toBeVisible()
  expect((await addReward.boundingBox())?.width).toBeGreaterThan(300)
  await page.screenshot({ path: 'test-results/owner-rewards-mobile.png', fullPage: true })

  await page.getByRole('button', { name: 'Program' }).click()
  expect((await page.getByRole('radio', { name: /Stamp-based/ }).boundingBox())?.width).toBeGreaterThan(300)
  await page.screenshot({ path: 'test-results/owner-program-mobile.png', fullPage: true })
})
