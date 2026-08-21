export type Account = {
  id: string
  name: string
  openingBalance: number
  color: string
  type?: 'standard' | 'interest-bearing'
  interest?: {
    enabled: boolean
    rate: number
    every: number
    interval: 'daily' | 'monthly' | 'yearly'
    compounding: 'simple' | 'compound'
    startDate: string
  }
}

export type StreamKind =
  | 'one-time'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'

export type RecurrenceRule =
  | { kind: 'one-time' }
  | { kind: 'daily'; everyDays: number; weekdays: number[] }
  | { kind: 'weekly'; everyWeeks: number; weekdays: number[] }
  | { kind: 'monthly-date'; everyMonths: number; dayOfMonth: number }
  | { kind: 'monthly-ordinal'; everyMonths: number; ordinal: number; weekday: number }
  | { kind: 'yearly'; everyYears: number; months: number[]; mode: 'date'; dayOfMonth: number }
  | { kind: 'yearly'; everyYears: number; months: number[]; mode: 'weekday'; ordinal: number; weekday: number }

export type MoneyStream = {
  id: string
  accountId: string
  name: string
  amount: number
  direction: 'income' | 'expense' | 'transfer'
  transferAccountId?: string
  startDate: string
  endDate?: string
  excludedDates?: string[]
  recurrence: RecurrenceRule
}

export type Checkpoint = {
  id: string
  accountId: string
  date: string
  actualBalance: number
  note?: string
}

export type ProjectionEvent = {
  id: string
  accountId: string
  label: string
  amount: number
  kind: 'income' | 'expense' | 'transfer' | 'interest' | 'checkpoint'
  note?: string
}

export type AccountSnapshot = {
  balance: number
  delta: number
  events: ProjectionEvent[]
}

export type DayProjection = {
  date: string
  accounts: Record<string, AccountSnapshot>
  totalBalance: number
  totalDelta: number
  events: ProjectionEvent[]
  checkpointAlerts: string[]
}

export type ProjectionResult = {
  days: Record<string, DayProjection>
  firstDeficitDateByAccount: Record<string, string | undefined>
  firstDeficitDate: string | undefined
  checkpointDriftAlerts: Array<{
    date: string
    accountId: string
    accountName: string
    variance: number
    checkpoint: Checkpoint
  }>
}

const dayMs = 24 * 60 * 60 * 1000

export function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function toDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function fromDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function compareDateKeys(left: string, right: string) {
  return utcMs(fromDateKey(left)) - utcMs(fromDateKey(right))
}

export function differenceInCalendarDays(left: Date, right: Date) {
  return Math.round((utcMs(left) - utcMs(right)) / dayMs)
}

export function addDays(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
}

export function addMonthsClamped(date: Date, amount: number) {
  const result = new Date(date.getFullYear(), date.getMonth() + amount, 1)
  const targetDay = Math.min(date.getDate(), daysInMonth(result.getFullYear(), result.getMonth()))
  result.setDate(targetDay)
  return result
}

export function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

export function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function utcMs(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
}

export function normalizeMoney(amount: number, direction: 'income' | 'expense') {
  const value = Math.abs(amount)
  return direction === 'income' ? value : -value
}

function occursOnInterestDate(account: Account, date: Date) {
  if (account.type !== 'interest-bearing' || !account.interest?.enabled) {
    return false
  }

  const start = fromDateKey(account.interest.startDate)
  if (utcMs(date) < utcMs(start)) {
    return false
  }

  const every = Math.max(1, account.interest.every || 1)

  switch (account.interest.interval) {
    case 'daily': {
      const daysSinceStart = differenceInCalendarDays(date, start)
      return daysSinceStart % every === 0
    }
    case 'monthly': {
      const monthsSinceStart = (date.getFullYear() - start.getFullYear()) * 12 + (date.getMonth() - start.getMonth())
      if (monthsSinceStart < 0 || monthsSinceStart % every !== 0) {
        return false
      }

      const clampedDay = Math.min(start.getDate(), daysInMonth(date.getFullYear(), date.getMonth()))
      return date.getDate() === clampedDay
    }
    case 'yearly': {
      const yearsSinceStart = date.getFullYear() - start.getFullYear()
      if (yearsSinceStart < 0 || yearsSinceStart % every !== 0) {
        return false
      }

      if (date.getMonth() !== start.getMonth()) {
        return false
      }

      const clampedDay = Math.min(start.getDate(), daysInMonth(date.getFullYear(), date.getMonth()))
      return date.getDate() === clampedDay
    }
    default:
      return false
  }
}

