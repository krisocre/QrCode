import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BadgeInfo, ChevronRight, Clock3, Gift, Home, LogOut, MapPin, Phone, ScanLine, ShieldCheck, Sparkles, UserRound, WalletCards } from 'lucide-react'
import { BottomSheet } from '../components/BottomSheet'
import { BrandMark } from '../components/BrandMark'
import { QRCode } from '../components/QRCode'
import { ApiError } from '../lib/api-client'
import { displayPhone, formatPhoneInput, normalizePhone } from '../lib/format'
import { productionConfigurationIssues, tenantSlugFromLocation } from '../lib/runtime'
import { clearSupabaseSession, customerAccessToken, getSupabaseClient } from '../lib/supabase'
import { productionApi } from './client'
import type { CustomerProfileResponse, ProductionReward, PublicTenantResponse } from './types'

type CustomerView = 'booting' | 'phone' | 'otp' | 'enroll' | 'wallet' | 'info' | 'unavailable'

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiError || error instanceof Error) return error.message
  return fallback
}

function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function ProductionCustomerApp() {
  const tenantSlug = tenantSlugFromLocation()
  const isInfoRoute = window.location.pathname === '/info' || window.location.pathname.startsWith('/info/')
  const isProfileRoute = window.location.pathname === '/profile' || window.location.pathname.startsWith('/profile/')
  const walletTestRequested = new URLSearchParams(window.location.search).get('test-wallet') === '1'
  const configurationIssues = productionConfigurationIssues()
  const [view, setView] = useState<CustomerView>('booting')
  const [publicData, setPublicData] = useState<PublicTenantResponse | null>(null)
  const [account, setAccount] = useState<CustomerProfileResponse | null>(null)
  const [phone, setPhone] = useState('+1 ')
  const [otp, setOtp] = useState(Array.from({ length: 6 }, () => ''))
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [profileOpen, setProfileOpen] = useState(isProfileRoute)
  const [walletMessage, setWalletMessage] = useState('')
  const [walletTestStarted, setWalletTestStarted] = useState(false)
  const [selectedReward, setSelectedReward] = useState<ProductionReward | null>(null)
  const [redemption, setRedemption] = useState<{ barcodeValue: string; expiresAt: string } | null>(null)
  const [now, setNow] = useState(Date.now())

  const loadAccount = useCallback(async () => {
    try {
      const profile = await productionApi.customerProfile()
      setAccount(profile)
      if (isProfileRoute) setProfileOpen(true)
      setView('wallet')
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 404 || caught.code === 'profile_not_found')) setView('enroll')
      else if (caught instanceof ApiError && caught.status === 401) setView('phone')
      else {
        setError(messageFor(caught, 'Unable to open your membership.'))
        setView('phone')
      }
    }
  }, [isProfileRoute])

  useEffect(() => {
    if (configurationIssues.length) {
      setView('unavailable')
      return
    }
    let active = true
    void productionApi.publicTenant(tenantSlug).then(async (result) => {
      if (!active) return
      setPublicData(result)
      if (isInfoRoute) { setView('info'); return }
      const token = await customerAccessToken()
      if (!active) return
      if (token) await loadAccount()
      else setView('phone')
    }).catch((caught) => {
      if (!active) return
      setError(messageFor(caught, 'This salon membership link is unavailable.'))
      setView('unavailable')
    })
    return () => { active = false }
  }, [isInfoRoute, loadAccount, tenantSlug])

  useEffect(() => {
    if (view !== 'wallet' || !account?.profile.id || !account.tenant.id) return
    const client = getSupabaseClient()
    let refreshTimer = 0
    const channel = client
      .channel(`member:${account.tenant.id}:${account.profile.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'loyalty_transactions',
        filter: `customer_id=eq.${account.profile.id}`,
      }, () => {
        window.clearTimeout(refreshTimer)
        refreshTimer = window.setTimeout(() => void loadAccount(), 120)
      })
      .subscribe()
    return () => {
      window.clearTimeout(refreshTimer)
      void client.removeChannel(channel)
    }
  }, [account?.profile.id, account?.tenant.id, loadAccount, view])

  useEffect(() => {
    if (!redemption) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [redemption])

  useEffect(() => {
    if (!walletTestRequested || !account || walletTestStarted) return
    setWalletTestStarted(true)
    void addToWallet()
  }, [account, walletTestRequested, walletTestStarted])

  async function requestCode(event: React.FormEvent) {
    event.preventDefault()
    const normalized = normalizePhone(phone)
    if (normalized.length !== 12) {
      setError('Enter a valid 10-digit mobile number.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await productionApi.phoneLogin({ tenantSlug, phone: normalized })
      await loadAccount()
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'unverified_phone_login_disabled') {
        try {
          await productionApi.requestOtp({ tenantSlug, phone: normalized })
          setOtp(Array.from({ length: 6 }, () => ''))
          setView('otp')
        } catch (otpError) {
          setError(messageFor(otpError, 'Unable to send a verification code.'))
        }
      } else {
        setError(messageFor(caught, 'Unable to open your membership.'))
      }
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(nextOtp = otp) {
    const code = nextOtp.join('')
    if (code.length !== 6) return
    setBusy(true)
    setError('')
    try {
      await productionApi.verifyOtp({ tenantSlug, phone: normalizePhone(phone), code })
      await loadAccount()
    } catch (caught) {
      setError(messageFor(caught, 'That code could not be verified.'))
      setOtp(Array.from({ length: 6 }, () => ''))
      document.getElementById('production-otp-0')?.focus()
    } finally {
      setBusy(false)
    }
  }

  function updateOtp(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...otp]
    next[index] = digit
    setOtp(next)
    setError('')
    if (digit && index < next.length - 1) document.getElementById(`production-otp-${index + 1}`)?.focus()
    if (digit && index === next.length - 1 && next.every(Boolean)) void verifyCode(next)
  }

  async function enroll(event: React.FormEvent) {
    event.preventDefault()
    if (!firstName.trim()) { setError('Enter your first name.'); return }
    if (!consentAccepted) { setError('Accept the loyalty program terms to continue.'); return }
    setBusy(true)
    setError('')
    try {
      const result = await productionApi.enrollCustomer({
        tenantSlug,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        consentAccepted,
      })
      setAccount(result)
      setView('wallet')
    } catch (caught) {
      setError(messageFor(caught, 'Unable to create your membership.'))
    } finally {
      setBusy(false)
    }
  }

  async function addToWallet() {
    if (!account) return
    setBusy(true)
    setWalletMessage('')
    try {
      const result = await productionApi.wallet(account.profile.wallet ? 'restore' : 'issue')
      window.location.assign(result.saveUrl)
    } catch (caught) {
      setWalletMessage(messageFor(caught, 'Unable to prepare your Google Wallet pass.'))
      setBusy(false)
    }
  }

  async function createRedemption() {
    if (!selectedReward) return
    if (!navigator.onLine) { setWalletMessage('Reconnect before starting a redemption.'); return }
    setBusy(true)
    setWalletMessage('')
    try {
      setRedemption(await productionApi.redemption(selectedReward.id))
    } catch (caught) {
      setWalletMessage(messageFor(caught, 'Unable to prepare this reward.'))
    } finally { setBusy(false) }
  }

  async function signOut() {
    setBusy(true)
    try { await clearSupabaseSession() } catch { /* The local session is cleared by Supabase when possible. */ }
    setAccount(null)
    setPhone('+1 ')
    setProfileOpen(false)
    setWalletTestStarted(false)
    setView('phone')
    setBusy(false)
  }

  if (view === 'booting') return <main className="auth-shell"><div className="loading-line" aria-label="Loading membership" /></main>

  if (view === 'unavailable') return <main className="auth-shell"><section className="auth-panel configuration-panel"><BrandMark /><ShieldCheck size={30} /><p className="eyebrow">Membership unavailable</p><h1>Setup is not complete.</h1><p>{configurationIssues.length ? `Missing ${configurationIssues.join(', ')}.` : error}</p><p className="privacy-note">No customer information has been submitted.</p></section></main>

  const tenant = account?.tenant ?? publicData?.tenant
  if (!tenant) return null

  if (view === 'info') {
    const hours = Object.entries(tenant.openingHours ?? {})
    return <main className="salon-info-shell"><header className="salon-info-hero" style={{ backgroundImage: `linear-gradient(to bottom, rgba(26,26,26,.08), rgba(26,26,26,.76)), url(${tenant.heroImageUrl || '/salon-interior-pink.png'})` }}><a href={`/?tenant=${encodeURIComponent(tenant.slug)}`} className="salon-info-back" aria-label="Back to membership"><ArrowLeft size={21} /></a><div><p className="eyebrow">Salon information</p><h1>{tenant.name}</h1></div></header><section className="salon-info-content"><article><MapPin size={22} /><div><p className="eyebrow">Location</p><h2>{tenant.address || 'Address coming soon'}</h2>{tenant.address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tenant.address)}`} target="_blank" rel="noreferrer">Open in Maps <ChevronRight size={17} /></a>}</div></article><article><Clock3 size={22} /><div><p className="eyebrow">Opening hours</p>{hours.length ? <dl>{hours.map(([day, value]) => <div key={day}><dt>{day}</dt><dd>{value}</dd></div>)}</dl> : <p>Contact the salon for today's hours.</p>}</div></article><article><BadgeInfo size={22} /><div><p className="eyebrow">About</p><p>{tenant.generalInfo || `${tenant.name} loyalty members collect rewards with every eligible visit.`}</p></div></article>{tenant.phone && <a className="salon-info-call" href={`tel:${tenant.phone}`}><Phone size={19} /> Call {tenant.name}</a>}</section></main>
  }

  if (view === 'phone') {
    const tenantQuery = encodeURIComponent(tenant.slug)
    return <main className="auth-shell"><section className="auth-panel"><BrandMark /><div className="auth-copy"><p className="eyebrow">Luxe Hair Studio 2</p><h1>Your salon card,<br />inside your phone.</h1><p>Enter your number to add or restore your loyalty pass.</p></div><form className="auth-form" onSubmit={requestCode}><label htmlFor="production-phone">Mobile number</label><input id="production-phone" className="phone-input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(formatPhoneInput(event.target.value))} autoFocus />{error && <p className="field-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Opening...' : <>Continue <ChevronRight size={19} /></>}</button></form><p className="privacy-note"><ShieldCheck size={16} /> Your number is used to find your salon membership.</p><nav className="portal-access" aria-label="Salon team access"><a className="portal-access-wallet" href={`/?tenant=${tenantQuery}&test-wallet=1`}><WalletCards size={19} /><span><strong>Test Google Wallet</strong><small>Create a personal test pass</small></span><ChevronRight size={18} /></a><div><a href={`/staff?tenant=${tenantQuery}`}><ScanLine size={18} /><span>Staff scanner</span></a><a href={`/admin?tenant=${tenantQuery}`}><UserRound size={18} /><span>Owner dashboard</span></a></div></nav></section></main>
  }

  if (view === 'otp') return <main className="auth-shell"><section className="auth-panel otp-panel"><button className="text-back-button" onClick={() => { setView('phone'); setError('') }}>Back</button><div className="auth-copy"><p className="eyebrow">Check your phone</p><h1>Enter the six-digit code.</h1><p>We sent it to {phone}.</p></div><div className="otp-row production-otp-row" aria-label="Verification code">{otp.map((digit, index) => <input key={index} id={`production-otp-${index}`} value={digit} inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} maxLength={1} aria-label={`Digit ${index + 1}`} onChange={(event) => updateOtp(index, event.target.value)} onKeyDown={(event) => { if (event.key === 'Backspace' && !digit && index > 0) document.getElementById(`production-otp-${index - 1}`)?.focus() }} autoFocus={index === 0} disabled={busy} />)}</div>{error && <p className="field-error" role="alert">{error}</p>}<button className="primary-button" type="button" disabled={busy || otp.some((digit) => !digit)} onClick={() => void verifyCode()}>{busy ? 'Checking...' : 'Verify number'}</button></section></main>

  if (view === 'enroll') return <main className="auth-shell"><section className="auth-panel"><BrandMark /><div className="auth-copy"><p className="eyebrow">One last detail</p><h1>Put a name on your pass.</h1><p>This is what the front desk will see after scanning.</p></div><form className="auth-form" onSubmit={enroll}><label htmlFor="member-first-name">First name<input id="member-first-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" autoFocus /></label><label htmlFor="member-last-name">Last name <small>Optional</small><input id="member-last-name" value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" /></label><label className="consent-check"><input type="checkbox" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} /><span>I agree to the loyalty program terms and privacy notice.</span></label>{error && <p className="field-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Creating membership...' : 'Create my salon card'}</button></form></section></main>

  if (!account) return null
  const { profile, rewards, transactions } = account
  const balance = tenant.programType === 'stamps' ? profile.stamps : profile.points
  const programUnit = tenant.programType === 'stamps' ? 'visits' : 'points'
  const nextReward = rewards.filter((reward) => balance < (tenant.programType === 'stamps' ? reward.stampCost : reward.pointCost)).sort((a, b) => (tenant.programType === 'stamps' ? a.stampCost - b.stampCost : a.pointCost - b.pointCost))[0]
  const earnedRewards = rewards.filter((reward) => balance >= (tenant.programType === 'stamps' ? reward.stampCost : reward.pointCost))
  const goal = nextReward ? (tenant.programType === 'stamps' ? nextReward.stampCost : nextReward.pointCost) : Math.max(balance, tenant.stampGoal)
  const progress = Math.min(100, goal ? balance / goal * 100 : 0)
  const visits = transactions.filter((transaction) => transaction.kind === 'visit').length
  const memberSince = new Date(profile.createdAt).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })

  return <main className="production-wallet-shell">
    <header className="wallet-first-header"><div><BrandMark /><span><small>Loyalty membership</small><strong>{tenant.name}</strong></span></div><button className="icon-button" onClick={() => setProfileOpen(true)} aria-label="Open profile"><UserRound size={20} /></button></header>
    <section className="wallet-first-hero"><div className="wallet-first-copy"><p className="eyebrow">Welcome, {profile.firstName}</p><h1>Your salon card is ready for Google Wallet.</h1><p>Open it at the front desk and let your cashier scan the rotating code.</p></div><div className="native-pass-preview" style={{ backgroundColor: tenant.brandColor || '#C23F73' }}><div className="pass-preview-brand"><BrandMark inverse /><span>{tenant.name}</span></div><div className="pass-preview-balance"><small>{tenant.programType === 'stamps' ? 'Visits completed' : 'Points balance'}</small><strong>{balance.toLocaleString()}</strong></div><div className="pass-preview-footer"><span><small>Member</small><strong>{profile.firstName} {profile.lastName}</strong></span><WalletCards size={28} /></div></div><button className="google-wallet-button" type="button" onClick={() => void addToWallet()} disabled={busy}><img src="/add-to-google-wallet.svg" alt="Add to Google Wallet" /></button>{walletMessage && <p className="field-error" role="alert">{walletMessage}</p>}</section>
    <section className="wallet-progress-band"><header><div><p className="eyebrow">Next upgrade</p><h2>{nextReward?.name ?? 'Every reward is within reach'}</h2></div><strong>{balance}/{goal}</strong></header><div className="reward-progress"><span style={{ width: `${progress}%` }} /></div><p>{nextReward ? `${Math.max(0, goal - balance)} ${programUnit} remaining` : 'Ask the front desk about your available rewards.'}</p></section>
    {earnedRewards.length > 0 && <section className="wallet-earned-band"><div className="production-section-heading"><div><p className="eyebrow">Ready now</p><h2>Earned upgrades</h2></div><Gift size={21} /></div><div className="production-coupon-list">{earnedRewards.map((reward) => <article key={reward.id}><span><Gift size={20} /></span><div><strong>{reward.name}</strong><small>{reward.description || 'Available at the front desk'}</small></div><button onClick={() => { setSelectedReward(reward); setRedemption(null); setWalletMessage('') }}>Redeem</button></article>)}</div></section>}
    <section className="wallet-details-band"><div className="production-section-heading"><div><p className="eyebrow">Membership</p><h2>At a glance</h2></div><Sparkles size={21} /></div><div className="wallet-stat-grid"><div><strong>{balance}</strong><span>{programUnit}</span></div><div><strong>{earnedRewards.length}</strong><span>ready</span></div><div><strong>{visits}</strong><span>recorded visits</span></div></div></section>
    <section className="wallet-contact-band"><div><MapPin size={20} /><span><small>Home salon</small><strong>{tenant.address || tenant.name}</strong></span></div>{tenant.phone && <a href={`tel:${tenant.phone}`}><Phone size={19} /><span>Call the salon</span></a>}<a href={`/info?tenant=${encodeURIComponent(tenant.slug)}`}><BadgeInfo size={19} /><span>Salon information</span></a></section>
    <nav className="salon-bottom-nav production-bottom-nav" aria-label="Customer navigation"><button className={!profileOpen ? 'active' : ''} onClick={() => { setProfileOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><Home size={20} /><span>Home</span></button><button className={profileOpen ? 'active' : ''} onClick={() => setProfileOpen(true)}><UserRound size={20} /><span>My Profile</span></button></nav>
    <BottomSheet open={profileOpen} title="My profile" onClose={() => setProfileOpen(false)}><div className="production-profile-sheet"><header><span>{profile.firstName.slice(0, 1)}{profile.lastName.slice(0, 1)}</span><div><p className="eyebrow">Member since {memberSince}</p><h3>{profile.firstName} {profile.lastName}</h3><p>{displayPhone(profile.phone)}</p></div></header><div className="profile-detail-list"><div><Sparkles size={19} /><span><small>Membership activity</small><strong>{visits ? `${visits} recent salon ${visits === 1 ? 'visit' : 'visits'}` : 'Your first salon visit is ahead'}</strong></span></div><div><Clock3 size={19} /><span><small>Wallet status</small><strong>{profile.wallet ? 'Pass issued' : 'Ready to add'}</strong></span></div><div><ShieldCheck size={19} /><span><small>Membership access</small><strong>Phone sign-in enabled</strong></span></div></div><button className="profile-sign-out" onClick={() => void signOut()} disabled={busy}><LogOut size={20} /><span><strong>Sign out</strong><small>Keep the pass in Google Wallet</small></span><ChevronRight size={18} /></button></div></BottomSheet>
    <BottomSheet open={Boolean(selectedReward)} title={redemption ? 'Redemption code' : 'Use this reward'} onClose={() => { setSelectedReward(null); setRedemption(null); setWalletMessage('') }} className="redemption-sheet">{selectedReward && (redemption ? <div className="redemption-code">{Date.parse(redemption.expiresAt) <= now ? <div className="expired-code"><Clock3 size={30} /><h3>This code has expired.</h3><p>Close this sheet and create a new code when the cashier is ready.</p></div> : <><p className="eyebrow">{selectedReward.name}</p><QRCode value={redemption.barcodeValue} size={280} /><div className="countdown"><Clock3 size={18} /> Expires in <strong>{formatCountdown(Date.parse(redemption.expiresAt) - now)}</strong></div><p className="scan-instruction">Let the cashier scan this code before confirming the reward.</p></>}</div> : <div className="production-redeem-confirm"><span><Gift size={24} /></span><h3>{selectedReward.name}</h3><p>This creates a single-use code for the front desk. It expires after five minutes.</p>{walletMessage && <p className="field-error" role="alert">{walletMessage}</p>}<button className="confirm-transaction" disabled={busy} onClick={() => void createRedemption()}><Gift size={19} /> {busy ? 'Preparing...' : 'Create redemption code'}</button></div>)}</BottomSheet>
  </main>
}
