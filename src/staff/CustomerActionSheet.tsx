import { useEffect, useMemo, useState } from 'react'
import { Check, Gift, Minus, Plus, UserRound } from 'lucide-react'
import { BottomSheet } from '../components/BottomSheet'
import { useDatabase } from '../hooks/useDatabase'
import { displayPhone, relativeVisit } from '../lib/format'
import { loyaltyStore } from '../lib/store'
import type { Profile, ScannedPayload } from '../types'

interface CustomerActionSheetProps {
  customer: Profile | null
  payload?: ScannedPayload | null
  source: 'scan' | 'manual'
  staffId: string
  onClose: () => void
  onConfirmed: (message: string) => void
}

export function CustomerActionSheet({ customer, payload, source, staffId, onClose, onConfirmed }: CustomerActionSheetProps) {
  const database = useDatabase()
  const [kind, setKind] = useState<'visit' | 'points' | 'redeem'>('visit')
  const [points, setPoints] = useState('25')
  const [rewardId, setRewardId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setError('')
    if (payload?.rewardId) {
      setKind('redeem')
      setRewardId(payload.rewardId)
    } else {
      setKind('visit')
      setRewardId('')
    }
  }, [customer?.id, payload?.rewardId])

  const history = useMemo(() => customer
    ? database.transactions
      .filter((transaction) => transaction.customerId === customer.id && transaction.kind === 'visit')
      .slice(0, 3)
    : [], [customer, database.transactions])

  function confirm() {
    if (!customer) return
    try {
      const selectedReward = database.rewards.find((reward) => reward.id === rewardId)
      loyaltyStore.confirmTransaction({
        staffId,
        customerId: customer.id,
        kind,
        source,
        points: Number(points),
        rewardId: kind === 'redeem' ? rewardId : undefined,
        redemptionToken: payload?.redemptionToken,
      })
      const message = kind === 'visit'
        ? `1 ${database.tenant.programType === 'stamps' ? 'stamp' : 'point'} added for ${customer.firstName}`
        : kind === 'points'
          ? `${Number(points)} points added for ${customer.firstName}`
          : `${selectedReward?.name ?? 'Reward'} redeemed`
      onConfirmed(message)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to confirm transaction.')
    }
  }

  const selectedReward = database.rewards.find((reward) => reward.id === rewardId)
  const actionLabel = kind === 'visit'
    ? `Confirm +1 ${database.tenant.programType === 'stamps' ? 'stamp' : 'point'}`
    : kind === 'points'
      ? `Confirm +${Number(points) || 0} points`
      : `Confirm ${selectedReward ? 'redemption' : 'reward'}`

  return (
    <BottomSheet open={Boolean(customer)} title="Customer found" onClose={onClose} className="action-sheet">
      {customer && (
        <div className="transaction-panel">
          <div className="customer-summary">
            <div className="customer-avatar"><UserRound size={24} /></div>
            <div>
              <h3>{customer.firstName} {customer.lastName}</h3>
              <p>{displayPhone(customer.phone)}</p>
            </div>
            <div className="customer-balance"><strong>{database.tenant.programType === 'stamps' ? customer.stamps : customer.points}</strong><span>{database.tenant.programType}</span></div>
          </div>

          <div className="summary-metrics">
            <div><span>Points</span><strong>{customer.points.toLocaleString()}</strong></div>
            <div><span>Recent visits</span><strong>{history.length ? relativeVisit(history[0].createdAt) : 'First visit'}</strong></div>
          </div>

          <div className="history-strip" aria-label="Visit history">
            {history.length ? history.map((transaction) => (
              <span key={transaction.id}><Check size={13} /> {relativeVisit(transaction.createdAt)}</span>
            )) : <span>No visits recorded yet</span>}
          </div>

          <div className="action-options" role="radiogroup" aria-label="Transaction type">
            <button className={kind === 'visit' ? 'selected' : ''} onClick={() => { setKind('visit'); setError('') }} role="radio" aria-checked={kind === 'visit'}>
              <Plus size={21} /><span><strong>1 {database.tenant.programType === 'stamps' ? 'Stamp' : 'Point'}</strong><small>Standard visit</small></span>
            </button>
            <button className={kind === 'points' ? 'selected' : ''} onClick={() => { setKind('points'); setError('') }} role="radio" aria-checked={kind === 'points'}>
              <Plus size={21} /><span><strong>Points</strong><small>Custom amount</small></span>
            </button>
            <button className={kind === 'redeem' ? 'selected' : ''} onClick={() => { setKind('redeem'); setError('') }} role="radio" aria-checked={kind === 'redeem'}>
              <Gift size={21} /><span><strong>Redeem</strong><small>Use a reward</small></span>
            </button>
          </div>

          {kind === 'points' && (
            <div className="points-stepper">
              <label htmlFor="custom-points">Points to add</label>
              <div>
                <button className="icon-button" aria-label="Subtract 5 points" title="Subtract 5 points" onClick={() => setPoints(String(Math.max(0, Number(points) - 5)))}><Minus size={20} /></button>
                <input id="custom-points" type="number" min="1" inputMode="numeric" value={points} onChange={(event) => setPoints(event.target.value)} />
                <button className="icon-button" aria-label="Add 5 points" title="Add 5 points" onClick={() => setPoints(String(Number(points) + 5))}><Plus size={20} /></button>
              </div>
            </div>
          )}

          {kind === 'redeem' && (
            <div className="reward-picker">
              <label htmlFor="reward-select">Reward</label>
              <select id="reward-select" value={rewardId} onChange={(event) => setRewardId(event.target.value)}>
                <option value="">Select a reward</option>
                {database.rewards.map((reward) => {
                  const cost = database.tenant.programType === 'stamps' ? reward.stampCost : reward.pointCost
                  const balance = database.tenant.programType === 'stamps' ? customer.stamps : customer.points
                  return <option key={reward.id} value={reward.id} disabled={balance < cost}>
                    {reward.name} | {cost} {database.tenant.programType}{balance < cost ? ' | unavailable' : ''}
                  </option>
                })}
              </select>
            </div>
          )}

          {error && <p className="transaction-error" role="alert">{error}</p>}
          <button className="confirm-transaction" type="button" disabled={kind === 'redeem' && !rewardId} onClick={confirm}>
            {kind === 'redeem' ? <Gift size={20} /> : <Plus size={20} />} {actionLabel}
          </button>
        </div>
      )}
    </BottomSheet>
  )
}
