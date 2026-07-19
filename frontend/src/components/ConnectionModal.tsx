import { Check, Database, Eye, EyeOff, LoaderCircle, LockKeyhole, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { ConnectionInput, ConnectionSummary } from '../types'
import { api } from '../lib/api'
import { emptyConnectionForm } from '../lib/connectionMeta'

type Props = {
  open: boolean
  defaults?: Partial<ConnectionInput> | null
  onClose: () => void
  onConnected: (connection: ConnectionSummary) => void
}

type ConnectionForm = Omit<ConnectionInput, 'port'> & { port: string }

function resolveInitial(defaults?: Partial<ConnectionInput> | null): ConnectionForm {
  const initial = defaults
    ? { ...emptyConnectionForm(), ...defaults, password: defaults.password ?? '' }
    : emptyConnectionForm()
  return { ...initial, port: String(initial.port) }
}

export function ConnectionModal({ open, defaults, onClose, onConnected }: Props) {
  const [form, setForm] = useState(() => resolveInitial(defaults))
  const [showPassword, setShowPassword] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLFormElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    setForm(resolveInitial(defaults))
    setError('')
    setShowPassword(false)
  }, [defaults, open])

  useEffect(() => {
    if (!open) return
    const node = dialogRef.current
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>('input, select, button') ?? []).filter((el) => !el.hasAttribute('disabled'))
    window.setTimeout(() => focusables()[0]?.focus(), 0)

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !testing) {
        event.preventDefault()
        onClose()
      }
      if (event.key !== 'Tab' || !node) return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, open, testing])

  if (!open) return null

  const update = <K extends keyof ConnectionForm>(key: K, value: ConnectionForm[K]) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const port = Number(form.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError('Port must be a number between 1 and 65535.')
      return
    }
    setTesting(true)
    setError('')
    try {
      const connection = await api.connect({ ...form, port })
      onConnected(connection)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !testing) onClose() }}>
      <form className="connection-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <div className="modal-header">
          <div className="modal-icon"><Database size={19} /></div>
          <div><strong id={titleId}>{form.profileId ? 'Reconnect PostgreSQL' : 'Connect PostgreSQL'}</strong><span>Profile details are saved locally. Password storage is your choice.</span></div>
          <button type="button" onClick={() => { if (!testing) onClose() }} aria-label="Close" disabled={testing}><X size={17} /></button>
        </div>

        <div className="form-grid">
          <label className="full-field"><span>Connection name</span><input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Production read replica" autoComplete="off" /></label>
          <label className="host-field"><span>Host</span><input required value={form.host} onChange={(event) => update('host', event.target.value)} placeholder="db.example.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
          <label className="port-field"><span>Port</span><input required type="text" inputMode="numeric" pattern="[0-9]*" value={form.port} onChange={(event) => update('port', event.target.value.replace(/\D/g, '').slice(0, 5))} /></label>
          <label><span>Database</span><input required value={form.database} onChange={(event) => update('database', event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
          <label><span>Username</span><input required value={form.username} onChange={(event) => update('username', event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
          <label className="full-field"><span>Password</span><span className="password-input"><input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => update('password', event.target.value)} autoComplete="current-password" placeholder={form.profileId && form.rememberPassword ? 'Use saved password' : ''} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Toggle password visibility">{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>
          <label><span>SSL mode</span><select value={form.sslMode} onChange={(event) => update('sslMode', event.target.value)}><option value="prefer">Prefer</option><option value="require">Require</option><option value="verify-full">Verify full</option><option value="disable">Disable</option></select></label>
          <label><span>Connect timeout</span><select value={form.connectTimeoutMs} onChange={(event) => update('connectTimeoutMs', Number(event.target.value))}><option value={5000}>5 seconds</option><option value={10000}>10 seconds</option><option value={30000}>30 seconds</option></select></label>
          <label className="connection-option full-field"><input type="checkbox" checked={form.rememberPassword} onChange={(event) => update('rememberPassword', event.target.checked)} /><span><strong>Remember password securely</strong><small>Store it in the operating-system credential vault after this connection succeeds.</small></span></label>
          <label className="connection-option"><input type="checkbox" checked={form.autoConnect} onChange={(event) => update('autoConnect', event.target.checked)} /><span><strong>Reconnect at launch</strong><small>Available when authentication can complete without another prompt.</small></span></label>
          <label className="connection-option"><input type="checkbox" checked={form.privateMode} onChange={(event) => update('privateMode', event.target.checked)} /><span><strong>Private history</strong><small>Do not retain executed SQL history for this profile.</small></span></label>
        </div>

        <div className="security-note"><LockKeyhole size={14} /><span>Saved passwords never enter the workspace database, browser storage, logs, or exports.</span></div>
        {error && <div className="form-error" role="alert">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={testing}>Cancel</button>
          <button type="submit" className="primary-button" disabled={testing}>
            {testing ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
            {testing ? 'Testing connection…' : 'Test & connect'}
          </button>
        </div>
      </form>
    </div>
  )
}
