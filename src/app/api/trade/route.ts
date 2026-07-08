import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://mxjgkvzbmgpzopbibbzv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14amdrdnpibWdwem9wYmliYnp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NTU5MTcsImV4cCI6MjA5OTAzMTkxN30.N83Ru9woRgBDC8jRolNtiMH-2nklelFSiPdRwIbRj4U'
)

const ADMIN_PASSWORD = 'marketadmin2024'

const STOCKS_META: { symbol: string; sector: string; basePrice: number }[] = [
  { symbol: 'TCS', sector: 'IT', basePrice: 3500 },
  { symbol: 'INFY', sector: 'IT', basePrice: 1750 },
  { symbol: 'WIPRO', sector: 'IT', basePrice: 480 },
  { symbol: 'HCLTECH', sector: 'IT', basePrice: 1600 },
  { symbol: 'TECHM', sector: 'IT', basePrice: 1350 },
  { symbol: 'HDFCBANK', sector: 'Banking', basePrice: 1700 },
  { symbol: 'ICICIBANK', sector: 'Banking', basePrice: 1200 },
  { symbol: 'SBIN', sector: 'Banking', basePrice: 800 },
  { symbol: 'KOTAKBANK', sector: 'Banking', basePrice: 1900 },
  { symbol: 'AXISBANK', sector: 'Banking', basePrice: 1150 },
  { symbol: 'SUNPHARMA', sector: 'Pharma', basePrice: 1650 },
  { symbol: 'DRREDDY', sector: 'Pharma', basePrice: 1250 },
  { symbol: 'CIPLA', sector: 'Pharma', basePrice: 1500 },
  { symbol: 'DIVISLAB', sector: 'Pharma', basePrice: 5400 },
  { symbol: 'AUROPHARMA', sector: 'Pharma', basePrice: 1100 },
  { symbol: 'RELIANCE', sector: 'Energy', basePrice: 2900 },
  { symbol: 'ONGC', sector: 'Energy', basePrice: 270 },
  { symbol: 'NTPC', sector: 'Energy', basePrice: 360 },
  { symbol: 'POWERGRID', sector: 'Energy', basePrice: 320 },
  { symbol: 'ADANIGREEN', sector: 'Energy', basePrice: 1800 },
  { symbol: 'HINDUNILVR', sector: 'FMCG', basePrice: 2400 },
  { symbol: 'ITC', sector: 'FMCG', basePrice: 460 },
  { symbol: 'NESTLEIND', sector: 'FMCG', basePrice: 2300 },
  { symbol: 'DABUR', sector: 'FMCG', basePrice: 530 },
  { symbol: 'BRITANNIA', sector: 'FMCG', basePrice: 5200 },
]

