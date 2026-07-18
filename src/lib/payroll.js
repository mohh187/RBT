// Payroll helpers — overtime computed from attendance punches (the source of truth).

// Worked hours per calendar day from in→out punches (an open shift counts to now).
export function hoursByDay(punches, sinceMs) {
  const list = (punches || []).filter((p) => (p.at?.toMillis?.() || 0) >= sinceMs)
    .slice().sort((a, b) => (a.at?.toMillis?.() || 0) - (b.at?.toMillis?.() || 0))
  const days = {}
  let lastIn = null
  list.forEach((p) => {
    const at = p.at?.toMillis?.() || 0
    if (p.type === 'in') lastIn = at
    else if (p.type === 'out' && lastIn) {
      const key = new Date(lastIn).toDateString()
      days[key] = (days[key] || 0) + (at - lastIn) / 3600000
      lastIn = null
    }
  })
  if (lastIn) { const key = new Date(lastIn).toDateString(); days[key] = (days[key] || 0) + (Date.now() - lastIn) / 3600000 }
  return days
}

// Total overtime hours since `sinceMs`: per day, anything beyond `afterHours`.
export function overtimeHours(punches, sinceMs, afterHours = 8) {
  if (!afterHours) return 0
  const days = hoursByDay(punches, sinceMs)
  return Object.values(days).reduce((s, h) => s + Math.max(0, h - afterHours), 0)
}

// Overtime pay = hours × ratePerHour (rate set by the venue's overtime policy).
export function overtimePay(punches, sinceMs, policy) {
  const after = Number(policy?.afterHours) || 8
  const rate = Number(policy?.ratePerHour) || 0
  if (!rate) return { hours: 0, pay: 0 }
  const hours = overtimeHours(punches, sinceMs, after)
  return { hours, pay: Math.round(hours * rate) }
}
