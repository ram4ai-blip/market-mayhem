'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { STOCKS, NEWS_SCRIPT } from '@/lib/gameData'

const SECTORS = ['IT', 'Banking', 'Pharma', 'Energy', 'FMCG']
const QTY_PRESETS = [10, 20, 50, 100]

export default function TradePage() {
  const router = useRouter()
  const [teamName, setTeamName] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [gameState, setGameState] = useState<any>(null)
  const [team, setTeam] = useState<any>(null)
  const [prices, setPrices] = useState<any[]>([])
  const [holdings, setHoldings] = useState<any[]>([])
  const [allTeams, setAllTeams] = useState<any[]>([])
  const [qty, setQty] = useState<Record<string, number>>({})
  const [tradeMsg, setTradeMsg] = useState<{ symbol: string; msg: string } | null>(null)
  const [tradeLoading, setTradeLoading] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [priceDelta, setPriceDelta] = useState<Record<string, 'up' | 'down' | null>>({})
  const [kicked, setKicked] = useState(false)
  const prevPrices = useRef<Record<string, number>>({})
  const timerRef = useRef<any>(null)

  useEffect(() => {
    const t = localStorage.getItem('team')
    if (!t) { router.push('/'); return }
    setTeamName(t)
    initSession(t)
  }, [])

  async function initSession(t: string) {
    // Read current session_id from DB and store it
    const { data: gs } = await supabase.from('game_state').select('*').eq('id', 1).single()
    if (gs) {
      setSessionId(gs.session_id ?? null)
      setGameState(gs)
    }
    fetchAll(t)

    const channel = supabase.channel('trade-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, (payload: any) => {
        const newGs = payload.new
        // If session_id changed → admin reset or restarted → kick participant
        setSessionId(prev => {
          if (prev !== null && newGs.session_id && prev !== newGs.session_id) {
            setKicked(true)
            localStorage.removeItem('team')
          }
          return newGs.session_id ?? prev
        })
        setGameState(newGs)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_prices' }, () => fetchPrices())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => fetchTeamAndAll(t))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'holdings' }, () => fetchHoldings(t))
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }

  async function fetchAll(t: string) {
    const [gsRes, teamRes, pricesRes, holdingsRes, teamsRes] = await Promise.all([
      supabase.from('game_state').select('*').eq('id', 1).single(),
      supabase.from('teams').select('*').eq('name', t).single(),
      supabase.from('stock_prices').select('*').order('symbol', { ascending: true }),
      supabase.from('holdings').select('*').eq('team_name', t),
      supabase.from('teams').select('*'),
    ])
    if (gsRes.data) setGameState(gsRes.data)
    if (teamRes.data) setTeam(teamRes.data)
    if (holdingsRes.data) setHoldings(holdingsRes.data)
    if (teamsRes.data) setAllTeams(teamsRes.data)
    if (pricesRes.data) {
      trackDeltas(pricesRes.data)
      setPrices(pricesRes.data)
    }
  }

  async function fetchPrices() {
    const { data } = await supabase.from('stock_prices').select('*')
    if (data) { trackDeltas(data); setPrices(data) }
  }

  async function fetchTeamAndAll(t: string) {
    const [teamRes, teamsRes] = await Promise.all([
      supabase.from('teams').select('*').eq('name', t).single(),
      supabase.from('teams').select('*'),
    ])
    if (teamRes.data) setTeam(teamRes.data)
    if (teamsRes.data) setAllTeams(teamsRes.data)
  }

  async function fetchHoldings(t: string) {
    const { data } = await supabase.from('holdings').select('*').eq('team_name', t)
    if (data) setHoldings(data)
  }

  function trackDeltas(newPrices: any[]) {
    const deltas: Record<string, 'up' | 'down' | null> = {}
    newPrices.forEach(p => {
      const prev = prevPrices.current[p.symbol]
      if (prev !== undefined && prev !== p.price) {
        deltas[p.symbol] = p.price > prev ? 'up' : 'down'
      }
      prevPrices.current[p.symbol] = p.price
    })
    if (Object.keys(deltas).length > 0) {
      setPriceDelta(deltas)
      setTimeout(() => setPriceDelta({}), 800)
    }
  }

  // Countdown timer
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

  function getQty(symbol: string) { return qty[symbol] ?? 10 }

  async function executeTrade(symbol: string, type: 'buy' | 'sell') {
    if (!gameState || gameState.status !== 'trading') return
    const q = getQty(symbol)
    const price = prices.find(p => p.symbol === symbol)?.price
    if (!price) return
    setTradeLoading(symbol + type)
    setTradeMsg(null)
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teamName, symbol, tradeType: type, quantity: q, price,
        day: gameState.current_day, minute: gameState.current_minute,
      }),
    })
    const data = await res.json()
    setTradeMsg({ symbol, msg: data.error ? '❌ ' + data.error : `✅ ${type === 'buy' ? 'Bought' : 'Sold'} ${q}` })
    if (!data.error) { fetchTeamAndAll(teamName); fetchHoldings(teamName) }
    setTradeLoading(null)
    setTimeout(() => setTradeMsg(null), 2000)
  }

  // Derived values
  const portfolioValue = holdings.reduce((sum, h) => {
    const price = prices.find(p => p.symbol === h.symbol)?.price || 0
    return sum + h.quantity * price
  }, 0)
  const totalValue = (team?.cash || 0) + portfolioValue
  const totalPnL = totalValue - 1000000
  const returnPct = (totalPnL / 1000000) * 100

  const currentNews = gameState
    ? NEWS_SCRIPT.find(n => n.day === gameState.current_day && n.minute === gameState.current_minute)
    : null
  const isTrading = gameState?.status === 'trading'
  const isBreak = gameState?.status === 'break'

  const timerColor = timeLeft !== null && timeLeft <= 15 ? '#ff1744'
    : timeLeft !== null && timeLeft <= 30 ? '#ffab00' : '#00e676'

  // Leaderboard for rank
  const leaderboard = [...allTeams].map(t => {
    const pv = holdings
      .filter(h => h.team_name === t.name && h.quantity > 0)
      .reduce((s, h) => s + h.quantity * (prices.find(p => p.symbol === h.symbol)?.price || 0), 0)
    return { name: t.name, total: t.cash + pv }
  }).sort((a, b) => b.total - a.total)
  const myRank = leaderboard.findIndex(t => t.name === teamName) + 1

  // ── KICKED SCREEN ──────────────────────────────────────
  if (kicked) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0f', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <div style={{ fontSize: '56px', marginBottom: '16px' }}>🔄</div>
        <h2 style={{ fontSize: '24px', marginBottom: '8px', color: '#e8e8f0' }}>Game Reset by Admin</h2>
        <p style={{ color: '#6b6b80', marginBottom: '24px' }}>The admin has reset the game. Please rejoin to participate.</p>
        <button onClick={() => router.push('/')}
          style={{ padding: '12px 32px', background: '#00e676', color: '#000', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}>
          Rejoin →
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', display: 'flex', flexDirection: 'column', fontFamily: 'Inter, sans-serif', color: '#e8e8f0' }}>

      {/* ── TOP BAR ── */}
      <div style={{ background: '#111118', borderBottom: '1px solid #2a2a3a', padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '10px', color: '#6b6b80', letterSpacing: '3px', textTransform: 'uppercase' }}>Market Mayhem</span>
          <span style={{ width: '1px', height: '14px', background: '#2a2a3a' }} />
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#448aff' }}>{teamName}</span>
          {myRank > 0 && (
            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: myRank === 1 ? 'rgba(255,171,0,0.15)' : '#1a1a24', color: myRank === 1 ? '#ffab00' : '#6b6b80', fontWeight: 600 }}>
              #{myRank} of {allTeams.length}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {/* Timer */}
          {timeLeft !== null && (
            <div style={{ textAlign: 'center', padding: '4px 14px', borderRadius: '8px', border: `1px solid ${timerColor}`, background: `${timerColor}18` }}>
              <p style={{ fontSize: '9px', color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '1px' }}>
                {isTrading ? 'Min Ends' : 'Break Ends'}
              </p>
              <p style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'monospace', color: timerColor, lineHeight: 1.1 }}>
                {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
              </p>
            </div>
          )}

          {/* Day · Min */}
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '9px', color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '1px' }}>Day · Min</p>
            <p style={{ fontSize: '15px', fontWeight: 700, fontFamily: 'monospace' }}>{gameState?.current_day ?? '-'} · {gameState?.current_minute ?? '-'}</p>
          </div>

          {/* Cash */}
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '9px', color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '1px' }}>Cash</p>
            <p style={{ fontSize: '15px', fontWeight: 700, fontFamily: 'monospace', color: '#00e676' }}>₹{((team?.cash || 0) / 100000).toFixed(2)}L</p>
          </div>

          {/* Portfolio */}
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '9px', color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '1px' }}>Portfolio</p>
            <p style={{ fontSize: '15px', fontWeight: 700, fontFamily: 'monospace', color: '#448aff' }}>₹{(portfolioValue / 100000).toFixed(2)}L</p>
          </div>

          {/* Return % */}
          <div style={{ textAlign: 'center', padding: '4px 14px', borderRadius: '8px', background: returnPct >= 0 ? 'rgba(0,230,118,0.08)' : 'rgba(255,23,68,0.08)', border: `1px solid ${returnPct >= 0 ? 'rgba(0,230,118,0.3)' : 'rgba(255,23,68,0.3)'}` }}>
            <p style={{ fontSize: '9px', color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '1px' }}>Return</p>
            <p style={{ fontSize: '16px', fontWeight: 800, fontFamily: 'monospace', color: returnPct >= 0 ? '#00e676' : '#ff1744' }}>
              {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%
            </p>
          </div>

          {/* Status */}
          <div style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', border: '1px solid', ...(isTrading ? { background: 'rgba(0,230,118,0.1)', color: '#00e676', borderColor: '#00e676' } : isBreak ? { background: 'rgba(255,171,0,0.1)', color: '#ffab00', borderColor: '#ffab00' } : { background: 'rgba(107,107,128,0.1)', color: '#6b6b80', borderColor: '#2a2a3a' }) }}>
            {gameState?.status === 'waiting' ? '⏳ Waiting' : isTrading ? '🟢 Trading' : isBreak ? '☕ Break' : '🏁 Done'}
          </div>
        </div>
      </div>

      {/* ── NEWS BANNER ── */}
      {currentNews && isTrading && (
        <div style={{ background: 'rgba(255,171,0,0.07)', borderBottom: '1px solid rgba(255,171,0,0.2)', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <span style={{ fontSize: '10px', color: '#ffab00', fontWeight: 800, letterSpacing: '2px', whiteSpace: 'nowrap' }}>📰 BREAKING</span>
          <span style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>{currentNews.headline}</span>
          <span style={{ fontSize: '12px', color: '#6b6b80', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentNews.detail}</span>
        </div>
      )}

      {/* ── BREAK BANNER ── */}
      {isBreak && (
        <div style={{ background: 'rgba(255,171,0,0.07)', borderBottom: '1px solid rgba(255,171,0,0.2)', padding: '12px 20px', textAlign: 'center', flexShrink: 0 }}>
          <span style={{ color: '#ffab00', fontWeight: 700, fontSize: '14px' }}>☕ Revision Break — Review your portfolio. Trading resumes for Day {(gameState?.current_day || 0) + 1} shortly.</span>
        </div>
      )}

      {/* ── WAITING ── */}
      {gameState?.status === 'waiting' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>⏳</div>
            <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Waiting for Simulation to Start</h2>
            <p style={{ color: '#6b6b80' }}>Admin will begin the session shortly. Stay on this page.</p>
          </div>
        </div>
      )}

      {/* ── FINISHED ── */}
      {gameState?.status === 'finished' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>🏆</div>
            <h2 style={{ fontSize: '28px', marginBottom: '8px' }}>Simulation Complete!</h2>
            <p style={{ fontSize: '22px', fontWeight: 700, color: returnPct >= 0 ? '#00e676' : '#ff1744', marginBottom: '8px' }}>
              {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}% Return
            </p>
            <p style={{ color: '#6b6b80', fontSize: '15px' }}>Final Value: ₹{(totalValue / 100000).toFixed(2)}L &nbsp;|&nbsp; Rank: #{myRank} of {allTeams.length}</p>
            <div style={{ marginTop: '24px', background: '#111118', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '20px', minWidth: '320px' }}>
              <p style={{ fontSize: '11px', color: '#6b6b80', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>Final Leaderboard</p>
              {leaderboard.map((t, i) => (
                <div key={t.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1a1a24', fontWeight: t.name === teamName ? 700 : 400 }}>
                  <span style={{ color: t.name === teamName ? '#448aff' : '#e8e8f0' }}>{i + 1}. {t.name}</span>
                  <span style={{ fontFamily: 'monospace', color: t.total >= 1000000 ? '#00e676' : '#ff1744' }}>
                    {((t.total - 1000000) / 1000000 * 100) >= 0 ? '+' : ''}{((t.total - 1000000) / 1000000 * 100).toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN TRADING VIEW ── */}
      {(isTrading || isBreak) && prices.length > 0 && (
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>

          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '190px 100px 80px 70px 130px 170px', gap: '8px', padding: '6px 12px', marginBottom: '4px' }}>
            {['Stock', 'Price', 'Change', 'Holding', 'Quantity', isBreak ? 'Status' : 'Trade'].map(h => (
              <span key={h} style={{ fontSize: '10px', color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '1px', textAlign: h === 'Stock' ? 'left' : 'right' }}>{h}</span>
            ))}
          </div>

          {SECTORS.map(sector => (
            <div key={sector} style={{ marginBottom: '16px' }}>
              {/* Sector header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                <span style={{ fontSize: '10px', color: '#6b6b80', letterSpacing: '3px', textTransform: 'uppercase', fontWeight: 700 }}>{sector}</span>
                <div style={{ flex: 1, height: '1px', background: '#2a2a3a' }} />
              </div>

              {prices.filter(p => STOCKS.find(s => s.symbol === p.symbol)?.sector === sector).map(p => {
                const change = ((p.price - p.base_price) / p.base_price) * 100
                const holding = holdings.find(h => h.symbol === p.symbol)
                const heldQty = holding?.quantity || 0
                const currentQty = getQty(p.symbol)
                const delta = priceDelta[p.symbol]
                const canAfford = (team?.cash || 0) >= p.price * currentQty
                const canSell = heldQty >= currentQty
                const msg = tradeMsg && tradeMsg.symbol === p.symbol ? tradeMsg.msg : null
                const loadingThis = tradeLoading === p.symbol + 'buy' || tradeLoading === p.symbol + 'sell'

                return (
                  <div key={p.symbol} style={{
                    display: 'grid',
                    gridTemplateColumns: '190px 100px 80px 70px 130px 170px',
                    gap: '8px', padding: '8px 12px', borderRadius: '8px', marginBottom: '3px',
                    alignItems: 'center',
                    background: delta === 'up' ? 'rgba(0,230,118,0.07)' : delta === 'down' ? 'rgba(255,23,68,0.07)' : '#111118',
                    border: `1px solid ${delta === 'up' ? 'rgba(0,230,118,0.25)' : delta === 'down' ? 'rgba(255,23,68,0.25)' : '#2a2a3a'}`,
                    transition: 'background 0.4s, border-color 0.4s',
                  }}>

                    {/* Stock name */}
                    <div>
                      <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'monospace' }}>{p.symbol}</span>
                      <span style={{ fontSize: '11px', color: '#6b6b80', marginLeft: '6px' }}>{p.name.split(' ').slice(0, 2).join(' ')}</span>
                      {msg && <div style={{ fontSize: '11px', marginTop: '2px', color: msg.startsWith('✅') ? '#00e676' : '#ff1744' }}>{msg}</div>}
                    </div>

                    {/* Price */}
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'monospace', color: delta === 'up' ? '#00e676' : delta === 'down' ? '#ff1744' : '#e8e8f0' }}>
                        ₹{p.price.toFixed(2)}
                      </p>
                    </div>

                    {/* Change */}
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '12px', fontWeight: 600, fontFamily: 'monospace', color: change >= 0 ? '#00e676' : '#ff1744' }}>
                        {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
                      </p>
                    </div>

                    {/* Holding */}
                    <div style={{ textAlign: 'right' }}>
                      {heldQty > 0
                        ? <span style={{ fontSize: '12px', fontWeight: 700, color: '#448aff', fontFamily: 'monospace', background: 'rgba(68,138,255,0.12)', padding: '2px 8px', borderRadius: '4px' }}>{heldQty}</span>
                        : <span style={{ fontSize: '12px', color: '#2a2a3a' }}>—</span>}
                    </div>

                    {/* Qty presets */}
                    <div style={{ display: 'flex', gap: '3px', justifyContent: 'flex-end' }}>
                      {QTY_PRESETS.map(q => (
                        <button key={q} onClick={() => setQty(prev => ({ ...prev, [p.symbol]: q }))}
                          style={{ padding: '4px 7px', fontSize: '11px', fontWeight: currentQty === q ? 700 : 400, borderRadius: '4px', border: 'none', cursor: isBreak ? 'default' : 'pointer', background: currentQty === q ? '#448aff' : '#1a1a24', color: currentQty === q ? '#fff' : '#6b6b80', transition: 'all 0.1s' }}>
                          {q}
                        </button>
                      ))}
                    </div>

                    {/* Buy / Sell — locked during break */}
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      {isBreak ? (
                        <span style={{ fontSize: '11px', color: '#ffab00', textAlign: 'right', width: '100%' }}>Market closed</span>
                      ) : (
                        <>
                          <button onClick={() => executeTrade(p.symbol, 'buy')}
                            disabled={loadingThis || !canAfford}
                            style={{ flex: 1, padding: '6px 0', fontSize: '12px', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: !canAfford ? 'not-allowed' : 'pointer', background: !canAfford ? '#2a2a3a' : '#00e676', color: !canAfford ? '#6b6b80' : '#000', transition: 'all 0.15s' }}>
                            {loadingThis ? '…' : 'BUY'}
                          </button>
                          <button onClick={() => executeTrade(p.symbol, 'sell')}
                            disabled={loadingThis || !canSell}
                            style={{ flex: 1, padding: '6px 0', fontSize: '12px', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: !canSell ? 'not-allowed' : 'pointer', background: !canSell ? '#2a2a3a' : '#ff1744', color: !canSell ? '#6b6b80' : '#fff', transition: 'all 0.15s' }}>
                            {loadingThis ? '…' : 'SELL'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}

          {/* Holdings Summary during Break */}
          {isBreak && holdings.filter(h => h.quantity > 0).length > 0 && (
            <div style={{ marginTop: '24px', background: '#111118', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '20px' }}>
              <p style={{ fontSize: '10px', color: '#6b6b80', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>💼 Your Portfolio</p>
              {holdings.filter(h => h.quantity > 0).map(h => {
                const price = prices.find(p => p.symbol === h.symbol)?.price || 0
                const pnl = (price - h.avg_buy_price) * h.quantity
                return (
                  <div key={h.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1a1a24' }}>
                    <div>
                      <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '13px' }}>{h.symbol}</span>
                      <span style={{ color: '#6b6b80', fontSize: '12px', marginLeft: '8px' }}>{h.quantity} shares · Avg ₹{h.avg_buy_price.toFixed(2)}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '13px', fontWeight: 600 }}>₹{(price * h.quantity).toFixed(0)}</p>
                      <p style={{ fontSize: '12px', color: pnl >= 0 ? '#00e676' : '#ff1744' }}>{pnl >= 0 ? '+' : ''}₹{pnl.toFixed(0)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {(isTrading || isBreak) && prices.length === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#6b6b80' }}>Loading market data...</p>
        </div>
      )}
    </div>
  )
}
