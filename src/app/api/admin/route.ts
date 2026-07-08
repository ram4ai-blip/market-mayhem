import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { STOCKS, NEWS_SCRIPT, TOTAL_DAYS, TRADING_MINUTES, BREAK_MINUTES, ADMIN_PASSWORD } from '@/lib/gameData'

const supabase = createClient(
  'https://mxjgkvzbmgpzopbibbzv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14amdrdnpibWdwem9wYmliYnp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NTU5MTcsImV4cCI6MjA5OTAzMTkxN30.N83Ru9woRgBDC8jRolNtiMH-2nklelFSiPdRwIbRj4U'
)

// Apply news-driven price change + high volatility noise every tick
function applyPriceChanges(
  currentPrices: { symbol: string; price: number }[],
  day: number,
  minute: number,
  isNoiseTick = false
) {
  const newsEvent = NEWS_SCRIPT.find(n => n.day === day && n.minute === minute)

  return currentPrices.map(stock => {
    const stockMeta = STOCKS.find(s => s.symbol === stock.symbol)
    if (!stockMeta) return stock

    let changePct = 0

    if (!isNoiseTick && newsEvent) {
      // Full news impact on minute advance
      const sectorImpact = newsEvent.impact[stockMeta.sector] ?? 0
      const jitter = (Math.random() - 0.5) * 1.2   // ±0.6% noise
      changePct = (sectorImpact + jitter) / 100
    } else {
      // 10-second noise tick — high volatility to simulate live market
      const noise = (Math.random() - 0.5) * 1.6    // ±0.8% per tick = very lively
      changePct = noise / 100
    }

    const newPrice = Math.max(stock.price * (1 + changePct), 1)
    return { ...stock, price: Math.round(newPrice * 100) / 100 }
  })
}

async function updatePricesInDb(prices: { symbol: string; price: number }[]) {
  const now = new Date().toISOString()
  for (const p of prices) {
    await supabase.from('stock_prices')
      .update({ price: p.price, updated_at: now })
      .eq('symbol', p.symbol)
  }
}

export async function POST(req: NextRequest) {
  const { action, password } = await req.json()

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }

  const { data: gs, error: gsErr } = await supabase
    .from('game_state').select('*').eq('id', 1).single()
  if (gsErr || !gs) {
    return NextResponse.json({ error: 'Game state not found. Run the SQL schema first.' }, { status: 500 })
  }

  // ── START ──────────────────────────────────────────────
  if (action === 'start') {
    const initialPrices = STOCKS.map(s => ({
      symbol: s.symbol, name: s.name, sector: s.sector,
      price: s.basePrice, base_price: s.basePrice,
    }))
    await supabase.from('stock_prices').upsert(initialPrices, { onConflict: 'symbol' })

    const phaseEnds = new Date(Date.now() + TRADING_MINUTES * 60 * 1000)
    await supabase.from('game_state').update({
      status: 'trading',
      current_day: 1,
      current_minute: 1,
      phase_ends_at: phaseEnds.toISOString(),
      started_at: new Date().toISOString(),
      session_id: Date.now().toString(),   // kick existing participants
    }).eq('id', 1)

    return NextResponse.json({ success: true, message: 'Game started! Day 1 · Minute 1' })
  }

  // ── NEXT MINUTE (called by admin every 60s) ───────────
  if (action === 'next_minute') {
    if (gs.status !== 'trading') {
      return NextResponse.json({ error: 'Game is not in trading phase' })
    }

    const { data: currentPrices } = await supabase
      .from('stock_prices').select('symbol, price')

    // Apply news impact for the minute that just ended
    if (currentPrices) {
      const updated = applyPriceChanges(currentPrices, gs.current_day, gs.current_minute, false)
      await updatePricesInDb(updated)
    }

    const nextMinute = gs.current_minute + 1

    if (nextMinute > TRADING_MINUTES) {
      // End of trading day
      if (gs.current_day >= TOTAL_DAYS) {
        await supabase.from('game_state').update({
          status: 'finished', phase_ends_at: null,
        }).eq('id', 1)
        return NextResponse.json({ success: true, message: '🏁 Game finished!' })
      }
      // Start break
      const phaseEnds = new Date(Date.now() + BREAK_MINUTES * 60 * 1000)
      await supabase.from('game_state').update({
        status: 'break', phase_ends_at: phaseEnds.toISOString(),
      }).eq('id', 1)
      return NextResponse.json({ success: true, message: `☕ Break — Day ${gs.current_day} complete` })
    }

    // Advance minute
    const phaseEnds = new Date(Date.now() + 60 * 1000)
    await supabase.from('game_state').update({
      current_minute: nextMinute,
      phase_ends_at: phaseEnds.toISOString(),
    }).eq('id', 1)
    return NextResponse.json({ success: true, message: `Day ${gs.current_day} · Min ${nextMinute}` })
  }

  // ── NOISE TICK (called every 10s by admin panel auto-advance) ──
  if (action === 'price_tick') {
    if (gs.status !== 'trading') {
      return NextResponse.json({ success: true, message: 'Not trading' })
    }
    const { data: currentPrices } = await supabase
      .from('stock_prices').select('symbol, price')
    if (currentPrices) {
      const updated = applyPriceChanges(currentPrices, gs.current_day, gs.current_minute, true)
      await updatePricesInDb(updated)
    }
    return NextResponse.json({ success: true, message: 'Prices updated' })
  }

  // ── NEXT DAY (after break) ────────────────────────────
  if (action === 'next_day') {
    if (gs.status !== 'break') {
      return NextResponse.json({ error: 'Game is not in break phase' })
    }
    const nextDay = gs.current_day + 1
    const phaseEnds = new Date(Date.now() + TRADING_MINUTES * 60 * 1000)
    await supabase.from('game_state').update({
      status: 'trading',
      current_day: nextDay,
      current_minute: 1,
      phase_ends_at: phaseEnds.toISOString(),
    }).eq('id', 1)
    return NextResponse.json({ success: true, message: `🔔 Day ${nextDay} started!` })
  }

  // ── RESET ─────────────────────────────────────────────
  if (action === 'reset') {
    await supabase.from('trades').delete().neq('id', 0)
    await supabase.from('holdings').delete().neq('id', 0)
    await supabase.from('teams').delete().neq('name', '')
    await supabase.from('stock_prices').delete().neq('symbol', '')
    await supabase.from('game_state').update({
      status: 'waiting',
      current_day: 1,
      current_minute: 0,
      phase_ends_at: null,
      started_at: null,
      session_id: Date.now().toString(),   // bump session → kicks all participants
    }).eq('id', 1)
    return NextResponse.json({ success: true, message: 'Game reset! All participants kicked.' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
