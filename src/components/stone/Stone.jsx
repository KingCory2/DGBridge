import { useState, useRef, useEffect } from 'react'
import OneRecordPage from '../pages/OneRecordPage'
import GraphDbPage from '../pages/GraphDbPage'
import NeoneEndpointPage from '../pages/NeoneEndpointPage'
import XsdgConverterPage from '../pages/XsdgConverterPage'
import DgdFormPage from '../pages/DgdFormPage'
import PdfViewerPage from '../pages/PdfViewerPage'
import DgAwbPage from '../pages/DgAwbPage'
import { ROLE_PAGES, canAccess, USERS } from '../../constants/users'
import {
  DEFAULT_NEONE_BASE_URL,
  DEFAULT_NEONE_TOKEN_URL,
  DEFAULT_GRAPHDB_ENDPOINT,
  DEFAULT_OFFICE_IDENTIFIER,
  LS_AWB_KEY,
} from '../../constants/defaults'

const ALL_NAV = [
  { id: 'one-record',      icon: '📄', label: 'ONE Record' },
  { id: 'graph-db',        icon: '🔍', label: 'GraphDB Endpoint Testing' },
  { id: 'neone',           icon: '🌐', label: 'NEOne Endpoint' },
  { id: 'xsdg-converter',  icon: '🔄', label: 'XSDG Converter' },
  { id: 'dgd-form',        icon: '🛩️', label: 'DGD Form',  navHidden: (role) => role === 'shipper' },
  { id: 'dg-awb',          icon: '📦', label: 'DG AWB' },
  { id: 'pdf-viewer',      icon: '📋', label: 'PDF Viewer' },
]