function lastDayOfMonth(year: number, month: number) {
  return daysInMonth(year, month)
}

function resolveDayOfMonthRule(year: number, month: number, dayOfMonth: number) {
  const lastDay = lastDayOfMonth(year, month)
  if (dayOfMonth > 0) {
    return Math.min(dayOfMonth, lastDay)
  }

  // Negative rules mean "nth from last": -1 => last day, -2 => second last, etc.
  return Math.max(1, lastDay + dayOfMonth + 1)
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, ordinal: number) {
  if (ordinal < 0) {
    const targetFromEnd = Math.abs(ordinal)
    const matches: number[] = []
    const end = lastDayOfMonth(year, month)
    for (let day = end; day >= end - 6; day -= 1) {
      const candidate = new Date(year, month, day)
      if (candidate.getDay() === weekday) {
        matches.push(day)
      }
    }

    for (let day = end - 7; day >= 1; day -= 1) {
      const candidate = new Date(year, month, day)
      if (candidate.getDay() === weekday) {
        matches.push(day)
      }
    }

    const matchDay = matches[targetFromEnd - 1]
    if (!matchDay) {
      return null
    }

    return new Date(year, month, matchDay)
  }

  const first = new Date(year, month, 1)
  const offset = (weekday - first.getDay() + 7) % 7
  const day = 1 + offset + (ordinal - 1) * 7
  if (day > lastDayOfMonth(year, month)) {
    // Clamp: fall back to last occurrence of this weekday in the month
    const end = lastDayOfMonth(year, month)
    for (let d = end; d >= end - 6; d -= 1) {
      const candidate = new Date(year, month, d)
      if (candidate.getDay() === weekday) {
        return candidate
      }
    }

    return null
  }

  return new Date(year, month, day)
}

function isWeeklyOccurrence(stream: MoneyStream, date: Date) {
  if (stream.recurrence.kind !== 'weekly') {
    return false
  }

  const start = fromDateKey(stream.startDate)
  if (utcMs(date) < utcMs(start)) {
    return false
  }

  const daysSinceStart = differenceInCalendarDays(date, start)
  const withinCycle = Math.floor(daysSinceStart / 7)
  return withinCycle % stream.recurrence.everyWeeks === 0 && stream.recurrence.weekdays.includes(date.getDay())
}

function isDailyOccurrence(stream: MoneyStream, date: Date) {
  if (stream.recurrence.kind !== 'daily') {
    return false
  }

  const start = fromDateKey(stream.startDate)
  if (utcMs(date) < utcMs(start)) {
    return false
  }

  const { everyDays, weekdays } = stream.recurrence
  if (weekdays.length > 0 && !weekdays.includes(date.getDay())) {
    return false
  }

  const daysSinceStart = differenceInCalendarDays(date, start)
  return daysSinceStart % everyDays === 0
}

function isMonthIntervalOccurrence(stream: MoneyStream, date: Date) {
  if (stream.recurrence.kind !== 'monthly-date' && stream.recurrence.kind !== 'monthly-ordinal') {
    return false
  }

  const start = fromDateKey(stream.startDate)
  if (utcMs(date) < utcMs(start)) {
    return false
  }

  const monthsSinceStart = (date.getFullYear() - start.getFullYear()) * 12 + (date.getMonth() - start.getMonth())
  if (monthsSinceStart < 0) {
    return false
  }

  if (monthsSinceStart % stream.recurrence.everyMonths !== 0) {
    return false
  }

  if (stream.recurrence.kind === 'monthly-date') {
    const candidateDay = resolveDayOfMonthRule(date.getFullYear(), date.getMonth(), stream.recurrence.dayOfMonth)
    return date.getDate() === candidateDay
  }

  const candidate = nthWeekdayOfMonth(date.getFullYear(), date.getMonth(), stream.recurrence.weekday, stream.recurrence.ordinal)
  return candidate !== null && candidate.getDate() === date.getDate()
}

