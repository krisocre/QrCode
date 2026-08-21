import { History, Minus, Phone, Plus, Search, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BottomSheet } from '../components/BottomSheet'
import { useDatabase } from '../hooks/useDatabase'
import { displayPhone, shortTime } from '../lib/format'
import { loyaltyStore } from '../lib/store'
import type { Profile, ProgramType } from '../types'

export function CustomerDirectory({ ownerId }: { ownerId: string }) {
  const database = useDatabase()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Profile | null>(null)
  const [balanceType, setBalanceType] = useState<ProgramType>(database.tenant.programType)
  const [amount, setAmount] = useState('1')
  const [error, setError] = useState('')

  const customers = useMemo(() => {
    const text = query.trim().toLowerCase()
    const digits = query.replace(/\D/g, '')
    return database.profiles.filter((profile) => profile.role === 'customer' && (!text || `${profile.firstName} ${profile.lastName}`.toLowerCase().includes(text) || (digits.length > 0 && profile.phone.replace(/\D/g, '').includes(digits))))
  }, [database.profiles, query])
  const liveSelected = selected ? database.profiles.find((profile) => profile.id === selected.id) ?? selected : null
  const history = liveSelected ? database.transactions.filter((transaction) => transaction.customerId === liveSelected.id) : []

  function adjust() {
    if (!liveSelected) return
    try {
      loyaltyStore.adjustCustomer(ownerId, liveSelected.id, Number(amount), balanceType)
      setAmount('1')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to adjust balance.')
    }
  }

  return (
    <section className="owner-page">
      <header className="owner-page-heading"><div><p className="eyebrow">Directory</p><h1>Customers</h1></div><p>{customers.length} matching profiles</p></header>
      <label className="search-field owner-search"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or phone" />{query && <button onClick={() => setQuery('')}>Clear</button>}</label>
      <section className="owner-section customer-directory-list">
        <div className="directory-head"><span>Customer</span><span>Balance</span><span>Visits</span><span>Last activity</span></div>
        {customers.map((customer) => {
          const visits = database.transactions.filter((transaction) => transaction.customerId === customer.id && transaction.kind === 'visit')
          const latest = database.transactions.find((transaction) => transaction.customerId === customer.id)
          return <button className="directory-row" key={customer.id} onClick={() => { setSelected(customer); setBalanceType(database.tenant.programType); setError('') }}>
            <span className="directory-name"><span className="result-avatar"><UserRound size={20} /></span><span><strong>{customer.firstName} {customer.lastName}</strong><small>{displayPhone(customer.phone)}</small></span></span>
            <strong>{database.tenant.programType === 'stamps' ? `${customer.stamps} stamps` : `${customer.points} points`}</strong><span>{visits.length}</span><time>{latest ? new Date(latest.createdAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : 'No visits'}</time>
          </button>
        })}
      </section>

      <BottomSheet open={Boolean(liveSelected)} title="Customer profile" onClose={() => setSelected(null)} className="customer-profile-sheet">
        {liveSelected && <div className="owner-customer-profile">
          <div className="profile-identity"><span className="result-avatar"><UserRound size={24} /></span><div><h3>{liveSelected.firstName} {liveSelected.lastName}</h3><p><Phone size={14} /> {displayPhone(liveSelected.phone)}</p></div></div>
          <div className="profile-balances"><div><span>Stamps</span><strong>{liveSelected.stamps}</strong></div><div><span>Points</span><strong>{liveSelected.points.toLocaleString()}</strong></div><div><span>Member since</span><strong>{new Date(liveSelected.createdAt ?? Date.now()).getFullYear()}</strong></div></div>
          <section className="adjustment-panel"><div><p className="eyebrow">Manual override</p><h4>Adjust balance</h4></div><div className="mini-segmented"><button className={balanceType === 'stamps' ? 'selected' : ''} onClick={() => setBalanceType('stamps')}>Stamps</button><button className={balanceType === 'points' ? 'selected' : ''} onClick={() => setBalanceType('points')}>Points</button></div><div className="adjustment-controls"><button className="icon-button" onClick={() => setAmount(String(Number(amount) - 1))} aria-label="Subtract one"><Minus size={18} /></button><input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="Adjustment amount" /><button className="icon-button" onClick={() => setAmount(String(Number(amount) + 1))} aria-label="Add one"><Plus size={18} /></button><button className="owner-save-button" onClick={adjust}>Apply</button></div>{error && <p className="transaction-error">{error}</p>}</section>
          <section className="profile-history"><div className="profile-history-heading"><History size={18} /><h4>Lifetime history</h4></div>{history.map((transaction) => { const change = transaction.stampsChanged || transaction.pointsChanged; return <div className="profile-history-row" key={transaction.id}><span><strong>{transaction.kind === 'visit' ? 'Standard visit' : transaction.kind === 'redeem' ? 'Reward redeemed' : transaction.kind === 'adjustment' ? 'Owner adjustment' : transaction.kind === 'undo' ? 'Correction' : 'Points added'}</strong><small>{new Date(transaction.createdAt).toLocaleDateString('en-CA')} at {shortTime(transaction.createdAt)}</small></span><strong className={change >= 0 ? 'positive' : 'negative'}>{change > 0 ? '+' : ''}{change} {transaction.stampsChanged ? 'stamps' : 'points'}</strong></div>})}{!history.length && <p className="owner-empty-row">No transaction history yet.</p>}</section>
        </div>}
      </BottomSheet>
    </section>
  )
}
