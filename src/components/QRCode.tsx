import { useEffect, useRef } from 'react'
import QRCodeLibrary from 'qrcode'

interface QRCodeProps {
  value: string
  size?: number
  className?: string
}

export function QRCode({ value, size = 240, className }: QRCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    void QRCodeLibrary.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#111111', light: '#FFFFFF' },
    })
  }, [size, value])

  return <canvas ref={canvasRef} className={className} aria-label="Account QR code" />
}
