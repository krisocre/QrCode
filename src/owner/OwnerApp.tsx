import { useState } from 'react'
import { Gift, LayoutDashboard, LockKeyhole, LogOut, Settings2, SlidersHorizontal, UsersRound } from 'lucide-react'
import { BrandMark } from '../components/BrandMark'
import { useDatabase } from '../hooks/useDatabase'
import { loyaltyStore } from '../lib/store'
import { CustomerDirectory } from './CustomerDirectory'
import { OwnerOverview } from './OwnerOverview'
import { ProgramSettings } from './ProgramSettings'
import { RewardsManager } from './RewardsManager'
import { StaffManager } from './StaffManager'

type OwnerTab = 'overview' | 'rewards' | 'staff' | 'customers' | 'program'
const OWNER_SESSION = 'juniper-owner-session'

export function OwnerApp() {
  const database = useDatabase()
  const sessionKey = `${OWNER_SESSION}:${database.tenant.id}`
  const [ownerId, setOwnerId] = useState(() => sessionStorage.getItem(sessionKey) ?? '')
  const [pin, setPin] = useState(['', '', '', ''])
  const [pinError, setPinError] = useState('')
  const [tab, setTab] = useState<OwnerTab>('overview')
  const owner = database.profiles.find((profile) => profile.id === ownerId && profile.role === 'owner')
  const demoOwner = database.profiles.find((profile) => profile.role === 'owner')

  function updatePin(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...pin]
    next[index] = digit
    setPin(next)
    setPinError('')
    if (digit && index < 3) document.getElementById(`owner-pin-${index + 1}`)?.focus()
    if (digit && index === 3) {
      const matched = loyaltyStore.verifyOwnerPin(next.join(''))
      if (matched) {
        sessionStorage.setItem(sessionKey, matched.id)
        setOwnerId(matched.id)
      } else {
        setPinError(`Incorrect PIN. Try ${demoOwner?.accessPin ?? '7391'} for this demo.`)
        window.setTimeout(() => setPin(['', '', '', '']), 400)
      }
    }
  }

  if (!owner) return <main className="owner-lock"><section className="pin-panel owner-pin-panel"><BrandMark inverse /><div className="lock-icon"><LockKeyhole size={25} /></div><p className="eyebrow">Owner access</p><h1>Open your dashboard</h1><p>Enter the owner PIN for {database.tenant.name}.</p><div className="pin-row" aria-label="Owner PIN">{pin.map((digit, index) => <input key={index} id={`owner-pin-${index}`} value={digit} type="password" inputMode="numeric" maxLength={1} aria-label={`Owner PIN digit ${index + 1}`} onChange={(event) => updatePin(index, event.target.value)} autoFocus={index === 0} />)}</div>{pinError && <p className="pin-error">{pinError}</p>}<p className="demo-pin">Demo owner PIN <strong>{demoOwner?.accessPin ?? '7391'}</strong></p></section></main>

  const navigation = [
    { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
    { id: 'rewards' as const, label: 'Rewards', icon: Gift },
    { id: 'staff' as const, label: 'Staff', icon: Settings2 },
    { id: 'customers' as const, label: 'Customers', icon: UsersRound },
    { id: 'program' as const, label: 'Program', icon: SlidersHorizontal },
  ]
  const activeLabel = navigation.find((item) => item.id === tab)?.label ?? 'Overview'

  return <main className="owner-shell">
    <aside className="owner-sidebar"><div className="owner-brand"><BrandMark inverse /><div><strong>{database.tenant.name}</strong><span>Owner portal</span></div></div><nav>{navigation.map(({ id, label, icon: Icon }) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}><Icon size={19} /><span>{label}</span></button>)}</nav><div className="owner-sidebar-user"><span>{owner.firstName.slice(0, 1)}{owner.lastName.slice(0, 1)}</span><div><strong>{owner.firstName} {owner.lastName}</strong><small>Owner</small></div><button onClick={() => { sessionStorage.removeItem(sessionKey); setOwnerId(''); setPin(['', '', '', '']) }} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button></div></aside>
    <div className="owner-main">
      <header className="owner-mobile-header"><div><BrandMark /><span><strong>{database.tenant.name}</strong><small>{activeLabel}</small></span></div><button className="icon-button" onClick={() => { sessionStorage.removeItem(sessionKey); setOwnerId(''); setPin(['', '', '', '']) }} aria-label="Sign out"><LogOut size={18} /></button></header>
      {tab === 'overview' && <OwnerOverview />}
      {tab === 'rewards' && <RewardsManager ownerId={owner.id} />}
      {tab === 'staff' && <StaffManager ownerId={owner.id} />}
      {tab === 'customers' && <CustomerDirectory ownerId={owner.id} />}
      {tab === 'program' && <ProgramSettings ownerId={owner.id} />}
    </div>
    <nav className="owner-mobile-nav" aria-label="Admin sections">{navigation.map(({ id, label, icon: Icon }) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => { setTab(id); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><Icon size={20} /><span>{label}</span></button>)}</nav>
  </main>
}