const NEWS_SCRIPT: { day: number; minute: number; impact: { [sector: string]: number } }[] = [
  { day: 1, minute: 1, impact: { IT: 0.8, Banking: 0.6, Pharma: 0.5, Energy: 0.7, FMCG: 0.4 } },
  { day: 1, minute: 2, impact: { IT: 0.3, Banking: 1.8, Pharma: 0.2, Energy: 0.4, FMCG: 0.5 } },
  { day: 1, minute: 3, impact: { IT: 2.1, Banking: 0.4, Pharma: 0.3, Energy: 0.2, FMCG: 0.3 } },
  { day: 1, minute: 4, impact: { IT: 0.2, Banking: 0.3, Pharma: 0.4, Energy: -1.5, FMCG: 0.6 } },
  { day: 1, minute: 5, impact: { IT: 1.2, Banking: 1.4, Pharma: 0.8, Energy: 0.9, FMCG: 0.7 } },
  { day: 1, minute: 6, impact: { IT: 0.9, Banking: 0.8, Pharma: 0.6, Energy: 0.5, FMCG: 0.7 } },
  { day: 2, minute: 1, impact: { IT: 3.2, Banking: 2.8, Pharma: 0.6, Energy: 1.1, FMCG: 0.5 } },
  { day: 2, minute: 2, impact: { IT: 4.5, Banking: 3.9, Pharma: 0.8, Energy: 1.4, FMCG: 0.6 } },
  { day: 2, minute: 3, impact: { IT: 5.1, Banking: 1.2, Pharma: 0.4, Energy: 0.6, FMCG: 0.3 } },
  { day: 2, minute: 4, impact: { IT: 1.1, Banking: 4.8, Pharma: 0.5, Energy: 0.7, FMCG: 0.4 } },
  { day: 2, minute: 5, impact: { IT: 2.8, Banking: 2.6, Pharma: 1.2, Energy: 1.8, FMCG: 1.1 } },
  { day: 2, minute: 6, impact: { IT: 2.1, Banking: 1.9, Pharma: 0.8, Energy: 1.2, FMCG: 0.9 } },
  { day: 3, minute: 1, impact: { IT: -1.2, Banking: -0.8, Pharma: 0.9, Energy: -0.5, FMCG: 1.1 } },
  { day: 3, minute: 2, impact: { IT: -2.1, Banking: -2.8, Pharma: 0.7, Energy: -0.9, FMCG: 0.8 } },
  { day: 3, minute: 3, impact: { IT: -0.4, Banking: -0.6, Pharma: 0.5, Energy: -2.4, FMCG: 0.6 } },
  { day: 3, minute: 4, impact: { IT: -0.3, Banking: -0.4, Pharma: 3.8, Energy: -0.2, FMCG: 1.2 } },
  { day: 3, minute: 5, impact: { IT: -2.8, Banking: -1.1, Pharma: 0.6, Energy: -0.4, FMCG: 0.9 } },
  { day: 3, minute: 6, impact: { IT: -0.9, Banking: -0.7, Pharma: 1.1, Energy: -0.3, FMCG: 0.8 } },
  { day: 4, minute: 1, impact: { IT: -5.8, Banking: -6.2, Pharma: -1.2, Energy: -4.1, FMCG: -0.8 } },
  { day: 4, minute: 2, impact: { IT: -7.2, Banking: -5.8, Pharma: -0.9, Energy: -5.4, FMCG: -0.6 } },
  { day: 4, minute: 3, impact: { IT: -4.1, Banking: -6.9, Pharma: -0.7, Energy: -3.8, FMCG: -0.5 } },
  { day: 4, minute: 4, impact: { IT: -2.3, Banking: -8.4, Pharma: -0.4, Energy: -2.1, FMCG: 0.8 } },
  { day: 4, minute: 5, impact: { IT: -3.1, Banking: -4.2, Pharma: 2.8, Energy: -2.9, FMCG: 2.4 } },
  { day: 4, minute: 6, impact: { IT: -4.2, Banking: -3.8, Pharma: 1.1, Energy: -3.4, FMCG: 1.3 } },
  { day: 5, minute: 1, impact: { IT: 2.1, Banking: 2.4, Pharma: 0.8, Energy: 1.6, FMCG: 0.5 } },
  { day: 5, minute: 2, impact: { IT: 1.4, Banking: 1.8, Pharma: 1.2, Energy: 3.2, FMCG: 2.8 } },
  { day: 5, minute: 3, impact: { IT: -1.8, Banking: 0.9, Pharma: 1.4, Energy: 1.1, FMCG: 1.6 } },
  { day: 5, minute: 4, impact: { IT: -0.6, Banking: 0.4, Pharma: 1.9, Energy: 0.8, FMCG: 4.1 } },
  { day: 5, minute: 5, impact: { IT: 1.2, Banking: 1.1, Pharma: 1.6, Energy: 1.4, FMCG: 1.8 } },
  { day: 5, minute: 6, impact: { IT: 0.5, Banking: 0.4, Pharma: 0.8, Energy: 0.6, FMCG: 0.9 } },
]

const TRADING_MINUTES = 6
const BREAK_MINUTES = 2
const TOTAL_DAYS = 5

function applyPriceChanges(currentPrices: { symbol: string; price: number }[], day: number, minute: number) {
  const newsEvent = NEWS_SCRIPT.find(n => n.day === day && n.minute === minute)
  if (!newsEvent) return currentPrices
  return currentPrices.map(stock => {
    const meta = STOCKS_META.find(s => s.symbol === stock.symbol)
    if (!meta) return stock
    const sectorImpact = newsEvent.impact[meta.sector] ?? 0
    const jitter = (Math.random() - 0.5) * 0.4
    const changePct = (sectorImpact + jitter) / 100
    const newPrice = Math.max(stock.price * (1 + changePct), 1)
    return { ...stock, price: Math.round(newPrice * 100) / 100 }
  })
}

