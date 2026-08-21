import { Search, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useDatabase } from '../hooks/useDatabase'
import { displayPhone } from '../lib/format'
import type { Profile } from '../types'

export function ManualSearch({ onSelect }: { onSelect: (customer: Profile) => void }) {
  const database = useDatabase()
  const [query, setQuery] = useState('')
  const results = useMemo(() => {
    const normalized = query.toLowerCase().replace(/\D/g, '')
    const text = query.toLowerCase().trim()
    return database.profiles.filter((profile) => {
      if (profile.role !== 'customer') return false
      if (!text) return true
      const name = `${profile.firstName} ${profile.lastName}`.toLowerCase()
      const matchesPhone = normalized.length > 0 && profile.phone.replace(/\D/g, '').includes(normalized)
      return name.includes(text) || matchesPhone
    })
  }, [database.profiles, query])

  return (
    <section className="staff-page search-page">
      <div className="staff-page-heading">
        <p className="eyebrow">Customer lookup</p>
        <h1>Find a member</h1>
        <p>Search by name or mobile number.</p>
      </div>
      <label className="search-field">
        <Search size={21} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or phone number" autoFocus />
        {query && <button onClick={() => setQuery('')} aria-label="Clear search">Clear</button>}
      </label>
      <div className="search-results">
        <p className="result-count">{results.length} {results.length === 1 ? 'member' : 'members'}</p>
        {results.map((customer) => (
          <button key={customer.id} className="customer-result" onClick={() => onSelect(customer)}>
            <span className="result-avatar"><UserRound size={21} /></span>
            <span className="result-name"><strong>{customer.firstName} {customer.lastName}</strong><small>{displayPhone(customer.phone)}</small></span>
            <span className="result-balance"><strong>{customer.stamps}</strong><small>stamps</small></span>
          </button>
        ))}
        {!results.length && <div className="empty-state"><Search size={28} /><h2>No member found</h2><p>Check the spelling or try the last four digits.</p></div>}
      </div>
    </section>
  )
}
