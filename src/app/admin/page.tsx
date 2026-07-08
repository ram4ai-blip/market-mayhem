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
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)
  const [autoAdvance, setAutoAdvance] = useState(false)

  const gameStateRef = useRef<any>(null)
  const autoAdvanceRef = useRef(false)
  const timeLeftRef = useRef(0)

  useEffect(() => { gameStateRef.current = gameState }, [gameState])
  useEffect(() => { autoAdvanceRef.current = autoAdvance }, [autoAdvance])
  useEffect(() => { timeLeftRef.current = timeLeft }, [timeLeft])

  useEffect(() => {
    if (!authed) return
    fetchAll()
    const channel = supabase.channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_prices' }, fetchAll)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [authed])

  // Countdown timer
  useEffect(() => {
    if (!gameState?.phase_ends_at) return
    const interval = setInterval(() => {
      const left = Math.max(0, Math.floor((new Date(gameState.phase_ends_at).getTime() - Date.now()) / 1000))
      setTimeLeft(left)
    }, 500)
    return () => clearInterval(interval)
  }, [gameState?.phase_ends_at])

  // Price tick every 5 seconds + auto advance when timer hits 0
  useEffect(() => {
    if (!authed) return

    // Tick prices every 5 seconds during trading
    const tickInterval = setInterval(async () => {
      const gs = gameStateRef.current
      if (!gs || gs.status !== 'trading') return
      await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tick', password: ADMIN_PWD })
      })
    }, 5000)

    // Auto advance when timer hits 0
    const advanceInterval = setInterval(async () => {
      if (!autoAdvanceRef.current) return
      const gs = gameStateRef.current
      if (!gs || gs.status === 'waiting' || gs.status === 'finished') return
      if (timeLeftRef.current > 0) return

      if (gs.status === 'trading') {
        await fetch('/api/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'next_minute', password: ADMIN_PWD })
        })
        fetchAll()
      } else if (gs.status === 'break') {
        await fetch('/api/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'next_day', password: ADMIN_PWD })
        })
        fetchAll()
      }
    }, 1000)

    return () => { clearInterval(tickInterval); clearInterval(advanceInterval) }
  }, [authed])

  async function fetchAll() {
    const [gsRes, teamsRes, pricesRes] = await Promise.all([
      supabase.from('game_state').select('*').eq('id', 1).single(),
      supabase.from('teams').select('*').order('cash', { ascending: false }),
      supabase.from('stock_prices').select('*').order('symbol'),
    ])
    if (gsRes.data) setGameState(gsRes.data)
    if (teamsRes.data) setTeams(teamsRes.data)
    if (pricesRes.data) setPrices(pricesRes.data)
  }

  async function callAdmin(action: string) {
    setLoading(true)
    setMsg('')
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, password: ADMIN_PWD })
      })
      const data = await res.json()
      if (data.error) setMsg('❌ ' + data.error)
      else setMsg('✅ ' + data.message)
      fetchAll()
    } catch (e) {
      setMsg('❌ Network error')
    }
    setLoading(false)
  }

  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '40px', width: '360px' }}>
          <h2 style={{ marginBottom: '24px', fontSize: '20px' }}>Admin Login</h2>
          <input type="password" value={pwd} onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key === 'Enter' && (pwd === ADMIN_PWD ? setAuthed(true) : setMsg('Wrong password'))}
            placeholder="Enter admin password" style={{ width: '100%', padding: '12px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '15px', outline: 'none', marginBottom: '12px' }} />
          {msg && <p style={{ color: 'var(--red)', fontSize: '13px', marginBottom: '12px' }}>{msg}</p>}
          <button onClick={() => pwd === ADMIN_PWD ? setAuthed(true) : setMsg('Wrong password')}
            style={{ width: '100%', padding: '12px', background: 'var(--green)', color: '#000', border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '15px' }}>Login</button>
        </div>
      </div>
    )
  }

  const statusColor = gameState?.status === 'trading' ? 'var(--green)' : gameState?.status === 'break' ? 'var(--amber)' : gameState?.status === 'finished' ? 'var(--blue)' : 'var(--text-dim)'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <p style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '2px', textTransform: 'uppercase' }}>Admin Panel</p>
            <h1 style={{ fontSize: '28px', fontWeight: 700 }}>Market Mayhem</h1>
          </div>
          <div style={{ padding: '8px 20px', borderRadius: '20px', border: '1px solid', borderColor: statusColor, color: statusColor, fontSize: '12px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' }}>
            {gameState?.status || 'Loading...'}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px' }}>

          {/* Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Game Status */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '16px' }}>Game Status</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                <div style={{ background: 'var(--surface2)', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Day</p>
                  <p style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{gameState?.current_day ?? '-'}/5</p>
                </div>
                <div style={{ background: 'var(--surface2)', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Minute</p>
                  <p style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{gameState?.current_minute ?? '-'}/6</p>
                </div>
              </div>

              {/* Timer */}
              {gameState?.phase_ends_at && (
                <div style={{ textAlign: 'center', marginBottom: '16px', padding: '12px', background: 'var(--surface2)', borderRadius: '8px' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '4px' }}>
                    {gameState.status === 'trading' ? 'MINUTE ENDS IN' : 'BREAK ENDS IN'}
                  </p>
                  <p style={{ fontSize: '32px', fontWeight: 700, fontFamily: 'var(--mono)', color: gameState.status === 'trading' ? 'var(--green)' : 'var(--amber)' }}>
                    {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
                  </p>
                </div>
              )}

              {/* Price tick indicator */}
              {gameState?.status === 'trading' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '8px 12px', background: 'rgba(0,230,118,0.08)', borderRadius: '8px', border: '1px solid rgba(0,230,118,0.2)' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 1s infinite' }} />
                  <span style={{ fontSize: '12px', color: 'var(--green)' }}>Prices updating every 5s</span>
                </div>
              )}

              {/* Auto Advance Toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', padding: '10px 14px', background: 'var(--surface2)', borderRadius: '8px' }}>
                <div>
                  <p style={{ fontSize: '13px', fontWeight: 500 }}>Auto Advance</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Auto next minute/day</p>
                </div>
                <button onClick={() => setAutoAdvance(!autoAdvance)} style={{
                  width: '44px', height: '24px', borderRadius: '12px', border: 'none',
                  background: autoAdvance ? 'var(--green)' : 'var(--border)',
                  position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0
                }}>
                  <span style={{
                    position: 'absolute', top: '2px', left: autoAdvance ? '22px' : '2px',
                    width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s'
                  }} />
                </button>
              </div>

              {msg && <div style={{ marginBottom: '12px', padding: '10px 14px', background: 'var(--surface2)', borderRadius: '8px', fontSize: '13px', color: msg.startsWith('✅') ? 'var(--green)' : 'var(--red)' }}>{msg}</div>}

              {/* Buttons */}
              {gameState?.status === 'waiting' && (
                <button onClick={() => callAdmin('start')} disabled={loading}
                  style={{ width: '100%', padding: '14px', background: 'var(--green)', color: '#000', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>
                  {loading ? 'Starting...' : '▶ Start Simulation'}
                </button>
              )}
              {gameState?.status === 'trading' && (
                <button onClick={() => callAdmin('next_minute')} disabled={loading}
                  style={{ width: '100%', padding: '14px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>
                  {loading ? 'Processing...' : '⏭ Next Minute'}
                </button>
              )}
              {gameState?.status === 'break' && (
                <button onClick={() => callAdmin('next_day')} disabled={loading}
                  style={{ width: '100%', padding: '14px', background: 'var(--amber)', color: '#000', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>
                  {loading ? 'Processing...' : '🌅 Start Next Day'}
                </button>
              )}
              {gameState?.status === 'finished' && (
                <div style={{ padding: '14px', background: 'var(--surface2)', borderRadius: '10px', textAlign: 'center', color: 'var(--green)', fontWeight: 700, marginBottom: '8px' }}>
                  🏆 Game Complete!
                </div>
              )}
              <button onClick={() => { if (confirm('Reset everything?')) callAdmin('reset') }} disabled={loading}
                style={{ width: '100%', padding: '12px', background: 'transparent', color: 'var(--red)', border: '1px solid var(--red)', borderRadius: '10px', fontSize: '14px', fontWeight: 600 }}>
                ↺ Reset Game
              </button>
            </div>

            {/* Teams */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '12px' }}>Teams Joined ({teams.length}/7)</p>
              {teams.length === 0 ? <p style={{ color: 'var(--text-dim)', fontSize: '13px' }}>No teams yet</p> : teams.map(t => (
                <div key={t.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '13px' }}>{t.name}</span>
                  <span style={{ fontSize: '12px', color: 'var(--green)', fontFamily: 'var(--mono)' }}>●</span>
                </div>
              ))}
            </div>
          </div>

          {/* Leaderboard + Prices */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* Leaderboard */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '16px' }}>🏆 Live Leaderboard</p>
              {teams.length === 0 ? <p style={{ color: 'var(--text-dim)', fontSize: '13px' }}>No teams joined yet</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['#', 'Team', 'Cash'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '1px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {teams.map((t, i) => (
                      <tr key={t.name} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px', fontSize: '13px', color: 'var(--text-dim)' }}>{i + 1}</td>
                        <td style={{ padding: '12px', fontSize: '14px', fontWeight: 600 }}>{t.name}</td>
                        <td style={{ padding: '12px', fontSize: '13px', fontFamily: 'var(--mono)', color: 'var(--green)' }}>₹{(t.cash / 100000).toFixed(2)}L</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Stock Prices */}
            {prices.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px' }}>
                <p style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '16px' }}>📈 Live Prices</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px' }}>
                  {prices.map(p => {
                    const change = ((p.price - p.base_price) / p.base_price * 100)
                    return (
                      <div key={p.symbol} style={{ background: 'var(--surface2)', borderRadius: '8px', padding: '10px 12px' }}>
                        <p style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{p.symbol}</p>
                        <p style={{ fontSize: '14px', fontWeight: 600 }}>₹{p.price.toFixed(2)}</p>
                        <p style={{ fontSize: '11px', color: change >= 0 ? 'var(--green)' : 'var(--red)' }}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  )
}