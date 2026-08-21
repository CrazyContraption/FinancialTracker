import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import './App.css'
import {
  addDays,
  buildProjection,
  compareDateKeys,
  formatCompactDate,
  formatShortDate,
  fromDateKey,
  occursOnDate,
  ordinalLabel,
  startOfDay,
  toDateKey,
  weekdayNames,
} from './finance'
import type {
  Account,
  Checkpoint,
  MoneyStream,
  StreamKind,
} from './finance'

type ModalTab = 'day' | 'transaction' | 'reconcile'
type EditScope = 'future' | 'all'
type DeleteScope = 'one' | 'series' | 'future'

type PendingDelete = {
  item: UpcomingItem
}

type StreamDraft = {
  accountId: string
  transferAccountId: string
  name: string
  amount: string
  direction: 'income' | 'expense' | 'transfer'
  startDate: string
  endDate: string
  kind: StreamKind
  everyDays: string
  everyWeeks: string
  everyMonths: string
  everyYears: string
  weekdays: number[]
  monthlyMode: 'date' | 'weekday'
  yearlyMode: 'date' | 'weekday'
  dayOfMonth: string
  ordinal: number
  weekday: number
  months: number[]
}

type ReconcileDraft = {
  accountId: string
  date: string
  actualBalance: string
  note: string
}

type AccountDraft = {
  name: string
  color: string
  type: 'standard' | 'interest-bearing'
  openingBalance: string
  openingDate: string
  interestRate: string
  interestEvery: string
  interestInterval: 'daily' | 'monthly' | 'yearly'
  interestCompounding: 'simple' | 'compound'
  interestStartDate: string
}

type PlannerSnapshot = {
  version: 2
  savedAt: string
  accounts: Account[]
  streams: MoneyStream[]
  checkpoints: Checkpoint[]
}

type UpcomingItem = {
  date: string
  id: string
  accountId: string
  label: string
  amount: number
  kind: 'income' | 'expense' | 'transfer' | 'interest' | 'checkpoint'
  sourceType: 'stream' | 'checkpoint' | 'interest'
  sourceId?: string
}

const STORAGE_KEY = 'finance-planner-v2'
const LEGACY_STORAGE_KEY = 'finance-planner-v1'
const SELECTED_ACCOUNT_KEY = 'finance-planner-selected-account'
const LAST_ACTIVE_ACCOUNT_KEY = 'finance-planner-last-active-account'
const weekdayLabels = weekdayNames()
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const today = startOfDay(new Date())
const todayKey = toDateKey(today)
const currentMonthKey = toDateKey(new Date(today.getFullYear(), today.getMonth(), 1))

