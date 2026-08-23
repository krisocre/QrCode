import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Gift, KeyRound, LayoutDashboard, LogOut, Minus, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Trash2, UserRound, UsersRound } from 'lucide-react'
import { BottomSheet } from '../components/BottomSheet'
import { BrandMark } from '../components/BrandMark'
import { QRCode } from '../components/QRCode'
import { ApiError } from '../lib/api-client'
import { displayPhone, formatPhoneInput, normalizePhone } from '../lib/format'
import { productionConfigurationIssues, tenantSlugFromLocation } from '../lib/runtime'
import { clearSupabaseSession, customerAccessToken } from '../lib/supabase'
import { ensureDeviceIdentity, publicKeyFromDeviceSetupCode } from '../lib/device-identity'
import { normalizeProfile, normalizeReward, normalizeTenant, normalizeTransaction, productionApi } from './client'
import type { ProductionProfile, ProductionReward, ProductionTenant, ProductionTransaction, PublicTenantResponse } from './types'

type OwnerView = 'booting' | 'phone' | 'otp' | 'dashboard' | 'unavailable'
type OwnerTab = 'overview' | 'rewards' | 'staff' | 'customers' | 'program'
type UnknownRecord = Record<string, unknown>

interface AdminData {
  tenant: ProductionTenant
  owner: ProductionProfile
  profiles: ProductionProfile[]
  rewards: ProductionReward[]
  transactions: ProductionTransaction[]
  devices: Array<{ id: string; name: string; active: boolean; lastSeenAt?: string }>
}

function record(value: unknown): UnknownRecord { return value && typeof value === 'object' ? value as UnknownRecord : {} }

function normalizeAdminData(value: unknown, publicData: PublicTenantResponse): AdminData {
  const payload = record(value)
  const profiles = Array.isArray(payload.profiles) ? payload.profiles.map(normalizeProfile) : []
  const owner = payload.owner ? normalizeProfile(payload.owner) : profiles.find((profile) => profile.role === 'owner')
  if (!owner) throw new Error('This account does not have owner access.')
  return {
    tenant: payload.tenant ? normalizeTenant(payload.tenant) : publicData.tenant,
    owner,
    profiles,
    rewards: Array.isArray(payload.rewards) ? payload.rewards.map(normalizeReward) : publicData.rewards,
    transactions: Array.isArray(payload.transactions) ? payload.transactions.map(normalizeTransaction) : [],
    devices: (Array.isArray(payload.devices) ? payload.devices : []).map((device) => {
      const item = record(device)
      const status = String(item.status ?? (item.active === false ? 'revoked' : 'active'))
      return { id: String(item.id ?? ''), name: String(item.name ?? item.label ?? 'Counter device'), active: status === 'active', lastSeenAt: String(item.lastSeenAt ?? item.last_seen_at ?? '') || undefined }
    }),
  }
}

