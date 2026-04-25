import { useState, useEffect, Fragment } from 'react'
import { useRefreshAction } from './dgAwb/useRefreshAction'
import { useStartDgCheckAction } from './dgAwb/useStartDgCheckAction'
import { useDoDgCheckAction } from './dgAwb/useDoDgCheckAction'
import { useViewChecklistAction } from './dgAwb/useViewChecklistAction'
import {
  LS_AWB_KEY,
  LS_GHA_SETTINGS_KEY,
  AWB_SERIAL_MIN,
  AWB_SERIAL_MAX,
  AWB_VALIDATION_REGEX,
  AWB_INPUT_MAX_LENGTH,
} from '../../constants/defaults'

const STATUS_STAGES = [
  'DG AWB Created',
  'DGD Submitted',
  'DG Check Started',
  'Document Checked',
  'Package Checked',
  'DG Check Completed',
]

const SEED_AWBS = [
  // { id: 1, awb: '516-00000001', origin: 'HKG', destination: 'LAX', statusIndex: 0, statusUpdatedAt: '2026-04-24T08:00:00Z' },
  // { id: 2, awb: '516-00000002', origin: 'SIN', destination: 'FRA', statusIndex: 1, statusUpdatedAt: '2026-04-23T14:30:00Z' },
  // { id: 3, awb: '516-00000003', origin: 'NRT', destination: 'JFK', statusIndex: 2, statusUpdatedAt: '2026-04-22T10:15:00Z' },
  // { id: 4, awb: '516-00000004', origin: 'DXB', destination: 'LHR', statusIndex: 3, statusUpdatedAt: '2026-04-21T16:45:00Z' },
  // { id: 5, awb: '516-00000005', origin: 'SYD', destination: 'CDG', statusIndex: 4, statusUpdatedAt: '2026-04-20T09:20:00Z' },
]

function loadGhaSettings() {
  try {
    const raw = localStorage.getItem(LS_GHA_SETTINGS_KEY)
    if (raw) return JSON.parse(raw)
  } catch (_) { /* ignore */ }
  return { userIdentifier: 'user', userName: '' }
}

function saveGhaSettings(settings) {
  try { localStorage.setItem(LS_GHA_SETTINGS_KEY, JSON.stringify(settings)) } catch (_) { /* ignore */ }
}

function loadAwbs() {
  try {
    const raw = localStorage.getItem(LS_AWB_KEY)
    if (raw) return JSON.parse(raw)
  } catch (_) { /* ignore */ }
  return SEED_AWBS
}

const EMPTY_FORM = { awb: '', origin: '', destination: '', goodDescriptions: '' }

const AIRLINE_PREFIXES = ['020', '074', '172', '180', '235', '297', '406', '516', '607', '618', '784', '988']
const AIRPORTS = ['HKG', 'LAX', 'SIN', 'FRA', 'NRT', 'JFK', 'DXB', 'LHR', 'SYD', 'CDG', 'ICN', 'PVG', 'AMS', 'ORD', 'BKK', 'DOH']

function generateDummyAwb() {
  const prefix = AIRLINE_PREFIXES[Math.floor(Math.random() * AIRLINE_PREFIXES.length)]
  const serial7 = Math.floor(Math.random() * AWB_SERIAL_MAX) + AWB_SERIAL_MIN
  const check = serial7 % 7
  // const awb = `${prefix}-${serial7}${check}`
  const awb = `695-${serial7}${check}`
  const pick = (arr, exclude) => {
    let choice
    do { choice = arr[Math.floor(Math.random() * arr.length)] } while (choice === exclude)
    return choice
  }
  const origin = pick(AIRPORTS, null)
  const destination = pick(AIRPORTS, origin)
  const goodDescriptions = 'UN3480'
  return { awb, origin, destination, goodDescriptions }
}

