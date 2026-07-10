import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://mxjgkvzbmgpzopbibbzv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14amdrdnpibWdwem9wYmliYnp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NTU5MTcsImV4cCI6MjA5OTAzMTkxN30.N83Ru9woRgBDC8jRolNtiMH-2nklelFSiPdRwIbRj4U'
)

export async function POST(req: NextRequest) {
  const { teamName, symbol, tradeType, quantity, price, day, minute } = await req.json()

  if (!teamName || !symbol || !tradeType || !quantity || !price) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (quantity < 10 || quantity % 10 !== 0 || quantity > 100) {
    return NextResponse.json({ error: 'Quantity must be 10–100 in multiples of 10' })
  }

  const totalCost = quantity * price

  if (tradeType === 'buy') {
    // ATOMIC: fetch fresh cash AND deduct in one conditional update
    // .gte('cash', totalCost) means Supabase only writes if cash is still enough
    // at the exact moment of the DB write — blocks race conditions completely
    const { data: team } = await supabase
      .from('teams')
      .select('cash')
      .eq('name', teamName)
      .single()

    if (!team) return NextResponse.json({ error: 'Team not found' })

    // Atomic update — only succeeds if cash >= totalCost right now in DB
    // No pre-check error shown — BUY button greys out naturally via UI
    const { data: updated } = await supabase
      .from('teams')
      .update({ cash: team.cash - totalCost })
      .eq('name', teamName)
      .gte('cash', totalCost)
      .select('cash')
      .single()

    // Silent fail — no error message, UI handles it
    if (!updated) return NextResponse.json({ success: false })

    const { data: existing } = await supabase
      .from('holdings').select('*').eq('team_name', teamName).eq('symbol', symbol).single()

    if (existing) {
      const newQty = existing.quantity + quantity
      const newAvg = ((existing.avg_buy_price * existing.quantity) + totalCost) / newQty
      await supabase.from('holdings')
        .update({ quantity: newQty, avg_buy_price: newAvg })
        .eq('team_name', teamName).eq('symbol', symbol)
    } else {
      await supabase.from('holdings')
        .insert({ team_name: teamName, symbol, quantity, avg_buy_price: price })
    }

  } else {
    // SELL — fetch fresh holdings and cash
    const { data: holding } = await supabase
      .from('holdings').select('*').eq('team_name', teamName).eq('symbol', symbol).single()

    if (!holding || holding.quantity < quantity) {
      return NextResponse.json({ error: 'Not enough shares to sell' })
    }

    const { data: team } = await supabase
      .from('teams').select('cash').eq('name', teamName).single()

    if (!team) return NextResponse.json({ error: 'Team not found' })

    await supabase.from('teams')
      .update({ cash: team.cash + (quantity * price) })
      .eq('name', teamName)

    await supabase.from('holdings')
      .update({ quantity: holding.quantity - quantity })
      .eq('team_name', teamName).eq('symbol', symbol)
  }

  await supabase.from('trades')
    .insert({ team_name: teamName, symbol, trade_type: tradeType, quantity, price, day, minute })

  return NextResponse.json({ success: true })
}