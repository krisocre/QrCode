import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BadgeInfo, Check, ChevronRight, Clock3, Gift, Home, LogOut, MapPin, Menu, Phone, Scissors, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { BottomSheet } from '../components/BottomSheet'
import { BrandMark } from '../components/BrandMark'
import { QRCode } from '../components/QRCode'
import { useDatabase } from '../hooks/useDatabase'
import { formatPhoneInput, normalizePhone } from '../lib/format'
import { clearCustomerSession, readCustomerSession, saveCustomerSession } from '../lib/session'
import { loyaltyStore } from '../lib/store'
import type { PendingRedemption, Reward } from '../types'

type AuthView = 'loading' | 'phone' | 'otp' | 'dashboard'
type CustomerSection = 'rewards' | 'stylists' | 'info'

function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export function CustomerApp() {
  const database = useDatabase()
  const [view, setView] = useState<AuthView>('loading')
  const [phone, setPhone] = useState('+1 ')
  const [otp, setOtp] = useState(['', '', '', ''])
  const [profileId, setProfileId] = useState<string | null>(null)
  const [selectedReward, setSelectedReward] = useState<Reward | null>(null)
  const [redemption, setRedemption] = useState<PendingRedemption | null>(null)
  const [qrExpanded, setQrExpanded] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [authError, setAuthError] = useState('')
  const [activeSection, setActiveSection] = useState<CustomerSection>('rewards')
  const [menuOpen, setMenuOpen] = useState(false)
  const [showAdminAccess, setShowAdminAccess] = useState(false)

  useEffect(() => {
    void readCustomerSession().then((session) => {
      const valid = session && session.tenantId === database.tenant.id && database.profiles.some((profile) => profile.id === session.profileId && profile.role === 'customer')
      if (valid && session) {
        setProfileId(session.profileId)
        setView('dashboard')
      } else {
        setView('phone')
      }
    })
  }, [])

  useEffect(() => {
    if (view !== 'dashboard') return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [view])

  const customer = database.profiles.find((profile) => profile.id === profileId && profile.role === 'customer')
  const redemptionExpired = redemption ? redemption.expiresAt <= now : false

  const customerQr = useMemo(
    () => customer ? loyaltyStore.customerPayload(customer.id, now) : '',
    [customer?.id, Math.floor(now / 60_000)],
  )

  function submitPhone(event: React.FormEvent) {
    event.preventDefault()
    if (normalizePhone(phone).length !== 12) {
      setAuthError('Enter a 10-digit phone number.')
      return
    }
    try {
      loyaltyStore.requestOtp(normalizePhone(phone))
      setAuthError('')
      setView('otp')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to send a verification code.')
    }
  }

  async function verifyOtp(nextOtp = otp) {
    if (nextOtp.join('') !== '2468') {
      setAuthError('That code does not match. Try 2468 for this demo.')
      return
    }
    const normalized = normalizePhone(phone)
    const profile = loyaltyStore.findCustomerByPhone(normalized) ?? loyaltyStore.registerCustomer(normalized)
    await saveCustomerSession(profile.id, database.tenant.id)
    setProfileId(profile.id)
    setShowAdminAccess(false)
    setAuthError('')
    setView('dashboard')
  }

  function updateOtp(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...otp]
    next[index] = digit
    setOtp(next)
    setAuthError('')
    if (digit && index < 3) document.getElementById(`otp-${index + 1}`)?.focus()
    if (digit && index === 3 && next.every(Boolean)) void verifyOtp(next)
  }

  function confirmRedemption() {
    if (!customer || !selectedReward) return
    try {
      const next = loyaltyStore.createRedemption(customer.id, selectedReward.id)
      setRedemption(next)
      setNow(Date.now())
      setSelectedReward(null)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to create redemption.')
    }
  }

  if (view === 'loading') {
    return <main className="auth-shell"><div className="loading-line" aria-label="Loading" /></main>
  }

  if (view === 'phone') {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <BrandMark />
          <div className="auth-copy">
            <p className="eyebrow">Luxe Hair Studio 2</p>
            <h1>Your rewards,<br />right this way.</h1>
            <p>Enter your mobile number to open your loyalty wallet.</p>
          </div>
          <form onSubmit={submitPhone} className="auth-form">
            <label htmlFor="phone">Mobile number</label>
            <input
              id="phone"
              className="phone-input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
              autoFocus
            />
            {authError && <p className="field-error" role="alert">{authError}</p>}
            <button className="primary-button" type="submit">Continue <ChevronRight size={19} /></button>
          </form>
          <p className="demo-note">Returning demo member: (416) 555-0182</p>
          <p className="privacy-note"><ShieldCheck size={16} /> Your number is used only for your loyalty account.</p>
          {showAdminAccess && <section className="signed-out-admin" aria-label="Signed out options"><div><p className="eyebrow">Signed out</p><strong>Need the owner dashboard?</strong></div><button type="button" onClick={() => window.location.assign(`/admin?tenant=${encodeURIComponent(database.tenant.slug)}`)}><ShieldCheck size={19} /><span>Open admin login</span><ChevronRight size={18} /></button></section>}
        </section>
      </main>
    )
  }

  if (view === 'otp') {
    return (
      <main className="auth-shell">
        <section className="auth-panel otp-panel">
          <button className="icon-button auth-back" onClick={() => { setView('phone'); setAuthError('') }} aria-label="Back" title="Back">
            <ArrowLeft size={22} />
          </button>
          <div className="auth-copy">
            <p className="eyebrow">Check your phone</p>
            <h1>Enter the 4-digit code.</h1>
            <p>We sent it to {phone}.</p>
          </div>
          <div className="otp-row" aria-label="Verification code">
            {otp.map((digit, index) => (
              <input
                key={index}
                id={`otp-${index}`}
                value={digit}
                inputMode="numeric"
                autoComplete={index === 0 ? 'one-time-code' : 'off'}
                maxLength={1}
                aria-label={`Digit ${index + 1}`}
                onChange={(event) => updateOtp(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Backspace' && !digit && index > 0) document.getElementById(`otp-${index - 1}`)?.focus()
                }}
                autoFocus={index === 0}
              />
            ))}
          </div>
          {authError && <p className="field-error centered" role="alert">{authError}</p>}
          <button className="primary-button" type="button" onClick={() => void verifyOtp()}>Verify number</button>
          <p className="demo-code">Demo verification code <strong>2468</strong></p>
        </section>
      </main>
    )
  }

  if (!customer) return null

  const programBalance = database.tenant.programType === 'stamps' ? customer.stamps : customer.points
  const programUnit = database.tenant.programType
  const memberSinceYear = new Date(customer.createdAt ?? Date.now()).getFullYear()
  const memberNumber = customer.phone.slice(-4) || customer.id.slice(-4).toUpperCase()
  const fullCardRemaining = database.tenant.programType === 'stamps' ? Math.max(0, database.tenant.stampGoal - customer.stamps) : Math.max(0, 1000 - customer.points)
  const availableRewards = database.rewards.filter((reward) => programBalance >= (database.tenant.programType === 'stamps' ? reward.stampCost : reward.pointCost))
  const customerTabs: Array<{ id: CustomerSection; label: string }> = [
    { id: 'rewards', label: 'Perks & Rewards' },
    { id: 'stylists', label: 'Stylists' },
    { id: 'info', label: 'Info' },
  ]

  return (
    <main className="salon-customer-shell">
      <header className="salon-hero">
        <div className="salon-hero-actions">
          <button className="hero-circle-button" type="button" onClick={() => window.history.back()} aria-label="Back" title="Back"><ArrowLeft size={22} /></button>
          <button className="hero-circle-button" type="button" onClick={() => setMenuOpen(true)} aria-label="Open salon menu" title="Menu"><Menu size={22} /></button>
        </div>
        <div className="salon-hero-copy"><p>Member rewards</p><h1>{database.tenant.name}</h1><span>Welcome back, {customer.firstName}</span></div>
      </header>

      <nav className="salon-tabs" aria-label="Salon sections">
        {customerTabs.map((tab) => <button key={tab.id} className={activeSection === tab.id ? 'active' : ''} onClick={() => setActiveSection(tab.id)}>{tab.label}</button>)}
      </nav>

      <section className="salon-home-content">
        <button className="salon-loyalty-pass" type="button" onClick={() => setQrExpanded(true)} aria-label="Show member QR code">
          <span className="pass-copy"><small>Loyalty balance</small><strong>{programBalance.toLocaleString()} <em>{database.tenant.programType === 'stamps' ? 'visits completed' : 'points'}</em></strong><span><Clock3 size={13} /> Code refreshes in {loyaltyStore.barcodeRefreshSeconds(now)}s</span></span>
          <span className="pass-qr"><QRCode value={customerQr} size={72} /><small>Scan at desk</small></span>
        </button>

        {activeSection === 'rewards' && <>
          <section className="salon-progress-section" aria-labelledby="progress-title">
            <div className="salon-section-heading"><div><p className="eyebrow">Your progress</p><h2 id="progress-title">{database.tenant.programType === 'stamps' ? `${Math.max(0, database.tenant.stampGoal - customer.stamps)} visits from a full card` : 'Keep earning toward your next service'}</h2></div><strong>{database.tenant.programType === 'stamps' ? `${customer.stamps}/${database.tenant.stampGoal}` : `${customer.points} pts`}</strong></div>
            {database.tenant.programType === 'stamps' ? <div className="salon-stamp-track">{Array.from({ length: database.tenant.stampGoal }, (_, index) => <span key={index} className={index < customer.stamps ? 'earned' : ''}>{index < customer.stamps ? <Check size={15} /> : index + 1}</span>)}</div> : <div className="points-progress"><span style={{ width: `${Math.min(100, customer.points / 1000 * 100)}%` }} /></div>}
          </section>

          {availableRewards.length > 0 && <section className="earned-services"><div className="salon-section-heading"><div><p className="eyebrow">Earned upgrades</p><h2>Ready for your next visit</h2></div><Gift size={20} /></div><div className="earned-rewards-strip ticket-strip">{availableRewards.map((reward) => <button key={reward.id} onClick={() => setSelectedReward(reward)}><span><Scissors size={23} /></span><div><strong>{reward.name}</strong><small>Tap to redeem</small></div><ChevronRight size={18} /></button>)}</div></section>}

          <section className="salon-catalog" aria-labelledby="rewards-title">
            <div className="salon-section-heading"><div><p className="eyebrow">Available rewards</p><h2 id="rewards-title">Your next upgrades</h2></div><Sparkles size={20} /></div>
            <div className="salon-reward-list">{database.rewards.map((reward) => {
              const cost = database.tenant.programType === 'stamps' ? reward.stampCost : reward.pointCost
              const available = programBalance >= cost
              const progress = Math.min(100, programBalance / cost * 100)
              return <article className="salon-reward-card" key={reward.id}><div className="salon-reward-top"><span className="salon-service-icon"><Scissors size={21} /></span><div><h3>{reward.name}</h3><p>{reward.description}</p></div><button disabled={!available} onClick={() => setSelectedReward(reward)}>{available ? 'Redeem' : `${cost - programBalance} more`}</button></div><div className="reward-progress"><span style={{ width: `${progress}%` }} /></div><small>{programBalance.toLocaleString()} of {cost.toLocaleString()} {programUnit}{available ? ' | Ready to redeem' : ` | ${cost - programBalance} ${database.tenant.programType === 'stamps' ? 'visits' : 'points'} remaining`}</small></article>
            })}</div>
          </section>

        </>}

        {activeSection === 'stylists' && <section className="salon-detail-section"><div className="salon-section-heading"><div><p className="eyebrow">Our team</p><h2>Meet the stylists</h2></div><Scissors size={21} /></div><div className="stylist-list"><article><span>AM</span><div><h3>Ari Morgan</h3><p>Colour, glossing, and dimensional blondes</p></div></article><article><span>JB</span><div><h3>Jordan Bell</h3><p>Precision cuts and modern texture</p></div></article><article><span>NS</span><div><h3>Nina Santos</h3><p>Curly hair and restorative treatments</p></div></article></div></section>}

        {activeSection === 'info' && <section className="salon-detail-section salon-info-section"><div className="salon-section-heading"><div><p className="eyebrow">Visit the studio</p><h2>Everything you need to know</h2></div><BadgeInfo size={21} /></div><div className="salon-location-block"><MapPin size={24} /><div><p className="eyebrow">Location</p><h3>128 Ossington Avenue</h3><p>Toronto, Ontario M6J 2Z5</p><a href="https://maps.google.com/?q=128+Ossington+Avenue+Toronto" target="_blank" rel="noreferrer">Open in Maps <ChevronRight size={16} /></a></div></div><section className="salon-hours" aria-labelledby="hours-title"><div className="info-row-heading"><Clock3 size={20} /><h3 id="hours-title">Opening hours</h3></div><dl><div><dt>Monday</dt><dd>Closed</dd></div><div><dt>Tuesday - Friday</dt><dd>10:00 a.m. - 7:00 p.m.</dd></div><div><dt>Saturday</dt><dd>9:00 a.m. - 5:00 p.m.</dd></div><div><dt>Sunday</dt><dd>10:00 a.m. - 4:00 p.m.</dd></div></dl></section><section className="salon-general-info" aria-labelledby="general-info-title"><div className="info-row-heading"><Sparkles size={20} /><h3 id="general-info-title">Good to know</h3></div><ul><li>Walk-ins are welcome when a stylist is available.</li><li>Street parking and bicycle parking are nearby.</li><li>All major cards and contactless payments are accepted.</li></ul><a href="tel:+14165550144"><Phone size={18} /> Call +1 (416) 555-0144</a></section></section>}
      </section>

      <nav className="salon-bottom-nav" aria-label="Customer navigation"><button className={!menuOpen ? 'active' : ''} onClick={() => { setMenuOpen(false); setActiveSection('rewards'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><Home size={20} /><span>Home</span></button><button className={menuOpen ? 'active' : ''} onClick={() => setMenuOpen(true)}><UserRound size={20} /><span>My Profile</span></button></nav>

      <BottomSheet open={menuOpen} title="My profile" onClose={() => setMenuOpen(false)}>
        <div className="salon-menu-sheet salon-profile-sheet"><header className="member-profile-identity"><span className="profile-avatar">{customer.firstName.slice(0, 1)}{customer.lastName.slice(0, 1)}</span><div><p className="eyebrow">Luxe member</p><h3>{customer.firstName} {customer.lastName}</h3><span>{formatPhoneInput(customer.phone)}</span></div><span className="profile-member-since"><small>Member since</small><strong>{memberSinceYear}</strong></span></header><div className="profile-stats"><div><small>Balance</small><strong>{programBalance.toLocaleString()}</strong><span>{programUnit}</span></div><div><small>Ready now</small><strong>{availableRewards.length}</strong><span>{availableRewards.length === 1 ? 'reward' : 'rewards'}</span></div><div><small>Full card in</small><strong>{fullCardRemaining}</strong><span>{database.tenant.programType === 'stamps' ? 'visits' : 'points'}</span></div></div><section className="profile-detail-list"><div><Sparkles size={19} /><span><small>Membership number</small><strong>LUXE-{memberNumber}</strong></span></div><div><MapPin size={19} /><span><small>Home salon</small><strong>{database.tenant.name}</strong></span></div></section><button onClick={() => { setMenuOpen(false); setActiveSection('info'); window.scrollTo({ top: 252, behavior: 'smooth' }) }}><BadgeInfo size={20} /><span><strong>Salon information</strong><small>Location, opening hours, and contact details</small></span><ChevronRight size={18} /></button><button className="profile-sign-out" onClick={() => { clearCustomerSession(); setProfileId(null); setPhone('+1 '); setMenuOpen(false); setShowAdminAccess(true); setView('phone') }}><LogOut size={20} /><span><strong>Sign out</strong><small>Return to phone login</small></span><ChevronRight size={18} /></button></div>
      </BottomSheet>

      <BottomSheet open={Boolean(selectedReward)} title="Redeem reward" onClose={() => setSelectedReward(null)}>
        {selectedReward && (
          <div className="confirm-reward">
            <div className="reward-summary-icon"><Gift size={25} /></div>
            <h3>{selectedReward.name}</h3>
            <p>This will use {database.tenant.programType === 'stamps' ? selectedReward.stampCost : selectedReward.pointCost} of your {database.tenant.programType === 'stamps' ? customer.stamps : customer.points} {database.tenant.programType}. Show the next screen at the front desk.</p>
            <div className="sheet-actions">
              <button className="primary-button" onClick={confirmRedemption}>Use {database.tenant.programType === 'stamps' ? selectedReward.stampCost : selectedReward.pointCost} {database.tenant.programType}</button>
              <button className="secondary-button" onClick={() => setSelectedReward(null)}>Not yet</button>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={Boolean(redemption)} title="Redemption code" onClose={() => setRedemption(null)} className="redemption-sheet">
        {redemption && (
          <div className="redemption-code">
            {redemptionExpired ? (
              <div className="expired-code"><Clock3 size={32} /><h3>This code has expired.</h3><p>Close this screen and start again when you are at the front desk.</p></div>
            ) : (
              <>
                <p className="scan-instruction">Ask your cashier to scan this code</p>
                <QRCode value={loyaltyStore.redemptionPayload(redemption)} size={280} />
                <div className="countdown"><Clock3 size={18} /> Expires in <strong>{formatCountdown(redemption.expiresAt - now)}</strong></div>
              </>
            )}
          </div>
        )}
      </BottomSheet>

      <div className={`qr-fullscreen ${qrExpanded ? 'open' : ''}`} aria-hidden={!qrExpanded}>
        <button className="icon-button qr-close" onClick={() => setQrExpanded(false)} aria-label="Close" title="Close"><ArrowLeft size={23} /></button>
        <p className="eyebrow">Scan at front desk</p>
        <QRCode value={customerQr} size={340} />
        <h2>{customer.firstName} {customer.lastName}</h2>
        <p className="brightness-prompt">Turn up screen brightness for best scanning.</p>
        <p>Hold your screen steady inside the scanner frame. Code refreshes in {loyaltyStore.barcodeRefreshSeconds(now)}s.</p>
      </div>
    </main>
  )
}
