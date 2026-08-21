import { useCallback, useState } from 'react'
import { Check, ClipboardList, LockKeyhole, LogOut, ScanLine, Search, ShieldCheck } from 'lucide-react'
import { BrandMark } from '../components/BrandMark'
import { useDatabase } from '../hooks/useDatabase'
import { loyaltyStore } from '../lib/store'
import type { Profile, ScannedPayload } from '../types'
import { AuditLog } from './AuditLog'
import { CustomerActionSheet } from './CustomerActionSheet'
import { ManualSearch } from './ManualSearch'
import { ScannerView } from './ScannerView'

type StaffTab = 'scan' | 'search' | 'audit'
const STAFF_SESSION = 'juniper-staff-session'
let feedbackContext: AudioContext | null = null

function initializeAudioFeedback() {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    feedbackContext ??= new AudioContextClass()
    void feedbackContext.resume()
    const oscillator = feedbackContext.createOscillator()
    const gain = feedbackContext.createGain()
    gain.gain.value = 0.0001
    oscillator.connect(gain).connect(feedbackContext.destination)
    oscillator.start()
    oscillator.stop(feedbackContext.currentTime + 0.01)
  } catch {
    // Haptic and visual feedback remain available when audio is restricted.
  }
}

function chime() {
  try {
    if (!feedbackContext) return
    const context = feedbackContext
    void context.resume()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(660, context.currentTime)
    oscillator.frequency.setValueAtTime(880, context.currentTime + 0.08)
    gain.gain.setValueAtTime(0.12, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.24)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.24)
  } catch {
    // Audio feedback is optional on restricted mobile browsers.
  }
}

export function StaffApp() {
  const database = useDatabase()
  const sessionKey = `${STAFF_SESSION}:${database.tenant.id}`
  const [staffId, setStaffId] = useState(() => sessionStorage.getItem(sessionKey) ?? '')
  const [pin, setPin] = useState(['', '', '', ''])
  const [pinError, setPinError] = useState('')
  const [tab, setTab] = useState<StaffTab>('scan')
  const [customer, setCustomer] = useState<Profile | null>(null)
  const [payload, setPayload] = useState<ScannedPayload | null>(null)
  const [source, setSource] = useState<'scan' | 'manual'>('scan')
  const [scanError, setScanError] = useState('')
  const [success, setSuccess] = useState('')
  const staff = database.profiles.find((profile) => profile.id === staffId && profile.role === 'staff')
  const demoStaff = database.profiles.find((profile) => profile.role === 'staff')

  function updatePin(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...pin]
    next[index] = digit
    setPin(next)
    setPinError('')
    if (digit && index < 3) document.getElementById(`pin-${index + 1}`)?.focus()
    if (digit && index === 3) {
      initializeAudioFeedback()
      const matchedStaff = loyaltyStore.verifyStaffPin(next.join(''))
      if (matchedStaff) {
        sessionStorage.setItem(sessionKey, matchedStaff.id)
        setStaffId(matchedStaff.id)
      } else {
        setPinError(`Incorrect PIN. Try ${demoStaff?.accessPin ?? '4826'} for this demo.`)
        window.setTimeout(() => setPin(['', '', '', '']), 400)
      }
    }
  }

  const handleRawScan = useCallback((value: string) => {
    const parsed = loyaltyStore.parsePayload(value)
    if (!parsed) {
      setScanError(`Code not recognized. Scan a ${database.tenant.name} member code.`)
      window.setTimeout(() => setScanError(''), 2600)
      return
    }
    const matched = loyaltyStore.getSnapshot().profiles.find((profile) => profile.id === parsed.customerId && profile.role === 'customer')
    if (!matched) {
      setScanError('Customer account was not found.')
      return
    }
    setPayload(parsed)
    setSource('scan')
    setCustomer(matched)
  }, [database.tenant.name])

  function selectManual(selected: Profile) {
    setPayload(null)
    setSource('manual')
    setCustomer(selected)
  }

  function transactionConfirmed(message: string) {
    setCustomer(null)
    setPayload(null)
    setSuccess(message)
    navigator.vibrate?.([40, 30, 80])
    chime()
    window.setTimeout(() => setSuccess(''), 820)
  }

  if (!staff) {
    return (
      <main className="staff-lock">
        <section className="pin-panel">
          <BrandMark inverse />
          <div className="lock-icon"><LockKeyhole size={25} /></div>
          <p className="eyebrow">Staff access</p>
          <h1>Enter your PIN</h1>
          <p>Fast, secure access for the current shift.</p>
          <div className="pin-row" aria-label="Staff PIN">
            {pin.map((digit, index) => (
              <input
                key={index}
                id={`pin-${index}`}
                value={digit}
                type="password"
                inputMode="numeric"
                maxLength={1}
                aria-label={`PIN digit ${index + 1}`}
                onChange={(event) => updatePin(index, event.target.value)}
                autoFocus={index === 0}
              />
            ))}
          </div>
          {pinError && <p className="pin-error">{pinError}</p>}
          <p className="demo-pin">Demo staff PIN <strong>{demoStaff?.accessPin ?? '4826'}</strong></p>
          <div className="device-status"><ShieldCheck size={17} /> Session locks when this tab closes</div>
        </section>
      </main>
    )
  }

  return (
    <main className={`staff-shell ${tab === 'scan' ? 'scanner-active' : ''}`}>
      <header className="staff-topbar">
        <div><BrandMark inverse={tab === 'scan'} /><span>{database.tenant.name}</span></div>
        <div className="staff-identity"><span>{staff.firstName}</span><button className="icon-button" onClick={() => { sessionStorage.removeItem(sessionKey); setStaffId(''); setPin(['', '', '', '']) }} aria-label="Lock staff portal" title="Lock staff portal"><LogOut size={18} /></button></div>
      </header>

      <div className="staff-content">
        {tab === 'scan' && <ScannerView paused={Boolean(customer)} onScan={handleRawScan} onDemoScan={() => {
          const demoCustomer = database.profiles.find((profile) => profile.role === 'customer')
          if (demoCustomer) handleRawScan(loyaltyStore.customerPayload(demoCustomer.id))
        }} />}
        {tab === 'search' && <ManualSearch onSelect={selectManual} />}
        {tab === 'audit' && <AuditLog staffId={staff.id} />}
      </div>

      {scanError && <div className="scan-toast" role="alert">{scanError}</div>}
      <nav className="staff-nav" aria-label="Staff tools">
        <button className={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}><ScanLine size={22} /><span>Scan</span></button>
        <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}><Search size={22} /><span>Search</span></button>
        <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}><ClipboardList size={22} /><span>Activity</span></button>
      </nav>

      <CustomerActionSheet customer={customer} payload={payload} source={source} staffId={staff.id} onClose={() => { setCustomer(null); setPayload(null) }} onConfirmed={transactionConfirmed} />

      <div className={`success-flash ${success ? 'visible' : ''}`} aria-live="assertive">
        <div className="success-check"><Check size={42} strokeWidth={3} /></div>
        <h2>Transaction confirmed</h2>
        <p>{success}</p>
      </div>
    </main>
  )
}
