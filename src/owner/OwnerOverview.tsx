import { ArrowDownRight, ArrowUpRight, Gift, Repeat2, Stamp, UsersRound } from 'lucide-react'
import { useMemo } from 'react'
import { useDatabase } from '../hooks/useDatabase'
import { shortTime } from '../lib/format'

export function OwnerOverview() {
  const database = useDatabase()
  const customers = database.profiles.filter((profile) => profile.role === 'customer')
  const thisMonth = new Date()
  const monthStart = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1).getTime()
  const activeCutoff = Date.now() - 90 * 86_400_000
  const activeCustomers = customers.filter((customer) =>
    database.transactions.some((transaction) => transaction.customerId === customer.id && transaction.createdAt >= activeCutoff),
  )
  const retainedCustomers = activeCustomers.filter((customer) =>
    database.transactions.filter((transaction) => transaction.customerId === customer.id && transaction.kind !== 'undo').length >= 2,
  )
  const awarded = database.transactions.reduce((sum, transaction) => sum + Math.max(0,
    database.tenant.programType === 'stamps' ? transaction.stampsChanged : transaction.pointsChanged,
  ), 0)
  const redemptions = database.transactions.filter((transaction) => transaction.kind === 'redeem' && transaction.createdAt >= monthStart).length
  const retention = activeCustomers.length ? Math.round(retainedCustomers.length / activeCustomers.length * 100) : 0

  const metrics = [
    { label: 'Active customers', value: activeCustomers.length, detail: `${customers.length} total`, icon: UsersRound, trend: 'up' },
    { label: `${database.tenant.programType === 'stamps' ? 'Stamps' : 'Points'} awarded`, value: awarded.toLocaleString(), detail: 'All time', icon: Stamp, trend: 'up' },
    { label: 'Redemptions', value: redemptions, detail: 'This month', icon: Gift, trend: redemptions ? 'up' : 'flat' },
    { label: 'Retention rate', value: `${retention}%`, detail: 'Last 90 days', icon: Repeat2, trend: retention >= 50 ? 'up' : 'down' },
  ] as const

  const recent = useMemo(() => database.transactions.slice(0, 8), [database.transactions])

  return (
    <section className="owner-page">
      <header className="owner-page-heading">
        <div><p className="eyebrow">Business overview</p><h1>Good afternoon.</h1></div>
        <p>Activity across {database.tenant.name}</p>
      </header>

      <div className="analytics-grid">
        {metrics.map((metric) => {
          const Icon = metric.icon
          return <article className="metric-block" key={metric.label}>
            <div className="metric-top"><span>{metric.label}</span><Icon size={19} /></div>
            <strong>{metric.value}</strong>
            <p className={metric.trend}>{metric.trend === 'down' ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}{metric.detail}</p>
          </article>
        })}
      </div>

      <section className="owner-section recent-section">
        <div className="owner-section-heading"><div><p className="eyebrow">Live feed</p><h2>Recent activity</h2></div><span className="live-badge"><i /> Live</span></div>
        <div className="owner-table">
          <div className="owner-table-head"><span>Customer</span><span>Activity</span><span>Staff</span><span>Time</span></div>
          {recent.map((transaction) => {
            const customer = database.profiles.find((profile) => profile.id === transaction.customerId)
            const staff = database.profiles.find((profile) => profile.id === transaction.staffId)
            const reward = database.rewards.find((item) => item.id === transaction.rewardId)
            const change = transaction.stampsChanged || transaction.pointsChanged
            const unit = transaction.stampsChanged ? 'stamp' : 'point'
            const activity = transaction.kind === 'redeem' ? reward?.name : transaction.kind === 'visit' ? 'Standard visit' : transaction.kind === 'adjustment' ? 'Owner adjustment' : transaction.kind === 'undo' ? 'Correction' : `${change > 0 ? '+' : ''}${change} ${unit}${Math.abs(change) === 1 ? '' : 's'}`
            return <div className="owner-table-row" key={transaction.id}>
              <strong>{customer?.firstName} {customer?.lastName}</strong><span>{activity}</span><span>{staff?.staffCode ?? 'Owner'}</span><time>{shortTime(transaction.createdAt)}</time>
            </div>
          })}
          {!recent.length && <p className="owner-empty-row">Transactions will appear here as they happen.</p>}
        </div>
      </section>
    </section>
  )
}
