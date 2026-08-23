import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const publicTenant = {
  tenant: {
    id: 'tenant-test',
    slug: 'juniper',
    name: 'Luxe Hair Studio',
    programType: 'stamps',
    stampGoal: 8,
    pointsPerDollar: 1,
    brandColor: '#C23F73',
    address: '128 Ossington Avenue, Toronto',
    phone: '+14165550144',
    openingHours: { Monday: '9:00 AM - 6:00 PM', Sunday: 'Closed' },
    generalInfo: 'An independent Toronto hair studio.',
  },
  rewards: [
    { id: 'reward-one', name: 'Complimentary Scalp Treatment', description: 'A calming add-on.', stampCost: 5, pointCost: 500 },
  ],
}

async function mockPublicConfiguration(page: Page) {
  await page.route('**/api/public/tenant?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(publicTenant) }))
}

async function seedCustomerSession(page: Page) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3_600
  const accessToken = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 'auth-customer', role: 'authenticated', exp: expiresAt })).toString('base64url'),
    'test-signature',
  ].join('.')
  await page.goto('/')
  await page.evaluate(async ({ token, expiry }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('luxe-session-security-v1', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('encryption-keys', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const encryptionKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('encryption-keys', 'readwrite')
      transaction.objectStore('encryption-keys').put({ id: 'supabase-session', key: encryptionKey })
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onerror = () => reject(transaction.error)
    })
    const storageKey = 'luxe-auth-session-v1'
    const session = JSON.stringify({
      access_token: token,
      refresh_token: 'test-refresh-token',
      expires_in: 3_600,
      expires_at: expiry,
      token_type: 'bearer',
      user: { id: 'auth-customer', aud: 'authenticated', role: 'authenticated' },
    })
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(storageKey),
    }, encryptionKey, new TextEncoder().encode(session)))
    const encode = (bytes: Uint8Array) => {
      let binary = ''
      for (const value of bytes) binary += String.fromCharCode(value)
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    }
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, iv: encode(iv), ciphertext: encode(ciphertext) }))
  }, { token: accessToken, expiry: expiresAt })
  return accessToken
}

test('compiled production assets exclude demo screens and credentials', () => {
  const assetDirectory = join(process.cwd(), 'dist', 'assets')
  const scripts = readdirSync(assetDirectory).filter((name) => name.endsWith('.js'))
  const bundleText = scripts.map((name) => readFileSync(join(assetDirectory, name), 'utf8')).join('\n')

  for (const screen of ['customer', 'staff', 'owner']) {
    expect(scripts.some((name) => name.startsWith(`${screen}.production-`)), screen).toBe(true)
  }
  expect(scripts.some((name) => /^(CustomerApp|StaffApp|OwnerApp)-/.test(name))).toBe(false)
  for (const marker of ['Demo staff PIN', 'Demo owner PIN', 'Demo OTP', 'Demo member', 'Try 2468']) {
    expect(bundleText, marker).not.toContain(marker)
  }
})

test('Vercel routes SPA deep links to the Vite entrypoint', () => {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
    rewrites?: Array<{ source?: string; destination?: string }>
  }
  expect(vercel.rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' })
})

test('production customer entrypoint is wallet-first and contains no demo credentials', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPublicConfiguration(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Your salon card/ })).toBeVisible()
  await expect(page.getByText('Luxe Hair Studio 2')).toBeVisible()
  await expect(page.getByLabel('Mobile number')).toBeVisible()
  await expect(page.getByText(/Demo OTP|Try 2468|Demo member/)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Owner login' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Test Google Wallet' })).toHaveAttribute('href', '/?tenant=juniper&test-wallet=1')
  await expect(page.getByRole('link', { name: 'Staff scanner' })).toHaveAttribute('href', '/staff?tenant=juniper')
  await expect(page.getByRole('link', { name: 'Owner dashboard' })).toHaveAttribute('href', '/admin?tenant=juniper')
})

test('salon information is public and contains location and hours', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPublicConfiguration(page)
  await page.goto('/info')
  await expect(page.getByRole('heading', { name: 'Luxe Hair Studio' })).toBeVisible()
  await expect(page.getByText('128 Ossington Avenue, Toronto')).toBeVisible()
  await expect(page.getByText('9:00 AM - 6:00 PM')).toBeVisible()
  await expect(page.getByText('An independent Toronto hair studio.')).toBeVisible()
  await expect(page.getByLabel('Mobile number')).toHaveCount(0)
})

