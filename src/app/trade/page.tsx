'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { STOCKS, NEWS_SCRIPT } from '@/lib/gameData'

export default function TradePage() {
  const router = useRouter()
  const [teamName, setTeamName] = useState('')
  const [gameState, setGameState] = useState<any>(null)
  const [team, setTeam] = useState<any>(null)
  const [prices, setPrices] = useState<any[]>([])
  const [holdings, setHoldings] = useState<any[]>([])
  const [selectedStock, setSelectedStock] = useState<any>(null)
  const [qty, setQty] = useState(10)
  const [tradeMsg, setTradeMsg] = useState('')
  const [tradeLoading, setTradeLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'market' | 'portfolio'>('market')

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

  async function fetchAll(t: string) {
    const [gsRes, teamRes, pricesRes, holdingsRes] = await Promise.all([
      supabase.from('game_state').select('*').eq('id', 1).single(),
      supabase.from('teams').select('*').eq('name', t).single(),
      supabase.from('stock_prices').select('*'),
      supabase.from('holdings').select('*').eq('team_name', t),
    ])
    if (gsRes.data) setGameState(gsRes.data)
    if (teamRes.data) setTeam(teamRes.data)
    if (pricesRes.data) setPrices(pricesRes.data)
    if (holdingsRes.data) setHoldings(holdingsRes.data)
  }

  async function executeTrade(type: 'buy' | 'sell') {
    if (!selectedStock || !gameState) return
    setTradeLoading(true)
    setTradeMsg('')
    const price = prices.find(p => p.symbol === selectedStock.symbol)?.price
    if (!price) { setTradeMsg('Price not available'); setTradeLoading(false); return }
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamName, symbol: selectedStock.symbol, tradeType: type, quantity: qty, price, day: gameState.current_day, minute: gameState.current_minute })
    })
    const data = await res.json()
    if (data.error) setTradeMsg('❌ ' + data.error)
    else { setTradeMsg(`✅ ${type === 'buy' ? 'Bought' : 'Sold'} ${qty} shares of ${selectedStock.symbol}`); fetchAll(teamName) }
    setTradeLoading(false)
  }

  const currentNews = gameState ? NEWS_SCRIPT.find(n => n.day === gameState.current_day && n.minute === gameState.current_minute) : null
  const isTrading = gameState?.status === 'trading'

  const portfolioValue = holdings.reduce((sum, h) => {
    const price = prices.find(p => p.symbol === h.symbol)?.price || 0
    return sum + (h.quantity * price)
  }, 0)
  const totalValue = (team?.cash || 0) + portfolioValue
  const totalPnL = totalValue - 1000000

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Top Bar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '2px', textTransform: 'uppercase' }}>Market Mayhem</span>
          <span style={{ marginLeft: '16px', fontSize: '13px', fontWeight: 600 }}>{teamName}</span>
        </div>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Cash</p>
            <p style={{ fontSize: '14px', fontFamily: 'var(--mono)', color: 'var(--green)' }}>₹{((team?.cash || 0) / 100000).toFixed(2)}L</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '11px', color: 'var(--text-dim)' }}>P&L</p>
            <p style={{ fontSize: '14px', fontFamily: 'var(--mono)', color: totalPnL >= 0 ? 'var(--green)' : 'var(--red)' }}>{totalPnL >= 0 ? '+' : ''}₹{(totalPnL / 100000).toFixed(2)}L</p>
          </div>
          <div style={{ padding: '6px 16px', borderRadius: '20px', background: isTrading ? 'rgba(0,230,118,0.1)' : 'rgba(107,107,128,0.1)', color: isTrading ? 'var(--green)' : 'var(--text-dim)', fontSize: '12px', fontWeight: 600, border: '1px solid', borderColor: isTrading ? 'var(--green)' : 'var(--border)' }}>
            {gameState?.status === 'waiting' ? '⏳ Waiting' : gameState?.status === 'trading' ? `Day ${gameState.current_day} · Min ${gameState.current_minute}` : gameState?.status === 'break' ? '☕ Break' : '🏁 Finished'}
          </div>
        </div>
      </div>

      {/* News Banner */}
      {currentNews && (
        <div style={{ background: 'rgba(255,171,0,0.1)', borderBottom: '1px solid rgba(255,171,0,0.3)', padding: '10px 24px' }}>
          <span style={{ fontSize: '11px', color: 'var(--amber)', fontWeight: 700, marginRight: '12px' }}>📰 BREAKING</span>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>{currentNews.headline}</span>
          <span style={{ fontSize: '12px', color: 'var(--text-dim)', marginLeft: '12px' }}>{currentNews.detail}</span>
        </div>
      )}

      {gameState?.status === 'waiting' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 120px)' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
            <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Waiting for Admin to Start</h2>
            <p style={{ color: 'var(--text-dim)' }}>The simulation will begin shortly...</p>
          </div>
        </div>
      )}

      {gameState?.status === 'finished' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 120px)' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏆</div>
            <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Simulation Complete!</h2>
            <p style={{ color: totalPnL >= 0 ? 'var(--green)' : 'var(--red)', fontSize: '20px', fontWeight: 700 }}>
              Final P&L: {totalPnL >= 0 ? '+' : ''}₹{(totalPnL / 100000).toFixed(2)}L
            </p>
          </div>
        </div>
      )}

      {(gameState?.status === 'trading' || gameState?.status === 'break') && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', height: 'calc(100vh - 100px)', overflow: 'hidden' }}>

          {/* Left - Stocks/Portfolio */}
          <div style={{ overflow: 'auto', padding: '20px' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              {(['market', 'portfolio'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: activeTab === tab ? 'var(--surface2)' : 'transparent', color: activeTab === tab ? 'var(--text)' : 'var(--text-dim)', fontWeight: activeTab === tab ? 600 : 400, fontSize: '13px', cursor: 'pointer', textTransform: 'capitalize' }}>
                  {tab === 'market' ? '📈 Market' : '💼 My Portfolio'}
                </button>
              ))}
            </div>

            {activeTab === 'market' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {['IT', 'Banking', 'Pharma', 'Energy', 'FMCG'].map(sector => (
                  <div key={sector}>
                    <p style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '2px', textTransform: 'uppercase', padding: '8px 0 4px' }}>{sector}</p>
                    {prices.filter(p => STOCKS.find(s => s.symbol === p.symbol)?.sector === sector).map(p => {
                      const change = ((p.price - p.base_price) / p.base_price * 100)
                      const isSelected = selectedStock?.symbol === p.symbol
                      return (
                        <div key={p.symbol} onClick={() => setSelectedStock(STOCKS.find(s => s.symbol === p.symbol))}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', background: isSelected ? 'var(--surface2)' : 'transparent', border: isSelected ? '1px solid var(--blue)' : '1px solid transparent', marginBottom: '2px' }}>
                          <div>
                            <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--mono)' }}>{p.symbol}</span>
                            <span style={{ fontSize: '12px', color: 'var(--text-dim)', marginLeft: '8px' }}>{p.name}</span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <p style={{ fontSize: '14px', fontWeight: 600, fontFamily: 'var(--mono)' }}>₹{p.price.toFixed(2)}</p>
                            <p style={{ fontSize: '11px', color: change >= 0 ? 'var(--green)' : 'var(--red)' }}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
                {prices.length === 0 && <p style={{ color: 'var(--text-dim)', fontSize: '14px', padding: '20px 0' }}>Prices loading...</p>}
              </div>
            )}

            {activeTab === 'portfolio' && (
              <div>
                {holdings.filter(h => h.quantity > 0).length === 0 ? (
                  <p style={{ color: 'var(--text-dim)', fontSize: '14px' }}>No holdings yet. Buy some stocks!</p>
                ) : holdings.filter(h => h.quantity > 0).map(h => {
                  const price = prices.find(p => p.symbol === h.symbol)?.price || 0
                  const pnl = (price - h.avg_buy_price) * h.quantity
                  return (
                    <div key={h.symbol} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <div>
                          <p style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{h.symbol}</p>
                          <p style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{h.quantity} shares · Avg ₹{h.avg_buy_price.toFixed(2)}</p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p style={{ fontSize: '14px', fontWeight: 600 }}>₹{(price * h.quantity).toFixed(0)}</p>
                          <p style={{ fontSize: '12px', color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{pnl >= 0 ? '+' : ''}₹{pnl.toFixed(0)}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right - Trade Panel */}
          <div style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border)', padding: '20px', overflow: 'auto' }}>
            <p style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '16px' }}>Trade</p>

            {!selectedStock ? (
              <p style={{ color: 'var(--text-dim)', fontSize: '13px' }}>← Select a stock to trade</p>
            ) : (
              <>
                <div style={{ marginBottom: '20px' }}>
                  <p style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{selectedStock.symbol}</p>
                  <p style={{ fontSize: '13px', color: 'var(--text-dim)' }}>{selectedStock.name}</p>
                  <p style={{ fontSize: '24px', fontWeight: 700, marginTop: '8px' }}>
                    ₹{prices.find(p => p.symbol === selectedStock.symbol)?.price?.toFixed(2) || '—'}
                  </p>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>Quantity (10–100)</label>
                  <input type="number" value={qty} onChange={e => setQty(Math.max(10, Math.min(100, parseInt(e.target.value) || 10)))} min={10} max={100} step={10}
                    style={{ width: '100%', marginTop: '8px', padding: '12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '16px', outline: 'none' }} />
                </div>

                <div style={{ background: 'var(--surface2)', borderRadius: '8px', padding: '12px', marginBottom: '16px', fontSize: '13px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-dim)' }}>Total Cost</span>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>₹{((prices.find(p => p.symbol === selectedStock.symbol)?.price || 0) * qty).toFixed(0)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                    <span style={{ color: 'var(--text-dim)' }}>Holdings</span>
                    <span>{holdings.find(h => h.symbol === selectedStock.symbol)?.quantity || 0} shares</span>
                  </div>
                </div>

                {tradeMsg && <div style={{ padding: '10px', background: 'var(--surface2)', borderRadius: '8px', fontSize: '13px', color: tradeMsg.startsWith('✅') ? 'var(--green)' : 'var(--red)', marginBottom: '12px' }}>{tradeMsg}</div>}

                {gameState?.status === 'break' ? (
                  <p style={{ color: 'var(--amber)', fontSize: '13px', textAlign: 'center', padding: '12px' }}>☕ Trading paused during break</p>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => executeTrade('buy')} disabled={tradeLoading}
                      style={{ flex: 1, padding: '14px', background: 'var(--green)', color: '#000', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700 }}>
                      {tradeLoading ? '...' : 'BUY'}
                    </button>
                    <button onClick={() => executeTrade('sell')} disabled={tradeLoading}
                      style={{ flex: 1, padding: '14px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700 }}>
                      {tradeLoading ? '...' : 'SELL'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
