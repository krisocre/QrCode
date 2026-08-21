import { Edit3, Gift, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { BottomSheet } from '../components/BottomSheet'
import { useDatabase } from '../hooks/useDatabase'
import { loyaltyStore } from '../lib/store'
import type { Reward } from '../types'

const emptyReward: Omit<Reward, 'tenantId'> = { id: '', name: '', description: '', stampCost: 5, pointCost: 500, promotion: '' }

export function RewardsManager({ ownerId }: { ownerId: string }) {
  const database = useDatabase()
  const [draft, setDraft] = useState<Omit<Reward, 'tenantId'> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Reward | null>(null)
  const [error, setError] = useState('')

  function save(event: React.FormEvent) {
    event.preventDefault()
    if (!draft) return
    if (!draft.name.trim()) { setError('Enter a reward name.'); return }
    loyaltyStore.saveReward(ownerId, draft)
    setDraft(null)
    setError('')
  }

  return (
    <section className="owner-page">
      <header className="owner-page-heading split-heading"><div><p className="eyebrow">Catalog</p><h1>Rewards</h1><p>{database.rewards.length} active rewards</p></div><button className="owner-primary-command" onClick={() => setDraft({ ...emptyReward })}><Plus size={18} /> Add reward</button></header>
      <section className="owner-section manager-list">
        <div className="manager-head"><span>Reward</span><span>Cost</span><span>Promotion</span><span>Actions</span></div>
        {database.rewards.map((reward) => <article className="manager-row" key={reward.id}>
          <div className="manager-name"><span className="manager-icon"><Gift size={19} /></span><span><strong>{reward.name}</strong><small>{reward.description}</small></span></div>
          <strong className="manager-cost">{database.tenant.programType === 'stamps' ? `${reward.stampCost} stamps` : `${reward.pointCost} points`}</strong>
          <span className="manager-promo">{reward.promotion || 'Always available'}</span>
          <div className="manager-actions"><button className="icon-button" onClick={() => setDraft({ ...reward })} aria-label={`Edit ${reward.name}`} title="Edit reward"><Edit3 size={18} /></button><button className="icon-button danger-icon" onClick={() => setDeleteTarget(reward)} aria-label={`Remove ${reward.name}`} title="Remove reward"><Trash2 size={18} /></button></div>
        </article>)}
      </section>

      <BottomSheet open={Boolean(draft)} title={draft?.id ? 'Edit reward' : 'Add reward'} onClose={() => { setDraft(null); setError('') }}>
        {draft && <form className="owner-sheet-form" onSubmit={save}>
          <label>Reward name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Signature Blowout" autoFocus /></label>
          <label>Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="What the customer receives" rows={3} /></label>
          <div className="owner-form-grid"><label>Stamp cost<input type="number" min="1" value={draft.stampCost} onChange={(event) => setDraft({ ...draft, stampCost: Number(event.target.value) })} /></label><label>Point cost<input type="number" min="1" value={draft.pointCost} onChange={(event) => setDraft({ ...draft, pointCost: Number(event.target.value) })} /></label></div>
          <label>Promotion rule<input value={draft.promotion ?? ''} onChange={(event) => setDraft({ ...draft, promotion: event.target.value })} placeholder="Always available" /></label>
          {error && <p className="transaction-error">{error}</p>}
          <button className="owner-save-button" type="submit">{draft.id ? 'Save reward' : 'Add reward'}</button>
        </form>}
      </BottomSheet>

      <BottomSheet open={Boolean(deleteTarget)} title="Remove reward" onClose={() => setDeleteTarget(null)}>
        {deleteTarget && <div className="owner-confirm-delete"><div className="delete-icon"><Trash2 size={23} /></div><h3>{deleteTarget.name}</h3><p>This removes the reward from the customer catalog. Existing transaction history stays intact.</p><button className="destructive-button" onClick={() => { loyaltyStore.deleteReward(ownerId, deleteTarget.id); setDeleteTarget(null) }}>Remove reward</button><button className="secondary-button" onClick={() => setDeleteTarget(null)}>Keep reward</button></div>}
      </BottomSheet>
    </section>
  )
}
