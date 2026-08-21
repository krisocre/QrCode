import { Edit3, Plus, Trash2, UserRound } from 'lucide-react'
import { useState } from 'react'
import { BottomSheet } from '../components/BottomSheet'
import { useDatabase } from '../hooks/useDatabase'
import { loyaltyStore } from '../lib/store'
import type { Profile } from '../types'

interface StaffDraft { id?: string; firstName: string; lastName: string; pin: string }

export function StaffManager({ ownerId }: { ownerId: string }) {
  const database = useDatabase()
  const staff = database.profiles.filter((profile) => profile.role === 'staff')
  const [draft, setDraft] = useState<StaffDraft | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Profile | null>(null)
  const [error, setError] = useState('')

  function save(event: React.FormEvent) {
    event.preventDefault()
    if (!draft) return
    try {
      if (draft.id) loyaltyStore.updateStaff(ownerId, draft.id, draft)
      else loyaltyStore.addStaff(ownerId, draft)
      setDraft(null)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save staff member.')
    }
  }

  return (
    <section className="owner-page">
      <header className="owner-page-heading split-heading"><div><p className="eyebrow">Team access</p><h1>Staff</h1><p>{staff.length} active staff profiles</p></div><button className="owner-primary-command" onClick={() => setDraft({ firstName: '', lastName: '', pin: '' })}><Plus size={18} /> Add staff</button></header>
      <section className="owner-section manager-list">
        <div className="manager-head staff-head"><span>Staff member</span><span>Staff ID</span><span>Access PIN</span><span>Actions</span></div>
        {staff.map((profile) => <article className="manager-row staff-row" key={profile.id}>
          <div className="manager-name"><span className="manager-icon"><UserRound size={19} /></span><span><strong>{profile.firstName} {profile.lastName}</strong><small>Cashier access</small></span></div>
          <strong className="manager-cost">{profile.staffCode}</strong><span className="masked-pin">****</span>
          <div className="manager-actions"><button className="icon-button" onClick={() => setDraft({ id: profile.id, firstName: profile.firstName, lastName: profile.lastName, pin: profile.accessPin ?? '' })} aria-label={`Edit ${profile.firstName}`} title="Edit staff"><Edit3 size={18} /></button><button className="icon-button danger-icon" onClick={() => setRemoveTarget(profile)} aria-label={`Remove ${profile.firstName}`} title="Remove staff"><Trash2 size={18} /></button></div>
        </article>)}
      </section>
      <BottomSheet open={Boolean(draft)} title={draft?.id ? 'Edit staff member' : 'Add staff member'} onClose={() => { setDraft(null); setError('') }}>
        {draft && <form className="owner-sheet-form" onSubmit={save}>
          <div className="owner-form-grid"><label>First name<input value={draft.firstName} onChange={(event) => setDraft({ ...draft, firstName: event.target.value })} autoFocus /></label><label>Last name<input value={draft.lastName} onChange={(event) => setDraft({ ...draft, lastName: event.target.value })} /></label></div>
          <label>4-digit access PIN<input type="text" inputMode="numeric" maxLength={4} value={draft.pin} onChange={(event) => setDraft({ ...draft, pin: event.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="0000" /></label>
          {error && <p className="transaction-error">{error}</p>}
          <button className="owner-save-button" type="submit">Save staff access</button>
        </form>}
      </BottomSheet>
      <BottomSheet open={Boolean(removeTarget)} title="Remove staff access" onClose={() => setRemoveTarget(null)}>
        {removeTarget && <div className="owner-confirm-delete"><div className="delete-icon"><Trash2 size={23} /></div><h3>{removeTarget.firstName} {removeTarget.lastName}</h3><p>This PIN will stop working immediately. Their transaction history will remain available.</p><button className="destructive-button" onClick={() => { loyaltyStore.removeStaff(ownerId, removeTarget.id); setRemoveTarget(null) }}>Remove staff member</button><button className="secondary-button" onClick={() => setRemoveTarget(null)}>Keep access</button></div>}
      </BottomSheet>
    </section>
  )
}