function isYearlyOccurrence(stream: MoneyStream, date: Date) {
  if (stream.recurrence.kind !== 'yearly') {
    return false
  }

  const rec = stream.recurrence
  const start = fromDateKey(stream.startDate)
  if (utcMs(date) < utcMs(start)) {
    return false
  }

  if (!rec.months.includes(date.getMonth())) {
    return false
  }

  const yearsSinceStart = date.getFullYear() - start.getFullYear()
  if (yearsSinceStart < 0 || yearsSinceStart % rec.everyYears !== 0) {
    return false
  }

  if (rec.mode === 'weekday') {
    const candidate = nthWeekdayOfMonth(date.getFullYear(), date.getMonth(), rec.weekday, rec.ordinal)
    return candidate !== null && candidate.getDate() === date.getDate()
  }

  const clampedDay = resolveDayOfMonthRule(date.getFullYear(), date.getMonth(), rec.dayOfMonth)
  return date.getDate() === clampedDay
}

export function occursOnDate(stream: MoneyStream, date: Date) {
  const dateKey = toDateKey(date)
  if (stream.endDate && compareDateKeys(dateKey, stream.endDate) > 0) {
    return false
  }

  if (compareDateKeys(dateKey, stream.startDate) < 0) {
    return false
  }

  if (stream.excludedDates?.includes(dateKey)) {
    return false
  }

  switch (stream.recurrence.kind) {
    case 'one-time':
      return dateKey === stream.startDate
    case 'daily':
      return isDailyOccurrence(stream, date)
    case 'weekly':
      return isWeeklyOccurrence(stream, date)
    case 'monthly-date':
    case 'monthly-ordinal':
      return isMonthIntervalOccurrence(stream, date)
    case 'yearly':
      return isYearlyOccurrence(stream, date)
    default:
      return false
  }
}

export function frequencyLabel(stream: MoneyStream) {
  switch (stream.recurrence.kind) {
    case 'one-time':
      return 'One-time'
    case 'daily':
      return stream.recurrence.everyDays === 1 ? 'Daily' : `Every ${stream.recurrence.everyDays} days`
    case 'weekly':
      return stream.recurrence.everyWeeks === 1 ? 'Weekly' : `Every ${stream.recurrence.everyWeeks} weeks`
    case 'monthly-date':
    case 'monthly-ordinal':
      return stream.recurrence.everyMonths === 1 ? 'Monthly' : `Every ${stream.recurrence.everyMonths} months`
    case 'yearly':
      return stream.recurrence.everyYears === 1 ? 'Yearly' : `Every ${stream.recurrence.everyYears} years`
    default:
      return 'Recurring'
  }
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatShortDate(dateKey: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(fromDateKey(dateKey))
}

export function formatCompactDate(dateKey: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(fromDateKey(dateKey))
}

export function ordinalLabel(value: number): string {
  if (value === -1) {
    return 'Last'
  }

  if (value < -1) {
    const fromEnd = Math.abs(value)
    let suffix = 'th'
    if (!(fromEnd % 100 >= 11 && fromEnd % 100 <= 13)) {
      if (fromEnd % 10 === 1) {
        suffix = 'st'
      } else if (fromEnd % 10 === 2) {
        suffix = 'nd'
      } else if (fromEnd % 10 === 3) {
        suffix = 'rd'
      }
    }
    return `${fromEnd}${suffix} last`
  }

  if (value % 100 >= 11 && value % 100 <= 13) {
    return `${value}th`
  }

  switch (value % 10) {
    case 1:
      return `${value}st`
    case 2:
      return `${value}nd`
    case 3:
      return `${value}rd`
    default:
      return `${value}th`
  }
}

export function weekdayNames() {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
}

export function weekdayLongName(index: number) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index]
}

