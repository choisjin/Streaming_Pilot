import { useState } from 'react'

interface LoginPageProps {
  onLogin: () => void
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, otp }),
      })
      if (res.ok) {
        onLogin()
      } else {
        const data = await res.json()
        setError(data.detail || 'Login failed')
      }
    } catch {
      setError('Connection failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-gray-950">
      <form onSubmit={handleSubmit} className="w-80 bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h1 className="text-lg font-semibold text-center mb-6">Ideality Remote Desktop</h1>

        <label className="block mb-4">
          <span className="text-xs text-gray-400">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            autoFocus
          />
        </label>

        <label className="block mb-4">
          <span className="text-xs text-gray-400">OTP Code</span>
          <input
            type="text"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit code"
            className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm tracking-widest text-center focus:outline-none focus:border-blue-500"
            inputMode="numeric"
            maxLength={6}
          />
        </label>

        {error && <p className="text-red-400 text-xs mb-3 text-center">{error}</p>}

        <button
          type="submit"
          disabled={loading || password.length === 0 || otp.length !== 6}
          className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 rounded text-sm font-medium transition-colors"
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  )
}
