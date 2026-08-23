import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ClipboardList, CloudOff, KeyRound, LockKeyhole, LogOut, ScanLine, Search, ShieldCheck, Stamp, Undo2, UserRound, Wifi } from 'lucide-react'
import { BrandMark } from '../components/BrandMark'
import { QRCode } from '../components/QRCode'
import { createDeviceSetupCode } from '../lib/device-identity'
import { displayPhone } from '../lib/format'
import { offlineVisitsFor, queueOfflineVisit, removeOfflineVisit } from '../lib/offline-visits'
import { productionConfigurationIssues, tenantSlugFromLocation } from '../lib/runtime'
import { ScannerView } from '../staff/ScannerView'
import { productionApi } from './client'
import { ProductionStaffActionSheet } from './ProductionStaffActionSheet'
import type { ProductionProfile, ProductionTransaction, PublicTenantResponse, StaffCustomerResponse, StaffSession } from './types'

type StaffTab = 'scan' | 'search' | 'audit'
const DEVICE_KEY_PREFIX = 'luxe-store-device-v1'
const SESSION_KEY_PREFIX = 'luxe-staff-session-v1'
let feedbackContext: AudioContext | null = null

function primeChime() {
  try {
    feedbackContext ??= new AudioContext()
    void feedbackContext.resume()
  } catch { /* Audio is optional; haptic and visual feedback remain available. */ }
}

function chime() {
  try {
    feedbackContext ??= new AudioContext()
    void feedbackContext.resume()
    const oscillator = feedbackContext.createOscillator()
    const gain = feedbackContext.createGain()
    oscillator.frequency.setValueAtTime(660, feedbackContext.currentTime)
    oscillator.frequency.setValueAtTime(880, feedbackContext.currentTime + 0.08)
    gain.gain.setValueAtTime(0.1, feedbackContext.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, feedbackContext.currentTime + 0.22)
    oscillator.connect(gain).connect(feedbackContext.destination)
    oscillator.start()
    oscillator.stop(feedbackContext.currentTime + 0.22)
  } catch { /* Visual feedback remains available. */ }
}

function readSession(key: string): StaffSession | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) || 'null') as StaffSession | null
    return parsed && new Date(parsed.expiresAt).getTime() > Date.now() ? parsed : null
  } catch { return null }
}

