import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import { Camera, CameraOff, FlipHorizontal2, Flashlight, FlashlightOff, ScanLine } from 'lucide-react'

interface ScannerViewProps {
  paused: boolean
  onScan: (value: string) => void
  fallbackAction?: { label: string; onClick: () => void }
}

export function ScannerView({ paused, onScan, fallbackAction }: ScannerViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const lastValueRef = useRef({ value: '', at: 0 })
  const pausedRef = useRef(paused)
  const onScanRef = useRef(onScan)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [torchOn, setTorchOn] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [cameraReady, setCameraReady] = useState(false)

  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => { onScanRef.current = onScan }, [onScan])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let controls: IScannerControls | undefined
    let disposed = false
    setCameraReady(false)
    setCameraError('')
    setTorchOn(false)
    const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 120 })

    void reader.decodeFromConstraints(
      { audio: false, video: { facingMode: { ideal: facingMode } } },
      video,
      (result, _error, scannerControls) => {
        controls = scannerControls
        if (!result || pausedRef.current) return
        const value = result.getText()
        const now = Date.now()
        if (lastValueRef.current.value === value && now - lastValueRef.current.at < 1500) return
        lastValueRef.current = { value, at: now }
        onScanRef.current(value)
      },
    ).then((nextControls) => {
      if (disposed) nextControls.stop()
      else {
        controls = nextControls
        setCameraReady(true)
      }
    }).catch((error: unknown) => {
      if (disposed) return
      const message = error instanceof Error && error.name === 'NotAllowedError'
        ? 'Camera access is blocked. Allow access or use customer search.'
        : 'Camera unavailable. Use customer search to continue.'
      setCameraError(message)
    })

    return () => {
      disposed = true
      controls?.stop()
    }
  }, [facingMode])

  async function toggleTorch() {
    const stream = videoRef.current?.srcObject as MediaStream | null
    const track = stream?.getVideoTracks()[0]
    if (!track) return
    try {
      const next = !torchOn
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch {
      setCameraError('Flash is not available on this camera.')
    }
  }

  return (
    <section className="scanner-view" aria-label="Customer QR scanner">
      <video ref={videoRef} className="scanner-video" muted playsInline />
      <div className="scanner-shade" />
      <div className="scanner-frame" aria-hidden="true">
        <i /><i /><i /><i />
        {cameraReady && !paused && <span className="scan-beam" />}
      </div>
      <div className="scanner-status">
        {cameraError ? <CameraOff size={18} /> : <ScanLine size={18} />}
        <span>{cameraError || (paused ? 'Customer loaded' : cameraReady ? 'Align customer code in frame' : 'Starting camera...')}</span>
      </div>
      <div className="camera-controls">
        <button className={`camera-button ${torchOn ? 'active' : ''}`} type="button" onClick={() => void toggleTorch()} aria-label="Toggle flash" title="Toggle flash">
          {torchOn ? <FlashlightOff size={21} /> : <Flashlight size={21} />}
        </button>
        <button className="camera-button" type="button" onClick={() => setFacingMode((mode) => mode === 'environment' ? 'user' : 'environment')} aria-label="Flip camera" title="Flip camera">
          <FlipHorizontal2 size={21} />
        </button>
      </div>
      {cameraError && fallbackAction && (
        <button className="camera-fallback-button" type="button" onClick={fallbackAction.onClick}>
          <Camera size={17} /> {fallbackAction.label}
        </button>
      )}
    </section>
  )
}
