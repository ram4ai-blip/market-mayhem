import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { STOCKS, NEWS_SCRIPT, TOTAL_DAYS, TRADING_MINUTES, BREAK_MINUTES, ADMIN_PASSWORD } from '@/lib/gameData'

const supabase = createClient(
  'https://mxjgkvzbmgpzopbibbzv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14amdrdnpibWdwem9wYmliYnp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NTU5MTcsImV4cCI6MjA5OTAzMTkxN30.N83Ru9woRgBDC8jRolNtiMH-2nklelFSiPdRwIbRj4U'
)

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
      const sectorImpact = newsEvent.impact[stockMeta.sector] ?? 0
      const jitter = (Math.random() - 0.5) * 1.2
      changePct = (sectorImpact + jitter) / 100
    } else {
      const noise = (Math.random() - 0.5) * 1.6
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

    const phaseEnds = new Date(Date.now() + 60 * 1000) // 60s for minute 1
    await supabase.from('game_state').update({
      status: 'trading',
      current_day: 1,
      current_minute: 1,
      phase_ends_at: phaseEnds.toISOString(),
      started_at: new Date().toISOString(),
      session_id: Date.now().toString(),
    }).eq('id', 1)

    return NextResponse.json({ success: true, message: 'Game started! Day 1 · Minute 1' })
  }

  // ── ADVANCE ───────────────────────────────────────────
  if (action === 'advance') {
    // Guard: only advance if timer actually expired
    if (gs.phase_ends_at) {
      const endsAt = new Date(gs.phase_ends_at).getTime()
      if (endsAt > Date.now() + 2000) {
        return NextResponse.json({ success: true, message: 'Timer still running' })
      }
    }

    if (gs.status === 'trading') {
      const { data: currentPrices } = await supabase.from('stock_prices').select('symbol, price')
      if (currentPrices) {
        const updated = applyPriceChanges(currentPrices, gs.current_day, gs.current_minute, false)
        await updatePricesInDb(updated)
      }

      const nextMinute = gs.current_minute + 1

      if (nextMinute > TRADING_MINUTES) {
        if (gs.current_day >= TOTAL_DAYS) {
          await supabase.from('game_state').update({ status: 'finished', phase_ends_at: null }).eq('id', 1)
          return NextResponse.json({ success: true, message: '🏁 Game finished!' })
        }
        // Start break — BREAK_MINUTES * 60
        const phaseEnds = new Date(Date.now() + BREAK_MINUTES * 60 * 1000)
        await supabase.from('game_state').update({
          status: 'break', phase_ends_at: phaseEnds.toISOString(),
        }).eq('id', 1)
        return NextResponse.json({ success: true, message: `☕ Break — Day ${gs.current_day} complete` })
      }

      // ✅ FIXED: next minute = 60 seconds (was incorrectly TRADING_MINUTES * 60)
      const phaseEnds = new Date(Date.now() + 60 * 1000)
      await supabase.from('game_state').update({
        current_minute: nextMinute,
        phase_ends_at: phaseEnds.toISOString(),
      }).eq('id', 1)
      return NextResponse.json({ success: true, message: `Day ${gs.current_day} · Min ${nextMinute}` })
    }

    if (gs.status === 'break') {
      const nextDay = gs.current_day + 1
      const phaseEnds = new Date(Date.now() + 60 * 1000) // minute 1 of new day = 60s
      await supabase.from('game_state').update({
        status: 'trading',
        current_day: nextDay,
        current_minute: 1,
        phase_ends_at: phaseEnds.toISOString(),
      }).eq('id', 1)
      return NextResponse.json({ success: true, message: `🔔 Day ${nextDay} started!` })
    }

    return NextResponse.json({ success: true, message: 'Nothing to advance' })
  }

  // ── PRICE TICK (every 5s) ─────────────────────────────
  if (action === 'price_tick') {
    if (gs.status !== 'trading') {
      return NextResponse.json({ success: true, message: 'Not trading' })
    }
    const { data: currentPrices } = await supabase.from('stock_prices').select('symbol, price')
    if (currentPrices) {
      const updated = applyPriceChanges(currentPrices, gs.current_day, gs.current_minute, true)
      await updatePricesInDb(updated)
    }
    return NextResponse.json({ success: true, message: 'Prices updated' })
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
      session_id: Date.now().toString(),
    }).eq('id', 1)
    return NextResponse.json({ success: true, message: 'Game reset!' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}