import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface BottomSheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
}

export function BottomSheet({ open, title, onClose, children, className = '' }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, open])

  if (!open) return null
  return (
    <div className="sheet-layer" role="presentation">
      <button className="sheet-backdrop" aria-label="Close" onClick={onClose} />
      <section className={`bottom-sheet ${className}`} role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-grabber" />
        <header className="sheet-header">
          <h2 id="sheet-title">{title}</h2>
          <button className="icon-button" type="button" aria-label="Close" title="Close" onClick={onClose}>
            <X size={21} />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}