function applyTick(currentPrices: { symbol: string; price: number }[], day: number, minute: number) {
  const newsEvent = NEWS_SCRIPT.find(n => n.day === day && n.minute === minute)
  return currentPrices.map(stock => {
    const meta = STOCKS_META.find(s => s.symbol === stock.symbol)
    if (!meta) return stock
    let noise = (Math.random() - 0.5) * 0.6
    if (newsEvent) {
      const sectorImpact = newsEvent.impact[meta.sector] ?? 0
      const direction = sectorImpact > 0 ? 1 : sectorImpact < 0 ? -1 : 0
      noise += direction * (Math.random() * 0.2)
    }
    const newPrice = Math.max(stock.price * (1 + noise / 100), 1)
    return { ...stock, price: Math.round(newPrice * 100) / 100 }
  })
}

export async function POST(req: NextRequest) {
  const { action, password } = await req.json()

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: gs } = await supabase.from('game_state').select('*').eq('id', 1).single()
  if (!gs) return NextResponse.json({ error: 'Game state not found' })

  if (action === 'start') {
    const initialPrices = STOCKS_META.map(s => ({
      symbol: s.symbol, name: s.symbol, sector: s.sector,
      price: s.basePrice, base_price: s.basePrice
    }))
    await supabase.from('stock_prices').upsert(initialPrices, { onConflict: 'symbol' })
    const phaseEnds = new Date(Date.now() + TRADING_MINUTES * 60 * 1000)
    await supabase.from('game_state').update({
      status: 'trading', current_day: 1, current_minute: 1,
      phase_ends_at: phaseEnds.toISOString(), started_at: new Date().toISOString()
    }).eq('id', 1)
    return NextResponse.json({ success: true, message: 'Game started' })
  }

  if (action === 'tick') {
    if (gs.status !== 'trading') return NextResponse.json({ success: true, message: 'Not trading' })
    const { data: currentPrices } = await supabase.from('stock_prices').select('symbol, price')
    if (currentPrices) {
      const updated = applyTick(currentPrices, gs.current_day, gs.current_minute)
      for (const p of updated) {
        await supabase.from('stock_prices')
          .update({ price: p.price, updated_at: new Date().toISOString() })
          .eq('symbol', p.symbol)
      }
    }
    return NextResponse.json({ success: true, message: 'Tick applied' })
  }

  if (action === 'next_minute') {
    if (gs.status !== 'trading') return NextResponse.json({ error: 'Not in trading phase' })
    const nextMinute = gs.current_minute + 1
    const { data: currentPrices } = await supabase.from('stock_prices').select('symbol, price')
    if (currentPrices) {
      const updated = applyPriceChanges(currentPrices, gs.current_day, gs.current_minute)
      for (const p of updated) {
        await supabase.from('stock_prices').update({ price: p.price, updated_at: new Date().toISOString() }).eq('symbol', p.symbol)
      }
    }
    if (nextMinute > TRADING_MINUTES) {
      if (gs.current_day >= TOTAL_DAYS) {
        await supabase.from('game_state').update({ status: 'finished', phase_ends_at: null }).eq('id', 1)
        return NextResponse.json({ success: true, message: 'Game finished' })
      }
      const phaseEnds = new Date(Date.now() + BREAK_MINUTES * 60 * 1000)
      await supabase.from('game_state').update({ status: 'break', phase_ends_at: phaseEnds.toISOString() }).eq('id', 1)
      return NextResponse.json({ success: true, message: 'Break started' })
    }
    const phaseEnds = new Date(Date.now() + 60 * 1000)
    await supabase.from('game_state').update({ current_minute: nextMinute, phase_ends_at: phaseEnds.toISOString() }).eq('id', 1)
    return NextResponse.json({ success: true, message: `Minute ${nextMinute}` })
  }

  if (action === 'next_day') {
    if (gs.status !== 'break') return NextResponse.json({ error: 'Not in break phase' })
    const nextDay = gs.current_day + 1
    const phaseEnds = new Date(Date.now() + TRADING_MINUTES * 60 * 1000)
    await supabase.from('game_state').update({
      status: 'trading', current_day: nextDay, current_minute: 1,
      phase_ends_at: phaseEnds.toISOString()
    }).eq('id', 1)
    return NextResponse.json({ success: true, message: `Day ${nextDay} started` })
  }

  if (action === 'reset') {
    await supabase.from('game_state').update({ status: 'waiting', current_day: 1, current_minute: 0, phase_ends_at: null, started_at: null }).eq('id', 1)
    await supabase.from('trades').delete().neq('id', 0)
    await supabase.from('holdings').delete().neq('id', 0)
    await supabase.from('teams').delete().neq('name', '')
    await supabase.from('stock_prices').delete().neq('symbol', '')
    return NextResponse.json({ success: true, message: 'Game reset' })
  }

  return NextResponse.json({ error: 'Unknown action' })
}