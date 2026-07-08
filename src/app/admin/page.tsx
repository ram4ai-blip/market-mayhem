'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { NEWS_SCRIPT, STOCKS, TEAMS } from '@/lib/gameData'

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

  // Refs so intervals always see latest values
  const gsRef = useRef<any>(null)
  const advancingRef = useRef(false)

  useEffect(() => { gsRef.current = gameState }, [gameState])

  const fetchAll = useCallback(async () => {
    const [gsRes, teamsRes, pricesRes] = await Promise.all([
      supabase.from('game_state').select('*').eq('id', 1).single(),
      supabase.from('teams').select('*'),
      supabase.from('stock_prices').select('*').order('symbol'),
    ])
    if (gsRes.data) setGameState(gsRes.data)
    if (teamsRes.data) setTeams(teamsRes.data)
    if (pricesRes.data) setPrices(pricesRes.data)
  }, [])

  // Subscribe to realtime
  useEffect(() => {
    if (!authed) return
    fetchAll()
    const channel = supabase.channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, (p) => {
        setGameState(p.new)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_prices' }, (p) => {
        setPrices(prev => prev.map(x => x.symbol === (p.new as any).symbol ? p.new : x))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [authed, fetchAll])

  // ── Countdown timer — reads phase_ends_at from Supabase (same as participants) ──
  useEffect(() => {
    if (!gameState?.phase_ends_at) { setTimeLeft(0); return }
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(gameState.phase_ends_at).getTime() - Date.now()) / 1000))
      setTimeLeft(left)
    }
    tick()
    const interval = setInterval(tick, 500)
    return () => clearInterval(interval)
  }, [gameState?.phase_ends_at])

  // ── Master game loop — runs every second, fully automatic ──
  useEffect(() => {
    if (!authed) return

    // Every 5 seconds: noise tick for price movement
    const tickInterval = setInterval(async () => {
      const gs = gsRef.current
      if (!gs || gs.status !== 'trading') return
      await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'price_tick', password: ADMIN_PWD })
      })
    }, 5000)

    // Every second: check if timer expired → advance game
    const advanceInterval = setInterval(async () => {
      const gs = gsRef.current
      if (!gs) return
      if (gs.status !== 'trading' && gs.status !== 'break') return
      if (!gs.phase_ends_at) return

      const left = Math.max(0, new Date(gs.phase_ends_at).getTime() - Date.now())
      if (left > 1500) return          // still time left
      if (advancingRef.current) return // prevent double call
      advancingRef.current = true

      await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'advance', password: ADMIN_PWD })
      })
      await fetchAll()
      setTimeout(() => { advancingRef.current = false }, 3000)
    }, 1000)

    return () => { clearInterval(tickInterval); clearInterval(advanceInterval) }
  }, [authed, fetchAll])

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
      await fetchAll()
    } catch {
      setMsg('❌ Network error')
    }
    setLoading(false)
  }

  if (!authed) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '40px', width: '360px' }}>
        <h2 style={{ marginBottom: '24px', fontSize: '20px' }}>Admin Login</h2>
        <input type="password" value={pwd} onChange={e => setPwd(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (pwd === ADMIN_PWD ? setAuthed(true) : setMsg('Wrong password'))}
          placeholder="Enter admin password"
          style={{ width: '100%', padding: '12px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '15px', outline: 'none', marginBottom: '12px' }} />
        {msg && <p style={{ color: 'var(--red)', fontSize: '13px', marginBottom: '12px' }}>{msg}</p>}
        <button onClick={() => pwd === ADMIN_PWD ? setAuthed(true) : setMsg('Wrong password')}
          style={{ width: '100%', padding: '12px', background: 'var(--green)', color: '#000', border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '15px' }}>
          Login
        </button>
      </div>
    </div>
  )

  const statusColor = gameState?.status === 'trading' ? 'var(--green)' : gameState?.status === 'break' ? 'var(--amber)' : gameState?.status === 'finished' ? 'var(--blue)' : 'var(--text-dim)'
  const currentNews = gameState ? NEWS_SCRIPT.find(n => n.day === gameState.current_day && n.minute === gameState.current_minute) : null

  const mins = Math.floor(timeLeft / 60)
  const secs = String(timeLeft % 60).padStart(2, '0')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px', fontFamily: 'var(--sans)' }}>
      <div style={{ maxWidth: '1300px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
          <div>
            <p style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '2px', textTransform: 'uppercase' }}>Admin Panel</p>
            <h1 style={{ fontSize: '28px', fontWeight: 700 }}>Market Mayhem</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {msg && <span style={{ fontSize: '13px', color: msg.startsWith('✅') ? 'var(--green)' : 'var(--red)' }}>{msg}</span>}
            <div style={{ padding: '8px 20px', borderRadius: '20px', border: `1px solid ${statusColor}`, color: statusColor, fontSize: '12px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' }}>
              {gameState?.status || 'Loading...'}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '20px' }}>

          {/* LEFT: Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Game Status */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '16px' }}>Game Status</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                <div style={{ background: 'var(--surface2)', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Day</p>
                  <p style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{gameState?.current_day ?? '-'}/5</p>
                </div>
                <div style={{ background: 'var(--surface2)', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Minute</p>
                  <p style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{gameState?.current_minute ?? '-'}/6</p>
                </div>
              </div>

              {/* Timer — synced to phase_ends_at, same as participants */}
              {gameState?.phase_ends_at && (
                <div style={{ textAlign: 'center', marginBottom: '16px', padding: '14px', background: 'var(--surface2)', borderRadius: '10px' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '4px', letterSpacing: '1px' }}>
                    {gameState.status === 'trading' ? '⏱ TRADING TIME LEFT' : '☕ BREAK TIME LEFT'}
                  </p>
                  <p style={{ fontSize: '40px', fontWeight: 700, fontFamily: 'var(--mono)', color: gameState.status === 'trading' ? 'var(--green)' : 'var(--amber)', lineHeight: 1 }}>
                    {mins}:{secs}
                  </p>
                  <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
                    Auto advances when timer hits 0
                  </p>
                </div>
              )}

              {/* Price tick indicator */}
              {gameState?.status === 'trading' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', padding: '8px 12px', background: 'rgba(0,230,118,0.08)', borderRadius: '8px', border: '1px solid rgba(0,230,118,0.15)' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 1s infinite' }} />
                  <span style={{ fontSize: '12px', color: 'var(--green)' }}>Prices live every 5s</span>
                </div>
              )}

              {/* Start button */}
              {gameState?.status === 'waiting' && (
                <button onClick={() => callAdmin('start')} disabled={loading}
                  style={{ width: '100%', padding: '14px', background: 'var(--green)', color: '#000', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>
                  {loading ? 'Starting...' : '▶ Start Simulation'}
                </button>
              )}

              {/* Running states — no manual buttons needed, fully auto */}
              {gameState?.status === 'trading' && (
                <div style={{ padding: '12px', background: 'rgba(0,230,118,0.08)', border: '1px solid rgba(0,230,118,0.2)', borderRadius: '10px', textAlign: 'center', marginBottom: '8px', fontSize: '13px', color: 'var(--green)' }}>
                  🟢 Market is OPEN — auto advancing
                </div>
              )}
              {gameState?.status === 'break' && (
                <div style={{ padding: '12px', background: 'rgba(255,171,0,0.08)', border: '1px solid rgba(255,171,0,0.2)', borderRadius: '10px', textAlign: 'center', marginBottom: '8px', fontSize: '13px', color: 'var(--amber)' }}>
                  ☕ Break in progress — auto resumes
                </div>
              )}
              {gameState?.status === 'finished' && (
                <div style={{ padding: '14px', background: 'var(--surface2)', borderRadius: '10px', textAlign: 'center', color: 'var(--green)', fontWeight: 700, marginBottom: '8px' }}>
                  🏆 Game Complete!
                </div>
              )}

              <button onClick={() => { if (confirm('Reset everything?')) callAdmin('reset') }} disabled={loading}
                style={{ width: '100%', padding: '10px', background: 'transparent', color: 'var(--red)', border: '1px solid var(--red)', borderRadius: '10px', fontSize: '13px', fontWeight: 600 }}>
                ↺ Reset Game
              </button>
            </div>

            {/* Current News */}
            {currentNews && (
              <div style={{ background: '#1a1200', border: '1px solid var(--amber)', borderRadius: '12px', padding: '16px' }}>
                <p style={{ fontSize: '10px', letterSpacing: '2px', color: 'var(--amber)', marginBottom: '8px' }}>📰 CURRENT NEWS</p>
                <p style={{ fontWeight: 600, fontSize: '13px', lineHeight: 1.4 }}>{currentNews.headline}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '6px' }}>{currentNews.detail}</p>
              </div>
            )}

            {/* Teams */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '12px' }}>Teams ({teams.length}/7)</p>
              {TEAMS.map(t => {
                const joined = teams.find(x => x.name === t)
                return (
                  <div key={t} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: '13px', color: joined ? 'var(--text)' : 'var(--text-dim)' }}>{t}</span>
                    <span style={{ fontSize: '11px', color: joined ? 'var(--green)' : 'var(--border)' }}>{joined ? '● Online' : '○'}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* RIGHT: Leaderboard + Prices */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Leaderboard */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '16px' }}>🏆 Live Leaderboard <span style={{ color: 'var(--border)', fontWeight: 400 }}>(hidden from teams)</span></p>
              {teams.length === 0
                ? <p style={{ color: 'var(--text-dim)', fontSize: '13px' }}>No teams joined yet</p>
                : (
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
                        <tr key={t.name} style={{ borderBottom: '1px solid var(--border)', background: i === 0 ? 'rgba(0,230,118,0.04)' : 'transparent' }}>
                          <td style={{ padding: '12px', fontSize: '13px', color: 'var(--text-dim)' }}>
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                          </td>
                          <td style={{ padding: '12px', fontSize: '14px', fontWeight: 600 }}>{t.name}</td>
                          <td style={{ padding: '12px', fontSize: '13px', fontFamily: 'var(--mono)', color: 'var(--green)' }}>
                            ₹{(t.cash / 100000).toFixed(2)}L
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>

            {/* Live Prices */}
            {prices.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px' }}>
                <p style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '16px' }}>📈 Live Prices</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
                  {prices.map(p => {
                    const change = p.base_price ? ((p.price - p.base_price) / p.base_price * 100) : 0
                    return (
                      <div key={p.symbol} style={{ background: 'var(--surface2)', borderRadius: '8px', padding: '10px 12px', borderLeft: `3px solid ${change >= 0 ? 'var(--green)' : 'var(--red)'}` }}>
                        <p style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{p.symbol}</p>
                        <p style={{ fontSize: '14px', fontWeight: 600, fontFamily: 'var(--mono)' }}>₹{Number(p.price).toFixed(0)}</p>
                        <p style={{ fontSize: '11px', color: change >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)' }}>
                          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
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
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  )
}