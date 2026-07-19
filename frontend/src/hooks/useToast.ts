import { useCallback, useRef, useState } from 'react'
import type { ToastTone } from '../types'

export type ToastState = {
  message: string
  tone: ToastTone
} | null

export function useToast() {
  const [toast, setToast] = useState<ToastState>(null)
  const timerRef = useRef<number | null>(null)

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    setToast({ message, tone })
    timerRef.current = window.setTimeout(() => setToast(null), 2800)
  }, [])

  const dismiss = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    setToast(null)
  }, [])

  return { toast, notify, dismiss }
}
