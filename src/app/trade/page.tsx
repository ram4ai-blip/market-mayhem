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
  const [gameState, setGameState] = useState<any>(null)
  const [team, setTeam] = useState<any>(null)
  const [prices, setPrices] = useState<any[]>([])
  const [holdings, setHoldings] = useState<any[]>([])
  const [qty, setQty] = useState<{ [symbol: string]: number }>({})
  const [tradeMsg, setTradeMsg] = useState<{ symbol: string; msg: string } | null>(null)
  const [tradeLoading, setTradeLoading] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [priceDelta, setPriceDelta] = useState<{ [symbol: string]: 'up' | 'down' | null }>({})
  const prevPrices = useRef<{ [symbol: string]: number }>({})
  const timerRef = useRef<any>(null)

  useEffect(() => {
    const t = localStorage.getItem('team')
    if (!t) { router.push('/'); return }
    setTeamName(t)
    fetchAll(t)
    const channel = supabase.channel('trade-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, () => fetchAll(t))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_prices' }, () => fetchAll(t))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => fetchAll(t))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'holdings' }, () => fetchAll(t))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Countdown timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (gameState?.phase_ends_at && gameState?.status === 'trading') {
      timerRef.current = setInterval(() => {
        const left = Math.max(0, Math.floor((new Date(gameState.phase_ends_at).getTime() - Date.now()) / 1000))
        setTimeLeft(left)
      }, 500)
    } else {
      setTimeLeft(null)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [gameState?.phase_ends_at, gameState?.status])

  async function fetchAll(t: string) {
    const [gsRes, teamRes, pricesRes, holdingsRes] = await Promise.all([
      supabase.from('game_state').select('*').eq('id', 1).single(),
      supabase.from('teams').select('*').eq('name', t).single(),
      supabase.from('stock_prices').select('*'),
      supabase.from('holdings').select('*').eq('team_name', t),
    ])
    if (gsRes.data) setGameState(gsRes.data)
    if (teamRes.data) setTeam(teamRes.data)
    if (pricesRes.data) {
      // Track price deltas for flash animation
      const newDeltas: { [symbol: string]: 'up' | 'down' | null } = {}
      pricesRes.data.forEach((p: any) => {
        const prev = prevPrices.current[p.symbol]
        if (prev !== undefined && prev !== p.price) {
          newDeltas[p.symbol] = p.price > prev ? 'up' : 'down'
        }
        prevPrices.current[p.symbol] = p.price
      })
      setPriceDelta(newDeltas)
      setTimeout(() => setPriceDelta({}), 1000)
      setPrices(pricesRes.data)
    }
    if (holdingsRes.data) setHoldings(holdingsRes.data)
  }

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
      body: JSON.stringify({ teamName, symbol, tradeType: type, quantity: q, price, day: gameState.current_day, minute: gameState.current_minute })
    })
    const data = await res.json()
    if (data.error) setTradeMsg({ symbol, msg: '❌ ' + data.error })
    else { setTradeMsg({ symbol, msg: `✅ ${type === 'buy' ? 'Bought' : 'Sold'} ${q} shares` }); fetchAll(teamName) }
    setTradeLoading(null)
    setTimeout(() => setTradeMsg(null), 2500)
  }

  const portfolioValue = holdings.reduce((sum, h) => {
    const price = prices.find(p => p.symbol === h.symbol)?.price || 0
    return sum + (h.quantity * price)
  }, 0)
  const totalPnL = (team?.cash || 0) + portfolioValue - 1000000
  const currentNews = gameState ? NEWS_SCRIPT.find(n => n.day === gameState.current_day && n.minute === gameState.current_minute) : null
  const isTrading = gameState?.status === 'trading'

  const timerColor = timeLeft !== null && timeLeft <= 15 ? 'var(--red)' : timeLeft !== null && timeLeft <= 30 ? 'var(--amber)' : 'var(--green)'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* Top Bar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '3px', textTransform: 'uppercase' }}>Market Mayhem</span>
          <span style={{ width: '1px', height: '16px', background: 'var(--border)' }} />
          <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--blue)' }}>{teamName}</span>
        </div>

        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          {/* Timer */}
          {isTrading && timeLeft !== null && (
            <div style={{ textAlign: 'center', padding: '4px 16px', borderRadius: '8px', border: `1px solid ${timerColor}`, background: `${timerColor}18` }}>
              <p style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>Time Left</p>
              <p style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: timerColor }}>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</p>
            </div>
          )}

          {/* Day/Min */}
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>Day · Min</p>
            <p style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{gameState?.current_day ?? '-'} · {gameState?.current_minute ?? '-'}</p>
          </div>

          {/* Cash */}
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>Cash</p>
            <p style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--green)' }}>₹{((team?.cash || 0) / 100000).toFixed(2)}L</p>
          </div>

          {/* P&L */}
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>P&L</p>
            <p style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--mono)', color: totalPnL >= 0 ? 'var(--green)' : 'var(--red)' }}>{totalPnL >= 0 ? '+' : ''}₹{(totalPnL / 100000).toFixed(2)}L</p>
          </div>

          {/* Status Badge */}
          <div style={{ padding: '6px 14px', borderRadius: '20px', background: isTrading ? 'rgba(0,230,118,0.12)' : gameState?.status === 'break' ? 'rgba(255,171,0,0.12)' : 'rgba(107,107,128,0.12)', color: isTrading ? 'var(--green)' : gameState?.status === 'break' ? 'var(--amber)' : 'var(--text-dim)', fontSize: '11px', fontWeight: 700, border: '1px solid', borderColor: isTrading ? 'var(--green)' : gameState?.status === 'break' ? 'var(--amber)' : 'var(--border)', letterSpacing: '1px', textTransform: 'uppercase' }}>
            {gameState?.status === 'waiting' ? '⏳ Waiting' : gameState?.status === 'trading' ? '🟢 Live' : gameState?.status === 'break' ? '☕ Break' : '🏁 Done'}
          </div>
        </div>
      </div>

      {/* News Ticker */}
      {currentNews && (
        <div style={{ background: 'rgba(255,171,0,0.08)', borderBottom: '1px solid rgba(255,171,0,0.2)', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <span style={{ fontSize: '10px', color: 'var(--amber)', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>📰 BREAKING</span>
          <span style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>{currentNews.headline}</span>
          <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{currentNews.detail}</span>
        </div>
      )}

      {/* Waiting State */}
      {gameState?.status === 'waiting' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>⏳</div>
            <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Waiting for Admin to Start</h2>
            <p style={{ color: 'var(--text-dim)' }}>The simulation will begin shortly...</p>
          </div>
        </div>
      )}

      {/* Finished State */}
      {gameState?.status === 'finished' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>🏆</div>
            <h2 style={{ fontSize: '28px', marginBottom: '8px' }}>Simulation Complete!</h2>
            <p style={{ fontSize: '22px', fontWeight: 700, color: totalPnL >= 0 ? 'var(--green)' : 'var(--red)' }}>
              Final P&L: {totalPnL >= 0 ? '+' : ''}₹{(totalPnL / 100000).toFixed(2)}L
            </p>
            <p style={{ color: 'var(--text-dim)', marginTop: '8px' }}>Total Value: ₹{(((team?.cash || 0) + portfolioValue) / 100000).toFixed(2)}L</p>
          </div>
        </div>
      )}

      {/* Break State */}
      {gameState?.status === 'break' && (
        <div style={{ background: 'rgba(255,171,0,0.06)', borderBottom: '1px solid rgba(255,171,0,0.2)', padding: '12px 20px', textAlign: 'center', flexShrink: 0 }}>
          <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: '14px' }}>☕ Market Break — Trading resumes next day</span>
        </div>
      )}

      {/* Main Trading View */}
      {(gameState?.status === 'trading' || gameState?.status === 'break') && prices.length > 0 && (
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>

          {/* Column Headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '200px 100px 90px 80px 120px 160px', gap: '8px', padding: '6px 12px', marginBottom: '4px', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>Stock</span>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', textAlign: 'right' }}>Price</span>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', textAlign: 'right' }}>Change</span>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', textAlign: 'center' }}>Holding</span>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', textAlign: 'center' }}>Qty</span>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', textAlign: 'center' }}>Trade</span>
          </div>

          {SECTORS.map(sector => (
            <div key={sector} style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '3px', textTransform: 'uppercase', fontWeight: 700 }}>{sector}</span>
                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
              </div>

              {prices.filter(p => STOCKS.find(s => s.symbol === p.symbol)?.sector === sector).map(p => {
                const change = ((p.price - p.base_price) / p.base_price * 100)
                const holding = holdings.find(h => h.symbol === p.symbol)
                const heldQty = holding?.quantity || 0
                const currentQty = getQty(p.symbol)
                const delta = priceDelta[p.symbol]
                const totalCost = p.price * currentQty
                const canAfford = (team?.cash || 0) >= totalCost
                const canSell = heldQty >= currentQty
                const msg = tradeMsg && tradeMsg.symbol === p.symbol ? tradeMsg.msg : null
                const loading = tradeLoading === p.symbol + 'buy' || tradeLoading === p.symbol + 'sell'

                return (
                  <div key={p.symbol} style={{
                    display: 'grid', gridTemplateColumns: '200px 100px 90px 80px 120px 160px',
                    gap: '8px', padding: '8px 12px', borderRadius: '8px', marginBottom: '2px',
                    alignItems: 'center',
                    background: delta === 'up' ? 'rgba(0,230,118,0.06)' : delta === 'down' ? 'rgba(255,23,68,0.06)' : 'var(--surface)',
                    border: `1px solid ${delta === 'up' ? 'rgba(0,230,118,0.2)' : delta === 'down' ? 'rgba(255,23,68,0.2)' : 'var(--border)'}`,
                    transition: 'background 0.3s, border-color 0.3s'
                  }}>
                    {/* Stock Name */}
                    <div>
                      <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{p.symbol}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginLeft: '6px' }}>{p.name.split(' ').slice(0, 2).join(' ')}</span>
                      {msg && <div style={{ fontSize: '11px', color: msg.startsWith('✅') ? 'var(--green)' : 'var(--red)', marginTop: '2px' }}>{msg}</div>}
                    </div>

                    {/* Price */}
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'var(--mono)', color: delta === 'up' ? 'var(--green)' : delta === 'down' ? 'var(--red)' : 'var(--text)' }}>
                        ₹{p.price.toFixed(2)}
                      </p>
                    </div>

                    {/* Change */}
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '12px', fontWeight: 600, color: change >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)' }}>
                        {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
                      </p>
                    </div>

                    {/* Holding */}
                    <div style={{ textAlign: 'center' }}>
                      {heldQty > 0 ? (
                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--blue)', fontFamily: 'var(--mono)', background: 'rgba(68,138,255,0.1)', padding: '2px 8px', borderRadius: '4px' }}>{heldQty}</span>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>—</span>
                      )}
                    </div>

                    {/* Qty Presets */}
                    <div style={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
                      {QTY_PRESETS.map(q => (
                        <button key={q} onClick={() => setQty(prev => ({ ...prev, [p.symbol]: q }))}
                          style={{ padding: '3px 6px', fontSize: '11px', fontWeight: currentQty === q ? 700 : 400, borderRadius: '4px', border: 'none', cursor: 'pointer', background: currentQty === q ? 'var(--blue)' : 'var(--surface2)', color: currentQty === q ? '#fff' : 'var(--text-dim)', transition: 'all 0.15s' }}>
                          {q}
                        </button>
                      ))}
                    </div>

                    {/* Buy/Sell */}
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                      <button
                        onClick={() => executeTrade(p.symbol, 'buy')}
                        disabled={loading || !isTrading || !canAfford}
                        style={{ flex: 1, padding: '6px 0', fontSize: '12px', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: !isTrading || !canAfford ? 'not-allowed' : 'pointer', background: !isTrading || !canAfford ? 'var(--border)' : 'var(--green)', color: !isTrading || !canAfford ? 'var(--text-dim)' : '#000', transition: 'all 0.15s' }}>
                        {loading ? '…' : 'BUY'}
                      </button>
                      <button
                        onClick={() => executeTrade(p.symbol, 'sell')}
                        disabled={loading || !isTrading || !canSell}
                        style={{ flex: 1, padding: '6px 0', fontSize: '12px', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: !isTrading || !canSell ? 'not-allowed' : 'pointer', background: !isTrading || !canSell ? 'var(--border)' : 'var(--red)', color: !isTrading || !canSell ? 'var(--text-dim)' : '#fff', transition: 'all 0.15s' }}>
                        {loading ? '…' : 'SELL'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Loading state */}
      {(gameState?.status === 'trading' || gameState?.status === 'break') && prices.length === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: 'var(--text-dim)' }}>Loading market data...</p>
        </div>
      )}
    </div>
  )
}
