import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

export function Modal({ title, onClose, children, className = '', returnFocusRef, showTitle = true }: {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
  returnFocusRef?: RefObject<HTMLElement | null>
  showTitle?: boolean
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const app = document.getElementById('root')
    const previousInert = app?.inert ?? false
    document.body.style.overflow = 'hidden'
    if (app) app.inert = true
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      if (app) app.inert = previousInert
      document.removeEventListener('keydown', onKeyDown)
      requestAnimationFrame(() => {
        if (!dialogRef.current?.isConnected) returnFocusRef?.current?.focus()
      })
    }
  }, [returnFocusRef])

  return createPortal(
    <div className="modal-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className={`modal-panel ${className}`} role="dialog" aria-modal="true" aria-label={title}
        ref={dialogRef}>
        <div className="modal-header">
          <h2 className={showTitle ? '' : 'sr-only'}>{title}</h2>
          <button ref={closeRef} className="secondary-button" type="button" onClick={onClose}>
            ✕ Schließen
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