export function ProductionStaffApp() {
  const tenantSlug = tenantSlugFromLocation()
  const configurationIssues = productionConfigurationIssues()
  const deviceKey = `${DEVICE_KEY_PREFIX}:${tenantSlug}`
  const sessionKey = `${SESSION_KEY_PREFIX}:${tenantSlug}`
  const [publicData, setPublicData] = useState<PublicTenantResponse | null>(null)
  const [deviceToken, setDeviceToken] = useState(() => localStorage.getItem(deviceKey) || new URLSearchParams(window.location.hash.slice(1)).get('enrollment') || '')
  const [deviceDraft, setDeviceDraft] = useState('')
  const [deviceSetupLink, setDeviceSetupLink] = useState('')
  const [session, setSession] = useState<StaffSession | null>(() => readSession(sessionKey))
  const [pin, setPin] = useState(['', '', '', ''])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<StaffTab>('scan')
  const [customerData, setCustomerData] = useState<StaffCustomerResponse | null>(null)
  const [source, setSource] = useState<'scan' | 'manual'>('scan')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ProductionProfile[]>([])
  const [transactions, setTransactions] = useState<ProductionTransaction[]>([])
  const [success, setSuccess] = useState('')
  const [successTitle, setSuccessTitle] = useState('Transaction confirmed')
  const [online, setOnline] = useState(navigator.onLine)
  const [queuedCount, setQueuedCount] = useState(0)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  useEffect(() => {
    if (configurationIssues.length) return
    void productionApi.publicTenant(tenantSlug).then(setPublicData).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load this salon.'))
  }, [tenantSlug])

  useEffect(() => {
    const enrollment = new URLSearchParams(window.location.hash.slice(1)).get('enrollment')?.trim()
    if (!enrollment || enrollment.length < 40) return
    localStorage.setItem(deviceKey, enrollment)
    setDeviceToken(enrollment)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }, [deviceKey])

  useEffect(() => {
    if (!publicData || deviceToken) return
    let active = true
    void createDeviceSetupCode(publicData.tenant.id).then((code) => {
      if (!active) return
      const url = new URL('/admin', window.location.origin)
      url.searchParams.set('tenant', tenantSlug)
      url.hash = `device-setup=${encodeURIComponent(code)}`
      setDeviceSetupLink(url.toString())
    }).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to prepare secure device setup.'))
    return () => { active = false }
  }, [deviceToken, publicData, tenantSlug])

  useEffect(() => {
    if (!session || tab !== 'search') return
    if (query.trim().length < 2) { setSearchResults([]); return }
    const timer = window.setTimeout(() => {
      setBusy(true)
      void productionApi.staffSearch(session.sessionToken, query).then(setSearchResults).catch((caught) => setError(caught instanceof Error ? caught.message : 'Search is unavailable.')).finally(() => setBusy(false))
    }, 220)
    return () => window.clearTimeout(timer)
  }, [query, session?.sessionToken, tab])

  const loadAudit = useCallback(async () => {
    if (!session) return
    try { setTransactions(await productionApi.staffAudit(session.sessionToken)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load activity.') }
  }, [session])

  useEffect(() => {
    if (tab !== 'audit' || !online) return
    void loadAudit()
    const timer = window.setInterval(() => void loadAudit(), 5_000)
    return () => window.clearInterval(timer)
  }, [loadAudit, online, tab])

  const syncOfflineVisits = useCallback(async () => {
    if (!session || !publicData || !navigator.onLine) return
    const queued = offlineVisitsFor(publicData.tenant.id, session.staff.id)
    setQueuedCount(queued.length)
    let synced = 0
    for (const visit of queued) {
      try {
        await productionApi.staffConfirm(session.sessionToken, {
          customerId: visit.customerId,
          kind: 'visit',
          source: visit.source,
          occurredAt: visit.occurredAt,
          deviceEventId: visit.eventId,
          deviceSignature: visit.deviceSignature,
        }, `offline:${visit.deviceId}:${visit.eventId}`)
        void productionApi.staffWalletSync(session.sessionToken, visit.customerId).catch(() => undefined)
        removeOfflineVisit(visit.eventId)
        synced += 1
      } catch (caught) {
        setError(caught instanceof Error ? `A saved visit could not sync: ${caught.message}` : 'A saved visit could not sync.')
        break
      }
    }
    const remaining = offlineVisitsFor(publicData.tenant.id, session.staff.id).length
    setQueuedCount(remaining)
    if (synced > 0) {
      setSuccessTitle('Offline visits synced')
      setSuccess(`${synced} saved ${synced === 1 ? 'visit is' : 'visits are'} now recorded.`)
      window.setTimeout(() => setSuccess(''), 1200)
    }
  }, [publicData, session])

  useEffect(() => {
    if (!session || !publicData) return
    setQueuedCount(offlineVisitsFor(publicData.tenant.id, session.staff.id).length)
    if (online) void syncOfflineVisits()
  }, [online, publicData, session, syncOfflineVisits])

  function enrollDevice(event: React.FormEvent) {
    event.preventDefault()
    const token = deviceDraft.trim()
    if (token.length < 12) { setError('Enter the complete enrollment token from the owner dashboard.'); return }
    localStorage.setItem(deviceKey, token)
    setDeviceToken(token)
    setDeviceDraft('')
    setError('')
  }

  async function unlock(nextPin: string[]) {
    if (nextPin.some((digit) => !digit)) return
    primeChime()
    setBusy(true)
    setError('')
    try {
      const result = await productionApi.unlockStaff({ tenantSlug, pin: nextPin.join(''), deviceToken })
      sessionStorage.setItem(sessionKey, JSON.stringify(result))
      setSession(result)
      setPin(['', '', '', ''])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Staff access was not approved.')
      setPin(['', '', '', ''])
      window.setTimeout(() => document.getElementById('production-staff-pin-0')?.focus(), 50)
    } finally { setBusy(false) }
  }

  function updatePin(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...pin]
    next[index] = digit
    setPin(next)
    setError('')
    if (digit && index < 3) document.getElementById(`production-staff-pin-${index + 1}`)?.focus()
    if (digit && index === 3) void unlock(next)
  }

  const handleScan = useCallback(async (barcode: string) => {
    if (!session || busy) return
    if (!navigator.onLine) { setError('Reconnect to validate this Wallet pass.'); return }
    setBusy(true)
    setError('')
    try {
      setCustomerData(await productionApi.staffScan(session.sessionToken, barcode))
      setSource('scan')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This code was not recognized.')
      window.setTimeout(() => setError(''), 3000)
    } finally { setBusy(false) }
  }, [busy, session])

  async function selectManual(customer: ProductionProfile) {
    if (!session) return
    setBusy(true)
    setError('')
    try {
      setCustomerData(await productionApi.staffCustomer(session.sessionToken, customer.id))
      setSource('manual')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to open this customer account.')
    } finally {
      setBusy(false)
    }
  }

  function transactionConfirmed(message: string) {
    setCustomerData(null)
    setSuccessTitle('Transaction confirmed')
    setSuccess(message)
    navigator.vibrate?.([40, 30, 80])
    chime()
    window.setTimeout(() => setSuccess(''), 900)
    if (tab === 'audit') void loadAudit()
  }

  async function saveOfflineVisit() {
    if (!session || !publicData || !customerData) return
    await queueOfflineVisit({
      tenantId: publicData.tenant.id,
      deviceToken,
      actorId: session.staff.id,
      customerId: customerData.customer.id,
      customerName: `${customerData.customer.firstName} ${customerData.customer.lastName}`.trim(),
      source,
    })
    setQueuedCount(offlineVisitsFor(publicData.tenant.id, session.staff.id).length)
    setCustomerData(null)
    setSuccessTitle('Visit saved securely')
    setSuccess(`The visit for ${customerData.customer.firstName} will sync after reconnection.`)
    navigator.vibrate?.(40)
    window.setTimeout(() => setSuccess(''), 1200)
  }

  async function undo(transactionId: string) {
    if (!session) return
    try {
      await productionApi.staffUndo(session.sessionToken, transactionId)
      await loadAudit()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to undo this transaction.') }
  }

  async function lock() {
    const activeSession = session
    sessionStorage.removeItem(sessionKey)
    setSession(null)
    setPin(['', '', '', ''])
    setCustomerData(null)
    if (activeSession) await productionApi.staffLogout(activeSession.sessionToken).catch(() => undefined)
  }

  if (configurationIssues.length) return <main className="staff-lock"><section className="pin-panel"><BrandMark inverse /><ShieldCheck size={28} /><p className="eyebrow">Configuration required</p><h1>Staff portal is not connected.</h1><p>Missing {configurationIssues.join(', ')}.</p></section></main>
  if (!publicData) return <main className="staff-lock"><section className="pin-panel"><BrandMark inverse /><div className="loading-line" />{error && <p className="pin-error">{error}</p>}</section></main>

  if (!deviceToken) return <main className="staff-lock"><section className="pin-panel device-enrollment-panel"><BrandMark inverse /><div className="lock-icon"><KeyRound size={25} /></div><p className="eyebrow">New counter device</p><h1>Enroll this device</h1><p>Scan this setup request with the owner's phone.</p>{deviceSetupLink && <div className="device-setup-qr"><QRCode value={deviceSetupLink} size={210} /><small>The private signing key stays on this counter.</small></div>}<form onSubmit={enrollDevice}><label htmlFor="device-enrollment-token">Enrollment token</label><input id="device-enrollment-token" value={deviceDraft} onChange={(event) => setDeviceDraft(event.target.value)} autoComplete="off" spellCheck={false} />{error && <p className="pin-error">{error}</p>}<button className="primary-button" type="submit">Enroll device</button></form><a href={`/admin?tenant=${encodeURIComponent(tenantSlug)}`}>Set up on this device instead</a></section></main>

  if (!session) return <main className="staff-lock"><section className="pin-panel"><BrandMark inverse /><div className="lock-icon"><LockKeyhole size={25} /></div><p className="eyebrow">Staff access</p><h1>Enter your PIN</h1><p>{publicData.tenant.name} counter device</p><div className="pin-row" aria-label="Staff PIN">{pin.map((digit, index) => <input key={index} id={`production-staff-pin-${index}`} value={digit} type="password" inputMode="numeric" maxLength={1} aria-label={`PIN digit ${index + 1}`} onChange={(event) => updatePin(index, event.target.value)} autoFocus={index === 0} disabled={busy} />)}</div>{error && <p className="pin-error">{error}</p>}<div className="device-status"><ShieldCheck size={17} /> Enrolled counter device</div><button className="forget-device-button" onClick={() => { localStorage.removeItem(deviceKey); setDeviceToken('') }}>Remove device enrollment</button></section></main>

  const tenant = publicData.tenant
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const reversed = new Set(transactions.map((transaction) => transaction.reversesId).filter(Boolean))

  return <main className={`staff-shell production-staff-shell ${tab === 'scan' ? 'scanner-active' : ''}`}>
    <header className="staff-topbar"><div><BrandMark inverse={tab === 'scan'} /><span>{tenant.name}</span></div><div className="staff-identity"><span className={online ? 'online' : 'offline'}>{online ? <Wifi size={15} /> : <CloudOff size={15} />}{online ? (queuedCount ? `${queuedCount} syncing` : session.staff.firstName) : (queuedCount ? `Offline, ${queuedCount} saved` : 'Offline')}</span><button className="icon-button" onClick={() => void lock()} aria-label="Lock staff portal"><LogOut size={18} /></button></div></header>
    <div className="staff-content">
      {tab === 'scan' && <ScannerView paused={Boolean(customerData) || busy} onScan={(value) => void handleScan(value)} />}
      {tab === 'search' && <section className="staff-page search-page"><div className="staff-page-heading"><p className="eyebrow">Customer lookup</p><h1>Find a member</h1><p>Search by name or mobile number.</p></div><label className="search-field"><Search size={21} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or phone number" autoFocus />{query && <button onClick={() => setQuery('')}>Clear</button>}</label><div className="search-results"><p className="result-count">{busy ? 'Searching...' : query.trim().length < 2 ? 'Enter at least 2 characters' : `${searchResults.length} members`}</p>{searchResults.map((customer) => <button key={customer.id} className="customer-result" onClick={() => void selectManual(customer)}><span className="result-avatar"><UserRound size={21} /></span><span className="result-name"><strong>{customer.firstName} {customer.lastName}</strong><small>{displayPhone(customer.phone)}</small></span><span className="result-balance"><strong>{tenant.programType === 'stamps' ? customer.stamps : customer.points}</strong><small>{tenant.programType}</small></span></button>)}</div></section>}
      {tab === 'audit' && <section className="staff-page audit-page"><div className="staff-page-heading audit-heading"><div><p className="eyebrow">Today</p><h1>Transaction log</h1></div><span className="live-badge"><i /> Live</span></div><div className="audit-list">{transactions.filter((transaction) => new Date(transaction.createdAt) >= todayStart).map((transaction) => { const change = transaction.stampsChanged || transaction.pointsChanged; const canUndo = transaction.kind !== 'undo' && Date.now() - new Date(transaction.createdAt).getTime() <= 60_000 && !reversed.has(transaction.id); return <article className={`audit-row ${transaction.kind === 'undo' ? 'undone' : ''}`} key={transaction.id}><div className="audit-icon"><Stamp size={19} /></div><div className="audit-main"><div><strong>{transaction.customer?.firstName ?? 'Customer'} {transaction.customer?.lastName ?? ''}</strong><time>{new Date(transaction.createdAt).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}</time></div><p>{transaction.reward?.name ?? (transaction.kind === 'visit' ? 'Standard visit' : transaction.kind)}</p><span>Staff {transaction.staff?.staffCode ?? session.staff.staffCode}</span></div><div className="audit-value"><strong>{change > 0 ? '+' : ''}{change} {transaction.stampsChanged ? 'stamps' : 'points'}</strong>{canUndo && <button onClick={() => void undo(transaction.id)}><Undo2 size={15} /> Undo</button>}</div></article> })}{!transactions.length && <div className="empty-state"><Stamp size={28} /><h2>No transactions yet</h2><p>Confirmed activity will appear here.</p></div>}</div></section>}
    </div>
    {error && <button className="scan-toast" onClick={() => setError('')} role="alert">{error}</button>}
    <nav className="staff-nav" aria-label="Staff tools"><button className={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}><ScanLine size={22} /><span>Scan</span></button><button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}><Search size={22} /><span>Search</span></button><button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}><ClipboardList size={22} /><span>Activity</span></button></nav>
    <ProductionStaffActionSheet customerData={customerData} tenant={tenant} sessionToken={session.sessionToken} source={source} online={online} onClose={() => setCustomerData(null)} onConfirmed={transactionConfirmed} onQueueVisit={saveOfflineVisit} />
    <div className={`success-flash ${success ? 'visible' : ''}`} aria-live="assertive"><div className="success-check"><Check size={42} strokeWidth={3} /></div><h2>{successTitle}</h2><p>{success}</p></div>
  </main>
}
