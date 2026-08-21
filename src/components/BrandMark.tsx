export function BrandMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`brand-mark ${inverse ? 'brand-mark-inverse' : ''}`} aria-hidden="true">
      <span>AJ</span>
    </div>
  )
}
