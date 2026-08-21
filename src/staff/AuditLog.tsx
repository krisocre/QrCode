import { RotateCcw, Stamp, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useDatabase } from '../hooks/useDatabase'
import { shortTime } from '../lib/format'
import { loyaltyStore } from '../lib/store'

export function AuditLog({ staffId }: { staffId: string }) {
  const database = useDatabase()
  const [now, setNow] = useState(Date.now())
  const [message, setMessage] = useState('')
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const todaysTransactions = useMemo(() => {
    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    return database.transactions.filter((transaction) => transaction.createdAt >= start)
  }, [database.transactions])
  const reversedIds = new Set(database.transactions.map((transaction) => transaction.reversesId).filter(Boolean))

  function undo(transactionId: string) {
    try {
      loyaltyStore.undoTransaction(transactionId, staffId)
      setMessage('Transaction undone.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to undo transaction.')
    }
  }

  return (
    <section className="staff-page audit-page">
      <div className="staff-page-heading audit-heading">
        <div>
          <p className="eyebrow">Today</p>
          <h1>Transaction log</h1>
        </div>
        <span className="live-badge"><i /> Live</span>
      </div>
      {message && <button className="audit-message" onClick={() => setMessage('')}>{message}</button>}
      <div className="audit-list">
        {todaysTransactions.map((transaction) => {
          const customer = database.profiles.find((profile) => profile.id === transaction.customerId)
          const staff = database.profiles.find((profile) => profile.id === transaction.staffId)
          const reward = database.rewards.find((item) => item.id === transaction.rewardId)
          const canUndo = transaction.kind !== 'undo' && now - transaction.createdAt <= 60_000 && !reversedIds.has(transaction.id)
          const value = transaction.stampsChanged
            ? `${transaction.stampsChanged > 0 ? '+' : ''}${transaction.stampsChanged} stamp${Math.abs(transaction.stampsChanged) === 1 ? '' : 's'}`
            : `${transaction.pointsChanged > 0 ? '+' : ''}${transaction.pointsChanged} points`
          return (
            <article className={`audit-row ${transaction.kind === 'undo' ? 'undone' : ''}`} key={transaction.id}>
              <div className="audit-icon">{transaction.kind === 'undo' ? <RotateCcw size={19} /> : <Stamp size={19} />}</div>
              <div className="audit-main">
                <div><strong>{customer?.firstName} {customer?.lastName}</strong><time>{shortTime(transaction.createdAt)}</time></div>
                <p>{transaction.kind === 'redeem' ? reward?.name : transaction.kind === 'undo' ? 'Correction' : transaction.kind === 'adjustment' ? 'Owner adjustment' : transaction.kind === 'visit' ? 'Standard visit' : 'Custom points'}</p>
                <span>Staff {staff?.staffCode ?? '-'}</span>
              </div>
              <div className="audit-value"><strong>{value}</strong>{canUndo && <button onClick={() => undo(transaction.id)}><Undo2 size={15} /> Undo</button>}</div>
            </article>
          )
        })}
        {!todaysTransactions.length && <div className="empty-state"><Stamp size={28} /><h2>No transactions yet</h2><p>Confirmed visits and redemptions will appear here.</p></div>}
      </div>
    </section>
  )
}