export function ProductionOwnerApp() {
  const tenantSlug = tenantSlugFromLocation()
  const setupRequestFromHash = new URLSearchParams(window.location.hash.slice(1)).get('device-setup') || ''
  const configurationIssues = productionConfigurationIssues()
  const [view, setView] = useState<OwnerView>('booting')
  const [tab, setTab] = useState<OwnerTab>(setupRequestFromHash ? 'staff' : 'overview')
  const [publicData, setPublicData] = useState<PublicTenantResponse | null>(null)
  const [data, setData] = useState<AdminData | null>(null)
  const [phone, setPhone] = useState('+1 ')
  const [otp, setOtp] = useState(Array.from({ length: 6 }, () => ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [rewardDraft, setRewardDraft] = useState<Partial<ProductionReward> | null>(null)
  const [staffDraft, setStaffDraft] = useState<{ id?: string; firstName: string; lastName: string; staffCode: string; pin: string } | null>(null)
  const [customerDraft, setCustomerDraft] = useState<ProductionProfile | null>(null)
  const [adjustment, setAdjustment] = useState('1')
  const [deviceName, setDeviceName] = useState('Front desk tablet')
  const [enrollmentToken, setEnrollmentToken] = useState('')
  const [deviceSetupCode, setDeviceSetupCode] = useState(setupRequestFromHash)
  const [deviceToRevoke, setDeviceToRevoke] = useState<{ id: string; name: string } | null>(null)

  const loadAdmin = useCallback(async (tenantInfo: PublicTenantResponse) => {
    try {
      const payload = await productionApi.adminOverview()
      setData(normalizeAdminData(payload, tenantInfo))
      setView('dashboard')
      setError('')
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) setView('phone')
      else if (caught instanceof ApiError && caught.status === 403) {
        await clearSupabaseSession().catch(() => undefined)
        setError('This number is not an owner account.')
        setView('phone')
      } else {
        setError(caught instanceof Error ? caught.message : 'Unable to open the owner portal.')
        setView('phone')
      }
    }
  }, [])

  useEffect(() => {
    if (configurationIssues.length) { setView('unavailable'); return }
    let active = true
    void productionApi.publicTenant(tenantSlug).then(async (result) => {
      if (!active) return
      setPublicData(result)
      if (await customerAccessToken()) await loadAdmin(result)
      else setView('phone')
    }).catch((caught) => { if (active) { setError(caught instanceof Error ? caught.message : 'Owner portal unavailable.'); setView('unavailable') } })
    return () => { active = false }
  }, [loadAdmin, tenantSlug])

  async function requestCode(event: React.FormEvent) {
    event.preventDefault()
    if (normalizePhone(phone).length !== 12) { setError('Enter a valid 10-digit mobile number.'); return }
    setBusy(true); setError('')
    try {
      await productionApi.phoneLogin({ tenantSlug, phone: normalizePhone(phone) })
      if (publicData) await loadAdmin(publicData)
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'unverified_phone_login_disabled') {
        try {
          await productionApi.requestOtp({ tenantSlug, phone: normalizePhone(phone) })
          setOtp(Array.from({ length: 6 }, () => ''))
          setView('otp')
        } catch (otpError) { setError(otpError instanceof Error ? otpError.message : 'Unable to send a code.') }
      } else {
        setError(caught instanceof Error ? caught.message : 'Unable to open the owner portal.')
      }
    }
    finally { setBusy(false) }
  }

  async function verifyCode(next = otp) {
    if (!publicData || next.some((digit) => !digit)) return
    setBusy(true); setError('')
    try {
      await productionApi.verifyOtp({ tenantSlug, phone: normalizePhone(phone), code: next.join('') })
      await loadAdmin(publicData)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to verify owner access.'); setOtp(Array.from({ length: 6 }, () => '')) }
    finally { setBusy(false) }
  }

  function updateOtp(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...otp]; next[index] = digit; setOtp(next); setError('')
    if (digit && index < 5) document.getElementById(`owner-otp-${index + 1}`)?.focus()
    if (digit && index === 5 && next.every(Boolean)) void verifyCode(next)
  }

  async function refresh() { if (publicData) await loadAdmin(publicData) }

  async function saveReward(event: React.FormEvent) {
    event.preventDefault()
    if (!rewardDraft?.name?.trim()) { setError('Enter a reward name.'); return }
    setBusy(true)
    try {
      await productionApi.adminResource('rewards', rewardDraft.id ? 'PATCH' : 'POST', rewardDraft)
      setRewardDraft(null); await refresh()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save reward.') }
    finally { setBusy(false) }
  }

  async function removeReward(id: string) {
    setBusy(true)
    try { await productionApi.adminResource('rewards', 'DELETE', { id }); await refresh() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to remove reward.') }
    finally { setBusy(false) }
  }

  async function saveStaff(event: React.FormEvent) {
    event.preventDefault()
    if (!staffDraft || !/^[A-Za-z0-9]{2,12}$/.test(staffDraft.staffCode)) { setError('Enter a 2 to 12 character staff code.'); return }
    if (!staffDraft.id && !/^\d{4}$/.test(staffDraft.pin)) { setError('Enter a unique four-digit PIN.'); return }
    if (staffDraft.id && staffDraft.pin && !/^\d{4}$/.test(staffDraft.pin)) { setError('A new PIN must contain four digits.'); return }
    setBusy(true)
    try { await productionApi.adminResource('staff', staffDraft.id ? 'PATCH' : 'POST', staffDraft); setStaffDraft(null); await refresh() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save staff access.') }
    finally { setBusy(false) }
  }

  async function removeStaff(id: string) {
    setBusy(true)
    try { await productionApi.adminResource('staff', 'DELETE', { id }); await refresh() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to remove staff access.') }
    finally { setBusy(false) }
  }

  async function adjustCustomer() {
    if (!customerDraft || !Number(adjustment)) return
    setBusy(true)
    try {
      const amount = Number(adjustment)
      await productionApi.adminResource('customers', 'PATCH', {
        customerId: customerDraft.id,
        stampsDelta: data?.tenant.programType === 'stamps' ? amount : 0,
        pointsDelta: data?.tenant.programType === 'points' ? amount : 0,
        reason: 'Owner balance correction',
      })
      void productionApi.ownerWalletSync(customerDraft.id).catch(() => undefined)
      setCustomerDraft(null); setAdjustment('1'); await refresh()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to adjust balance.') }
    finally { setBusy(false) }
  }

  async function saveProgram(input: Partial<ProductionTenant>) {
    setBusy(true)
    try { await productionApi.adminResource('program', 'PATCH', input); await refresh() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save program settings.') }
    finally { setBusy(false) }
  }

  async function createDevice(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setEnrollmentToken('')
    try {
      const tenantId = data?.tenant.id ?? ''
      const publicKeyJwk = deviceSetupCode
        ? publicKeyFromDeviceSetupCode(deviceSetupCode, tenantId)
        : (await ensureDeviceIdentity(tenantId)).publicKeyJwk
      const payload = record(await productionApi.adminResource('device-enrollments', 'POST', {
        label: deviceName,
        publicKeyJwk,
      }))
      setEnrollmentToken(String(payload.enrollmentToken ?? payload.enrollment_token ?? ''))
      if (deviceSetupCode) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
        setDeviceSetupCode('')
      }
      await refresh()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to create an enrollment token.') }
    finally { setBusy(false) }
  }

  async function revokeCounterDevice() {
    if (!deviceToRevoke) return
    setBusy(true)
    try {
      await productionApi.adminResource('device-enrollments', 'DELETE', { id: deviceToRevoke.id })
      setDeviceToRevoke(null)
      await refresh()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to revoke this device.') }
    finally { setBusy(false) }
  }

  async function signOut() { await clearSupabaseSession().catch(() => undefined); setData(null); setView('phone') }

  if (view === 'booting') return <main className="owner-lock"><div className="loading-line" /></main>
  if (view === 'unavailable') return <main className="owner-lock"><section className="pin-panel owner-pin-panel"><BrandMark inverse /><ShieldCheck size={28} /><h1>Owner portal is not configured.</h1><p>{configurationIssues.length ? `Missing ${configurationIssues.join(', ')}.` : error}</p></section></main>
  const tenantName = publicData?.tenant.name ?? 'Luxe Hair Studio'
  if (view === 'phone') return <main className="owner-lock"><section className="pin-panel owner-pin-panel"><BrandMark inverse /><div className="lock-icon"><ShieldCheck size={25} /></div><p className="eyebrow">Owner access</p><h1>Open your dashboard</h1><p>Enter the owner phone number for {tenantName}.</p><form className="auth-form owner-auth-form" onSubmit={requestCode}><label htmlFor="owner-phone">Mobile number</label><input id="owner-phone" className="phone-input" value={phone} type="tel" inputMode="tel" onChange={(event) => setPhone(formatPhoneInput(event.target.value))} autoFocus />{error && <p className="pin-error">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Opening...' : 'Continue'}</button></form></section></main>
  if (view === 'otp') return <main className="owner-lock"><section className="pin-panel owner-pin-panel"><BrandMark inverse /><p className="eyebrow">Check your phone</p><h1>Enter the six-digit code</h1><div className="pin-row owner-production-otp">{otp.map((digit, index) => <input key={index} id={`owner-otp-${index}`} value={digit} inputMode="numeric" maxLength={1} aria-label={`Owner OTP digit ${index + 1}`} onChange={(event) => updateOtp(index, event.target.value)} autoFocus={index === 0} />)}</div>{error && <p className="pin-error">{error}</p>}<button className="primary-button" disabled={busy || otp.some((digit) => !digit)} onClick={() => void verifyCode()}>{busy ? 'Checking...' : 'Verify owner access'}</button></section></main>
  if (!data) return null

  const navigation = [
    { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
    { id: 'rewards' as const, label: 'Rewards', icon: Gift },
    { id: 'staff' as const, label: 'Staff', icon: Settings2 },
    { id: 'customers' as const, label: 'Customers', icon: UsersRound },
    { id: 'program' as const, label: 'Program', icon: SlidersHorizontal },
  ]
  const customers = data.profiles.filter((profile) => profile.role === 'customer')
  const staff = data.profiles.filter((profile) => profile.role === 'staff')
  const filteredCustomers = customers.filter((customer) => `${customer.firstName} ${customer.lastName} ${customer.phone}`.toLowerCase().includes(query.toLowerCase()))
  const awarded = data.transactions.reduce((sum, transaction) => sum + Math.max(0, data.tenant.programType === 'stamps' ? transaction.stampsChanged : transaction.pointsChanged), 0)
  const redemptions = data.transactions.filter((transaction) => transaction.kind === 'redeem').length
  const enrollmentLink = enrollmentToken
    ? `${window.location.origin}/staff?tenant=${encodeURIComponent(data.tenant.slug)}#enrollment=${encodeURIComponent(enrollmentToken)}`
    : ''

  return <main className="owner-shell">
    <aside className="owner-sidebar"><div className="owner-brand"><BrandMark inverse /><div><strong>{data.tenant.name}</strong><span>Owner portal</span></div></div><nav>{navigation.map(({ id, label, icon: Icon }) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}><Icon size={19} /><span>{label}</span></button>)}</nav><div className="owner-sidebar-user"><span>{data.owner.firstName.slice(0, 1)}{data.owner.lastName.slice(0, 1)}</span><div><strong>{data.owner.firstName} {data.owner.lastName}</strong><small>Owner account</small></div><button onClick={() => void signOut()} aria-label="Sign out"><LogOut size={18} /></button></div></aside>
    <div className="owner-main"><header className="owner-mobile-header"><div><BrandMark /><span><strong>{data.tenant.name}</strong><small>{navigation.find((item) => item.id === tab)?.label}</small></span></div><button className="icon-button" onClick={() => void signOut()}><LogOut size={18} /></button></header>{error && <button className="owner-error-banner" onClick={() => setError('')}>{error}</button>}
      {tab === 'overview' && <section className="owner-page"><header className="owner-page-heading"><div><p className="eyebrow">Business overview</p><h1>Good afternoon.</h1></div><p>Live activity across {data.tenant.name}</p></header><div className="analytics-grid"><article className="metric-block"><div className="metric-top"><span>Customers</span><UsersRound size={19} /></div><strong>{customers.length}</strong><p>Total members</p></article><article className="metric-block"><div className="metric-top"><span>{data.tenant.programType === 'stamps' ? 'Stamps' : 'Points'} awarded</span><Check size={19} /></div><strong>{awarded}</strong><p>Recent activity</p></article><article className="metric-block"><div className="metric-top"><span>Redemptions</span><Gift size={19} /></div><strong>{redemptions}</strong><p>Recent activity</p></article><article className="metric-block"><div className="metric-top"><span>Counter devices</span><KeyRound size={19} /></div><strong>{data.devices.filter((device) => device.active).length}</strong><p>Enrolled</p></article></div><section className="owner-section recent-section"><div className="owner-section-heading"><div><p className="eyebrow">Live feed</p><h2>Recent activity</h2></div></div><div className="owner-table"><div className="owner-table-head"><span>Customer</span><span>Activity</span><span>Change</span><span>Time</span></div>{data.transactions.slice(0, 10).map((transaction) => { const customer = data.profiles.find((profile) => profile.id === transaction.customerId); const change = transaction.stampsChanged || transaction.pointsChanged; return <div className="owner-table-row" key={transaction.id}><strong>{customer?.firstName ?? 'Customer'} {customer?.lastName ?? ''}</strong><span>{transaction.kind}</span><span>{change > 0 ? '+' : ''}{change}</span><time>{new Date(transaction.createdAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div> })}</div></section></section>}
      {tab === 'rewards' && <section className="owner-page"><header className="owner-page-heading split-heading"><div><p className="eyebrow">Catalog</p><h1>Rewards</h1></div><button className="owner-primary-command" onClick={() => setRewardDraft({ name: '', description: '', stampCost: 5, pointCost: 500, promotion: '' })}><Plus size={18} /> Add reward</button></header><section className="owner-section manager-list">{data.rewards.map((reward) => <article className="manager-row" key={reward.id}><div className="manager-name"><span className="manager-icon"><Gift size={19} /></span><span><strong>{reward.name}</strong><small>{reward.description}</small></span></div><strong className="manager-cost">{data.tenant.programType === 'stamps' ? `${reward.stampCost} stamps` : `${reward.pointCost} points`}</strong><span className="manager-promo">{reward.promotion || 'Always available'}</span><div className="manager-actions"><button className="icon-button" onClick={() => setRewardDraft(reward)}>Edit</button><button className="icon-button danger-icon" onClick={() => void removeReward(reward.id)} aria-label={`Remove ${reward.name}`}><Trash2 size={18} /></button></div></article>)}</section></section>}
      {tab === 'staff' && <section className="owner-page"><header className="owner-page-heading split-heading"><div><p className="eyebrow">Team and devices</p><h1>Staff access</h1></div><button className="owner-primary-command" onClick={() => setStaffDraft({ firstName: '', lastName: '', staffCode: '', pin: '' })}><Plus size={18} /> Add staff</button></header><section className="owner-section manager-list">{staff.map((person) => <article className="manager-row staff-row" key={person.id}><div className="manager-name"><span className="manager-icon"><UserRound size={19} /></span><span><strong>{person.firstName} {person.lastName}</strong><small>{person.staffCode}</small></span></div><span className="manager-promo">PIN protected</span><div className="manager-actions"><button className="icon-button" onClick={() => setStaffDraft({ id: person.id, firstName: person.firstName, lastName: person.lastName, staffCode: person.staffCode ?? '', pin: '' })}>Edit</button><button className="icon-button danger-icon" onClick={() => void removeStaff(person.id)}><Trash2 size={18} /></button></div></article>)}</section><section className="owner-section device-admin-section"><div className="owner-section-heading"><div><p className="eyebrow">Counter security</p><h2>Enrolled devices</h2></div></div>{data.devices.map((device) => <div className="device-admin-row" key={device.id}><KeyRound size={19} /><span><strong>{device.name}</strong><small>{device.lastSeenAt ? `Last used ${new Date(device.lastSeenAt).toLocaleDateString('en-CA')}` : 'Not used yet'}</small></span><i className={device.active ? 'active' : ''}>{device.active ? 'Active' : 'Disabled'}</i>{device.active && <button className="icon-button danger-icon" onClick={() => setDeviceToRevoke({ id: device.id, name: device.name })} aria-label={`Revoke ${device.name}`}><Trash2 size={17} /></button>}</div>)}<form className="device-enrollment-form" onSubmit={createDevice}>{deviceSetupCode && <p className="linked-device-request"><ShieldCheck size={18} /> Counter setup request linked</p>}<label>Device name<input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label><button className="owner-save-button" disabled={busy}>Create enrollment token</button></form><p className="device-enrollment-note">{deviceSetupCode ? 'The private signing key remains on the counter that showed the setup QR.' : 'For remote setup, start on the new counter and scan its setup QR with this phone.'}</p>{enrollmentToken && <div className="enrollment-token"><p>Scan this with the counter device</p><QRCode value={enrollmentLink} size={210} /><small>The enrollment secret is carried in the URL fragment and is not sent in request logs.</small></div>}</section></section>}
      {tab === 'customers' && <section className="owner-page"><header className="owner-page-heading"><div><p className="eyebrow">Directory</p><h1>Customers</h1></div></header><label className="search-field owner-search"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or phone" /></label><section className="owner-section customer-directory-list">{filteredCustomers.map((customer) => <button className="directory-row" key={customer.id} onClick={() => setCustomerDraft(customer)}><span className="directory-name"><span className="result-avatar"><UserRound size={20} /></span><span><strong>{customer.firstName} {customer.lastName}</strong><small>{displayPhone(customer.phone)}</small></span></span><strong>{data.tenant.programType === 'stamps' ? `${customer.stamps} stamps` : `${customer.points} points`}</strong><time>{new Date(customer.createdAt).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' })}</time></button>)}</section></section>}
      {tab === 'program' && <ProgramEditor tenant={data.tenant} busy={busy} onSave={saveProgram} />}
    </div>
    <nav className="owner-mobile-nav">{navigation.map(({ id, label, icon: Icon }) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => { setTab(id); window.scrollTo({ top: 0 }) }}><Icon size={20} /><span>{label}</span></button>)}</nav>
    <BottomSheet open={Boolean(rewardDraft)} title={rewardDraft?.id ? 'Edit reward' : 'Add reward'} onClose={() => setRewardDraft(null)}>{rewardDraft && <form className="owner-sheet-form" onSubmit={saveReward}><label>Reward name<input value={rewardDraft.name ?? ''} onChange={(event) => setRewardDraft({ ...rewardDraft, name: event.target.value })} /></label><label>Description<textarea rows={3} value={rewardDraft.description ?? ''} onChange={(event) => setRewardDraft({ ...rewardDraft, description: event.target.value })} /></label><div className="owner-form-grid"><label>Stamp cost<input type="number" min="1" value={rewardDraft.stampCost ?? 1} onChange={(event) => setRewardDraft({ ...rewardDraft, stampCost: Number(event.target.value) })} /></label><label>Point cost<input type="number" min="1" value={rewardDraft.pointCost ?? 1} onChange={(event) => setRewardDraft({ ...rewardDraft, pointCost: Number(event.target.value) })} /></label></div><label>Promotion<input value={rewardDraft.promotion ?? ''} onChange={(event) => setRewardDraft({ ...rewardDraft, promotion: event.target.value })} /></label><button className="owner-save-button" disabled={busy}>Save reward</button></form>}</BottomSheet>
    <BottomSheet open={Boolean(staffDraft)} title={staffDraft?.id ? 'Edit staff member' : 'Add staff member'} onClose={() => setStaffDraft(null)}>{staffDraft && <form className="owner-sheet-form" onSubmit={saveStaff}><div className="owner-form-grid"><label>First name<input value={staffDraft.firstName} onChange={(event) => setStaffDraft({ ...staffDraft, firstName: event.target.value })} /></label><label>Last name<input value={staffDraft.lastName} onChange={(event) => setStaffDraft({ ...staffDraft, lastName: event.target.value })} /></label></div><label>Staff code<input maxLength={12} value={staffDraft.staffCode} onChange={(event) => setStaffDraft({ ...staffDraft, staffCode: event.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase() })} /></label><label>{staffDraft.id ? 'New 4-digit PIN (optional)' : '4-digit PIN'}<input type="password" inputMode="numeric" maxLength={4} value={staffDraft.pin} onChange={(event) => setStaffDraft({ ...staffDraft, pin: event.target.value.replace(/\D/g, '').slice(0, 4) })} /></label><button className="owner-save-button" disabled={busy}>Save staff access</button></form>}</BottomSheet>
    <BottomSheet open={Boolean(customerDraft)} title="Adjust customer" onClose={() => setCustomerDraft(null)}>{customerDraft && <div className="owner-customer-profile"><div className="profile-identity"><span className="result-avatar"><UserRound size={24} /></span><div><h3>{customerDraft.firstName} {customerDraft.lastName}</h3><p>{displayPhone(customerDraft.phone)}</p></div></div><div className="profile-balances"><div><span>Stamps</span><strong>{customerDraft.stamps}</strong></div><div><span>Points</span><strong>{customerDraft.points}</strong></div></div><section className="adjustment-panel"><div><p className="eyebrow">Audited correction</p><h4>Adjust {data.tenant.programType}</h4></div><div className="adjustment-controls"><button className="icon-button" onClick={() => setAdjustment(String(Number(adjustment) - 1))}><Minus size={18} /></button><input value={adjustment} type="number" onChange={(event) => setAdjustment(event.target.value)} /><button className="icon-button" onClick={() => setAdjustment(String(Number(adjustment) + 1))}><Plus size={18} /></button><button className="owner-save-button" disabled={busy} onClick={() => void adjustCustomer()}>Apply</button></div></section></div>}</BottomSheet>
    <BottomSheet open={Boolean(deviceToRevoke)} title="Revoke counter device" onClose={() => setDeviceToRevoke(null)}>{deviceToRevoke && <div className="owner-confirm-sheet"><ShieldCheck size={28} /><p><strong>{deviceToRevoke.name}</strong> will be signed out immediately and can no longer access customer accounts.</p><button className="owner-danger-button" disabled={busy} onClick={() => void revokeCounterDevice()}>{busy ? 'Revoking...' : 'Revoke device'}</button></div>}</BottomSheet>
  </main>
}

const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

function completeOpeningHours(hours: ProductionTenant['openingHours']): Record<string, string> {
  return Object.fromEntries(WEEK_DAYS.map((day) => [day, hours?.[day] || 'Closed']))
}

function ProgramEditor({ tenant, busy, onSave }: { tenant: ProductionTenant; busy: boolean; onSave: (input: Partial<ProductionTenant>) => Promise<void> }) {
  const [programType, setProgramType] = useState(tenant.programType)
  const [stampGoal, setStampGoal] = useState(tenant.stampGoal)
  const [pointsPerDollar, setPointsPerDollar] = useState(tenant.pointsPerDollar)
  const [name, setName] = useState(tenant.name)
  const [address, setAddress] = useState(tenant.address ?? '')
  const [phone, setPhone] = useState(tenant.phone ?? '')
  const [generalInfo, setGeneralInfo] = useState(tenant.generalInfo ?? '')
  const [openingHours, setOpeningHours] = useState<Record<string, string>>(() => completeOpeningHours(tenant.openingHours))

  useEffect(() => {
    setProgramType(tenant.programType)
    setStampGoal(tenant.stampGoal)
    setPointsPerDollar(tenant.pointsPerDollar)
    setName(tenant.name)
    setAddress(tenant.address ?? '')
    setPhone(tenant.phone ?? '')
    setGeneralInfo(tenant.generalInfo ?? '')
    setOpeningHours(completeOpeningHours(tenant.openingHours))
  }, [tenant])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    void onSave({
      programType,
      stampGoal,
      pointsPerDollar,
      name,
      address,
      phone,
      generalInfo,
      openingHours,
    })
  }

  return <section className="owner-page">
    <header className="owner-page-heading"><div><p className="eyebrow">Program</p><h1>Program &amp; salon</h1></div></header>
    <form className="program-editor-form" onSubmit={submit}>
      <section className="owner-section program-section">
        <div className="owner-section-heading"><div><p className="eyebrow">Earning rules</p><h2>Loyalty settings</h2></div></div>
        <div className="program-selector">
          <button type="button" className={programType === 'stamps' ? 'selected' : ''} onClick={() => setProgramType('stamps')}><Check size={22} /><span><strong>Stamp-based</strong><small>One visit, one stamp</small></span></button>
          <button type="button" className={programType === 'points' ? 'selected' : ''} onClick={() => setProgramType('points')}><span className="points-symbol">P</span><span><strong>Point-based</strong><small>Points per dollar</small></span></button>
        </div>
        <div className="rules-form">
          {programType === 'stamps' ? <label className="owner-stepper"><span><strong>Stamps per cycle</strong><small>Target for a full card.</small></span><span className="stepper-control"><button type="button" aria-label="Decrease stamp goal" onClick={() => setStampGoal(Math.max(1, stampGoal - 1))}><Minus size={18} /></button><input aria-label="Stamp goal" value={stampGoal} type="number" min="1" max="50" onChange={(event) => setStampGoal(Number(event.target.value))} /><button type="button" aria-label="Increase stamp goal" onClick={() => setStampGoal(Math.min(50, stampGoal + 1))}><Plus size={18} /></button></span></label> : <label className="owner-stepper"><span><strong>Points per dollar</strong><small>Earning rate for purchases.</small></span><span className="stepper-control"><button type="button" aria-label="Decrease points rate" onClick={() => setPointsPerDollar(Math.max(0.01, pointsPerDollar - 1))}><Minus size={18} /></button><input aria-label="Points per dollar" value={pointsPerDollar} type="number" min="0.01" max="1000" step="0.01" onChange={(event) => setPointsPerDollar(Number(event.target.value))} /><button type="button" aria-label="Increase points rate" onClick={() => setPointsPerDollar(Math.min(1000, pointsPerDollar + 1))}><Plus size={18} /></button></span></label>}
        </div>
      </section>

      <section className="owner-section salon-settings-section">
        <div className="owner-section-heading"><div><p className="eyebrow">Public details</p><h2>Salon information</h2></div></div>
        <div className="salon-settings-form">
          <label>Salon name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Street address<input maxLength={300} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
          <label>Phone number<input type="tel" maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          <label className="salon-info-field">General information<textarea rows={4} maxLength={1000} value={generalInfo} onChange={(event) => setGeneralInfo(event.target.value)} /></label>
        </div>
        <fieldset className="opening-hours-editor">
          <legend>Opening hours</legend>
          {WEEK_DAYS.map((day) => <label className="opening-hours-row" key={day}><span>{day}</span><input required maxLength={100} value={openingHours[day]} onChange={(event) => setOpeningHours((current) => ({ ...current, [day]: event.target.value }))} /></label>)}
        </fieldset>
      </section>

      <div className="owner-program-save"><button className="owner-save-button" disabled={busy}>{busy ? 'Saving...' : 'Save program and salon'}</button></div>
    </form>
  </section>
}