export function buildProjection(
  accounts: Account[],
  streams: MoneyStream[],
  checkpoints: Checkpoint[],
  startDate: Date,
  endDate: Date,
  checkpointVarianceThreshold: number,
): ProjectionResult {
  const dayCount = differenceInCalendarDays(endDate, startDate)
  const runningBalances: Record<string, number> = Object.fromEntries(accounts.map((account) => [account.id, account.openingBalance]))
  const principalBalances: Record<string, number> = Object.fromEntries(accounts.map((account) => [account.id, account.openingBalance]))
  const firstDeficitDateByAccount: Record<string, string | undefined> = Object.fromEntries(accounts.map((account) => [account.id, undefined]))
  const checkpointDriftAlerts: ProjectionResult['checkpointDriftAlerts'] = []
  const checkpointMap = new Map<string, Checkpoint[]>()
  const seenCheckpointByAccount: Record<string, boolean> = Object.fromEntries(accounts.map((account) => [account.id, false]))

  for (const checkpoint of checkpoints) {
    const bucket = checkpointMap.get(checkpoint.date) ?? []
    bucket.push(checkpoint)
    checkpointMap.set(checkpoint.date, bucket)
  }

  const days: Record<string, DayProjection> = {}
  const dateKeys: string[] = []
  let firstDeficitDate: string | undefined

  for (let offset = 0; offset <= dayCount; offset += 1) {
    const currentDate = addDays(startDate, offset)
    const dateKey = toDateKey(currentDate)
    const dayEvents: ProjectionEvent[] = []
    const checkpointAlerts: string[] = []

    for (const stream of streams) {
      if (!occursOnDate(stream, currentDate)) {
        continue
      }

      if (stream.direction === 'transfer') {
        if (!stream.transferAccountId || stream.transferAccountId === stream.accountId) {
          continue
        }

        const transferAmount = Math.abs(stream.amount)
        runningBalances[stream.accountId] = (runningBalances[stream.accountId] ?? 0) - transferAmount
        runningBalances[stream.transferAccountId] = (runningBalances[stream.transferAccountId] ?? 0) + transferAmount
        principalBalances[stream.accountId] = (principalBalances[stream.accountId] ?? 0) - transferAmount
        principalBalances[stream.transferAccountId] = (principalBalances[stream.transferAccountId] ?? 0) + transferAmount

        dayEvents.push({
          id: `${stream.id}-out`,
          accountId: stream.accountId,
          label: `${stream.name} transfer out`,
          amount: -transferAmount,
          kind: 'transfer',
        })
        dayEvents.push({
          id: `${stream.id}-in`,
          accountId: stream.transferAccountId,
          label: `${stream.name} transfer in`,
          amount: transferAmount,
          kind: 'transfer',
        })
        continue
      }

      const signedAmount = normalizeMoney(stream.amount, stream.direction)
      runningBalances[stream.accountId] = (runningBalances[stream.accountId] ?? 0) + signedAmount
      principalBalances[stream.accountId] = (principalBalances[stream.accountId] ?? 0) + signedAmount
      dayEvents.push({
        id: stream.id,
        accountId: stream.accountId,
        label: stream.name,
        amount: signedAmount,
        kind: stream.direction,
      })
    }

    for (const checkpoint of checkpointMap.get(dateKey) ?? []) {
      const projectedBeforeCheckpoint = runningBalances[checkpoint.accountId] ?? 0
      const variance = checkpoint.actualBalance - projectedBeforeCheckpoint
      const hasPriorCheckpoint = seenCheckpointByAccount[checkpoint.accountId]
      runningBalances[checkpoint.accountId] = checkpoint.actualBalance
      principalBalances[checkpoint.accountId] = checkpoint.actualBalance
      dayEvents.push({
        id: checkpoint.id,
        accountId: checkpoint.accountId,
        label: 'Checkpoint',
        amount: variance,
        kind: 'checkpoint',
        note: checkpoint.note,
      })

      if (hasPriorCheckpoint && Math.abs(variance) >= checkpointVarianceThreshold) {
        checkpointAlerts.push(`${checkpoint.accountId}:${variance}`)
        const accountName = accounts.find((account) => account.id === checkpoint.accountId)?.name ?? checkpoint.accountId
        checkpointDriftAlerts.push({
          date: dateKey,
          accountId: checkpoint.accountId,
          accountName,
          variance,
          checkpoint,
        })
      }

      seenCheckpointByAccount[checkpoint.accountId] = true
    }

    for (const account of accounts) {
      if (!occursOnInterestDate(account, currentDate) || !account.interest) {
        continue
      }

      const interestBase = account.interest.compounding === 'compound'
        ? (runningBalances[account.id] ?? 0)
        : (principalBalances[account.id] ?? 0)
      const interestAmount = interestBase * (account.interest.rate / 100)

      if (!interestAmount) {
        continue
      }

      runningBalances[account.id] = (runningBalances[account.id] ?? 0) + interestAmount
      if (account.interest.compounding === 'compound') {
        principalBalances[account.id] = (principalBalances[account.id] ?? 0) + interestAmount
      }

      dayEvents.push({
        id: `interest-${account.id}-${dateKey}`,
        accountId: account.id,
        label: 'Interest',
        amount: interestAmount,
        kind: 'interest',
      })
    }

    const accountSnapshots: Record<string, AccountSnapshot> = {}
    let totalBalance = 0
    let totalDelta = 0

    for (const account of accounts) {
      const balance = runningBalances[account.id] ?? 0
      const previousDay = offset === 0 ? account.openingBalance : days[toDateKey(addDays(currentDate, -1))]?.accounts[account.id]?.balance ?? account.openingBalance
      const delta = balance - previousDay
      accountSnapshots[account.id] = {
        balance,
        delta,
        events: dayEvents,
      }
      totalBalance += balance
      totalDelta += delta

      if (balance < 0 && !firstDeficitDateByAccount[account.id]) {
        firstDeficitDateByAccount[account.id] = dateKey
      }
    }

    if (totalBalance < 0 && !firstDeficitDate) {
      firstDeficitDate = dateKey
    }

    days[dateKey] = {
      date: dateKey,
      accounts: accountSnapshots,
      totalBalance,
      totalDelta,
      events: dayEvents,
      checkpointAlerts,
    }
    dateKeys.push(dateKey)
  }

  // Backfill only from the first reconciliation for each account.
  // Later reconciliations naturally apply forward until the next reconciliation.
  // Reverse propagation uses a one-day offset: a day's events apply to the
  // previous day when inferring history.
  for (const account of accounts) {
    const firstReconciliationIndex = dateKeys.findIndex((dateKey) => (
      days[dateKey].events.some((event) => event.accountId === account.id && event.kind === 'checkpoint')
    ))

    if (firstReconciliationIndex <= 0) {
      continue
    }

    for (let index = firstReconciliationIndex - 1; index >= 0; index -= 1) {
      const nextDateKey = dateKeys[index + 1]
      const currentDateKey = dateKeys[index]
      const nextBalance = days[nextDateKey].accounts[account.id].balance
      const nextDayNetFlow = days[nextDateKey].events
        .filter((event) => event.accountId === account.id && event.kind !== 'checkpoint')
        .reduce((sum, event) => sum + event.amount, 0)

      days[currentDateKey].accounts[account.id] = {
        ...days[currentDateKey].accounts[account.id],
        balance: nextBalance - nextDayNetFlow,
      }
    }
  }

  // Recalculate day-over-day deltas after backfilling balances.
  for (const account of accounts) {
    for (let index = 0; index < dateKeys.length; index += 1) {
      const dateKey = dateKeys[index]
      const previousBalance = index === 0
        ? days[dateKey].accounts[account.id].balance
        : days[dateKeys[index - 1]].accounts[account.id].balance

      days[dateKey].accounts[account.id] = {
        ...days[dateKey].accounts[account.id],
        delta: index === 0 ? 0 : days[dateKey].accounts[account.id].balance - previousBalance,
      }
    }
  }

  firstDeficitDate = undefined
  for (const account of accounts) {
    firstDeficitDateByAccount[account.id] = undefined
  }

  for (const dateKey of dateKeys) {
    const day = days[dateKey]
    let totalBalance = 0
    let totalDelta = 0

    for (const account of accounts) {
      const snapshot = day.accounts[account.id]
      totalBalance += snapshot.balance
      totalDelta += snapshot.delta

      if (snapshot.balance < 0 && !firstDeficitDateByAccount[account.id]) {
        firstDeficitDateByAccount[account.id] = dateKey
      }
    }

    day.totalBalance = totalBalance
    day.totalDelta = totalDelta

    if (totalBalance < 0 && !firstDeficitDate) {
      firstDeficitDate = dateKey
    }
  }

  return {
    days,
    firstDeficitDateByAccount,
    firstDeficitDate,
    checkpointDriftAlerts,
  }
}

export function weekdayToggleLabel(index: number) {
  return weekdayLongName(index).slice(0, 3)
}