test('signed-in customer can create a five-minute reward code', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPublicConfiguration(page)
  const seededAccessToken = await seedCustomerSession(page)
  await page.route('**/api/customer/profile', async (route) => {
    expect(route.request().headers()['x-tenant-id']).toBe('tenant-test')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...publicTenant,
        profile: { id: 'customer-one', role: 'customer', firstName: 'Maya', lastName: 'Chen', phone: '+14165550182', stamps: 6, points: 0, memberSince: '2025-04-12T00:00:00.000Z' },
        transactions: [],
        walletPass: null,
      }),
    })
  })
  await page.route('**/api/customer/redemption', async (route) => {
    expect(route.request().headers()['x-tenant-id']).toBe('tenant-test')
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ barcodeValue: 'LUXER1:test-redemption', expiresAt: new Date(Date.now() + 300_000).toISOString() }) })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Google Wallet/ })).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('luxe-auth-session-v1') ?? '')).not.toContain(seededAccessToken)
  const coupon = page.locator('.production-coupon-list article').first()
  const redeemButton = page.getByRole('button', { name: 'Redeem' })
  const [couponBox, buttonBox] = await Promise.all([coupon.boundingBox(), redeemButton.boundingBox()])
  expect(couponBox).not.toBeNull()
  expect(buttonBox).not.toBeNull()
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(couponBox!.x + couponBox!.width + 1)
  await redeemButton.click()
  await page.getByRole('button', { name: 'Create redemption code' }).click()
  await expect(page.getByText(/Expires in/)).toBeVisible()
  await expect(page.locator('.redemption-code canvas')).toBeVisible()
})

test('wallet test route issues a customer pass without a staff action', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPublicConfiguration(page)
  await seedCustomerSession(page)
  await page.route('**/api/customer/profile', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ...publicTenant,
      profile: { id: 'customer-one', role: 'customer', firstName: 'Maya', lastName: 'Chen', phone: '+14165550182', stamps: 0, points: 0, memberSince: '2025-04-12T00:00:00.000Z' },
      transactions: [],
      walletPass: null,
    }),
  }))
  let walletRequested = false
  await page.route('**/api/customer/wallet', (route) => {
    walletRequested = true
    expect(route.request().headers()['x-tenant-id']).toBe('tenant-test')
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ objectId: 'issuer.customer-test', saveUrl: 'https://pay.google.com/gp/v/save/test-pass' }),
    })
  })
  await page.route('https://pay.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Google Wallet</title>' }))

  await page.goto('/?tenant=juniper&test-wallet=1')
  await expect.poll(() => walletRequested).toBe(true)
})

test('production staff entrypoint requires owner-enrolled hardware', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPublicConfiguration(page)
  await page.goto('/staff')
  await expect(page.getByRole('heading', { name: 'Enroll this device' })).toBeVisible()
  await expect(page.getByLabel('Enrollment token')).toBeVisible()
  await expect(page.locator('.device-setup-qr canvas')).toBeVisible()
  await expect(page.getByText(/Demo staff PIN/)).toHaveCount(0)
})

test('counter enrollment secret is consumed from the URL fragment', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPublicConfiguration(page)
  const token = `test.${'a'.repeat(64)}.signature`
  await page.goto(`/staff?tenant=juniper#enrollment=${token}`)
  await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('luxe-store-device-v1:juniper'))).toBe(token)
})

test('production owner entrypoint uses phone verification instead of a public PIN', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPublicConfiguration(page)
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Open your dashboard' })).toBeVisible()
  await expect(page.getByLabel('Mobile number')).toBeVisible()
  await expect(page.getByText(/Demo owner PIN/)).toHaveCount(0)
})

test('compiled production shell reloads offline without serving HTML as an asset', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPublicConfiguration(page)
  const pageErrors: string[] = []
  const assetResponses: Array<{ path: string; status: number; contentType: string }> = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/staff')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await page.reload({ waitUntil: 'networkidle' })

  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (path.startsWith('/assets/') && path !== '/assets/offline-missing.js') {
      assetResponses.push({
        path,
        status: response.status(),
        contentType: response.headers()['content-type'] ?? '',
      })
    }
  })

  await context.setOffline(true)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('#root > *')).toHaveCount(1)
  await expect(page.getByText(/Demo staff PIN/)).toHaveCount(0)

  const missingAsset = await page.evaluate(async () => {
    const response = await fetch('/assets/offline-missing.js')
    const text = await response.text()
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      isHtml: text.trimStart().toLowerCase().startsWith('<!doctype html'),
    }
  })

  expect(pageErrors).toEqual([])
  expect(assetResponses.length).toBeGreaterThan(0)
  for (const asset of assetResponses) {
    expect(asset.status, asset.path).toBe(200)
    expect(asset.contentType, asset.path).toMatch(/javascript|text\/css/)
  }
  expect(missingAsset).toEqual({
    status: 503,
    contentType: 'text/plain; charset=utf-8',
    isHtml: false,
  })
})
