const VERSION = 'luxe-loyalty-v5'
const SHELL_CACHE = `${VERSION}-shell`
const RUNTIME_CACHE = `${VERSION}-runtime`
const APP_SHELL_URL = '/'
const PRECACHE_URLS = [
  APP_SHELL_URL,
  '/manifest.webmanifest',
  '/mark.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/salon-interior.png',
  '/salon-interior-pink.png',
]
const MAX_RUNTIME_ENTRIES = 96

const isSameOrigin = (request) => new URL(request.url).origin === self.location.origin

const isValidStaticResponse = (request, response) => {
  if (!response || !response.ok || response.type === 'opaque') return false

  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  const destination = request.destination

  if (destination === 'script' || destination === 'worker') {
    return contentType.includes('javascript') || contentType.includes('ecmascript')
  }
  if (destination === 'style') return contentType.includes('text/css')
  if (destination === 'image') return contentType.startsWith('image/')
  if (destination === 'font') {
    return contentType.startsWith('font/') || contentType.includes('application/font') || contentType.includes('application/octet-stream')
  }
  if (new URL(request.url).pathname.endsWith('.webmanifest')) {
    return contentType.includes('application/manifest+json') || contentType.includes('application/json')
  }

  return true
}

const cacheShellAndBuildAssets = async () => {
  const cache = await caches.open(SHELL_CACHE)
  const shellResponse = await fetch(APP_SHELL_URL, { cache: 'reload' })

  if (!shellResponse.ok || !shellResponse.headers.get('content-type')?.includes('text/html')) {
    throw new Error('The application shell could not be cached')
  }

  await cache.put(APP_SHELL_URL, shellResponse.clone())

  const html = await shellResponse.text()
  const buildAssetUrls = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => new URL(match[1], self.location.origin))
    .filter((url) => url.origin === self.location.origin && url.pathname.startsWith('/assets/'))
    .map((url) => url.pathname)

  const optionalUrls = [...new Set([...PRECACHE_URLS.slice(1), ...buildAssetUrls])]
  await Promise.allSettled(optionalUrls.map(async (url) => {
    const request = new Request(url, { cache: 'reload' })
    const response = await fetch(request)
    if (isValidStaticResponse(request, response)) await cache.put(request, response)
  }))
}

const trimCache = async (cache, maximumEntries) => {
  const keys = await cache.keys()
  const excess = keys.length - maximumEntries
  if (excess > 0) await Promise.all(keys.slice(0, excess).map((request) => cache.delete(request)))
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheShellAndBuildAssets().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('luxe-loyalty-') && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

const handleNavigation = async (request) => {
  const cache = await caches.open(RUNTIME_CACHE)

  try {
    const response = await fetch(request)
    if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
      await cache.put(request, response.clone())
      await trimCache(cache, MAX_RUNTIME_ENTRIES)
    }
    return response
  } catch {
    return (await cache.match(request)) || (await caches.match(APP_SHELL_URL)) || new Response(
      'Luxe Loyalty is unavailable offline. Reconnect and try again.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }
}

const handleStaticAsset = async (request) => {
  const cached = await caches.match(request)
  const update = fetch(request).then(async (response) => {
    if (!isValidStaticResponse(request, response)) throw new Error('Unexpected static asset response')
    const cache = await caches.open(RUNTIME_CACHE)
    await cache.put(request, response.clone())
    await trimCache(cache, MAX_RUNTIME_ENTRIES)
    return response
  })

  if (cached && isValidStaticResponse(request, cached)) {
    update.catch(() => undefined)
    return cached
  }

  try {
    return await update
  } catch {
    return new Response('Asset unavailable offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || !isSameOrigin(request)) return

  const url = new URL(request.url)
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }

  const cacheableDestination = ['script', 'style', 'worker', 'image', 'font', 'manifest'].includes(request.destination)
  if (cacheableDestination || url.pathname.startsWith('/assets/') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(handleStaticAsset(request))
  }
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
