import { useEffect, useMemo, useState } from 'react'
import { Check, Gift, Minus, Plus, UserRound } from 'lucide-react'
import { BottomSheet } from '../components/BottomSheet'
import { displayPhone } from '../lib/format'
import { productionApi } from './client'
import type { ProductionTenant, StaffCustomerResponse } from './types'

interface Props {
  customerData: StaffCustomerResponse | null
  tenant: ProductionTenant
  sessionToken: string
  source: 'scan' | 'manual'
  online: boolean
  onClose: () => void
  onConfirmed: (message: string) => void
  onQueueVisit: () => Promise<void>
}

export function ProductionStaffActionSheet({ customerData, tenant, sessionToken, source, online, onClose, onConfirmed, onQueueVisit }: Props) {
  const [kind, setKind] = useState<'visit' | 'points' | 'redeem'>('visit')
  const [points, setPoints] = useState('25')
  const [rewardId, setRewardId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const redemptionScan = customerData?.scanKind === 'redemption'

  useEffect(() => {
    setKind(customerData?.scanKind === 'redemption' ? 'redeem' : 'visit')
    setRewardId(customerData?.rewardId ?? '')
    setError('')
  }, [customerData?.customer.id, customerData?.rewardId, customerData?.scanKind])

  const visits = useMemo(() => customerData?.transactions.filter((transaction) => transaction.kind === 'visit').slice(0, 3) ?? [], [customerData])
  if (!customerData) return <BottomSheet open={false} title="Customer found" onClose={onClose}><></></BottomSheet>

  const currentData = customerData
  const { customer, rewards } = currentData
  const balance = tenant.programType === 'stamps' ? customer.stamps : customer.points
  const selectedReward = rewards.find((reward) => reward.id === rewardId)

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      if (!online) {
        if (kind !== 'visit') throw new Error('Reconnect to add custom points or redeem a reward.')
        await onQueueVisit()
        return
      }
      await productionApi.staffConfirm(sessionToken, {
        customerId: customer.id,
        kind,
        source,
        points: kind === 'points' ? Number(points) : undefined,
        rewardId: kind === 'redeem' ? rewardId : undefined,
        scanToken: currentData.scanToken,
      })
      void productionApi.staffWalletSync(sessionToken, customer.id).catch(() => undefined)
      const message = kind === 'visit'
        ? `1 ${tenant.programType === 'stamps' ? 'stamp' : 'point'} added for ${customer.firstName}`
        : kind === 'points'
          ? `${Number(points)} points added for ${customer.firstName}`
          : `${selectedReward?.name ?? 'Reward'} redeemed`
      onConfirmed(message)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to confirm the transaction.')
    } finally {
      setBusy(false)
    }
  }

  const actionLabel = kind === 'visit'
    ? `Confirm +1 ${tenant.programType === 'stamps' ? 'stamp' : 'point'}`
    : kind === 'points'
      ? `Confirm +${Number(points) || 0} points`
      : 'Confirm redemption'

  return <BottomSheet open title="Customer found" onClose={onClose} className="action-sheet"><div className="transaction-panel">
    <div className="customer-summary"><div className="customer-avatar"><UserRound size={24} /></div><div><h3>{customer.firstName} {customer.lastName}</h3><p>{displayPhone(customer.phone)}</p></div><div className="customer-balance"><strong>{balance}</strong><span>{tenant.programType}</span></div></div>
    <div className="summary-metrics"><div><span>Points</span><strong>{customer.points.toLocaleString()}</strong></div><div><span>Recent visits</span><strong>{visits.length ? new Date(visits[0].createdAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : 'First visit'}</strong></div></div>
    <div className="history-strip">{visits.length ? visits.map((visit) => <span key={visit.id}><Check size={13} /> {new Date(visit.createdAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span>) : <span>No visits recorded yet</span>}</div>
    {redemptionScan ? <div className="action-options redemption-only"><button className="selected" disabled><Gift size={21} /><span><strong>Reward redemption</strong><small>{selectedReward?.name ?? 'Selected customer reward'}</small></span></button></div> : <div className="action-options" role="radiogroup" aria-label="Transaction type">
      <button className={kind === 'visit' ? 'selected' : ''} onClick={() => setKind('visit')} role="radio" aria-checked={kind === 'visit'}><Plus size={21} /><span><strong>1 {tenant.programType === 'stamps' ? 'Stamp' : 'Point'}</strong><small>Standard visit</small></span></button>
      <button className={kind === 'points' ? 'selected' : ''} onClick={() => setKind('points')} role="radio" aria-checked={kind === 'points'}><Plus size={21} /><span><strong>Points</strong><small>Custom amount</small></span></button>
      <button className={kind === 'redeem' ? 'selected' : ''} onClick={() => setKind('redeem')} role="radio" aria-checked={kind === 'redeem'}><Gift size={21} /><span><strong>Redeem</strong><small>Use a reward</small></span></button>
    </div>}
    {kind === 'points' && <div className="points-stepper"><label htmlFor="production-custom-points">Points to add</label><div><button className="icon-button" aria-label="Subtract 5 points" onClick={() => setPoints(String(Math.max(0, Number(points) - 5)))}><Minus size={20} /></button><input id="production-custom-points" type="number" min="1" inputMode="numeric" value={points} onChange={(event) => setPoints(event.target.value)} /><button className="icon-button" aria-label="Add 5 points" onClick={() => setPoints(String(Number(points) + 5))}><Plus size={20} /></button></div></div>}
    {kind === 'redeem' && !redemptionScan && <div className="reward-picker"><label htmlFor="production-reward-select">Reward</label><select id="production-reward-select" value={rewardId} onChange={(event) => setRewardId(event.target.value)}><option value="">Select a reward</option>{rewards.map((reward) => { const cost = tenant.programType === 'stamps' ? reward.stampCost : reward.pointCost; return <option key={reward.id} value={reward.id} disabled={balance < cost}>{reward.name} | {cost} {tenant.programType}{balance < cost ? ' | unavailable' : ''}</option> })}</select></div>}
    {error && <p className="transaction-error" role="alert">{error}</p>}
    <button className="confirm-transaction" disabled={busy || (kind === 'redeem' && !rewardId) || (kind === 'points' && Number(points) <= 0)} onClick={() => void confirm()}>{kind === 'redeem' ? <Gift size={20} /> : <Plus size={20} />} {busy ? 'Confirming...' : actionLabel}</button>
  </div></BottomSheet>
}
