'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

const ADMIN_PWD = 'marketadmin2024'

export default function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [pwd, setPwd] = useState('')
  const [gameState, setGameState] = useState<any>(null)
  const [teams, setTeams] = useState<any[]>([])
  const [prices, setPrices] = useState<any[]>([])
  const [holdings, setHoldings] = useState<any[]>([])
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const timerRef = useRef<any>(null)
  const priceTickRef = useRef<any>(null)
  const minuteTickRef = useRef<any>(null)
  const autoAdvanceRef = useRef(false)
  const gameStateRef = useRef<any>(null)  // always-current ref for intervals

  // Keep ref in sync with state
  useEffect(() => { gameStateRef.current = gameState }, [gameState])

  useEffect(() => {
    if (!authed) return
    fetchAll()
    // Poll every 3s so admin view stays fresh too
    const poll = setInterval(() => fetchAll(), 3000)
    const channel = supabase.channel('admin-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_prices' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'holdings' }, fetchAll)
      .subscribe()
    return () => { clearInterval(poll); supabase.removeChannel(channel) }
  }, [authed])

  // Countdown timer — runs off phase_ends_at from DB, always in sync
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (gameState?.phase_ends_at && (gameState.status === 'trading' || gameState.status === 'break')) {
      timerRef.current = setInterval(() => {
        const left = Math.max(0, Math.floor((new Date(gameState.phase_ends_at).getTime() - Date.now()) / 1000))
        setTimeLeft(left)
      }, 500)
    } else {
      setTimeLeft(null)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [gameState?.phase_ends_at, gameState?.status])

  // Auto-advance intervals — use ref so they always see latest game state
  useEffect(() => {
    if (priceTickRef.current) clearInterval(priceTickRef.current)
    if (minuteTickRef.current) clearInterval(minuteTickRef.current)

    if (gameState?.status === 'trading' && autoAdvanceRef.current) {
      // Price noise every 10s
      priceTickRef.current = setInterval(() => {
        if (gameStateRef.current?.status === 'trading') {
          callAdmin('price_tick', true)
        }
      }, 10000)

      // Minute advance every 60s
      minuteTickRef.current = setInterval(() => {
        if (gameStateRef.current?.status === 'trading') {
          callAdmin('next_minute', true)
        }
      }, 60000)
    }

    return () => {
      if (priceTickRef.current) clearInterval(priceTickRef.current)
      if (minuteTickRef.current) clearInterval(minuteTickRef.current)
    }
  }, [gameState?.status, gameState?.current_minute])

  async function fetchAll() {
    const [gsRes, teamsRes, pricesRes, holdingsRes] = await Promise.all([
      supabase.from('game_state').select('*').eq('id', 1).single(),
      supabase.from('teams').select('*'),
      supabase.from('stock_prices').select('*').order('symbol'),
      supabase.from('holdings').select('*'),
    ])
    if (gsRes.data) setGameState(gsRes.data)
    if (teamsRes.data) setTeams(teamsRes.data)
    if (pricesRes.data) setPrices(pricesRes.data)
    if (holdingsRes.data) setHoldings(holdingsRes.data)
  }

  async function callAdmin(action: string, silent = false) {
    if (!silent) { setLoading(true); setMsg('') }
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, password: ADMIN_PWD }),
      })
      const data = await res.json()
      if (!silent) {
        if (data.error) setMsg('❌ ' + data.error)
        else setMsg('✅ ' + data.message)
        fetchAll()
      }
    } catch {
      if (!silent) setMsg('❌ Network error')
    }
    if (!silent) setLoading(false)
  }

  async function handleStart() {
    autoAdvanceRef.current = true
    await callAdmin('start')
  }

  async function handleNextDay() {
    autoAdvanceRef.current = true
    await callAdmin('next_day')
  }

  async function handleReset() {
    if (!confirm('Reset everything? All participants will be kicked out.')) return
    autoAdvanceRef.current = false
    if (priceTickRef.current) clearInterval(priceTickRef.current)
    if (minuteTickRef.current) clearInterval(minuteTickRef.current)
    await callAdmin('reset')
  }

  // Compute leaderboard with portfolio values
  const leaderboard = teams.map(t => {
    const portfolioVal = holdings
      .filter(h => h.team_name === t.name && h.quantity > 0)
      .reduce((sum, h) => sum + h.quantity * (prices.find(p => p.symbol === h.symbol)?.price || 0), 0)
    const total = t.cash + portfolioVal
    const ret = ((total - 1000000) / 1000000) * 100
    return { ...t, portfolioVal, total, ret }
  }).sort((a, b) => b.total - a.total)

  const statusColor = gameState?.status === 'trading' ? '#00e676'
    : gameState?.status === 'break' ? '#ffab00'
    : gameState?.status === 'finished' ? '#448aff' : '#6b6b80'

  const timerColor = timeLeft !== null && timeLeft <= 20 ? '#ff1744'
    : timeLeft !== null && timeLeft <= 40 ? '#ffab00' : '#00e676'

  // ── LOGIN ──────────────────────────────────────────────
  if (!authed) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0f' }}>
      <div style={{ background: '#111118', border: '1px solid #2a2a3a', borderRadius: '16px', padding: '40px', width: '360px' }}>
        <h2 style={{ marginBottom: '8px', fontSize: '20px', color: '#e8e8f0' }}>Admin Login</h2>
        <p style={{ fontSize: '12px', color: '#6b6b80', marginBottom: '24px' }}>Market Mayhem Control Panel</p>
        <input type="password" value={pwd} onChange={e => setPwd(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (pwd === ADMIN_PWD ? setAuthed(true) : setMsg('Wrong password'))}
          placeholder="Enter admin password"
          style={{ width: '100%', padding: '12px 16px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: '8px', color: '#e8e8f0', fontSize: '15px', outline: 'none', marginBottom: '12px', boxSizing: 'border-box' }} />
        {msg && <p style={{ color: '#ff1744', fontSize: '13px', marginBottom: '12px' }}>{msg}</p>}
        <button onClick={() => pwd === ADMIN_PWD ? setAuthed(true) : setMsg('Wrong password')}
          style={{ width: '100%', padding: '12px', background: '#00e676', color: '#000', border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '15px', cursor: 'pointer' }}>
          Login
        </button>
      </div>
    </div>
  )

  // ── MAIN ──────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', padding: '20px', fontFamily: 'Inter, sans-serif', color: '#e8e8f0' }}>
      <div style={{ maxWidth: '1300px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <p style={{ fontSize: '10px', color: '#6b6b80', letterSpacing: '3px', textTransform: 'uppercase' }}>Admin Panel</p>
            <h1 style={{ fontSize: '26px', fontWeight: 700 }}>Market Mayhem</h1>
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            {timeLeft !== null && (
              <div style={{ textAlign: 'center', padding: '6px 20px', borderRadius: '10px', border: `1px solid ${timerColor}`, background: `${timerColor}18` }}>
                <p style={{ fontSize: '10px', color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  {gameState?.status === 'trading' ? 'Minute Ends' : 'Break Ends'}
                </p>
                <p style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'monospace', color: timerColor }}>
                  {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
                </p>
              </div>
            )}
            <div style={{ padding: '8px 20px', borderRadius: '20px', border: `1px solid ${statusColor}`, color: statusColor, fontSize: '12px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
              {gameState?.status || '...'}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '20px' }}>

          {/* LEFT — Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            <div style={{ background: '#111118', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '20px' }}>
              <p style={{ fontSize: '10px', color: '#6b6b80', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '16px' }}>Game Controls</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                {[{ label: 'Day', value: `${gameState?.current_day ?? '-'}/5` }, { label: 'Minute', value: `${gameState?.current_minute ?? '-'}/6` }].map(({ label, value }) => (
                  <div key={label} style={{ background: '#1a1a24', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                    <p style={{ fontSize: '10px', color: '#6b6b80' }}>{label}</p>
                    <p style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'monospace' }}>{value}</p>
                  </div>
                ))}
              </div>

              {msg && (
                <div style={{ marginBottom: '12px', padding: '10px 14px', background: '#1a1a24', borderRadius: '8px', fontSize: '13px', color: msg.startsWith('✅') ? '#00e676' : '#ff1744' }}>
                  {msg}
                </div>
              )}

              {gameState?.status === 'waiting' && (
                <button onClick={handleStart} disabled={loading}
                  style={{ width: '100%', padding: '14px', background: '#00e676', color: '#000', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 800, cursor: 'pointer', marginBottom: '8px' }}>
                  {loading ? 'Starting...' : '▶ Start Simulation'}
                </button>
              )}
              {gameState?.status === 'trading' && (
                <button onClick={() => callAdmin('next_minute')} disabled={loading}
                  style={{ width: '100%', padding: '14px', background: '#448aff', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', marginBottom: '8px' }}>
                  {loading ? '...' : '⏭ Next Minute'}
                </button>
              )}
              {gameState?.status === 'break' && (
                <button onClick={handleNextDay} disabled={loading}
                  style={{ width: '100%', padding: '14px', background: '#ffab00', color: '#000', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', marginBottom: '8px' }}>
                  {loading ? '...' : '🌅 Start Next Day'}
                </button>
              )}
              {gameState?.status === 'finished' && (
                <div style={{ padding: '14px', background: '#1a1a24', borderRadius: '10px', textAlign: 'center', color: '#00e676', fontWeight: 700, marginBottom: '8px', fontSize: '15px' }}>
                  🏆 Simulation Complete!
                </div>
              )}

              <button onClick={handleReset} disabled={loading}
                style={{ width: '100%', padding: '12px', background: 'transparent', color: '#ff1744', border: '1px solid #ff1744', borderRadius: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                ↺ Reset & Kick All
              </button>
            </div>

            {/* Session Flow */}
            <div style={{ background: '#111118', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '20px' }}>
              <p style={{ fontSize: '10px', color: '#6b6b80', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>Session Flow</p>
              {[
                { label: 'Total Duration', value: '40 min' },
                { label: 'Trading per Day', value: '6 min' },
                { label: 'Revision Break', value: '2 min' },
                { label: 'Trading Days', value: '5 days' },
                { label: 'Price Updates', value: 'Every 10s' },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1a1a24', fontSize: '12px' }}>
                  <span style={{ color: '#6b6b80' }}>{label}</span>
                  <span style={{ fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>

            {/* Teams */}
            <div style={{ background: '#111118', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '20px' }}>
              <p style={{ fontSize: '10px', color: '#6b6b80', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>Teams ({teams.length}/7)</p>
              {teams.length === 0
                ? <p style={{ color: '#6b6b80', fontSize: '13px' }}>No teams joined yet</p>
                : teams.map(t => (
                  <div key={t.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #1a1a24' }}>
                    <span style={{ fontSize: '13px' }}>{t.name}</span>
                    <span style={{ fontSize: '11px', color: '#00e676' }}>● Online</span>
                  </div>
                ))}
            </div>
          </div>

          {/* RIGHT — Leaderboard + Prices */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            <div style={{ background: '#111118', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '20px' }}>
              <p style={{ fontSize: '10px', color: '#6b6b80', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '16px' }}>🏆 Live Leaderboard</p>
              {leaderboard.length === 0
                ? <p style={{ color: '#6b6b80', fontSize: '13px' }}>No teams yet</p>
                : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #2a2a3a' }}>
                        {['#', 'Team', 'Cash', 'Portfolio', 'Total', 'Return %'].map(h => (
                          <th key={h} style={{ padding: '8px 10px', textAlign: h === '#' ? 'center' : 'right', fontSize: '10px', color: '#6b6b80', letterSpacing: '1px', fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((t, i) => (
                        <tr key={t.name} style={{ borderBottom: '1px solid #1a1a24' }}>
                          <td style={{ padding: '10px', textAlign: 'center', fontSize: '14px' }}>
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span style={{ color: '#6b6b80' }}>{i + 1}</span>}
                          </td>
                          <td style={{ padding: '10px', textAlign: 'right', fontSize: '14px', fontWeight: 600 }}>{t.name}</td>
                          <td style={{ padding: '10px', textAlign: 'right', fontSize: '12px', fontFamily: 'monospace', color: '#6b6b80' }}>₹{(t.cash / 100000).toFixed(2)}L</td>
                          <td style={{ padding: '10px', textAlign: 'right', fontSize: '12px', fontFamily: 'monospace', color: '#448aff' }}>₹{(t.portfolioVal / 100000).toFixed(2)}L</td>
                          <td style={{ padding: '10px', textAlign: 'right', fontSize: '13px', fontFamily: 'monospace', fontWeight: 700 }}>₹{(t.total / 100000).toFixed(2)}L</td>
                          <td style={{ padding: '10px', textAlign: 'right', fontSize: '14px', fontFamily: 'monospace', fontWeight: 800, color: t.ret >= 0 ? '#00e676' : '#ff1744' }}>
                            {t.ret >= 0 ? '+' : ''}{t.ret.toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>

            {prices.length > 0 && (
              <div style={{ background: '#111118', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '20px' }}>
                <p style={{ fontSize: '10px', color: '#6b6b80', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '16px' }}>📈 Live Stock Prices</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
                  {prices.map(p => {
                    const change = ((p.price - p.base_price) / p.base_price) * 100
                    return (
                      <div key={p.symbol} style={{ background: '#1a1a24', borderRadius: '8px', padding: '10px 12px' }}>
                        <p style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'monospace' }}>{p.symbol}</p>
                        <p style={{ fontSize: '14px', fontWeight: 600, margin: '2px 0' }}>₹{p.price.toFixed(2)}</p>
                        <p style={{ fontSize: '11px', color: change >= 0 ? '#00e676' : '#ff1744' }}>
                          {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}