export default function Stone({ user, role, onLogout, onSwitchUser }) {
  const [activePage, setActivePage] = useState(() => ROLE_PAGES[role]?.[0] ?? 'one-record')
  const [dgdContext, setDgdContext] = useState(null)

  const openDgdForAwb = (awb) => {
    setDgdContext({ awb, viewOnly: true })
    setActivePage('dgd-form')
  }

  const handleDgdSubmitSuccess = (awb) => {
    try {
      const raw = localStorage.getItem(LS_AWB_KEY)
      if (raw) {
        const awbs = JSON.parse(raw)
        const updated = awbs.map(a => a.awb === awb ? { ...a, statusIndex: 1, statusUpdatedAt: new Date().toISOString() } : a)
        localStorage.setItem(LS_AWB_KEY, JSON.stringify(updated))
      }
    } catch (_) { /* ignore */ }
    setDgdContext(null)
    setActivePage('dg-awb')
  }
  const [graphdbEndpoint, setGraphdbEndpoint] = useState(DEFAULT_GRAPHDB_ENDPOINT)
  const [neoneBaseUrl, setNeoneBaseUrl] = useState(DEFAULT_NEONE_BASE_URL)
  const [neoneTokenUrl, setNeoneTokenUrl] = useState(DEFAULT_NEONE_TOKEN_URL)
  const [officeIdentifier, setOfficeIdentifier] = useState(DEFAULT_OFFICE_IDENTIFIER)
  const [showSettings, setShowSettings] = useState(false)
  const [endpointInput, setEndpointInput] = useState(DEFAULT_GRAPHDB_ENDPOINT)
  const [neoneInput, setNeoneInput] = useState(DEFAULT_NEONE_BASE_URL)
  const [neoneTokenInput, setNeoneTokenInput] = useState(DEFAULT_NEONE_TOKEN_URL)
  const [officeIdentifierInput, setOfficeIdentifierInput] = useState(DEFAULT_OFFICE_IDENTIFIER)
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setUserDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const openSettings = () => {
    setEndpointInput(graphdbEndpoint)
    setNeoneInput(neoneBaseUrl)
    setNeoneTokenInput(neoneTokenUrl)
    setOfficeIdentifierInput(officeIdentifier)
    setShowSettings(true)
  }

  const saveSettings = () => {
    setGraphdbEndpoint(endpointInput)
    setNeoneBaseUrl(neoneInput)
    setNeoneTokenUrl(neoneTokenInput)
    setOfficeIdentifier(officeIdentifierInput)
    setShowSettings(false)
  }

  return (
    <div className="stone-container">
      <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        <button
          className="sidebar-toggle-btn"
          onClick={() => setSidebarCollapsed(c => !c)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? '▶' : '◀'}
        </button>
        <div className="sidebar-header">
          <div className="user-info">
            <span className="user-avatar">
              {role === 'airline' ? '✈️' : role === 'shipper' ? '🚢' : '🦺'}
            </span>
            <span className="user-name">{user}</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="tree-menu">
            {ALL_NAV.filter(n => canAccess(role, n.id) && !n.navHidden?.(role)).map(n => (
              <div
                key={n.id}
                className={`tree-item ${activePage === n.id ? 'active' : ''}`}
                onClick={() => { setActivePage(n.id); setDgdContext(null) }}
              >
                <span className="tree-icon">{n.icon}</span>
                <span className="tree-label">{n.label}</span>
              </div>
            ))}
          </div>
        </nav>
        <div className="sidebar-footer">
          <button className="settings-btn" onClick={openSettings}>
            <span className="settings-icon">⚙️</span>
            <span>Settings</span>
          </button>
          <button onClick={onLogout} className="logout-btn">
            <span className="logout-icon">🚪</span>
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <div className="main-content">
        <header className="header">
          <div className="header-left">
            <h1>ST:ONE</h1>
          </div>
          <div className="header-right">
            <div className="user-profile" ref={dropdownRef}>
              <button
                className="user-dropdown-btn"
                onClick={() => setUserDropdownOpen(o => !o)}
                aria-haspopup="listbox"
                aria-expanded={userDropdownOpen}
              >
                <span className="user-avatar">
                  {role === 'airline' ? '✈️' : role === 'shipper' ? '🚢' : '🦺'}
                </span>
                <span className="user-name">{user}</span>
                <span className="dropdown-caret">{userDropdownOpen ? '▴' : '▾'}</span>
              </button>
              {userDropdownOpen && (
                <div className="user-dropdown-menu" role="listbox">
                  {USERS.map(u => (
                    <button
                      key={u.username}
                      role="option"
                      aria-selected={u.username === user}
                      className={`user-dropdown-item${u.username === user ? ' active' : ''}`}
                      onClick={() => {
                        onSwitchUser(u.username, u.role)
                        setActivePage(ROLE_PAGES[u.role]?.[0] ?? 'one-record')
                        setUserDropdownOpen(false)
                      }}
                    >
                      <span>{u.role === 'airline' ? '✈️' : u.role === 'shipper' ? '🚢' : '🦺'}</span>
                      <span className="dropdown-item-name">{u.username}</span>
                      {/* <span className="dropdown-item-role">{u.role}</span> */}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="content">
          {activePage === 'one-record'     && canAccess(role, 'one-record')     && <OneRecordPage />}
          {activePage === 'graph-db'       && canAccess(role, 'graph-db')       && <GraphDbPage graphdbEndpoint={graphdbEndpoint} />}
          {activePage === 'neone'          && canAccess(role, 'neone')          && <NeoneEndpointPage neoneBaseUrl={neoneBaseUrl} neoneTokenUrl={neoneTokenUrl} />}
          {activePage === 'xsdg-converter' && canAccess(role, 'xsdg-converter') && <XsdgConverterPage />}
          {activePage === 'dgd-form'       && canAccess(role, 'dgd-form')       && <DgdFormPage neoneBaseUrl={neoneBaseUrl} neoneTokenUrl={neoneTokenUrl} initialAwb={dgdContext?.awb ?? ''} viewOnly={dgdContext?.viewOnly ?? false} onClose={() => { setDgdContext(null); setActivePage('dg-awb') }} onSubmitSuccess={dgdContext ? handleDgdSubmitSuccess : undefined} />}
          {activePage === 'dg-awb'         && canAccess(role, 'dg-awb')         && <DgAwbPage role={role} onOpenDgd={openDgdForAwb} officeIdentifier={officeIdentifier} neoneBaseUrl={neoneBaseUrl} neoneTokenUrl={neoneTokenUrl} />}
          {activePage === 'pdf-viewer'     && canAccess(role, 'pdf-viewer')     && <PdfViewerPage />}

          {showSettings && (
            <div className="settings-overlay" onClick={() => setShowSettings(false)}>
              <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
                <div className="settings-modal-header">
                  <h2>Settings</h2>
                  <button className="settings-close-btn" onClick={() => setShowSettings(false)}>✕</button>
                </div>
                <div className="settings-modal-body">
                  <div className="form-group">
                    <label htmlFor="graphdbEndpoint">GraphDB Repository Endpoint</label>
                    <input
                      type="text"
                      id="graphdbEndpoint"
                      value={endpointInput}
                      onChange={(e) => setEndpointInput(e.target.value)}
                      placeholder="http://localhost:7200/repositories/my-repo"
                    />
                  </div>
                  <div className="form-group" style={{ marginTop: '16px' }}>
                    <label htmlFor="neoneBaseUrl">NEOne Server Base URL</label>
                    <input
                      type="text"
                      id="neoneBaseUrl"
                      value={neoneInput}
                      onChange={(e) => setNeoneInput(e.target.value)}
                      placeholder="http://localhost:8080"
                    />
                  </div>
                  <div className="form-group" style={{ marginTop: '16px' }}>
                    <label htmlFor="neoneTokenUrl">NEOne Token URL</label>
                    <input
                      type="text"
                      id="neoneTokenUrl"
                      value={neoneTokenInput}
                      onChange={(e) => setNeoneTokenInput(e.target.value)}
                      placeholder="http://localhost:8989/realms/neone/protocol/openid-connect/token"
                    />
                  </div>
                  <div className="form-group" style={{ marginTop: '16px' }}>
                    <label htmlFor="officeIdentifier">DG Check Office Identifier</label>
                    <input
                      type="text"
                      id="officeIdentifier"
                      value={officeIdentifierInput}
                      onChange={(e) => setOfficeIdentifierInput(e.target.value.toUpperCase())}
                      placeholder="e.g. HKG"
                      maxLength={10}
                    />
                  </div>
                </div>
                <div className="settings-modal-footer">
                  <button className="clear-btn" onClick={() => setShowSettings(false)}>Cancel</button>
                  <button className="search-btn" onClick={saveSettings}>Save</button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
