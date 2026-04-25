import { useState } from 'react'
import { USERS } from '../../constants/users'

export default function LoginPage({ onLogin, onOpenHelperTool, helperTools = [] }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    const match = USERS.find(u => u.username === username && u.password === password)
    if (match) {
      onLogin(match.username, match.role)
    } else {
      setError('Invalid username or password')
    }
  }

  const quickLogin = (user) => {
    onLogin(user.username, user.role)
  }

  return (
    <div className="login-container">
      <div className="login-split">
        {/* Left: Login panel */}
        <div className="login-left-panel">
          <div className="login-card">
            <div className="login-header">
              <h1>DG Bridge</h1>
              <img src="src/img/stone_logo.png" alt="" style={{ width: '200px' }} />
            </div>
            {/* <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group">
                <label htmlFor="username">Username</label>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                />
              </div>
              {error && <div className="error-message">{error}</div>}
              <button type="submit" className="login-btn">Sign In</button>
            </form> */}
            <div className="login-footer">
              <p className="quick-login-label">Quick login</p>
              <div className="quick-login-btns">
                {USERS.map(u => (
                  <button
                    key={u.username}
                    type="button"
                    className={`quick-login-btn quick-login-btn-${u.role}`}
                    onClick={() => quickLogin(u)}
                  >
                    <span className="quick-login-icon">
                      {u.role === 'airline' ? '✈️' : u.role === 'shipper' ? '🚢' : '🦺'}
                    </span>
                    {u.username}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="login-divider" />

        {/* Right: Helper tools panel */}
        <div className="login-right-panel">
          <div className="helper-tools-panel">
            <div className="helper-tools-header">
              <h2>🛠️ Helper Tools</h2>
              <p>Standalone tools — no login required</p>
            </div>
            <div className="helper-tools-list">
              {helperTools.map(tool => (
                <button
                  key={tool.id}
                  className="helper-tool-card"
                  onClick={() => onOpenHelperTool(tool.id)}
                >
                  <span className="helper-tool-card-icon">{tool.icon}</span>
                  <div className="helper-tool-card-text">
                    <span className="helper-tool-card-label">{tool.label}</span>
                    <span className="helper-tool-card-desc">{tool.description}</span>
                  </div>
                  <span className="helper-tool-card-arrow">›</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
