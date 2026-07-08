'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { NEWS_SCRIPT, TEAMS } from '@/lib/gameData'

const ADMIN_PWD = 'marketadmin2024'

export default function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [pwd, setPwd] = useState('')
  const [authErr, setAuthErr] = useState('')
  const [gameState, setGameState] = useState<any>(null)
  const [teams, setTeams] = useState<any[]>([])
  const [prices, setPrices] = useState<any[]>([])
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)

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

  useEffect(() => {
    if (!authed) return
    fetchAll()
    const channel = supabase.channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, (p) => {
        setGameState(p.new)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_prices' }, (p) => {
        setPrices(prev => prev.map((x: any) => x.symbol === (p.new as any).symbol ? p.new : x))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [authed, fetchAll])

  // Timer — reads phase_ends_at from DB (same source as participants)
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

  // Master game loop — price tick every 5s + auto advance when timer hits 0
  useEffect(() => {
    if (!authed) return

    const tickInterval = setInterval(async () => {
      const gs = gsRef.current
      if (!gs || gs.status !== 'trading') return
      await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'price_tick', password: ADMIN_PWD })
      })
    }, 5000)

    const advanceInterval = setInterval(async () => {
      const gs = gsRef.current
      if (!gs || (gs.status !== 'trading' && gs.status !== 'break')) return
      if (!gs.phase_ends_at) return
      const left = new Date(gs.phase_ends_at).getTime() - Date.now()
      if (left > 1500) return
      if (advancingRef.current) return
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
    setTimeout(() => setMsg(''), 4000)
  }

  if (!authed) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0f', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ background: '#111118', border: '1px solid #2a2a3a', borderRadius: '16px', padding: '40px', width: '360px' }}>
        <p style={{ fontSize: '11px', color: '#6b6b80', letterSpacing: '2px', marginBottom: '8px' }}>ADMIN ACCESS</p>
        <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '24px', color: '#e8e8f0' }}>Market Mayhem</h2>
        <input
          type="password" value={pwd}
          onChange={e => { setPwd(e.target.value); setAuthErr('') }}
          onKeyDown={e => e.key === 'Enter' && (pwd === ADMIN_PWD ? setAuthed(true) : setAuthErr('Wrong password'))}
          placeholder="Enter admin password"
          style={{ width: '100%', padding: '12px 16px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: '8px', color: '#e8e8f0', fontSize: '15px', outline: 'none', marginBottom: '8px', boxSizing: 'border-box' }}
        />
        {authErr && <p style={{ color: '#ff1744', fontSize: '13px', marginBottom: '10px' }}>{authErr}</p>}
        <button
          onClick={() => pwd === ADMIN_PWD ? setAuthed(true) : setAuthErr('Wrong password')}
          style={{ width: '100%', padding: '13px', background: '#00e676', color: '#000', border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '15px', cursor: 'pointer' }}>
          Login →
        </button>
        <p style={{ fontSize: '12px', color: '#6b6b80', marginTop: '12px', textAlign: 'center' }}>Default: marketadmin2024</p>
      </div>
    </div>
  )

  const isTrading = gameState?.status === 'trading'
  const isBreak = gameState?.status === 'break'
  const currentNews = gameState ? NEWS_SCRIPT.find((n: any) => n.day === gameState.current_day && n.minute === gameState.current_minute) : null

  // Display timer: trading shows full 6-min countdown, break shows 2-min countdown
  const displayTime = isTrading
    ? Math.max(0, (6 - gameState.current_minute) * 60 + timeLeft)
    : timeLeft
  const displayMins = Math.floor(displayTime / 60)
  const displaySecs = String(displayTime % 60).padStart(2, '0')
  const timerColor = displayTime <= 30 ? '#ff1744' : displayTime <= 60 ? '#ffab00' : '#00e676'

  const statusColor = isTrading ? '#00e676' : isBreak ? '#ffab00' : gameState?.status === 'finished' ? '#448aff' : '#6b6b80'

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', padding: '24px', fontFamily: 'Inter, sans-serif', color: '#e8e8f0' }}>
      <div style={{ maxWidth: '1300px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
          <div>
            <p style={{ fontSize: '11px', color: '#6b6b80', letterSpacing: '2px', textTransform: 'uppercase' }}>Admin Panel</p>
            <h1 style={{ fontSize: '28px', fontWeight: 700 }}>Market Mayhem</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {msg && <span style={{ fontSize: '13px', color: msg.startsWith('✅') ? '#00e676' : '#ff1744' }}>{msg}</span>}
            <div style={{ padding: '8px 20px', borderRadius: '20px', border: `1px solid ${statusColor}`, color: statusColor, fontSize: '12px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
              {gameState?.status || 'Loading...'}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '20px' }}>

          {/* LEFT PANEL */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Game Controls */}
            <div style={{ background: '#111118', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '20px' }}>
              <p style={{ fontSize: '11px', color: '#6b6b80', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '16px' }}>Game Status</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                <div style={{ background: '#1a1a24', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <p style={{ fontSize: '11px', color: '#6b6b80' }}>Day</p>
                  <p style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'monospace' }}>{gameState?.current_day ?? '-'}/5</p>
                </div>
                <div style={{ background: '#1a1a24', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <p style={{ fontSize: '11px', color: '#6b6b80' }}>Minute</p>
                  <p style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'monospace' }}>{gameState?.current_minute ?? '-'}/6</p>
                </div>
              </div>

              {/* Timer */}
              {gameState?.phase_ends_at && (
                <div style={{ textAlign: 'center', marginBottom: '16px', padding: '14px', background: '#1a1a24', borderRadius: '10px', border: `1px solid ${timerColor}40` }}>
                  <p style={{ fontSize: '11px', color: '#6b6b80', marginBottom: '4px', letterSpacing: '1px' }}>
                    {isTrading ? '⏱ TRADING TIME LEFT' : '☕ BREAK TIME LEFT'}
                  </p>
                  <p style={{ fontSize: '42px', fontWeight: 800, fontFamily: 'monospace', color: timerColor, lineHeight: 1 }}>
                    {displayMins}:{displaySecs}
                  </p>
                  <p style={{ fontSize: '11px', color: '#6b6b80', marginTop: '6px' }}>Auto advances when timer hits 0</p>
                </div>
              )}

              {/* Pulse indicator */}
              {isTrading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', padding: '8px 12px', background: 'rgba(0,230,118,0.06)', borderRadius: '8px', border: '1px solid rgba(0,230,118,0.15)' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#00e676', display: 'inline-block', animation: 'pulse 1s infinite' }} />
                  <span style={{ fontSize: '12px', color: '#00e676' }}>Prices live · updating every 5s</span>
                </div>
              )}

              {/* Action buttons */}
              {gameState?.status === 'waiting' && (
                <button onClick={() => callAdmin('start')} disabled={loading}
                  style={{ width: '100%', padding: '14px', background: '#00e676', color: '#000', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', marginBottom: '8px' }}>
                  {loading ? 'Starting...' : '▶ Start Simulation'}
                </button>
              )}
              {isTrading && (
                <div style={{ padding: '12px', background: 'rgba(0,230,118,0.06)', border: '1px solid rgba(0,230,118,0.2)', borderRadius: '10px', textAlign: 'center', marginBottom: '8px', fontSize: '13px', color: '#00e676' }}>
                  🟢 Market OPEN — running automatically
                </div>
              )}
              {isBreak && (
                <div style={{ padding: '12px', background: 'rgba(255,171,0,0.06)', border: '1px solid rgba(255,171,0,0.2)', borderRadius: '10px', textAlign: 'center', marginBottom: '8px', fontSize: '13px', color: '#ffab00' }}>
                  ☕ Break in progress — auto resumes
                </div>
              )}
              {gameState?.status === 'finished' && (
                <div style={{ padding: '14px', background: '#1a1a24', borderRadius: '10px', textAlign: 'center', color: '#00e676', fontWeight: 700, marginBottom: '8px' }}>
                  🏆 Simulation Complete!
                </div>
              )}

              <button onClick={() => { if (confirm('Reset everything? All teams and trades will be cleared.')) callAdmin('reset') }}
                disabled={loading}
                style={{ width: '100%', padding: '10px', background: 'transparent', color: '#ff1744', border: '1px solid #ff1744', borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                ↺ Reset Game
              </button>
            </div>

            {/* Current News */}
            {currentNews && (
              <div style={{ background: 'rgba(255,171,0,0.06)', border: '1px solid rgba(255,171,0,0.3)', borderRadius: '12px', padding: '16px' }}>
                <p style={{ fontSize: '10px', letterSpacing: '2px', color: '#ffab00', marginBottom: '8px' }}>📰 CURRENT NEWS</p>
                <p style={{ fontWeight: 700, fontSize: '13px', lineHeight: 1.4, color: '#e8e8f0' }}>{currentNews.headline}</p>
                <p style={{ fontSize: '11px', color: '#6b6b80', marginTop: '6px' }}>{currentNews.detail}</p>
              </div>
            )}

            {/* Teams */}
            <div style={{ background: '#111118', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '16px' }}>
              <p style={{ fontSize: '11px', color: '#6b6b80', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '12px' }}>Teams ({teams.length}/7)</p>
              {TEAMS.map((t: string) => {
                const joined = teams.find((x: any) => x.name === t)
                return (
                  <div key={t} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #1a1a24' }}>
                    <span style={{ fontSize: '13px', color: joined ? '#e8e8f0' : '#6b6b80' }}>{t}</span>
                    <span style={{ fontSize: '11px', color: joined ? '#00e676' : '#2a2a3a' }}>{joined ? '● Online' : '○'}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* RIGHT PANEL */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Leaderboard */}
            <div style={{ background: '#111118', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '20px' }}>
              <p style={{ fontSize: '11px', color: '#6b6b80', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '16px' }}>
                🏆 Live Leaderboard <span style={{ color: '#2a2a3a', fontWeight: 400 }}>(hidden from teams)</span>
              </p>
              {teams.length === 0
                ? <p style={{ color: '#6b6b80', fontSize: '13px' }}>No teams joined yet</p>
                : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #2a2a3a' }}>
                        {['#', 'Team', 'Cash'].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', color: '#6b6b80', letterSpacing: '1px', fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...teams].sort((a: any, b: any) => b.cash - a.cash).map((t: any, i: number) => (
                        <tr key={t.name} style={{ borderBottom: '1px solid #1a1a24', background: i === 0 ? 'rgba(0,230,118,0.03)' : 'transparent' }}>
                          <td style={{ padding: '12px', fontSize: '14px' }}>
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                          </td>
                          <td style={{ padding: '12px', fontSize: '14px', fontWeight: 600 }}>{t.name}</td>
                          <td style={{ padding: '12px', fontSize: '13px', fontFamily: 'monospace', color: '#00e676' }}>
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
              <div style={{ background: '#111118', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '20px' }}>
                <p style={{ fontSize: '11px', color: '#6b6b80', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '16px' }}>📈 Live Prices</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
                  {prices.map((p: any) => {
                    const change = p.base_price ? ((p.price - p.base_price) / p.base_price * 100) : 0
                    return (
                      <div key={p.symbol} style={{ background: '#1a1a24', borderRadius: '8px', padding: '10px 12px', borderLeft: `3px solid ${change >= 0 ? '#00e676' : '#ff1744'}` }}>
                        <p style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'monospace' }}>{p.symbol}</p>
                        <p style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'monospace' }}>₹{Number(p.price).toFixed(0)}</p>
                        <p style={{ fontSize: '11px', color: change >= 0 ? '#00e676' : '#ff1744', fontFamily: 'monospace' }}>
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
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  )
}