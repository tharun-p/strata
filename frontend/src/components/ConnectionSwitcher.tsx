import { Check, ChevronDown, KeyRound, Plus, Unplug } from 'lucide-react'
import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import type { ConnectionProfile, ConnectionSummary } from '../types'
import { useDismissableLayer } from '../hooks/useDismissableLayer'

type Props = {
  open: boolean
  connections: ConnectionSummary[]
  profiles: ConnectionProfile[]
  activeId: string | null
  colorFor: (connection: ConnectionSummary) => string
  onToggle: () => void
  onSwitch: (connectionId: string) => void
  onAdd: () => void
  onDisconnect: (connectionId: string) => void
  onConnectProfile: (profile: ConnectionProfile) => void
  onClose: () => void
}

export function ConnectionSwitcher({
  open,
  connections,
  profiles,
  activeId,
  colorFor,
  onToggle,
  onSwitch,
  onAdd,
  onDisconnect,
  onConnectProfile,
  onClose,
}: Props) {
  const rootRef = useDismissableLayer<HTMLDivElement>(open, onClose)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const active = connections.find((item) => item.id === activeId) ?? connections[0] ?? null
  const connectedProfiles = new Set(connections.map((connection) => connection.profileId).filter(Boolean))
  const offlineProfiles = profiles.filter((profile) => !connectedProfiles.has(profile.id))

  useEffect(() => {
    if (!open) return
    window.requestAnimationFrame(() => {
      const selected = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')
      const first = menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')
      ;(selected ?? first)?.focus()
    })
  }, [open])

  const moveMenuFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])
    if (items.length === 0) return
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement))
    let next = current
    if (event.key === 'ArrowDown') next = (current + 1) % items.length
    else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      triggerRef.current?.focus()
      return
    } else return
    event.preventDefault()
    items[next]?.focus()
  }

  return (
    <div className="connection-switcher" ref={rootRef} data-wails-no-drag>
      <button
        ref={triggerRef}
        className="workspace-switch"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            onToggle()
          }
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
      >
        {active ? (
          <>
            <i className="connection-chip" style={{ background: colorFor(active) }} />
            <span>{active.name || active.database}</span>
          </>
        ) : (
          <span>Connect PostgreSQL</span>
        )}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div ref={menuRef} id={menuId} className="connection-menu" role="menu" aria-label="Database connections" onKeyDown={moveMenuFocus}>
          {connections.map((connection) => {
            const selected = connection.id === active?.id
            return (
              <div className={`connection-menu-row ${selected ? 'selected' : ''}`} key={connection.id}>
                <button className="connection-menu-main" role="menuitemradio" aria-checked={selected} onClick={() => onSwitch(connection.id)}>
                  <i className="connection-chip" style={{ background: colorFor(connection) }} />
                  <span>
                    <strong>{connection.name || connection.database}</strong>
                    <small>{connection.host}:{connection.port} · {connection.database} · {connection.latencyMs} ms</small>
                  </span>
                  {selected && <Check size={14} />}
                </button>
                <button role="menuitem" className="connection-menu-disconnect" aria-label={`Disconnect ${connection.name || connection.database}`} onClick={() => onDisconnect(connection.id)}>
                  <Unplug size={13} />
                </button>
              </div>
            )
          })}
          {offlineProfiles.length > 0 && <span className="connection-menu-section">Saved profiles</span>}
          {offlineProfiles.map((profile) => (
            <button className="connection-menu-main connection-menu-offline" role="menuitem" key={profile.id} onClick={() => onConnectProfile(profile)}>
              <i className="connection-chip" style={{ background: profile.color }} />
              <span>
                <strong>{profile.name || profile.database}</strong>
                <small>{profile.host}:{profile.port} · {profile.database} · {profile.credentialStatus === 'available' ? 'Password saved' : 'Authentication required'}</small>
              </span>
              <KeyRound size={13} />
            </button>
          ))}
          <button role="menuitem" className="connection-menu-add" onClick={onAdd}><Plus size={14} />Add connection</button>
        </div>
      )}
    </div>
  )
}
