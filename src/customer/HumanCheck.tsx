import { useEffect, useRef, useState } from 'react'
import { Check, ShieldCheck } from 'lucide-react'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string
      remove: (widgetId: string) => void
    }
  }
}

interface HumanCheckProps {
  onToken: (token: string) => void
}

export function HumanCheck({ onToken }: HumanCheckProps) {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined
  const containerRef = useRef<HTMLDivElement>(null)
  const [verified, setVerified] = useState(false)

  useEffect(() => {
    if (!siteKey || !containerRef.current) return
    let widgetId = ''
    let cancelled = false
    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'light',
        action: 'otp_request',
        callback: (token: string) => { setVerified(true); onToken(token) },
        'expired-callback': () => { setVerified(false); onToken('') },
        'error-callback': () => { setVerified(false); onToken('') },
      })
    }
    if (window.turnstile) renderWidget()
    else {
      const existing = document.getElementById('cf-turnstile-script') as HTMLScriptElement | null
      if (existing) existing.addEventListener('load', renderWidget, { once: true })
      else {
        const script = document.createElement('script')
        script.id = 'cf-turnstile-script'
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.async = true
        script.defer = true
        script.addEventListener('load', renderWidget, { once: true })
        document.head.appendChild(script)
      }
    }
    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [onToken, siteKey])

  if (siteKey) return <div ref={containerRef} className="turnstile-container" aria-label="Security check" />
  return (
    <button
      className={`human-check ${verified ? 'verified' : ''}`}
      type="button"
      onClick={() => { setVerified(true); onToken('local-preview-human') }}
      aria-pressed={verified}
    >
      <span className="human-checkbox">{verified && <Check size={17} strokeWidth={3} />}</span>
      <span>{verified ? 'Security check complete' : "I'm not a robot"}</span>
      <ShieldCheck size={23} />
    </button>
  )
}