const recurrenceOptions: Array<{ value: StreamKind; label: string }> = [
  { value: 'one-time', label: 'One-time' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

function addThousandsSeparators(value: string) {
  const normalized = value.replace(/^0+(?=\d)/, '') || '0'
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatMoneyInput(raw: string, allowNegative: boolean) {
  const trimmed = raw.trim()
  if (!trimmed) {
    return ''
  }

  const compact = trimmed.replace(/,/g, '')
  const hasNegativeSign = allowNegative && compact.startsWith('-')
  const unsigned = compact.replace(/-/g, '')
  const hasDot = unsigned.includes('.')
  const [wholeRaw, ...fractionParts] = unsigned.split('.')
  const wholeDigits = wholeRaw.replace(/\D/g, '')
  const fractionDigits = fractionParts.join('').replace(/\D/g, '').slice(0, 2)

  if (!wholeDigits && !fractionDigits && !hasDot) {
    return hasNegativeSign ? '-' : ''
  }

  let output = addThousandsSeparators(wholeDigits || '0')
  if (hasDot) {
    output += `.${fractionDigits}`
  }

  return hasNegativeSign ? `-${output}` : output
}

function parseMoneyInput(value: string) {
  const numeric = Number(value.replace(/,/g, ''))
  return Number.isFinite(numeric) ? numeric : 0
}

function countMoneyUnitsBeforeCursor(value: string, cursor: number, allowNegative: boolean) {
  let count = 0
  for (let index = 0; index < Math.min(cursor, value.length); index += 1) {
    const char = value[index]
    if (/\d/.test(char) || char === '.') {
      count += 1
      continue
    }

    if (allowNegative && char === '-' && count === 0) {
      count += 1
    }
  }
  return count
}

function resolveCursorFromMoneyUnits(value: string, units: number, allowNegative: boolean) {
  if (units <= 0) {
    return 0
  }

  let count = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (/\d/.test(char) || char === '.') {
      count += 1
    } else if (allowNegative && char === '-' && count === 0) {
      count += 1
    } else {
      continue
    }

    if (count >= units) {
      return index + 1
    }
  }

  return value.length
}

function formatCashParts(amount: number) {
  const negative = amount < 0
  const totalCents = Math.round(Math.abs(amount) * 100)
  const whole = Math.floor(totalCents / 100)
  const cents = totalCents % 100
  return {
    sign: negative ? '-' : '',
    whole: new Intl.NumberFormat('en-US').format(whole),
    cents: String(cents).padStart(2, '0'),
  }
}

function formatMobileBalance(amount: number) {
  const sign = amount < 0 ? '-' : ''
  const absoluteAmount = Math.abs(amount)
  let value = Math.round(absoluteAmount).toLocaleString('en-US')
  if (absoluteAmount >= 1_000_000_000) {
    value = `${(absoluteAmount / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
  } else if (absoluteAmount >= 1_000_000) {
    value = `${(absoluteAmount / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  } else if (absoluteAmount >= 1_000) {
    value = `${(absoluteAmount / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  }

  return { sign, value }
}

function MobileBalance({ amount }: { amount: number }) {
  const balanceRef = useRef<HTMLSpanElement>(null)
  const formatted = formatMobileBalance(amount)

  useEffect(() => {
    const balanceElement = balanceRef.current
    if (!balanceElement) {
      return
    }

    const resizeBalance = () => {
      balanceElement.style.fontSize = '0.76rem'
      const availableWidth = balanceElement.parentElement?.clientWidth ?? 0
      const requiredWidth = balanceElement.scrollWidth
      if (availableWidth > 0 && requiredWidth > availableWidth) {
        const fittedSize = Math.max(0.35, 0.76 * (availableWidth / requiredWidth))
        balanceElement.style.fontSize = `${fittedSize}rem`
      }
    }

    resizeBalance()
    const observer = new ResizeObserver(resizeBalance)
    observer.observe(balanceElement.parentElement ?? balanceElement)
    window.addEventListener('resize', resizeBalance)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', resizeBalance)
    }
  }, [amount])

  return (
    <span ref={balanceRef} className="mobile-balance">
      <span className="mobile-money-sign">{formatted.sign}</span>
      <span className="mobile-currency">$</span>
      {formatted.value}
    </span>
  )
}

function ordinalSuffix(value: number) {
  if (value % 100 >= 11 && value % 100 <= 13) {
    return 'th'
  }

  switch (value % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

function formatDayOfMonthRule(value: number) {
  if (value === -1) {
    return 'last'
  }

  if (value < -1) {
    const fromLast = Math.abs(value)
    return `${fromLast}${ordinalSuffix(fromLast)} last`
  }

  return String(value)
}

function parseDayOfMonthRule(input: string, fallback: number) {
  const normalized = input.trim().toLowerCase()
  if (!normalized) {
    return fallback
  }

  if (normalized === 'last') {
    return -1
  }

  const nthLastMatch = normalized.match(/^(\d+)(st|nd|rd|th)?\s*last(?:\s*day)?s?$/)
  if (nthLastMatch) {
    const value = Number(nthLastMatch[1])
    return value > 0 ? -value : fallback
  }

  const numeric = Number(normalized)
  if (Number.isFinite(numeric)) {
    if (numeric < 0) {
      return -Math.max(1, Math.floor(Math.abs(numeric)))
    }

    return Math.max(1, Math.min(31, Math.floor(numeric)))
  }

  return fallback
}

function sourceStreamIdFromEvent(eventId: string, kind: UpcomingItem['kind']) {
  if (kind === 'transfer') {
    if (eventId.endsWith('-out')) {
      return eventId.slice(0, -4)
    }
    if (eventId.endsWith('-in')) {
      return eventId.slice(0, -3)
    }
  }
  return eventId
}

function signedStreamAmountForView(stream: MoneyStream, accountView: 'all' | string) {
  if (stream.direction === 'income') {
    return stream.amount
  }

  if (stream.direction === 'expense') {
    return -stream.amount
  }

  if (accountView === 'all') {
    return null
  }

  if (stream.accountId === accountView) {
    return -stream.amount
  }

  if (stream.transferAccountId === accountView) {
    return stream.amount
  }

  return null
}

function recurrenceSummary(stream: MoneyStream) {
  switch (stream.recurrence.kind) {
    case 'one-time':
      return 'One-time'
    case 'daily':
      return `Every ${stream.recurrence.everyDays} day${stream.recurrence.everyDays === 1 ? '' : 's'}`
    case 'weekly':
      return `Every ${stream.recurrence.everyWeeks} week${stream.recurrence.everyWeeks === 1 ? '' : 's'}`
    case 'monthly-date':
      return `Every ${stream.recurrence.everyMonths} month${stream.recurrence.everyMonths === 1 ? '' : 's'}`
    case 'monthly-ordinal':
      return `Every ${stream.recurrence.everyMonths} month${stream.recurrence.everyMonths === 1 ? '' : 's'}`
    case 'yearly':
      return `Every ${stream.recurrence.everyYears} year${stream.recurrence.everyYears === 1 ? '' : 's'}`
    default:
      return 'Recurring'
  }
}

function CashAmount({ amount, className }: { amount: number; className?: string }) {
  const { sign, whole, cents } = formatCashParts(amount)
  return (
    <span className={className ? `cash-amount ${className}` : 'cash-amount'}>
      {sign}${whole}<sup className="cash-cents">{cents}</sup>
    </span>
  )
}

function streamDraftFromStream(stream: MoneyStream): StreamDraft {
  const base: StreamDraft = {
    accountId: stream.accountId,
    transferAccountId: stream.transferAccountId ?? '',
    name: stream.name,
    amount: formatMoneyInput(Math.abs(stream.amount).toFixed(2), false),
    direction: stream.direction,
    startDate: stream.startDate,
    endDate: stream.endDate ?? '',
    kind: 'one-time',
    everyDays: '1',
    everyWeeks: '1',
    everyMonths: '1',
    everyYears: '1',
    weekdays: [],
    monthlyMode: 'date',
    yearlyMode: 'date',
    dayOfMonth: String(fromDateKey(stream.startDate).getDate()),
    ordinal: 1,
    weekday: fromDateKey(stream.startDate).getDay(),
    months: [fromDateKey(stream.startDate).getMonth()],
  }

  switch (stream.recurrence.kind) {
    case 'one-time':
      return base
    case 'daily':
      return {
        ...base,
        kind: 'daily',
        everyDays: String(stream.recurrence.everyDays),
        weekdays: [...stream.recurrence.weekdays],
      }
    case 'weekly':
      return {
        ...base,
        kind: 'weekly',
        everyWeeks: String(stream.recurrence.everyWeeks),
        weekdays: [...stream.recurrence.weekdays],
      }
    case 'monthly-date':
      return {
        ...base,
        kind: 'monthly',
        monthlyMode: 'date',
        everyMonths: String(stream.recurrence.everyMonths),
        dayOfMonth: formatDayOfMonthRule(stream.recurrence.dayOfMonth),
      }
    case 'monthly-ordinal':
      return {
        ...base,
        kind: 'monthly',
        monthlyMode: 'weekday',
        everyMonths: String(stream.recurrence.everyMonths),
        ordinal: stream.recurrence.ordinal,
        weekday: stream.recurrence.weekday,
      }
    case 'yearly':
      if (stream.recurrence.mode === 'weekday') {
        return {
          ...base,
          kind: 'yearly',
          yearlyMode: 'weekday',
          everyYears: String(stream.recurrence.everyYears),
          months: [...stream.recurrence.months],
          ordinal: stream.recurrence.ordinal,
          weekday: stream.recurrence.weekday,
        }
      }

      return {
        ...base,
        kind: 'yearly',
        yearlyMode: 'date',
        everyYears: String(stream.recurrence.everyYears),
        months: [...stream.recurrence.months],
        dayOfMonth: formatDayOfMonthRule(stream.recurrence.dayOfMonth),
      }
    default:
      return base
  }
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function monthLabel(dateKey: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(fromDateKey(dateKey))
}

function monthKey(date: Date) {
  return toDateKey(new Date(date.getFullYear(), date.getMonth(), 1))
}

function buildMonthGrid(cursorKey: string) {
  const cursor = fromDateKey(cursorKey)
  const firstVisible = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const startOffset = firstVisible.getDay()
  const gridStart = new Date(firstVisible.getFullYear(), firstVisible.getMonth(), 1 - startOffset)
  return Array.from({ length: 42 }, (_, index) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index))
}

function createInitialAccount(): Account {
  return {
    id: 'account-primary',
    name: 'Primary account',
    openingBalance: 0,
    color: '#0f766e',
    type: 'standard',
  }
}

function isLegacySeededSnapshot(accounts: Account[], streams: MoneyStream[], checkpoints: Checkpoint[]) {
  const hasSeededAccounts = accounts.some((account) => account.id === 'checking') || accounts.some((account) => account.id === 'savings')
  const hasSeededStreams = streams.some((stream) => stream.id === 'paycheck') || streams.some((stream) => stream.id === 'rent')
  const hasSeededCheckpoint = checkpoints.some((checkpoint) => checkpoint.id === 'checkpoint-initial')
  return hasSeededAccounts || hasSeededStreams || hasSeededCheckpoint
}

function normalizeAccounts(accounts: Account[]) {
  if (!accounts.length) {
    return [createInitialAccount()]
  }

  return accounts.map((account): Account => {
    const accountType: Account['type'] = account.type === 'interest-bearing' || account.interest?.enabled ? 'interest-bearing' : 'standard'
    return {
      ...account,
      openingBalance: 0,
      color: account.color || '#0f766e',
      name: account.name || 'Untitled account',
      type: accountType,
      interest: accountType === 'interest-bearing'
        ? {
            enabled: true,
            rate: account.interest?.rate ?? 1,
            every: account.interest?.every ?? 1,
            interval: account.interest?.interval ?? 'monthly',
            compounding: account.interest?.compounding ?? 'compound',
            startDate: account.interest?.startDate ?? todayKey,
          }
        : undefined,
    }
  })
}

function parseSnapshot(raw: string | null): PlannerSnapshot | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PlannerSnapshot>
    if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.streams) || !Array.isArray(parsed.checkpoints)) {
      return null
    }

    if (isLegacySeededSnapshot(parsed.accounts, parsed.streams, parsed.checkpoints)) {
      return null
    }

    return {
      version: 2,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
      accounts: normalizeAccounts(parsed.accounts),
      streams: parsed.streams,
      checkpoints: parsed.checkpoints,
    }
  } catch {
    return null
  }
}

function readSnapshot(): PlannerSnapshot {
  const modern = parseSnapshot(localStorage.getItem(STORAGE_KEY))
  if (modern) {
    return modern
  }

  const legacy = parseSnapshot(localStorage.getItem(LEGACY_STORAGE_KEY))
  if (legacy) {
    return legacy
  }

  return {
    version: 2,
    savedAt: new Date().toISOString(),
    accounts: [createInitialAccount()],
    streams: [],
    checkpoints: [],
  }
}

function recurrenceFromDraft(draft: StreamDraft): MoneyStream['recurrence'] {
  switch (draft.kind) {
    case 'one-time':
      return { kind: 'one-time' }
    case 'daily':
      return {
        kind: 'daily',
        everyDays: Math.max(1, Number(draft.everyDays) || 1),
        weekdays: draft.weekdays,
      }
    case 'weekly':
      return {
        kind: 'weekly',
        everyWeeks: Math.max(1, Number(draft.everyWeeks) || 1),
        weekdays: draft.weekdays.length ? draft.weekdays : [0, 1, 2, 3, 4, 5, 6],
      }
    case 'monthly':
      if (draft.monthlyMode === 'weekday') {
        return {
          kind: 'monthly-ordinal',
          everyMonths: Math.max(1, Number(draft.everyMonths) || 1),
          ordinal: draft.ordinal,
          weekday: draft.weekday,
        }
      }
      return {
        kind: 'monthly-date',
        everyMonths: Math.max(1, Number(draft.everyMonths) || 1),
        dayOfMonth: parseDayOfMonthRule(draft.dayOfMonth, fromDateKey(draft.startDate).getDate()),
      }
    case 'yearly': {
      const everyYears = Math.max(1, Number(draft.everyYears) || 1)
      const months = draft.months.length ? [...draft.months].sort((a, b) => a - b) : [fromDateKey(draft.startDate).getMonth()]
      if (draft.yearlyMode === 'weekday') {
        return {
          kind: 'yearly',
          everyYears,
          months,
          mode: 'weekday',
          ordinal: draft.ordinal,
          weekday: draft.weekday,
        }
      }
      return {
        kind: 'yearly',
        everyYears,
        months,
        mode: 'date',
        dayOfMonth: parseDayOfMonthRule(draft.dayOfMonth, fromDateKey(draft.startDate).getDate()),
      }
    }
    default:
      return { kind: 'one-time' }
  }
}

function App() {
  const snapshot = useMemo(() => readSnapshot(), [])
  const initialSelectedAccount = useMemo<'all' | string>(() => {
    const savedSelected = localStorage.getItem(SELECTED_ACCOUNT_KEY)
    if (savedSelected === 'all') {
      return 'all'
    }

    if (savedSelected && snapshot.accounts.some((account) => account.id === savedSelected)) {
      return savedSelected
    }

    const savedLastActive = localStorage.getItem(LAST_ACTIVE_ACCOUNT_KEY)
    if (savedLastActive && snapshot.accounts.some((account) => account.id === savedLastActive)) {
      return savedLastActive
    }

    return snapshot.accounts[0]?.id ?? 'all'
  }, [snapshot.accounts])
  const [accounts, setAccounts] = useState<Account[]>(snapshot.accounts)
  const [streams, setStreams] = useState<MoneyStream[]>(snapshot.streams)
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(snapshot.checkpoints)
  const [monthCursor, setMonthCursor] = useState(currentMonthKey)
  const [selectedAccountId, setSelectedAccountId] = useState<'all' | string>(initialSelectedAccount)
  const [lastActiveAccountId, setLastActiveAccountId] = useState<string>(() => {
    const saved = localStorage.getItem(LAST_ACTIVE_ACCOUNT_KEY)
    if (saved && snapshot.accounts.some((account) => account.id === saved)) {
      return saved
    }

    return snapshot.accounts[0]?.id ?? ''
  })
  const [driftThresholdInput, setDriftThresholdInput] = useState('1,000.00')
  const [modalDate, setModalDate] = useState<string | null>(null)
  const [showAllUpcoming, setShowAllUpcoming] = useState(false)
  const [modalTab, setModalTab] = useState<ModalTab>('day')
  const [accountsModalOpen, setAccountsModalOpen] = useState(false)
  const [editingStreamId, setEditingStreamId] = useState<string | null>(null)
  const [streamEditScope, setStreamEditScope] = useState<EditScope>('future')
  const [editingCheckpointId, setEditingCheckpointId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const [streamDraft, setStreamDraft] = useState<StreamDraft>({
    accountId: snapshot.accounts[0]?.id ?? '',
    transferAccountId: snapshot.accounts[1]?.id ?? snapshot.accounts[0]?.id ?? '',
    name: '',
    amount: '0.00',
    direction: 'expense',
    startDate: todayKey,
    endDate: '',
    kind: 'monthly',
    everyDays: '1',
    everyWeeks: '1',
    everyMonths: '1',
    everyYears: '1',
    weekdays: [],
    monthlyMode: 'date',
    yearlyMode: 'date',
    dayOfMonth: '1',
    ordinal: 1,
    weekday: 1,
    months: [today.getMonth()],
  })

  const [reconcileDraft, setReconcileDraft] = useState<ReconcileDraft>({
    accountId: snapshot.accounts[0]?.id ?? '',
    date: todayKey,
    actualBalance: '0.00',
    note: '',
  })

  const [accountDraft, setAccountDraft] = useState<AccountDraft>({
    name: '',
    color: '#0f766e',
    type: 'standard',
    openingBalance: '0.00',
    openingDate: todayKey,
    interestRate: '1',
    interestEvery: '1',
    interestInterval: 'monthly',
    interestCompounding: 'compound',
    interestStartDate: todayKey,
  })

  const importInputRef = useRef<HTMLInputElement>(null)
  const driftThreshold = parseMoneyInput(driftThresholdInput)

  function handleMoneyInputChange(
    event: ChangeEvent<HTMLInputElement>,
    allowNegative: boolean,
    applyValue: (value: string) => void,
  ) {
    const input = event.currentTarget
    const raw = input.value
    const cursor = input.selectionStart ?? raw.length
    const unitsBeforeCursor = countMoneyUnitsBeforeCursor(raw, cursor, allowNegative)
    const formatted = formatMoneyInput(raw, allowNegative)
    const nextCursor = resolveCursorFromMoneyUnits(formatted, unitsBeforeCursor, allowNegative)

    applyValue(formatted)

    requestAnimationFrame(() => {
      if (document.activeElement === input) {
        input.setSelectionRange(nextCursor, nextCursor)
      }
    })
  }

  useEffect(() => {
    const save: PlannerSnapshot = {
      version: 2,
      savedAt: new Date().toISOString(),
      accounts,
      streams,
      checkpoints,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save))
  }, [accounts, checkpoints, streams])

  useEffect(() => {
    localStorage.setItem(SELECTED_ACCOUNT_KEY, selectedAccountId)
    if (selectedAccountId !== 'all') {
      localStorage.setItem(LAST_ACTIVE_ACCOUNT_KEY, selectedAccountId)
      setLastActiveAccountId(selectedAccountId)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (!accounts.length) {
      return
    }

    if (!accounts.some((account) => account.id === streamDraft.accountId)) {
      setStreamDraft((current) => ({ ...current, accountId: accounts[0].id }))
    }

    if (streamDraft.transferAccountId && !accounts.some((account) => account.id === streamDraft.transferAccountId)) {
      const fallback = accounts.find((account) => account.id !== streamDraft.accountId)?.id ?? accounts[0].id
      setStreamDraft((current) => ({ ...current, transferAccountId: fallback }))
    }

    if (!accounts.some((account) => account.id === reconcileDraft.accountId)) {
      setReconcileDraft((current) => ({ ...current, accountId: accounts[0].id }))
    }

    if (selectedAccountId !== 'all' && !accounts.some((account) => account.id === selectedAccountId)) {
      setSelectedAccountId('all')
    }
  }, [accounts, reconcileDraft.accountId, selectedAccountId, streamDraft.accountId])

  useEffect(() => {
    if (selectedAccountId === 'all') {
      return
    }

    setStreamDraft((current) => {
      if (current.accountId === selectedAccountId) {
        return current
      }

      const fallbackTransfer = current.transferAccountId === selectedAccountId
        ? (accounts.find((account) => account.id !== selectedAccountId)?.id ?? current.transferAccountId)
        : current.transferAccountId

      return {
        ...current,
        accountId: selectedAccountId,
        transferAccountId: fallbackTransfer,
      }
    })

    setReconcileDraft((current) => {
      if (current.accountId === selectedAccountId) {
        return current
      }
      return {
        ...current,
        accountId: selectedAccountId,
      }
    })
  }, [accounts, selectedAccountId])

  const projection = useMemo(() => {
    const start = fromDateKey(currentMonthKey)
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 720)
    return buildProjection(accounts, streams, checkpoints, start, end, driftThreshold)
  }, [accounts, checkpoints, driftThreshold, streams])

  const visibleDays = useMemo(() => buildMonthGrid(monthCursor), [monthCursor])
  const selectedDayProjection = modalDate ? projection.days[modalDate] : undefined
  const preferredAccountId = selectedAccountId === 'all'
    ? (accounts.find((account) => account.id === lastActiveAccountId)?.id ?? accounts[0]?.id ?? '')
    : selectedAccountId
  const selectedDayStreams = useMemo(() => {
    if (!modalDate) {
      return []
    }

    return streams.filter((stream) => {
      if (!occursOnDate(stream, fromDateKey(modalDate))) {
        return false
      }

      return selectedAccountId === 'all'
        ? true
        : stream.accountId === selectedAccountId || stream.transferAccountId === selectedAccountId
    })
  }, [modalDate, selectedAccountId, streams])
  const selectedDayCheckpoints = useMemo(() => {
    if (!modalDate) {
      return []
    }

    return checkpoints.filter((checkpoint) => checkpoint.date === modalDate && (selectedAccountId === 'all' || checkpoint.accountId === selectedAccountId))
  }, [checkpoints, modalDate, selectedAccountId])
  const selectedDayNetFlow = useMemo(() => {
    if (!selectedDayProjection) {
      return 0
    }

    const events = selectedAccountId === 'all'
      ? selectedDayProjection.events
      : selectedDayProjection.events.filter((event) => event.accountId === selectedAccountId)

    return events.reduce((sum, event) => sum + event.amount, 0)
  }, [selectedAccountId, selectedDayProjection])
  const monthlyOverview = useMemo(() => {
    const monthStart = fromDateKey(monthCursor)
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0)
    const monthKeys: string[] = []

    let cursor = monthStart
    while (cursor <= monthEnd) {
      monthKeys.push(toDateKey(cursor))
      cursor = addDays(cursor, 1)
    }

    const monthDays = monthKeys
      .map((key) => projection.days[key])
      .filter((day): day is NonNullable<typeof projection.days[string]> => Boolean(day))

    if (!monthDays.length) {
      return {
        hasData: false,
        net: 0,
        startBalance: 0,
        endBalance: 0,
        averageDailyFlow: 0,
        momentumRate: 0,
      }
    }

    const dailyDeltas = monthDays.map((day) => (
      selectedAccountId === 'all'
        ? day.totalDelta
        : (day.accounts[selectedAccountId]?.delta ?? 0)
    ))

    const balances = monthDays.map((day) => (
      selectedAccountId === 'all'
        ? day.totalBalance
        : (day.accounts[selectedAccountId]?.balance ?? 0)
    ))

    const net = dailyDeltas.reduce((sum, value) => sum + value, 0)
    const startBalance = balances[0] ?? 0
    const endBalance = balances[balances.length - 1] ?? 0
    const averageDailyFlow = net / monthDays.length
    const firstHalfLength = Math.ceil(dailyDeltas.length / 2)
    const secondHalfLength = Math.max(1, dailyDeltas.length - firstHalfLength)
    const firstHalfTotal = dailyDeltas.slice(0, firstHalfLength).reduce((sum, value) => sum + value, 0)
    const secondHalfTotal = dailyDeltas.slice(firstHalfLength).reduce((sum, value) => sum + value, 0)
    const firstHalfRate = firstHalfTotal / firstHalfLength
    const secondHalfRate = secondHalfTotal / secondHalfLength
    const momentumRate = secondHalfRate - firstHalfRate

    return {
      hasData: true,
      net,
      startBalance,
      endBalance,
      averageDailyFlow,
      momentumRate,
    }
  }, [monthCursor, projection.days, selectedAccountId])

  const deficitDate = selectedAccountId === 'all'
    ? projection.firstDeficitDate
    : projection.firstDeficitDateByAccount[selectedAccountId]

  const checkpointWarnings = projection.checkpointDriftAlerts.filter((alert) => (
    Math.abs(alert.variance) >= driftThreshold
    && (selectedAccountId === 'all' || alert.accountId === selectedAccountId)
  ))
  const mainUpcomingItems = useMemo(() => {
    return Object.values(projection.days)
      .filter((day) => compareDateKeys(day.date, todayKey) >= 0)
      .flatMap((day) => day.events
        .filter((event) => selectedAccountId === 'all' || event.accountId === selectedAccountId)
        .map((event) => ({
          ...event,
          date: day.date,
          sourceType: event.kind === 'checkpoint'
            ? 'checkpoint'
            : event.kind === 'interest'
              ? 'interest'
              : 'stream',
          sourceId: event.kind === 'checkpoint'
            ? event.id
            : event.kind === 'interest'
              ? undefined
              : sourceStreamIdFromEvent(event.id, event.kind),
        })))
  }, [projection.days, selectedAccountId]) as UpcomingItem[]
  const visibleUpcomingItems = mainUpcomingItems.slice(0, showAllUpcoming ? 30 : 10)

  useEffect(() => {
    setShowAllUpcoming(false)
  }, [mainUpcomingItems])

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cashFlowDates = useMemo(() => Object.values(projection.days)
    .filter((day) => day.events.some((event) => event.kind !== 'interest'))
    .map((day) => day.date)
    .filter((date, index, dates) => dates[index - 1] !== date), [projection.days])

  function moveModalDay(direction: -1 | 1) {
    if (!modalDate) {
      return
    }

    const currentIndex = cashFlowDates.indexOf(modalDate)
    const nextDate = cashFlowDates[currentIndex + direction]
    if (nextDate) {
      openDayModal(nextDate)
    }
  }

  function openDayModal(dateKey: string, tab: ModalTab = 'day') {
    setModalDate(dateKey)
    setModalTab(tab)
    setEditingStreamId(null)
    setEditingCheckpointId(null)
    setStreamEditScope('future')
    setStreamDraft((current) => ({
      ...current,
      accountId: preferredAccountId || current.accountId,
      startDate: dateKey,
      dayOfMonth: String(fromDateKey(dateKey).getDate()),
      transferAccountId: current.transferAccountId || accounts.find((account) => account.id !== (preferredAccountId || current.accountId))?.id || (preferredAccountId || current.accountId),
    }))
    setReconcileDraft((current) => ({
      ...current,
      accountId: preferredAccountId || current.accountId,
      date: dateKey,
    }))
  }

  function closeModal() {
    setModalDate(null)
    setEditingStreamId(null)
    setEditingCheckpointId(null)
  }

  function addTransaction() {
    if (!streamDraft.accountId || !streamDraft.name.trim()) {
      return
    }

    if (streamDraft.direction === 'transfer' && (!streamDraft.transferAccountId || streamDraft.transferAccountId === streamDraft.accountId)) {
      return
    }

    const payload: MoneyStream = {
      id: editingStreamId ?? createId('stream'),
      accountId: streamDraft.accountId,
      transferAccountId: streamDraft.direction === 'transfer' ? streamDraft.transferAccountId : undefined,
      name: streamDraft.name.trim(),
      amount: Math.abs(parseMoneyInput(streamDraft.amount)),
      direction: streamDraft.direction,
      startDate: streamDraft.startDate,
      endDate: streamDraft.endDate || undefined,
      recurrence: recurrenceFromDraft(streamDraft),
    }

    if (editingStreamId) {
      const original = streams.find((item) => item.id === editingStreamId)
      if (original) {
        if (streamEditScope === 'all' || original.recurrence.kind === 'one-time') {
          setStreams((current) => current.map((item) => (item.id === editingStreamId ? {
            ...payload,
            excludedDates: original.excludedDates,
          } : item)))
        } else {
          const effectiveFrom = modalDate ?? streamDraft.startDate
          if (compareDateKeys(effectiveFrom, original.startDate) <= 0) {
            setStreams((current) => current.map((item) => (item.id === editingStreamId ? {
              ...payload,
              excludedDates: original.excludedDates,
            } : item)))
          } else {
            const previousEnd = toDateKey(addDays(fromDateKey(effectiveFrom), -1))
            setStreams((current) => {
              const withoutOriginal = current.filter((item) => item.id !== editingStreamId)
              const truncatedOriginal: MoneyStream | null = compareDateKeys(previousEnd, original.startDate) >= 0
                ? {
                    ...original,
                    endDate: original.endDate && compareDateKeys(original.endDate, previousEnd) < 0 ? original.endDate : previousEnd,
                  }
                : null

              return [
                ...withoutOriginal,
                ...(truncatedOriginal ? [truncatedOriginal] : []),
                {
                  ...payload,
                  id: createId('stream'),
                  startDate: effectiveFrom,
                  excludedDates: original.excludedDates?.filter((excludedDate) => compareDateKeys(excludedDate, effectiveFrom) >= 0),
                },
              ]
            })
          }
        }
      }
    } else {
      setStreams((current) => [...current, payload])
    }

    setEditingStreamId(null)
    setStreamDraft((current) => ({
      ...current,
      name: '',
      amount: '0.00',
      endDate: '',
      direction: 'expense',
    }))
    setModalTab('day')
  }

  function addReconciliation() {
    if (!reconcileDraft.accountId) {
      return
    }

    const next: Checkpoint = {
      id: editingCheckpointId ?? createId('checkpoint'),
      accountId: reconcileDraft.accountId,
      date: reconcileDraft.date,
      actualBalance: parseMoneyInput(reconcileDraft.actualBalance),
      note: reconcileDraft.note.trim() || undefined,
    }

    if (editingCheckpointId) {
      setCheckpoints((current) => current.map((item) => (item.id === editingCheckpointId ? next : item)))
    } else {
      setCheckpoints((current) => [...current, next])
    }

    setEditingCheckpointId(null)
    setReconcileDraft((current) => ({
      ...current,
      actualBalance: '0.00',
      note: '',
    }))
    setModalTab('day')
  }

  function addAccount() {
    if (!accountDraft.name.trim()) {
      return
    }

    const openingAmount = parseMoneyInput(accountDraft.openingBalance)
    const openingDate = accountDraft.openingDate || todayKey

    const nextAccount: Account = {
      id: createId('account'),
      name: accountDraft.name.trim(),
      color: accountDraft.color,
      openingBalance: 0,
      type: accountDraft.type,
      interest: accountDraft.type === 'interest-bearing'
        ? {
            enabled: true,
            rate: Number(accountDraft.interestRate) || 0,
            every: Math.max(1, Number(accountDraft.interestEvery) || 1),
            interval: accountDraft.interestInterval,
            compounding: accountDraft.interestCompounding,
            startDate: accountDraft.interestStartDate || openingDate,
          }
        : undefined,
    }

    setAccounts((current) => [...current, nextAccount])
    if (openingAmount !== 0) {
      setCheckpoints((current) => [
        ...current,
        {
          id: createId('checkpoint'),
          accountId: nextAccount.id,
          date: openingDate,
          actualBalance: openingAmount,
          note: 'Opening balance',
        },
      ])
    }

    setStreamDraft((current) => ({ ...current, accountId: nextAccount.id }))
    setReconcileDraft((current) => ({ ...current, accountId: nextAccount.id }))
    setAccountDraft({
      name: '',
      color: '#0f766e',
      type: 'standard',
      openingBalance: '0.00',
      openingDate: todayKey,
      interestRate: '1',
      interestEvery: '1',
      interestInterval: 'monthly',
      interestCompounding: 'compound',
      interestStartDate: todayKey,
    })
    setAccountsModalOpen(true)
  }

  function editStream(stream: MoneyStream) {
    setEditingStreamId(stream.id)
    setStreamEditScope('all')
    setStreamDraft(streamDraftFromStream(stream))
    setModalTab('transaction')
  }

  function copyStream(stream: MoneyStream) {
    setEditingStreamId(null)
    setStreamDraft({
      ...streamDraftFromStream(stream),
      name: `${stream.name} copy`,
    })
    setModalTab('transaction')
  }

  function editCheckpoint(checkpoint: Checkpoint) {
    setEditingCheckpointId(checkpoint.id)
    setReconcileDraft({
      accountId: checkpoint.accountId,
      date: checkpoint.date,
      actualBalance: formatMoneyInput(String(checkpoint.actualBalance.toFixed(2)), true),
      note: checkpoint.note ?? '',
    })
    setModalTab('reconcile')
  }

  function copyCheckpoint(checkpoint: Checkpoint) {
    setEditingCheckpointId(null)
    setReconcileDraft({
      accountId: checkpoint.accountId,
      date: checkpoint.date,
      actualBalance: formatMoneyInput(String(checkpoint.actualBalance.toFixed(2)), true),
      note: checkpoint.note ?? '',
    })
    setModalTab('reconcile')
  }

  function updateAccount(accountId: string, patch: Partial<Account>) {
    setAccounts((current) => current.map((account) => (
      account.id === accountId
        ? {
            ...account,
            ...patch,
            openingBalance: 0,
          }
        : account
    )))
  }

  function removeAccount(accountId: string) {
    if (accounts.length <= 1) {
      return
    }

    setAccounts((current) => current.filter((account) => account.id !== accountId))
    setStreams((current) => current.filter((stream) => stream.accountId !== accountId))
    setCheckpoints((current) => current.filter((checkpoint) => checkpoint.accountId !== accountId))
    if (selectedAccountId === accountId) {
      setSelectedAccountId('all')
    }
  }

  function removeStream(streamId: string) {
    setStreams((current) => current.filter((stream) => stream.id !== streamId))
  }

  function removeCheckpoint(checkpointId: string) {
    setCheckpoints((current) => current.filter((checkpoint) => checkpoint.id !== checkpointId))
  }

  function openUpcomingEdit(item: UpcomingItem) {
    if (item.sourceType === 'checkpoint' && item.sourceId) {
      const checkpoint = checkpoints.find((entry) => entry.id === item.sourceId)
      if (!checkpoint) {
        return
      }
      setModalDate(item.date)
      editCheckpoint(checkpoint)
      return
    }

    if (item.sourceType === 'stream' && item.sourceId) {
      const stream = streams.find((entry) => entry.id === item.sourceId)
      if (!stream) {
        return
      }
      setModalDate(item.date)
      editStream(stream)
    }
  }

  function deleteStreamOccurrence(item: UpcomingItem, scope: DeleteScope) {
    if (!item.sourceId) {
      return
    }

    setStreams((current) => current.flatMap((stream) => {
      if (stream.id !== item.sourceId) {
        return [stream]
      }

      if (scope === 'series' || stream.recurrence.kind === 'one-time') {
        return []
      }

      if (scope === 'future') {
        const previousDay = toDateKey(addDays(fromDateKey(item.date), -1))
        if (compareDateKeys(previousDay, stream.startDate) < 0) {
          return []
        }

        return [{
          ...stream,
          endDate: stream.endDate && compareDateKeys(stream.endDate, previousDay) < 0 ? stream.endDate : previousDay,
        }]
      }

      const nextExcluded = stream.excludedDates ? [...stream.excludedDates] : []
      if (!nextExcluded.includes(item.date)) {
        nextExcluded.push(item.date)
      }
      return [{
        ...stream,
        excludedDates: nextExcluded,
      }]
    }))
  }

  function deleteUpcomingItem(item: UpcomingItem) {
    if (item.sourceType === 'interest') {
      return
    }
    setPendingDelete({ item })
  }

  function confirmUpcomingDelete(scope?: DeleteScope) {
    if (!pendingDelete) {
      return
    }

    const { item } = pendingDelete

    if (item.sourceType === 'checkpoint') {
      if (item.sourceId) {
        removeCheckpoint(item.sourceId)
      }
      setPendingDelete(null)
      return
    }

    if (!item.sourceId || !scope) {
      setPendingDelete(null)
      return
    }

    deleteStreamOccurrence(item, scope)
    setPendingDelete(null)
  }

  function exportSnapshot() {
    const payload: PlannerSnapshot = {
      version: 2,
      savedAt: new Date().toISOString(),
      accounts,
      streams,
      checkpoints,
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `finance-planner-${toDateKey(new Date())}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function importSnapshot(file: File) {
    const text = await file.text()
    const parsed = JSON.parse(text) as Partial<PlannerSnapshot>
    if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.streams) || !Array.isArray(parsed.checkpoints)) {
      throw new Error('Invalid planner file format')
    }

    const importedAccounts = normalizeAccounts(parsed.accounts)
    setAccounts(importedAccounts)
    setStreams(parsed.streams)
    setCheckpoints(parsed.checkpoints)
    setStreamDraft((current) => ({ ...current, accountId: importedAccounts[0].id }))
    setReconcileDraft((current) => ({ ...current, accountId: importedAccounts[0].id }))
  }

  return (
    <div className="app-shell">
      <header className="toolbar panel">
        <div>
          <p className="eyebrow">Finance Planner</p>
          <h1>{monthLabel(monthCursor)}</h1>
        </div>

        <div className="toolbar-actions">
          <label>
            Account view
            <select value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)}>
              <option value="all">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>

          <label>
            Drift alert
            <input
              type="text"
              inputMode="decimal"
              value={driftThresholdInput}
              onChange={(event) => handleMoneyInputChange(event, false, setDriftThresholdInput)}
            />
          </label>

          <button
            type="button"
            className="icon-button"
            onClick={() => {
              const current = fromDateKey(monthCursor)
              setMonthCursor(monthKey(new Date(current.getFullYear(), current.getMonth() - 1, 1)))
            }}
          >
            Prev
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              const current = fromDateKey(monthCursor)
              setMonthCursor(monthKey(new Date(current.getFullYear(), current.getMonth() + 1, 1)))
            }}
          >
            Next
          </button>
          <button type="button" className="secondary-button" onClick={() => setMonthCursor(currentMonthKey)}>Today</button>
          <button type="button" className="secondary-button" onClick={() => setAccountsModalOpen(true)}>Accounts</button>
          <button type="button" className="secondary-button" onClick={exportSnapshot}>Export</button>
          <button type="button" className="secondary-button" onClick={() => importInputRef.current?.click()}>Import</button>
          <input
            ref={importInputRef}
            className="hidden-input"
            type="file"
            accept="application/json"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.currentTarget.value = ''
              if (!file) {
                return
              }

              try {
                await importSnapshot(file)
              } catch {
                alert('Unable to import that file. Please use a planner export JSON file.')
              }
            }}
          />
        </div>
      </header>

      <section className="calendar-panel panel">
        <div className="weekday-row" aria-hidden="true">
          {weekdayLabels.map((label, index) => <span key={label} className={index === 0 || index === 6 ? 'weekend-column' : ''}>{label}</span>)}
        </div>

        <div className="calendar-grid">
          {visibleDays.map((date) => {
            const key = toDateKey(date)
            const day = projection.days[key]
            const viewEvents = selectedAccountId === 'all'
              ? (day?.events ?? [])
              : (day?.events.filter((event) => event.accountId === selectedAccountId) ?? [])
            const balance = selectedAccountId === 'all'
              ? day?.totalBalance
              : day?.accounts[selectedAccountId]?.balance
            const delta = selectedAccountId === 'all'
              ? (day?.totalDelta ?? 0)
              : (day?.accounts[selectedAccountId]?.delta ?? 0)
            const isCurrentMonth = date.getMonth() === fromDateKey(monthCursor).getMonth()
            const isToday = key === todayKey
            const hasDrift = selectedAccountId === 'all'
              ? Boolean(day?.checkpointAlerts.length)
              : Boolean(day?.checkpointAlerts.some((entry) => entry.startsWith(`${selectedAccountId}:`)))
            const hasReconciliation = Boolean(viewEvents.some((event) => event.kind === 'checkpoint'))
            const hasIncome = Boolean(viewEvents.some((event) => event.amount > 0 && event.kind !== 'checkpoint'))
            const hasExpense = Boolean(viewEvents.some((event) => event.amount < 0 && event.kind !== 'checkpoint'))
            const hasMixedFlow = hasIncome && hasExpense
            const isDeficit = selectedAccountId === 'all'
              ? projection.firstDeficitDate === key
              : projection.firstDeficitDateByAccount[selectedAccountId] === key
            const isWeekend = date.getDay() === 0 || date.getDay() === 6

            const prevBalance = balance !== undefined ? balance - delta : 0
            const absChange = Math.abs(delta)
            const absBase = Math.abs(prevBalance)
            const changeRatio = (absChange + absBase) > 0 ? absChange / (absChange + absBase) : 0
            const borderOpacity = Number((0.2 + changeRatio * 0.8).toFixed(2))

            const eventBorderColor = hasReconciliation
              ? `rgba(249,115,22,${borderOpacity})`
              : hasMixedFlow
                ? `rgba(234,179,8,${borderOpacity})`
                : hasIncome
                  ? `rgba(22,163,74,${borderOpacity})`
                  : hasExpense
                    ? `rgba(220,38,38,${borderOpacity})`
                    : undefined

            const amountToneClass = delta > 0
              ? 'balance-up'
              : delta < 0
                ? 'balance-down'
                : 'balance-neutral'

            return (
              <button
                key={key}
                type="button"
                className={`day-cell ${amountToneClass} ${hasDrift ? 'drift' : ''} ${isWeekend ? 'weekend' : ''} ${isCurrentMonth ? '' : 'muted'} ${isToday ? 'today' : ''} ${isDeficit ? 'deficit' : ''}`}
                style={eventBorderColor ? { borderColor: eventBorderColor } : undefined}
                onClick={() => openDayModal(key)}
              >
                <div className="day-topline">
                  <span className="day-date"><span className="day-weekday">{weekdayLabels[date.getDay()]}</span>{date.getDate()}</span>
                  {hasDrift ? <span className="badge checkpoint">Drift</span> : null}
                </div>
                <strong className="day-balance">{balance === undefined ? <><span className="desktop-balance">No data</span><span className="mobile-balance">N/A</span></> : <><span className="desktop-balance"><CashAmount amount={balance} /></span><MobileBalance amount={balance} /></>}</strong>
                <span className="day-meta">
                  {viewEvents.length ? `${viewEvents.length} event${viewEvents.length === 1 ? '' : 's'}` : 'No activity'}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="status-strip panel">
        <p>
          {deficitDate
            ? `Projected deficit starts on ${formatShortDate(deficitDate)} if no plan changes are made.`
            : 'No projected deficit within the active projection window.'}
        </p>
        <p>
          {checkpointWarnings.length} checkpoint drift alert{checkpointWarnings.length === 1 ? '' : 's'} above <CashAmount amount={driftThreshold} />.
        </p>
      </section>

      <section className="panel monthly-overview">
        <div className="monthly-overview-header">
          <h3>Monthly overview</h3>
          <p className="muted-copy">{monthLabel(monthCursor)} {selectedAccountId === 'all' ? '· all accounts' : ''}</p>
        </div>
        {monthlyOverview.hasData ? (
          <div className="monthly-overview-grid">
            <article className="monthly-metric-card">
              <span>Net gain/loss this month</span>
              <strong className={monthlyOverview.net >= 0 ? 'positive-value' : 'negative-value'}>
                <CashAmount amount={monthlyOverview.net} />
              </strong>
              <p className="muted-copy">
                Start <CashAmount amount={monthlyOverview.startBalance} /> {'->'} End <CashAmount amount={monthlyOverview.endBalance} />
              </p>
            </article>

            <article className="monthly-metric-card">
              <span>Cash-flow direction rate</span>
              <strong className={monthlyOverview.momentumRate >= 0 ? 'positive-value' : 'negative-value'}>
                {monthlyOverview.momentumRate >= 0 ? 'Improving' : 'Declining'} by <CashAmount amount={Math.abs(monthlyOverview.momentumRate)} />/day
              </strong>
              <p className="muted-copy">Average daily net: <CashAmount amount={monthlyOverview.averageDailyFlow} />/day</p>
            </article>
          </div>
        ) : (
          <p className="muted-copy">No projection data is available for this month yet.</p>
        )}
      </section>

      <section className="panel calendar-panel">
        <h3>Upcoming events</h3>
        <ul className="event-list">
          {visibleUpcomingItems.map((item) => (
            <li key={`${item.date}-${item.id}`}>
              <span>
                {formatCompactDate(item.date)} · {item.label}
                {selectedAccountId === 'all'
                  ? ` · ${accounts.find((account) => account.id === item.accountId)?.name ?? item.accountId}`
                  : ''}
              </span>
              <div className="item-actions">
                <strong className={item.amount >= 0 ? 'positive-value' : 'negative-value'}><CashAmount amount={item.amount} /></strong>
                {item.sourceType !== 'interest' ? (
                  <button type="button" className="link-button" onClick={() => openUpcomingEdit(item)}>Edit</button>
                ) : null}
                {item.sourceType !== 'interest' ? (
                  <button type="button" className="link-button" onClick={() => deleteUpcomingItem(item)}>Delete</button>
                ) : null}
              </div>
            </li>
          ))}
          {!mainUpcomingItems.length ? <li><span>None</span></li> : null}
        </ul>
        <div className="upcoming-footer-actions">
          {mainUpcomingItems.length > 10 && !showAllUpcoming ? (
            <button type="button" className="secondary-button show-more-button" onClick={() => setShowAllUpcoming(true)}>
              Show more
            </button>
          ) : <span />}
          <button type="button" className="secondary-button back-to-top-button" onClick={scrollToTop}>
            Back to top
          </button>
        </div>
      </section>

      {modalDate ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Day details">
          <div className="modal-card panel">
            <header className="modal-header">
              <div>
                <p className="eyebrow">Selected day</p>
                <h2>{formatShortDate(modalDate)}</h2>
              </div>
              <div className="modal-header-actions">
                <button type="button" className="icon-button" onClick={() => moveModalDay(-1)} disabled={!modalDate || cashFlowDates.indexOf(modalDate) <= 0}>Previous</button>
                <button type="button" className="icon-button" onClick={() => moveModalDay(1)} disabled={!modalDate || cashFlowDates.indexOf(modalDate) === cashFlowDates.length - 1}>Next</button>
                <button type="button" className="icon-button" onClick={closeModal}>Close</button>
              </div>
            </header>

            <nav className="modal-tabs" aria-label="Day actions">
              <button type="button" className={modalTab === 'day' ? 'tab active' : 'tab'} onClick={() => setModalTab('day')}>Day details</button>
              <button type="button" className={modalTab === 'transaction' ? 'tab active' : 'tab'} onClick={() => setModalTab('transaction')}>Income or expense</button>
              <button type="button" className={modalTab === 'reconcile' ? 'tab active' : 'tab'} onClick={() => setModalTab('reconcile')}>Reconciliation</button>
            </nav>

            {modalTab === 'transaction' ? (
              <section className="form-grid">
                <label>
                  From account
                  <select value={streamDraft.accountId} onChange={(event) => setStreamDraft((current) => {
                    const nextAccountId = event.target.value
                    const nextTransferAccountId = current.transferAccountId === nextAccountId
                      ? (accounts.find((account) => account.id !== nextAccountId)?.id ?? current.transferAccountId)
                      : current.transferAccountId
                    return { ...current, accountId: nextAccountId, transferAccountId: nextTransferAccountId }
                  })}>
                    {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </label>
                <label>
                  Name
                  <input value={streamDraft.name} onChange={(event) => setStreamDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Salary, rent, subscription" />
                </label>
                <label>
                  Amount
                  <input
                    type="text"
                    inputMode="decimal"
                    value={streamDraft.amount}
                    onChange={(event) => handleMoneyInputChange(event, false, (value) => setStreamDraft((current) => ({ ...current, amount: value })))}
                  />
                </label>
                <label>
                  Type
                  <select value={streamDraft.direction} onChange={(event) => setStreamDraft((current) => ({ ...current, direction: event.target.value as 'income' | 'expense' | 'transfer' }))}>
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </label>
                {streamDraft.direction === 'transfer' ? (
                  <label>
                    To account
                    <select value={streamDraft.transferAccountId} onChange={(event) => setStreamDraft((current) => ({ ...current, transferAccountId: event.target.value }))}>
                      {accounts.filter((account) => account.id !== streamDraft.accountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                    </select>
                  </label>
                ) : null}
                <label>
                  Start date
                  <input
                    type="date"
                    value={streamDraft.startDate}
                    onChange={(event) => setStreamDraft((current) => {
                      const selectedDay = String(fromDateKey(event.target.value).getDate())
                      const previousStartDay = String(fromDateKey(current.startDate).getDate())
                      const shouldRefreshDayDefault = !editingStreamId && (current.dayOfMonth === '' || current.dayOfMonth === previousStartDay)
                      return {
                        ...current,
                        startDate: event.target.value,
                        dayOfMonth: shouldRefreshDayDefault ? selectedDay : current.dayOfMonth,
                      }
                    })}
                  />
                </label>
                <label>
                  End date (optional)
                  <input type="date" value={streamDraft.endDate} onChange={(event) => setStreamDraft((current) => ({ ...current, endDate: event.target.value }))} />
                </label>
                <label className="full-span">
                  Recurrence
                  <select
                    value={streamDraft.kind}
                    onChange={(event) => setStreamDraft((current) => {
                      const nextKind = event.target.value as StreamKind
                      const startDay = String(fromDateKey(current.startDate).getDate())
                      return {
                        ...current,
                        kind: nextKind,
                        dayOfMonth: (nextKind === 'monthly' || nextKind === 'yearly') ? startDay : current.dayOfMonth,
                      }
                    })}
                  >
                    {recurrenceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>

                {streamDraft.kind === 'daily' ? (
                  <>
                    <label>
                      Repeat every (days)
                      <input type="number" min="1" value={streamDraft.everyDays} onChange={(event) => setStreamDraft((current) => ({ ...current, everyDays: event.target.value }))} />
                    </label>
                    <div className="weekday-picker full-span">
                      <span>Active weekdays <em style={{ fontWeight: 400, fontStyle: 'normal', color: '#64748b' }}>(none = every day)</em></span>
                      <div>
                        {weekdayLabels.map((label, index) => {
                          const checked = streamDraft.weekdays.includes(index)
                          return (
                            <button
                              key={label}
                              type="button"
                              className={checked ? 'weekday-toggle active' : 'weekday-toggle'}
                              onClick={() => setStreamDraft((current) => ({
                                ...current,
                                weekdays: checked ? current.weekdays.filter((item) => item !== index) : [...current.weekdays, index],
                              }))}
                            >
                              {label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </>
                ) : null}

                {streamDraft.kind === 'weekly' ? (
                  <>
                    <label>
                      Repeat every (weeks)
                      <input type="number" min="1" value={streamDraft.everyWeeks} onChange={(event) => setStreamDraft((current) => ({ ...current, everyWeeks: event.target.value }))} />
                    </label>
                    <div className="weekday-picker full-span">
                      <span>Active weekdays</span>
                      <div>
                        {weekdayLabels.map((label, index) => {
                          const checked = streamDraft.weekdays.includes(index)
                          return (
                            <button
                              key={label}
                              type="button"
                              className={checked ? 'weekday-toggle active' : 'weekday-toggle'}
                              onClick={() => setStreamDraft((current) => ({
                                ...current,
                                weekdays: checked ? current.weekdays.filter((item) => item !== index) : [...current.weekdays, index],
                              }))}
                            >
                              {label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </>
                ) : null}

                {streamDraft.kind === 'monthly' ? (
                  <>
                    <label>
                      Repeat every (months)
                      <input type="number" min="1" value={streamDraft.everyMonths} onChange={(event) => setStreamDraft((current) => ({ ...current, everyMonths: event.target.value }))} />
                    </label>
                    <div className="weekday-picker full-span">
                      <span>Repeat by</span>
                      <div>
                        <button
                          type="button"
                          className={streamDraft.monthlyMode === 'date' ? 'weekday-toggle active' : 'weekday-toggle'}
                          onClick={() => setStreamDraft((current) => ({ ...current, monthlyMode: 'date' }))}
                        >
                          By date
                        </button>
                        <button
                          type="button"
                          className={streamDraft.monthlyMode === 'weekday' ? 'weekday-toggle active' : 'weekday-toggle'}
                          onClick={() => setStreamDraft((current) => ({ ...current, monthlyMode: 'weekday' }))}
                        >
                          By weekday
                        </button>
                      </div>
                    </div>
                    {streamDraft.monthlyMode === 'date' ? (
                      <label>
                        Day of month
                        <input type="number" min="1" max="31" value={streamDraft.dayOfMonth} onChange={(event) => setStreamDraft((current) => ({ ...current, dayOfMonth: event.target.value }))} />
                      </label>
                    ) : (
                      <>
                        <label>
                          Occurrence
                          <select value={streamDraft.ordinal} onChange={(event) => setStreamDraft((current) => ({ ...current, ordinal: Number(event.target.value) }))}>
                            {[1, 2, 3, 4, -1, -2, -3].map((value) => <option key={value} value={value}>{ordinalLabel(value)}</option>)}
                          </select>
                        </label>
                        <label>
                          Weekday
                          <select value={streamDraft.weekday} onChange={(event) => setStreamDraft((current) => ({ ...current, weekday: Number(event.target.value) }))}>
                            {weekdayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}
                          </select>
                        </label>
                      </>
                    )}
                  </>
                ) : null}

                {streamDraft.kind === 'yearly' ? (
                  <>
                    <label>
                      Repeat every (years)
                      <input type="number" min="1" value={streamDraft.everyYears} onChange={(event) => setStreamDraft((current) => ({ ...current, everyYears: event.target.value }))} />
                    </label>
                    <div className="weekday-picker full-span">
                      <span>Active months</span>
                      <div>
                        {monthNames.map((name, index) => {
                          const checked = streamDraft.months.includes(index)
                          return (
                            <button
                              key={name}
                              type="button"
                              className={checked ? 'weekday-toggle active' : 'weekday-toggle'}
                              onClick={() => setStreamDraft((current) => ({
                                ...current,
                                months: checked ? current.months.filter((item) => item !== index) : [...current.months, index],
                              }))}
                            >
                              {name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <div className="weekday-picker full-span">
                      <span>Day selection</span>
                      <div>
                        <button
                          type="button"
                          className={streamDraft.yearlyMode === 'date' ? 'weekday-toggle active' : 'weekday-toggle'}
                          onClick={() => setStreamDraft((current) => ({ ...current, yearlyMode: 'date' }))}
                        >
                          By date
                        </button>
                        <button
                          type="button"
                          className={streamDraft.yearlyMode === 'weekday' ? 'weekday-toggle active' : 'weekday-toggle'}
                          onClick={() => setStreamDraft((current) => ({ ...current, yearlyMode: 'weekday' }))}
                        >
                          By weekday
                        </button>
                      </div>
                    </div>
                    {streamDraft.yearlyMode === 'date' ? (
                      <label>
                        Day of month
                        <input type="number" min="1" max="31" value={streamDraft.dayOfMonth} onChange={(event) => setStreamDraft((current) => ({ ...current, dayOfMonth: event.target.value }))} />
                      </label>
                    ) : (
                      <>
                        <label>
                          Occurrence
                          <select value={streamDraft.ordinal} onChange={(event) => setStreamDraft((current) => ({ ...current, ordinal: Number(event.target.value) }))}>
                            {[1, 2, 3, 4, -1, -2, -3].map((value) => <option key={value} value={value}>{ordinalLabel(value)}</option>)}
                          </select>
                        </label>
                        <label>
                          Weekday
                          <select value={streamDraft.weekday} onChange={(event) => setStreamDraft((current) => ({ ...current, weekday: Number(event.target.value) }))}>
                            {weekdayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}
                          </select>
                        </label>
                      </>
                    )}
                  </>
                ) : null}

                {editingStreamId && streamDraft.kind !== 'one-time' ? (
                  <label className="full-span">
                    Apply changes to
                    <select value={streamEditScope} onChange={(event) => setStreamEditScope(event.target.value as EditScope)}>
                      <option value="future">Only future occurrences</option>
                      <option value="all">Past and future occurrences</option>
                    </select>
                  </label>
                ) : null}

                <button type="button" className="primary-button" onClick={addTransaction}>{editingStreamId ? 'Save transaction edits' : 'Save transaction'}</button>
              </section>
            ) : null}

            {modalTab === 'reconcile' ? (
              <section className="form-grid">
                <label>
                  Account
                  <select value={reconcileDraft.accountId} onChange={(event) => setReconcileDraft((current) => ({ ...current, accountId: event.target.value }))}>
                    {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </label>
                <label>
                  Date
                  <input type="date" value={reconcileDraft.date} onChange={(event) => setReconcileDraft((current) => ({ ...current, date: event.target.value }))} />
                </label>
                <label>
                  Actual balance
                  <input
                    type="text"
                    inputMode="decimal"
                    value={reconcileDraft.actualBalance}
                    onChange={(event) => handleMoneyInputChange(event, true, (value) => setReconcileDraft((current) => ({ ...current, actualBalance: value })))}
                  />
                </label>
                <label className="full-span">
                  Note
                  <input value={reconcileDraft.note} onChange={(event) => setReconcileDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Optional context for reconciliation" />
                </label>
                <button type="button" className="primary-button" onClick={addReconciliation}>{editingCheckpointId ? 'Save reconciliation edits' : 'Save reconciliation'}</button>
              </section>
            ) : null}

            {modalTab === 'day' ? (
              <section className="day-details">
                <article className="summary-card">
                  <span>Total projected balance</span>
                  <strong>
                    <CashAmount amount={selectedAccountId === 'all' ? (selectedDayProjection?.totalBalance ?? 0) : (selectedDayProjection?.accounts[selectedAccountId]?.balance ?? 0)} />
                  </strong>
                  <span>
                    Net flow on this date: <CashAmount amount={selectedDayNetFlow} />
                  </span>
                </article>

                <div className="detail-block">
                  <h3>Transactions active on this date</h3>
                  <ul className="event-list">
                    {selectedDayStreams.map((stream) => {
                      const accountName = accounts.find((account) => account.id === stream.accountId)?.name ?? stream.accountId
                      const transferName = stream.transferAccountId
                        ? (accounts.find((account) => account.id === stream.transferAccountId)?.name ?? stream.transferAccountId)
                        : ''
                      const signedAmount = signedStreamAmountForView(stream, selectedAccountId)

                      return (
                        <li key={stream.id}>
                          <div className="item-main">
                            <strong className="item-title">{stream.name}</strong>
                            <p className="muted-copy">
                              {selectedAccountId === 'all'
                                ? (stream.direction === 'transfer'
                                  ? `${accountName} -> ${transferName}`
                                  : accountName)
                                : accountName}
                              {' · '}
                              {recurrenceSummary(stream)}
                              {' · starts '}
                              {formatCompactDate(stream.startDate)}
                            </p>
                          </div>
                          <div className="item-actions">
                            {signedAmount === null ? (
                              <span className="muted-copy">
                                Out <CashAmount amount={-stream.amount} /> · In <CashAmount amount={stream.amount} />
                              </span>
                            ) : (
                              <strong className={signedAmount >= 0 ? 'positive-value' : 'negative-value'}><CashAmount amount={signedAmount} /></strong>
                            )}
                            <button type="button" className="link-button" onClick={() => editStream(stream)}>Edit</button>
                            <button type="button" className="link-button" onClick={() => copyStream(stream)}>Copy</button>
                            <button type="button" className="link-button" onClick={() => removeStream(stream.id)}>Remove</button>
                          </div>
                        </li>
                      )
                    })}
                    {!selectedDayStreams.length ? <li><span>None</span></li> : null}
                  </ul>
                </div>

                <div className="detail-block">
                  <h3>Reconciliations on this date</h3>
                  <ul className="event-list">
                    {selectedDayCheckpoints.map((checkpoint) => (
                      <li key={checkpoint.id}>
                        <div className="item-main">
                          <strong className="item-title">Reconciliation</strong>
                          <p className="muted-copy">
                            {selectedAccountId === 'all'
                              ? `${accounts.find((account) => account.id === checkpoint.accountId)?.name ?? checkpoint.accountId} · `
                              : ''}
                            {checkpoint.note?.trim() ? checkpoint.note : 'No note'}
                          </p>
                        </div>
                        <div className="item-actions">
                          <strong className={checkpoint.actualBalance >= 0 ? 'positive-value' : 'negative-value'}><CashAmount amount={checkpoint.actualBalance} /></strong>
                          <button type="button" className="link-button" onClick={() => editCheckpoint(checkpoint)}>Edit</button>
                          <button type="button" className="link-button" onClick={() => copyCheckpoint(checkpoint)}>Copy</button>
                          <button type="button" className="link-button" onClick={() => removeCheckpoint(checkpoint.id)}>Remove</button>
                        </div>
                      </li>
                    ))}
                    {!selectedDayCheckpoints.length ? <li><span>None</span></li> : null}
                  </ul>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}

      {accountsModalOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Accounts">
          <div className="modal-card panel">
            <header className="modal-header">
              <div>
                <p className="eyebrow">Accounts</p>
                <h2>Manage accounts</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setAccountsModalOpen(false)}>Close</button>
            </header>

            <section className="form-grid">
              <div className="full-span account-section">
                <h3>Existing accounts</h3>
                <ul className="event-list">
                  {accounts.map((account) => (
                    <li key={account.id} className="account-row">
                      <label>
                        Name
                        <input
                          value={account.name}
                          onChange={(event) => updateAccount(account.id, { name: event.target.value })}
                        />
                      </label>
                      <label>
                        Color
                        <input
                          type="color"
                          value={account.color}
                          onChange={(event) => updateAccount(account.id, { color: event.target.value })}
                        />
                      </label>
                      <label>
                        Account type
                        <select
                          value={account.type ?? 'standard'}
                          onChange={(event) => updateAccount(account.id, {
                            type: event.target.value as 'standard' | 'interest-bearing',
                            interest: event.target.value === 'interest-bearing'
                              ? (account.interest ?? {
                                  enabled: true,
                                  rate: 1,
                                  every: 1,
                                  interval: 'monthly',
                                  compounding: 'compound',
                                  startDate: todayKey,
                                })
                              : undefined,
                          })}
                        >
                          <option value="standard">Standard</option>
                          <option value="interest-bearing">Interest-bearing</option>
                        </select>
                      </label>
                      {account.type === 'interest-bearing' ? (
                        <>
                          <label>
                            Interest rate (%)
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={account.interest?.rate ?? 0}
                              onChange={(event) => updateAccount(account.id, {
                                interest: {
                                  enabled: true,
                                  rate: Number(event.target.value) || 0,
                                  every: account.interest?.every ?? 1,
                                  interval: account.interest?.interval ?? 'monthly',
                                  compounding: account.interest?.compounding ?? 'compound',
                                  startDate: account.interest?.startDate ?? todayKey,
                                },
                              })}
                            />
                          </label>
                          <label>
                            Every
                            <input
                              type="number"
                              min="1"
                              value={account.interest?.every ?? 1}
                              onChange={(event) => updateAccount(account.id, {
                                interest: {
                                  enabled: true,
                                  rate: account.interest?.rate ?? 1,
                                  every: Math.max(1, Number(event.target.value) || 1),
                                  interval: account.interest?.interval ?? 'monthly',
                                  compounding: account.interest?.compounding ?? 'compound',
                                  startDate: account.interest?.startDate ?? todayKey,
                                },
                              })}
                            />
                          </label>
                          <label>
                            Interval
                            <select
                              value={account.interest?.interval ?? 'monthly'}
                              onChange={(event) => updateAccount(account.id, {
                                interest: {
                                  enabled: true,
                                  rate: account.interest?.rate ?? 1,
                                  every: account.interest?.every ?? 1,
                                  interval: event.target.value as 'daily' | 'monthly' | 'yearly',
                                  compounding: account.interest?.compounding ?? 'compound',
                                  startDate: account.interest?.startDate ?? todayKey,
                                },
                              })}
                            >
                              <option value="daily">Daily</option>
                              <option value="monthly">Monthly</option>
                              <option value="yearly">Yearly</option>
                            </select>
                          </label>
                          <label>
                            Compounding
                            <select
                              value={account.interest?.compounding ?? 'compound'}
                              onChange={(event) => updateAccount(account.id, {
                                interest: {
                                  enabled: true,
                                  rate: account.interest?.rate ?? 1,
                                  every: account.interest?.every ?? 1,
                                  interval: account.interest?.interval ?? 'monthly',
                                  compounding: event.target.value as 'simple' | 'compound',
                                  startDate: account.interest?.startDate ?? todayKey,
                                },
                              })}
                            >
                              <option value="compound">Compound</option>
                              <option value="simple">Simple</option>
                            </select>
                          </label>
                          <label>
                            Interest start date
                            <input
                              type="date"
                              value={account.interest?.startDate ?? todayKey}
                              onChange={(event) => updateAccount(account.id, {
                                interest: {
                                  enabled: true,
                                  rate: account.interest?.rate ?? 1,
                                  every: account.interest?.every ?? 1,
                                  interval: account.interest?.interval ?? 'monthly',
                                  compounding: account.interest?.compounding ?? 'compound',
                                  startDate: event.target.value,
                                },
                              })}
                            />
                          </label>
                        </>
                      ) : null}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => removeAccount(account.id)}
                        disabled={accounts.length <= 1}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="full-span account-section">
                <h3>Add account</h3>
              </div>

              <label>
                Account name
                <input value={accountDraft.name} onChange={(event) => setAccountDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Travel account" />
              </label>
              <label>
                Color
                <input type="color" value={accountDraft.color} onChange={(event) => setAccountDraft((current) => ({ ...current, color: event.target.value }))} />
              </label>
              <label>
                Account type
                <select value={accountDraft.type} onChange={(event) => setAccountDraft((current) => ({ ...current, type: event.target.value as 'standard' | 'interest-bearing' }))}>
                  <option value="standard">Standard</option>
                  <option value="interest-bearing">Interest-bearing</option>
                </select>
              </label>
              <label>
                Opening balance (as reconciliation)
                <input
                  type="text"
                  inputMode="decimal"
                  value={accountDraft.openingBalance}
                  onChange={(event) => handleMoneyInputChange(event, true, (value) => setAccountDraft((current) => ({ ...current, openingBalance: value })))}
                />
              </label>
              <label>
                Opening balance date
                <input type="date" value={accountDraft.openingDate} onChange={(event) => setAccountDraft((current) => ({ ...current, openingDate: event.target.value }))} />
              </label>
              {accountDraft.type === 'interest-bearing' ? (
                <>
                  <label>
                    Interest rate (%)
                    <input type="number" min="0" step="0.01" value={accountDraft.interestRate} onChange={(event) => setAccountDraft((current) => ({ ...current, interestRate: event.target.value }))} />
                  </label>
                  <label>
                    Every
                    <input type="number" min="1" value={accountDraft.interestEvery} onChange={(event) => setAccountDraft((current) => ({ ...current, interestEvery: event.target.value }))} />
                  </label>
                  <label>
                    Interval
                    <select value={accountDraft.interestInterval} onChange={(event) => setAccountDraft((current) => ({ ...current, interestInterval: event.target.value as 'daily' | 'monthly' | 'yearly' }))}>
                      <option value="daily">Daily</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </label>
                  <label>
                    Compounding
                    <select value={accountDraft.interestCompounding} onChange={(event) => setAccountDraft((current) => ({ ...current, interestCompounding: event.target.value as 'simple' | 'compound' }))}>
                      <option value="compound">Compound</option>
                      <option value="simple">Simple</option>
                    </select>
                  </label>
                  <label>
                    Interest start date
                    <input type="date" value={accountDraft.interestStartDate} onChange={(event) => setAccountDraft((current) => ({ ...current, interestStartDate: event.target.value }))} />
                  </label>
                </>
              ) : null}
              <button type="button" className="primary-button" onClick={addAccount}>Save account</button>
            </section>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete event">
          <div className="modal-card panel delete-modal">
            <header className="modal-header">
              <div>
                <p className="eyebrow">Confirm delete</p>
                <h2>Delete upcoming item</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setPendingDelete(null)}>Close</button>
            </header>

            <section className="delete-modal-content">
              <p>
                {formatCompactDate(pendingDelete.item.date)} · {pendingDelete.item.label}
              </p>
              {pendingDelete.item.sourceType === 'checkpoint' ? (
                <p className="muted-copy">This will remove this reconciliation checkpoint.</p>
              ) : (
                <p className="muted-copy">Choose how much of this recurring series to delete.</p>
              )}
            </section>

            <div className="delete-modal-actions">
              {pendingDelete.item.sourceType === 'checkpoint' ? (
                <button type="button" className="primary-button" onClick={() => confirmUpcomingDelete()}>Delete checkpoint</button>
              ) : (
                <>
                  <button type="button" className="secondary-button" onClick={() => confirmUpcomingDelete('one')}>Delete this one</button>
                  <button type="button" className="secondary-button" onClick={() => confirmUpcomingDelete('future')}>Delete this and future</button>
                  <button type="button" className="primary-button" onClick={() => confirmUpcomingDelete('series')}>Delete entire series</button>
                </>
              )}
              <button type="button" className="link-button" onClick={() => setPendingDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App