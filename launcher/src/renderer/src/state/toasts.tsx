import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type ToastTone = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

interface ToastContextValue {
  toasts: Toast[]
  push: (message: string, tone?: ToastTone) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  const push = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = nextId++
      setToasts((list) => [...list.slice(-2), { id, message, tone }])
      window.setTimeout(() => dismiss(id), 4000)
    },
    [dismiss]
  )

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss])
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

export function useToasts(): ToastContextValue {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToasts doit être utilisé dans <ToastProvider>')
  return value
}
