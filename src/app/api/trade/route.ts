import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://skvwmspkbunmukuhmrda.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNrdndtc3BrYnVubXVrdWhtcmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MzE0NjgsImV4cCI6MjA5OTAwNzQ2OH0.qewOoU7oMqyI8fCLp4l0it7INfaMYz4VC67udbgTv7E'
)

export async function POST(req: NextRequest) {
  const { teamName, symbol, tradeType, quantity, price, day, minute } = await req.json()

  if (!teamName || !symbol || !tradeType || !quantity || !price) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (quantity < 10 || quantity % 10 !== 0 || quantity > 100) {
    return NextResponse.json({ error: 'Quantity must be 10–100 in multiples of 10' })
  }

  const { data: team, error: teamErr } = await supabase.from('teams').select('cash').eq('name', teamName).single()
  if (teamErr || !team) return NextResponse.json({ error: 'Team not found' })

  const totalCost = quantity * price

  if (tradeType === 'buy') {
    if (team.cash < totalCost) return NextResponse.json({ error: 'Insufficient cash' })
    await supabase.from('teams').update({ cash: team.cash - totalCost }).eq('name', teamName)
    const { data: existing } = await supabase.from('holdings').select('*').eq('team_name', teamName).eq('symbol', symbol).single()
    if (existing) {
      const newQty = existing.quantity + quantity
      const newAvg = ((existing.avg_buy_price * existing.quantity) + totalCost) / newQty
      await supabase.from('holdings').update({ quantity: newQty, avg_buy_price: newAvg }).eq('team_name', teamName).eq('symbol', symbol)
    } else {
      await supabase.from('holdings').insert({ team_name: teamName, symbol, quantity, avg_buy_price: price })
    }
  } else {
    const { data: holding } = await supabase.from('holdings').select('*').eq('team_name', teamName).eq('symbol', symbol).single()
    if (!holding || holding.quantity < quantity) return NextResponse.json({ error: 'Not enough shares to sell' })
    await supabase.from('teams').update({ cash: team.cash + (quantity * price) }).eq('name', teamName)
    await supabase.from('holdings').update({ quantity: holding.quantity - quantity }).eq('team_name', teamName).eq('symbol', symbol)
  }

  await supabase.from('trades').insert({ team_name: teamName, symbol, trade_type: tradeType, quantity, price, day, minute })
  return NextResponse.json({ success: true })
}