function AddAwbModal({ onClose, onSave }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [pending, setPending] = useState(null)

  const set = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setErrors(prev => ({ ...prev, [field]: undefined }))
  }

  const validate = () => {
    const e = {}
    if (!form.awb.trim())          e.awb         = 'AWB number is required'
    if (!AWB_VALIDATION_REGEX.test(form.awb.trim())) e.awb = 'Format: NNN-NNNNNNNN (e.g. 516-00000006)'
    if (!form.origin.trim())       e.origin      = 'Origin is required'
    if (form.origin.trim().length !== 3) e.origin = 'Must be 3-letter IATA code'
    if (!form.destination.trim())  e.destination = 'Destination is required'
    if (form.destination.trim().length !== 3) e.destination = 'Must be 3-letter IATA code'
    return e
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const e2 = validate()
    if (Object.keys(e2).length > 0) { setErrors(e2); return }
    setPending({
      id: Date.now(),
      awb: form.awb.trim(),
      origin: form.origin.trim().toUpperCase(),
      destination: form.destination.trim().toUpperCase(),
      goodDescriptions: form.goodDescriptions.trim(),
      statusIndex: 0,
      statusUpdatedAt: new Date().toISOString(),
    })
  }

  const handleConfirm = () => {
    onSave(pending)
    onClose()
  }

  return (
    <div className="settings-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-modal">
        <div className="settings-modal-header">
          <h2>Add AWB</h2>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={handleSubmit} noValidate>
          <div className="settings-modal-body awb-modal-form">
            <div className="awb-modal-row">
              <div className="form-group">
                <label htmlFor="awb-no">AWB Number</label>
                <input
                  id="awb-no"
                  type="text"
                  placeholder="e.g. 516-00000006"
                  value={form.awb}
                  onChange={e => set('awb', e.target.value)}
                  maxLength={AWB_INPUT_MAX_LENGTH}
                />
                {errors.awb && <span className="awb-field-error">{errors.awb}</span>}
              </div>
            </div>
            <div className="awb-modal-row awb-modal-row-split">
              <div className="form-group">
                <label htmlFor="awb-origin">Origin</label>
                <input
                  id="awb-origin"
                  type="text"
                  placeholder="e.g. HKG"
                  value={form.origin}
                  onChange={e => set('origin', e.target.value.toUpperCase())}
                  maxLength={3}
                />
                {errors.origin && <span className="awb-field-error">{errors.origin}</span>}
              </div>
              <div className="form-group">
                <label htmlFor="awb-dest">Destination</label>
                <input
                  id="awb-dest"
                  type="text"
                  placeholder="e.g. JFK"
                  value={form.destination}
                  onChange={e => set('destination', e.target.value.toUpperCase())}
                  maxLength={3}
                />
                {errors.destination && <span className="awb-field-error">{errors.destination}</span>}
              </div>
            </div>
            <div className="awb-modal-row">
              <div className="form-group">
                <label htmlFor="awb-good-desc">Good Descriptions</label>
                <input
                  id="awb-good-desc"
                  type="text"
                  placeholder="e.g. Lithium batteries, UN3480"
                  value={form.goodDescriptions}
                  onChange={e => set('goodDescriptions', e.target.value)}
                />
              </div>
            </div>
            <p className="awb-modal-note">Status will start at <strong>DG AWB Created</strong>.</p>
          </div>
          <div className="settings-modal-footer">
            <button
              type="button"
              className="btn-dummy"
              onClick={() => { setForm(generateDummyAwb()); setErrors({}) }}
            >
              🎲 Fill Dummy
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Add AWB</button>
          </div>
        </form>
      </div>

      {pending && (
        <div className="awb-confirm-overlay">
          <div className="awb-confirm-popup">
            <h3 className="awb-confirm-title">Confirm New AWB</h3>
            <p className="awb-confirm-desc">Please review the details before adding.</p>
            <dl className="awb-confirm-dl">
              <dt>AWB Number</dt>
              <dd>{pending.awb}</dd>
              <dt>Origin</dt>
              <dd>{pending.origin}</dd>
              <dt>Destination</dt>
              <dd>{pending.destination}</dd>
              {pending.goodDescriptions && (<><dt>Good Descriptions</dt><dd>{pending.goodDescriptions}</dd></>)}
              <dt>Initial Status</dt>
              <dd>DG AWB Created</dd>
            </dl>
            <div className="awb-confirm-footer">
              <button className="btn-secondary" onClick={() => setPending(null)}>← Back</button>
              <button className="btn-primary" onClick={handleConfirm}>Confirm &amp; Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusStepper({ statusIndex, statusUpdatedAt }) {
  const formattedTime = statusUpdatedAt
    ? new Date(statusUpdatedAt).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
    : null

  return (
    <div className="awb-status-stepper">
      {STATUS_STAGES.map((stage, i) => (
        <Fragment key={i}>
          <div className="awb-status-step">
            <div className="awb-status-node-wrap">
              <div
                className={`awb-status-node ${
                  i < statusIndex ? 'completed' : i === statusIndex ? 'active' : ''
                }`}
              >
                {i < statusIndex ? '✓' : i + 1}
              </div>
              {i === statusIndex && formattedTime && (
                <div className="awb-status-tooltip">Updated: {formattedTime}</div>
              )}
            </div>
            <span className="awb-status-label">{stage}</span>
          </div>
          {i < STATUS_STAGES.length - 1 && (
            <div className={`awb-status-line ${i < statusIndex ? 'completed' : ''}`} />
          )}
        </Fragment>
      ))}
    </div>
  )
}

const ACTIONS = []

function GhaSettingsModal({ settings, onClose, onSave }) {
  const [userIdentifier, setUserIdentifier] = useState(settings.userIdentifier)
  const [userName, setUserName] = useState(settings.userName ?? '')

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave({
      userIdentifier: userIdentifier.trim() || 'user',
      userName: userName.trim(),
    })
    onClose()
  }

  return (
    <div className="settings-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-modal">
        <div className="settings-modal-header">
          <h2>GHA Settings</h2>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="settings-modal-body awb-modal-form">
            <div className="awb-modal-row">
              <div className="form-group">
                <label htmlFor="gha-user-id">User Identifier</label>
                <input
                  id="gha-user-id"
                  type="text"
                  value={userIdentifier}
                  onChange={e => setUserIdentifier(e.target.value)}
                  placeholder="user"
                />
                <span className="awb-modal-note">Sent as <code>userIdentifier</code> in the Do DG Check request.</span>
              </div>
            </div>
            <div className="awb-modal-row">
              <div className="form-group">
                <label htmlFor="gha-user-name">User Name</label>
                <input
                  id="gha-user-name"
                  type="text"
                  value={userName}
                  onChange={e => setUserName(e.target.value)}
                  placeholder=""
                />
                <span className="awb-modal-note">Sent as <code>userName</code> in the Do DG Check request.</span>
              </div>
            </div>
          </div>
          <div className="settings-modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  )
}

const GHA_DG_CHECK_STATUSES = [2, 3, 4] // DG Check Started, Document Checked, Package Checked

export default function DgAwbPage({ role, onOpenDgd, officeIdentifier = 'HKG', neoneBaseUrl = 'http://localhost:8080', neoneTokenUrl }) {
  const [awbs, setAwbs] = useState(loadAwbs)
  const [showAddModal, setShowAddModal] = useState(false)
  const [ghaSettings, setGhaSettings] = useState(loadGhaSettings)
  const [showGhaSettings, setShowGhaSettings] = useState(false)

  const canAdd = role === 'developer' || role === 'airline'

  const { handler: handleRefresh, loading: refreshLoading, notification: refreshNotification } = useRefreshAction(setAwbs, neoneBaseUrl, neoneTokenUrl)
  const { handler: handleStartDgCheck, loading: startDgCheckLoading } = useStartDgCheckAction(setAwbs, officeIdentifier)
  const { handler: handleDoDgCheck, loading: doDgCheckLoading } = useDoDgCheckAction(ghaSettings, neoneBaseUrl, neoneTokenUrl)
  const handleViewChecklist = useViewChecklistAction()

  useEffect(() => {
    try { localStorage.setItem(LS_AWB_KEY, JSON.stringify(awbs)) } catch (_) { /* ignore */ }
  }, [awbs])

  const handleAdd = (entry) => {
    setAwbs(prev => [...prev, entry])
  }

  const handleAction = (action, awb) => {
    if (action === 'delete') {
      if (window.confirm(`Delete AWB ${awb.awb}?`)) {
        setAwbs(prev => prev.filter(a => a.id !== awb.id))
      }
      return
    }
    console.log(`[DG AWB] Action: ${action}`, awb)
  }

  return (
    <div className="awb-page">
      <div className="awb-page-header">
        <div className="awb-page-header-text">
          <h1>DG AWB</h1>
          <span className="awb-page-subtitle">
            Dangerous Goods Air Waybill — tracking &amp; status overview
          </span>
        </div>
        <div className="awb-page-header-actions">
          {role === 'gha' && (
            <button className="awb-action-btn" title="GHA Settings" onClick={() => setShowGhaSettings(true)}>⚙️</button>
          )}
          {canAdd && (
            <button className="awb-add-btn" onClick={() => setShowAddModal(true)}>
              + Add AWB
            </button>
          )}
        </div>
      </div>

      {showAddModal && (
        <AddAwbModal onClose={() => setShowAddModal(false)} onSave={handleAdd} />
      )}

      {showGhaSettings && (
        <GhaSettingsModal
          settings={ghaSettings}
          onClose={() => setShowGhaSettings(false)}
          onSave={(s) => { setGhaSettings(s); saveGhaSettings(s) }}
        />
      )}

      <div className="awb-table-wrap">
        <table className="awb-table">
          <thead>
            <tr>
              <th>AWB</th>
              <th>Origin</th>
              <th>Destination</th>
              <th>Good Descriptions</th>
              <th>Status</th>
              <th>Check Result</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {awbs.length === 0 ? (
              <tr>
                  <td colSpan={7} className="awb-empty">No AWBs found.</td>
              </tr>
            ) : (
              awbs.map(awb => (
                <tr key={awb.id}>
                  <td className="awb-id-cell">{awb.awb}</td>
                  <td>{awb.origin}</td>
                  <td>{awb.destination}</td>
                  <td>{awb.goodDescriptions || '—'}</td>
                  <td>
                    <StatusStepper statusIndex={awb.statusIndex} statusUpdatedAt={awb.statusUpdatedAt} />
                  </td>
                  <td>
                    {awb.checkResult
                      ? <span className={`awb-check-result awb-check-result--${awb.checkResult}`}>{awb.checkResult === 'passed' ? 'Pass' : 'Failed'}</span>
                      : '—'}
                  </td>
                  <td>
                    <div className="awb-actions">
                      {ACTIONS.map(({ key, icon, title }) => (
                        <button
                          key={key}
                          className={`awb-action-btn ${key === 'delete' ? 'awb-action-delete' : ''}`}
                          title={title}
                          onClick={() => handleAction(key, awb)}
                        >
                          {icon}
                        </button>
                      ))}
                      {awb.acceptanceCheckId && awb.statusIndex !== 5 && (
                        <button
                          className="awb-action-btn"
                          title="DG Auto Check"
                          disabled={refreshLoading === awb.id}
                          onClick={() => handleRefresh(awb)}
                        >
                          {refreshLoading === awb.id ? '⏳' : '🔄'}
                        </button>
                      )}
                      {role === 'shipper' && awb.statusIndex === 0 && (
                        <button
                          className="awb-action-btn awb-action-submit-dgd"
                          title="Submit DGD"
                          onClick={() => onOpenDgd && onOpenDgd(awb.awb)}
                        >
                          📝
                        </button>
                      )}
                      {(role === 'airline' || role === 'developer') && awb.statusIndex === 1 && (
                        <button
                          className="awb-action-btn awb-action-start-dg-check"
                          title="Start DG Check"
                          disabled={startDgCheckLoading === awb.id}
                          onClick={() => handleStartDgCheck(awb)}
                        >
                          {startDgCheckLoading === awb.id ? '⏳' : '▶️'}
                        </button>
                      )}
                      {role === 'gha' && GHA_DG_CHECK_STATUSES.includes(awb.statusIndex) && (
                        <button
                          className="awb-action-btn awb-action-do-dg-check"
                          title="Do DG Check"
                          disabled={doDgCheckLoading === awb.id}
                          onClick={() => handleDoDgCheck(awb)}
                        >
                          {doDgCheckLoading === awb.id ? '⏳' : <img src="/src/img/dgac_icon.jpg.png" alt="Do DG Check" style={{ width: '1.2em', height: '1.2em', objectFit: 'contain', verticalAlign: 'middle' }} />}
                        </button>
                      )}
                      {awb.acceptanceCheckId && awb.statusIndex === 5 && (
                        <button
                          className="awb-action-btn awb-action-view-checklist"
                          title="View Acceptance Checklist"
                          onClick={() => handleViewChecklist(awb)}
                        >
                          📄
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {refreshNotification && (
        <div className={`awb-toast awb-toast--${refreshNotification.type}`}>
          {refreshNotification.text}
        </div>
      )}
    </div>
  )
}
