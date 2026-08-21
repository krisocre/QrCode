import { Check, Minus, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDatabase } from '../hooks/useDatabase'
import { loyaltyStore } from '../lib/store'
import type { ProgramType } from '../types'

export function ProgramSettings({ ownerId }: { ownerId: string }) {
  const database = useDatabase()
  const [stampGoal, setStampGoal] = useState(database.tenant.stampGoal)
  const [pointsPerDollar, setPointsPerDollar] = useState(database.tenant.pointsPerDollar)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setStampGoal(database.tenant.stampGoal)
    setPointsPerDollar(database.tenant.pointsPerDollar)
  }, [database.tenant.pointsPerDollar, database.tenant.stampGoal])

  function setProgramType(programType: ProgramType) {
    loyaltyStore.updateProgram(ownerId, { programType })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1400)
  }

  function saveRules(event: React.FormEvent) {
    event.preventDefault()
    loyaltyStore.updateProgram(ownerId, { stampGoal, pointsPerDollar })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1400)
  }

  return (
    <section className="owner-page">
      <header className="owner-page-heading"><div><p className="eyebrow">Program</p><h1>Loyalty settings</h1></div><p>Choose how customers earn and redeem.</p></header>
      <section className="owner-section program-section">
        <div className="owner-section-heading"><div><p className="eyebrow">Earning model</p><h2>Program type</h2></div>{saved && <span className="saved-state"><Check size={15} /> Saved</span>}</div>
        <div className="program-selector" role="radiogroup" aria-label="Program type">
          <button className={database.tenant.programType === 'stamps' ? 'selected' : ''} onClick={() => setProgramType('stamps')} role="radio" aria-checked={database.tenant.programType === 'stamps'}><Stamp size={22} /><span><strong>Stamp-based</strong><small>One visit, one stamp</small></span></button>
          <button className={database.tenant.programType === 'points' ? 'selected' : ''} onClick={() => setProgramType('points')} role="radio" aria-checked={database.tenant.programType === 'points'}><span className="points-symbol">P</span><span><strong>Point-based</strong><small>Points per dollar</small></span></button>
        </div>
      </section>
      <form className="owner-section rules-form" onSubmit={saveRules}>
        <div className="owner-section-heading"><div><p className="eyebrow">Rules</p><h2>{database.tenant.programType === 'stamps' ? 'Stamp target' : 'Earning rate'}</h2></div></div>
        {database.tenant.programType === 'stamps' ? (
          <label className="owner-stepper"><span><strong>Stamps per cycle</strong><small>Customers complete this many visits for a full card.</small></span><span className="stepper-control"><button type="button" onClick={() => setStampGoal((value) => Math.max(1, value - 1))} aria-label="Decrease stamp target"><Minus size={18} /></button><input value={stampGoal} onChange={(event) => setStampGoal(Number(event.target.value))} type="number" min="1" max="50" /><button type="button" onClick={() => setStampGoal((value) => Math.min(50, value + 1))} aria-label="Increase stamp target"><Plus size={18} /></button></span></label>
        ) : (
          <label className="owner-stepper"><span><strong>Points per $1</strong><small>Applied to point-based purchases.</small></span><span className="stepper-control"><button type="button" onClick={() => setPointsPerDollar((value) => Math.max(1, value - 1))} aria-label="Decrease earning rate"><Minus size={18} /></button><input value={pointsPerDollar} onChange={(event) => setPointsPerDollar(Number(event.target.value))} type="number" min="1" max="100" /><button type="button" onClick={() => setPointsPerDollar((value) => Math.min(100, value + 1))} aria-label="Increase earning rate"><Plus size={18} /></button></span></label>
        )}
        <button className="owner-save-button" type="submit">Save program rules</button>
      </form>
    </section>
  )
}

function Stamp({ size }: { size: number }) {
  return <span className="stamp-symbol" style={{ width: size, height: size }}><Check size={Math.round(size * .55)} /></span>
}
