import { PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { PANEL_WIDTH_LIMITS } from '../lib/connectionMeta'

type Props = {
  explorerWidth: number
  contextWidth: number
  explorerCollapsed: boolean
  contextCollapsed: boolean
  explorerLabel: string
  explorerControls: string
  rail: ReactNode
  explorer: ReactNode
  workspace: ReactNode
  context: ReactNode
  onResizeExplorer: (width: number) => void
  onResizeContext: (width: number) => void
  onExpandExplorer: () => void
  onExpandContext: () => void
}

type ResizerProps = {
  area: 'explorer' | 'context'
  width: number
  min: number
  max: number
  direction: 1 | -1
  defaultWidth: number
  onResize: (width: number) => void
}

function PanelResizer({ area, width, min, max, direction, defaultWidth, onResize }: ResizerProps) {
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const resize = (next: number) => onResize(Math.min(max, Math.max(min, next)))

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    resize(drag.startWidth + (event.clientX - drag.startX) * direction)
  }

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      resize(width - 16 * direction)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      resize(width + 16 * direction)
    } else if (event.key === 'Home') {
      event.preventDefault()
      resize(min)
    } else if (event.key === 'End') {
      event.preventDefault()
      resize(max)
    }
  }

  return (
    <div
      className={`panel-resizer ${area}-resizer`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${area}`}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={() => { dragRef.current = null }}
      onDoubleClick={() => resize(defaultWidth)}
      onKeyDown={onKeyDown}
    />
  )
}

export function WorkspaceShell({
  explorerWidth,
  contextWidth,
  explorerCollapsed,
  contextCollapsed,
  explorerLabel,
  explorerControls,
  rail,
  explorer,
  workspace,
  context,
  onResizeExplorer,
  onResizeContext,
  onExpandExplorer,
  onExpandContext,
}: Props) {
  const explorerHandleRef = useRef<HTMLButtonElement>(null)
  const contextHandleRef = useRef<HTMLButtonElement>(null)
  const previousExplorerCollapsed = useRef(explorerCollapsed)
  const previousContextCollapsed = useRef(contextCollapsed)

  useEffect(() => {
    if (explorerCollapsed && !previousExplorerCollapsed.current) {
      explorerHandleRef.current?.focus()
    } else if (!explorerCollapsed && previousExplorerCollapsed.current) {
      document.querySelector<HTMLButtonElement>(`#${explorerControls} .panel-collapse`)?.focus()
    }
    previousExplorerCollapsed.current = explorerCollapsed
  }, [explorerCollapsed, explorerControls])

  useEffect(() => {
    if (contextCollapsed && !previousContextCollapsed.current) {
      contextHandleRef.current?.focus()
    } else if (!contextCollapsed && previousContextCollapsed.current) {
      document.querySelector<HTMLButtonElement>('#context-panel .context-collapse')?.focus()
    }
    previousContextCollapsed.current = contextCollapsed
  }, [contextCollapsed])

  const columns = [
    '50px',
    explorerCollapsed ? '40px' : `${explorerWidth}px`,
    explorerCollapsed ? '0px' : '4px',
    'minmax(0, 1fr)',
    contextCollapsed ? '0px' : '4px',
    contextCollapsed ? '40px' : `${contextWidth}px`,
  ].join(' ')

  return (
    <div className="strata-body" style={{ gridTemplateColumns: columns }}>
      {rail}
      <div className={`shell-panel explorer-shell ${explorerCollapsed ? 'collapsed' : ''}`}>
        <div className="panel-expanded-content" aria-hidden={explorerCollapsed} inert={explorerCollapsed ? true : undefined}>{explorer}</div>
        {explorerCollapsed && (
          <button ref={explorerHandleRef} className="collapsed-panel-handle left" onClick={onExpandExplorer} aria-controls={explorerControls} aria-expanded="false" aria-label={`Expand ${explorerLabel.toLowerCase()}`} title={`Expand ${explorerLabel.toLowerCase()}`}>
            <PanelLeftOpen size={16} />
            <span>{explorerLabel}</span>
          </button>
        )}
      </div>
      {!explorerCollapsed && (
        <PanelResizer
          area="explorer"
          width={explorerWidth}
          min={PANEL_WIDTH_LIMITS.explorer.min}
          max={PANEL_WIDTH_LIMITS.explorer.max}
          direction={1}
          defaultWidth={PANEL_WIDTH_LIMITS.explorer.default}
          onResize={onResizeExplorer}
        />
      )}
      {workspace}
      {!contextCollapsed && (
        <PanelResizer
          area="context"
          width={contextWidth}
          min={PANEL_WIDTH_LIMITS.context.min}
          max={PANEL_WIDTH_LIMITS.context.max}
          direction={-1}
          defaultWidth={PANEL_WIDTH_LIMITS.context.default}
          onResize={onResizeContext}
        />
      )}
      <div className={`shell-panel context-shell ${contextCollapsed ? 'collapsed' : ''}`}>
        <div className="panel-expanded-content" aria-hidden={contextCollapsed} inert={contextCollapsed ? true : undefined}>{context}</div>
        {contextCollapsed && (
          <button ref={contextHandleRef} className="collapsed-panel-handle right" onClick={onExpandContext} aria-controls="context-panel" aria-expanded="false" aria-label="Expand context panel" title="Expand context panel">
            <PanelRightOpen size={16} />
            <span>Context</span>
          </button>
        )}
      </div>
    </div>
  )
}
