import { useState } from 'react'
import './App.css'
import LoginPage from './components/auth/LoginPage'
import Stone from './components/stone/Stone'
import XsdgConverterPage from './components/pages/XsdgConverterPage'
import AcceptanceChecklistConverterPage from './components/pages/AcceptanceChecklistConverterPage'

const HELPER_TOOLS = [
  { id: 'xsdg-converter', icon: '🔄', label: 'XSDG Converter', description: 'Convert between XSDG XML and ONE Record JSON-LD' },
  { id: 'acceptance-checklist-converter', icon: '📋', label: 'Acceptance Checklist to ONE Record', description: 'Upload a DG Acceptance Checklist PDF and convert it to a ONE Record cargo:Check JSON-LD' },
]

function HelperToolView({ toolId, onBack }) {
  const tool = HELPER_TOOLS.find(t => t.id === toolId)
  return (
    <div className="helper-tool-view">
      <div className="helper-tool-topbar">
        <button className="helper-tool-back-btn" onClick={onBack}>← Back to Login</button>
        <span className="helper-tool-topbar-title">{tool?.icon} {tool?.label}</span>
        <span />
      </div>
      <div className="helper-tool-content">
        {toolId === 'xsdg-converter' && <XsdgConverterPage />}
        {toolId === 'acceptance-checklist-converter' && <AcceptanceChecklistConverterPage />}
      </div>
    </div>
  )
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [user, setUser] = useState('')
  const [role, setRole] = useState('')
  const [helperTool, setHelperTool] = useState(null)

  const handleLogin = (username, userRole) => {
    setUser(username)
    setRole(userRole)
    setIsLoggedIn(true)
  }

  const handleLogout = () => {
    setUser('')
    setRole('')
    setIsLoggedIn(false)
  }

  const handleSwitchUser = (username, userRole) => {
    setUser(username)
    setRole(userRole)
  }

  if (isLoggedIn) {
    return <Stone user={user} role={role} onLogout={handleLogout} onSwitchUser={handleSwitchUser} />
  }

  if (helperTool) {
    return <HelperToolView toolId={helperTool} onBack={() => setHelperTool(null)} />
  }

  return <LoginPage onLogin={handleLogin} onOpenHelperTool={setHelperTool} helperTools={HELPER_TOOLS} />
}

export default App
