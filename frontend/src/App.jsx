import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Playlist from './components/Playlist'
import Preview from './components/Preview'
import Controls from './components/Controls'
import Timer from './components/Timer'
import LiveIndicator from './components/LiveIndicator'
import ActivityLog from './components/ActivityLog'
import Icon from './components/Icon'
import { api } from './api'
import packageJson from '../package.json'

const APP_VERSION = packageJson.version
const AUTOSAVE_DELAY_MS = 1500
const VALIDATION_REFRESH_MS = 2000
const VALIDATION_REFRESH_RETRIES = 10
const UPDATE_POLL_MS = 300000
const UPDATE_PROGRESS_POLL_MS = 2000
const MAX_LOG_ENTRIES = 50
const MAX_UNDO_ITEMS = 500
const MAX_UNDO_ENTRIES = 50
const MOVE_THROTTLE_MS = 250
const NEXT_HIGHLIGHT_SECONDS = 5
const VOLUME_THROTTLE_MS = 60
const SETTINGS_FEEDBACK_MS = 2200
const MAX_RELEASE_NOTES = 1200
const OBS_STATUS_INTERVAL_MS = 5000
const OBS_RECONNECT_DELAYS = [5000, 10000, 30000, 60000]
const INSTALL_FAILURE_MESSAGES = {
  'on-air': 'The update was not installed because the channel is on air',
  'not-ready': 'The update has not been downloaded yet',
  'missing': 'The downloaded update is missing, download it again',
  'installing': 'The update is already being installed',
  'launch-failed': 'The installer could not be started, open it from the updates folder'
}

const ENGINE_OUTPUT_KEYS = ['resolution', 'aspectRatio', 'quality', 'scalingMode', 'networkStreamingEnabled', 'audioDeviceLabel']

const PERFORMANCE_MODE_KEY = 'flowair.performanceMode'
const PERFORMANCE_MODES = ['auto', 'on', 'off']
const DIAGNOSTICS_DISMISS_KEY = 'flowair.diagnosticsDismissed'

const IPC_CHANNELS = [
  'output-window-closed',
  'output-window-opened',
  'displays-changed',
  'backend-restarted',
  'update-available',
  'update:state',
  'update:progress',
  'open-playlist-file'
]

const SHORTCUT_STORAGE_KEY = 'flowair.shortcuts'

const SHORTCUT_ACTIONS = [
  { id: 'play', label: 'Play / Pause', defaultBinding: 'Space' },
  { id: 'stop', label: 'Stop', defaultBinding: 'S' },
  { id: 'next', label: 'Next item', defaultBinding: 'N' },
  { id: 'cue', label: 'Cue selected item', defaultBinding: 'Enter' },
  { id: 'remove', label: 'Delete selected items', defaultBinding: 'Delete' },
  { id: 'undo', label: 'Undo', defaultBinding: 'Ctrl+Z' },
  { id: 'copy', label: 'Copy selection', defaultBinding: 'Ctrl+C' },
  { id: 'paste', label: 'Paste', defaultBinding: 'Ctrl+V' },
  { id: 'search', label: 'Find in playlist', defaultBinding: 'Ctrl+F' },
  { id: 'selectAll', label: 'Select all', defaultBinding: 'Ctrl+A' },
  { id: 'exit', label: 'Exit FlowAir', defaultBinding: 'Ctrl+Q' },
  { id: 'output', label: 'Show / hide output', defaultBinding: 'Ctrl+Shift+E', global: true }
]

const DEFAULT_SHORTCUTS = SHORTCUT_ACTIONS.reduce((acc, action) => {
  acc[action.id] = action.defaultBinding
  return acc
}, {})

const RESERVED_BINDINGS = [
  'Alt+F4',
  'Ctrl+W',
  'Ctrl+R',
  'F5',
  'Ctrl+Shift+I',
  'F12',
  'Escape',
  'Tab'
]

const RESERVED_KEY_TOKENS = ['Up', 'Down']

const BINDING_KEY_TOKENS = {
  ' ': 'Space',
  spacebar: 'Space',
  enter: 'Enter',
  delete: 'Delete',
  backspace: 'Backspace',
  escape: 'Escape',
  tab: 'Tab',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown'
}

const BINDING_PATTERN = /^(Ctrl\+)?(Alt\+)?(Shift\+)?(Space|Enter|Delete|Backspace|Escape|Tab|Up|Down|Left|Right|Home|End|PageUp|PageDown|F1[0-2]|F[1-9]|[A-Z0-9])$/

const keyTokenFromEvent = (event) => {
  const key = typeof event.key === 'string' ? event.key : ''
  if (!key) return ''
  const lower = key.toLowerCase()
  if (lower === 'control' || lower === 'shift' || lower === 'alt' || lower === 'meta') return ''
  if (BINDING_KEY_TOKENS[lower]) return BINDING_KEY_TOKENS[lower]
  if (/^f([1-9]|1[0-2])$/.test(lower)) return lower.toUpperCase()
  if (key.length === 1) {
    const code = typeof event.code === 'string' ? event.code : ''
    if (/^Key[A-Z]$/.test(code)) return code.slice(3)
    if (/^Digit[0-9]$/.test(code)) return code.slice(5)
    return key.toUpperCase()
  }
  return ''
}

const bindingFromEvent = (event) => {
  if (event.metaKey) return ''
  const token = keyTokenFromEvent(event)
  if (!token) return ''
  let prefix = ''
  if (event.ctrlKey) prefix += 'Ctrl+'
  if (event.altKey) prefix += 'Alt+'
  if (event.shiftKey) prefix += 'Shift+'
  return `${prefix}${token}`
}

const isTypingTarget = (target) => {
  if (!target) return false
  const tag = typeof target.tagName === 'string' ? target.tagName : ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return Boolean(target.isContentEditable)
}

const ACTIVATION_SCOPES = '.update-panel, .pl-find'

const isActivationTarget = (target, key) => {
  if (key !== ' ' && key !== 'Enter') return false
  if (!target || target.tagName !== 'BUTTON' || typeof target.closest !== 'function') return false
  return Boolean(target.closest(ACTIVATION_SCOPES))
}

const isValidBinding = (binding) => typeof binding === 'string' && BINDING_PATTERN.test(binding)

const bindingKeyToken = (binding) => String(binding).split('+').pop()

const isReservedBinding = (binding) => RESERVED_BINDINGS.includes(binding) || RESERVED_KEY_TOKENS.includes(bindingKeyToken(binding))

const toAccelerator = (binding) => binding.split('+').map(part => (part === 'Ctrl' ? 'CommandOrControl' : part)).join('+')

const loadShortcuts = () => {
  const bindings = { ...DEFAULT_SHORTCUTS }
  let saved = null
  try {
    saved = JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) || 'null')
  } catch (error) {
    saved = null
  }
  if (saved && typeof saved === 'object') {
    SHORTCUT_ACTIONS.forEach(action => {
      const value = saved[action.id]
      if (isValidBinding(value) && !isReservedBinding(value)) bindings[action.id] = value
    })
  }
  const taken = new Set()
  const cleared = []
  SHORTCUT_ACTIONS.forEach(action => {
    const binding = bindings[action.id]
    if (binding && !taken.has(binding)) {
      taken.add(binding)
      return
    }
    const fallback = taken.has(action.defaultBinding) ? '' : action.defaultBinding
    bindings[action.id] = fallback
    if (fallback) {
      taken.add(fallback)
      return
    }
    cleared.push(action.label)
  })
  return { bindings, cleared }
}

const matchesSearch = (item, needle) => {
  if (item.name && item.name.toLowerCase().includes(needle)) return true
  if (item.location && item.location.toLowerCase().includes(needle)) return true
  if (item.type === 'note' && item.note && item.note.toLowerCase().includes(needle)) return true
  if (item.type === 'obs') {
    if (item.obs_scene && item.obs_scene.toLowerCase().includes(needle)) return true
    if (item.obs_source && item.obs_source.toLowerCase().includes(needle)) return true
  }
  if (item.type === 'stop' && 'stop event'.includes(needle)) return true
  return false
}

const fileNameFromPath = (filePath) => {
  const parts = String(filePath).split(/[\\/]/)
  return parts[parts.length - 1] || String(filePath)
}

const getElectron = () => {
  try {
    return window.require('electron')
  } catch (error) {
    return null
  }
}

const getNodeFs = () => {
  try {
    return window.require('fs')
  } catch (error) {
    return null
  }
}

const requestGlobalShortcut = async (accelerator) => {
  const electron = getElectron()
  if (!electron) return { success: true }
  const answer = await electron.ipcRenderer.invoke('shortcuts:set-global', { accelerator }).catch(() => null)
  return answer || { success: false, reason: 'unavailable' }
}

const serializePlaylistItems = (items) => items.map(item => ({
  type: item.type,
  name: item.name,
  location: item.location,
  duration: item.duration,
  duration_formatted: item.duration_formatted,
  note: item.note,
  loop: item.loop,
  obs_scene: item.obs_scene,
  obs_source: item.obs_source,
  obs_action: item.obs_action,
  obs_transition: item.obs_transition,
  obs_transition_duration: item.obs_transition_duration
}))

const extractPlaylistItems = (data) => {
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.playlist)) return data.playlist
  if (data && Array.isArray(data.items)) return data.items
  return []
}

const describeItem = (item) => {
  if (!item) return 'item'
  if (item.name) return item.name
  if (item.type === 'note') return item.note || 'Note'
  if (item.type === 'stop') return 'STOP EVENT'
  if (item.type === 'obs') return 'OBS Event'
  return 'item'
}

const itemCountLabel = (count) => `${count} item${count === 1 ? '' : 's'}`

const buildRestoreRuns = (serializedItems, originalIndices) => {
  const entries = serializedItems
    .map((item, position) => ({ item, index: originalIndices[position] }))
    .filter(entry => typeof entry.index === 'number' && entry.index >= 0)
    .sort((a, b) => a.index - b.index)

  const runs = []
  entries.forEach(entry => {
    const last = runs[runs.length - 1]
    if (last && entry.index === last.position + last.items.length) {
      last.items.push(entry.item)
    } else {
      runs.push({ position: entry.index, items: [entry.item] })
    }
  })
  return runs
}

const undoRefusalReason = (action, items, currentIndex, isPlaying, currentId) => {
  const indexById = new Map(items.map((item, index) => [item.id, index]))

  if (action.type === 'added_items') {
    if (action.itemIds.some(id => !indexById.has(id))) return 'those items are no longer in the playlist'
    if (currentId !== null && action.itemIds.includes(currentId)) return 'one of those items is on air'
    return null
  }

  if (action.type === 'removed_items') {
    let length = items.length
    for (const run of action.runs) {
      if (run.position > length) return 'the playlist changed since that delete'
      length += run.items.length
    }
    if (isPlaying && currentIndex >= 0 && action.runs.some(run => run.position <= currentIndex)) {
      return 'it would insert at or before the item on air'
    }
    return null
  }

  if (action.type === 'restore_order') {
    const tailIds = items.slice(currentIndex + 1).map(item => item.id)
    if (tailIds.length !== action.itemIds.length) return 'the playlist changed since that move'
    const tailSet = new Set(tailIds)
    if (action.itemIds.some(id => !tailSet.has(id))) return 'the playlist changed since that move'
    return null
  }

  if (action.type === 'note_edit') {
    const item = items[indexById.get(action.itemId) ?? -1]
    if (!item || item.type !== 'note') return 'that note is no longer in the playlist'
    return null
  }

  if (action.type === 'obs_edit') {
    const item = items[indexById.get(action.itemId) ?? -1]
    if (!item || item.type !== 'obs') return 'that OBS event is no longer in the playlist'
    return null
  }

  if (action.type === 'loop_toggle') {
    const item = items[indexById.get(action.itemId) ?? -1]
    if (!item) return 'that item is no longer in the playlist'
    if (Boolean(item.loop) === Boolean(action.previousLoop)) return 'the loop flag already has that value'
    return null
  }

  return 'that action cannot be undone'
}

const applyUndoAction = async (action, items, progress) => {
  const markStarted = () => {
    if (progress) progress.started = true
  }

  if (action.type === 'added_items') {
    markStarted()
    await Promise.all(action.itemIds.map(id => api.removeItem(id)))
    return { applied: true }
  }

  if (action.type === 'removed_items') {
    const expected = action.runs.reduce((sum, run) => sum + run.items.length, 0)
    let completed = 0
    let restored = 0
    for (const run of action.runs) {
      markStarted()
      const result = await api.restoreItems(run.items, run.position)
      if (!result || result.success === false) break
      completed += 1
      restored += Array.isArray(result.items) ? result.items.length : run.items.length
    }
    if (restored === 0) return { applied: false }
    if (completed < action.runs.length || restored < expected) {
      return { applied: true, partial: `${restored} of ${expected} item(s) restored` }
    }
    return { applied: true }
  }

  if (action.type === 'restore_order') {
    markStarted()
    const result = await api.setOrder(action.itemIds)
    return { applied: Boolean(result && result.success !== false) }
  }

  if (action.type === 'note_edit') {
    markStarted()
    const result = await api.updateNote(action.itemId, action.previousNote)
    return { applied: Boolean(result && result.success !== false) }
  }

  if (action.type === 'obs_edit') {
    const index = items.findIndex(item => item.id === action.itemId)
    const previous = action.previous
    markStarted()
    const result = await api.insertOBSEvent(
      index,
      previous.scene,
      previous.source,
      previous.action,
      previous.transition,
      previous.transitionDuration,
      action.itemId
    )
    return { applied: Boolean(result && result.success !== false) }
  }

  if (action.type === 'loop_toggle') {
    markStarted()
    const result = await api.toggleLoop(action.itemId)
    return { applied: Boolean(result && result.success !== false) }
  }

  return { applied: false }
}

const resolveNextHighlightId = (items, currentItem, isPlaying, elapsed) => {
  if (!isPlaying || !currentItem || currentItem.type !== 'video') return null
  if (currentItem.loop) return null
  const duration = Number(currentItem.duration) || 0
  if (duration <= 0 || duration - elapsed > NEXT_HIGHLIGHT_SECONDS) return null

  const currentIndex = items.findIndex(item => item.id === currentItem.id)
  if (currentIndex < 0) return null

  for (let index = currentIndex + 1; index < items.length; index++) {
    const item = items[index]
    if (item.type === 'stop') return null
    if (item.type === 'note' || item.type === 'obs') continue
    if (item.status === 'corrupted' || item.playability === 'unsupported') continue
    if (item.type === 'video' || item.type === 'image') return item.id
  }
  return null
}

const formatClock = (date, timeFormat) => {
  if (timeFormat === '24') {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
}

const formatDate = (date) => {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const DEFAULT_DIAGNOSTICS = {
  gpu: { vendor: '', model: '', driverVersion: '', videoDecode: 'unknown', compositing: 'unknown', rasterization: 'unknown', accelerationDisabled: false },
  system: { platform: '', release: '', arch: '', cpuModel: '', cpuCores: 0, totalMemoryMb: 0, freeMemoryMb: 0 },
  app: { version: APP_VERSION, engineVersion: '', electron: '', chrome: '' },
  health: { level: 'ok', reasons: [] },
  text: ''
}

const FEATURE_LABELS = {
  enabled: 'Hardware accelerated',
  software: 'Software (processor)',
  disabled: 'Disabled',
  unknown: 'Unknown'
}

const FEATURE_COLORS = {
  enabled: 'var(--success)',
  software: 'var(--warning-text)',
  disabled: 'var(--danger-text)',
  unknown: 'var(--text-tertiary)'
}

const featureState = (value) => (FEATURE_LABELS[value] ? value : 'unknown')

const normalizeDiagnostics = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const health = raw.health && typeof raw.health === 'object' ? raw.health : {}
  const level = health.level === 'critical' || health.level === 'warning' ? health.level : 'ok'
  return {
    gpu: { ...DEFAULT_DIAGNOSTICS.gpu, ...(raw.gpu || {}) },
    system: { ...DEFAULT_DIAGNOSTICS.system, ...(raw.system || {}) },
    app: { ...DEFAULT_DIAGNOSTICS.app, ...(raw.app || {}) },
    health: { level, reasons: Array.isArray(health.reasons) ? health.reasons.filter(reason => typeof reason === 'string' && reason) : [] },
    text: typeof raw.text === 'string' ? raw.text : ''
  }
}

const diagnosticsSignature = (diagnostics) => (
  diagnostics ? `${diagnostics.health.level}|${diagnostics.health.reasons.join('|')}` : ''
)

const loadPerformanceMode = () => {
  const saved = localStorage.getItem(PERFORMANCE_MODE_KEY)
  return PERFORMANCE_MODES.includes(saved) ? saved : 'auto'
}

const parseDurationSeconds = (value) => {
  if (!value || typeof value !== 'string') return 0
  const parts = value.split(':')
  if (parts.length !== 3) return 0
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = parseInt(parts[2], 10)
  if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) return 0
  return hours * 3600 + minutes * 60 + seconds
}

const formatRemaining = (item, elapsed) => {
  if (!item) return '--:--'
  const total = parseDurationSeconds(item.duration_formatted) || Math.floor(Number(item.duration) || 0)
  if (total <= 0) return '--:--'
  const remaining = Math.max(0, total - Math.floor(elapsed))
  const minutes = String(Math.floor((remaining % 3600) / 60)).padStart(2, '0')
  const seconds = String(remaining % 60).padStart(2, '0')
  if (remaining >= 3600) return `${Math.floor(remaining / 3600)}:${minutes}:${seconds}`
  return `${minutes}:${seconds}`
}

const formatMemoryMb = (value) => {
  const megabytes = Number(value) || 0
  if (megabytes <= 0) return 'Unknown'
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(1)} GB`
  return `${Math.round(megabytes)} MB`
}

const orUnknown = (value) => {
  const text = value === 0 ? '0' : String(value || '').trim()
  return text ? text : 'Unknown'
}

const createAudioLevelSource = () => {
  const listeners = new Set()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    publish(level) {
      listeners.forEach(listener => listener(level))
    }
  }
}

const MemoPlaylist = React.memo(Playlist)
const MemoPreview = React.memo(Preview)
const MemoControls = React.memo(Controls)
const MemoTimer = React.memo(Timer)
const MemoActivityLog = React.memo(ActivityLog)

const HeaderClock = React.memo(({ timeFormat }) => {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <>
      <span style={styles.date}>{formatDate(now)}</span>
      <span style={styles.clock}>{formatClock(now, timeFormat)}</span>
    </>
  )
})

const ConfirmDialog = ({ title, body, confirmLabel, cancelLabel, tone, focus, outputBinding, onConfirm, onCancel }) => {
  const confirmRef = useRef(null)
  const cancelRef = useRef(null)

  useEffect(() => {
    const previous = document.activeElement
    const initial = focus === 'confirm' ? confirmRef.current : cancelRef.current
    if (initial) initial.focus()
    return () => {
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus()
    }
  }, [focus])

  const handleKeyDown = (e) => {
    if (outputBinding && bindingFromEvent(e) === outputBinding) return
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat) onConfirm()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      const nodes = [confirmRef.current, cancelRef.current].filter(Boolean)
      if (nodes.length === 0) return
      const index = nodes.indexOf(document.activeElement)
      const step = e.shiftKey ? -1 : 1
      nodes[(index + step + nodes.length) % nodes.length].focus()
      return
    }
    e.stopPropagation()
  }

  return (
    <div style={styles.modalOverlay} onKeyDown={handleKeyDown} onMouseDown={(e) => e.preventDefault()}>
      <div style={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
        <div style={styles.modalHeader}>{title}</div>
        <div style={styles.modalBody}>{body}</div>
        <div style={styles.modalButtons}>
          <button
            ref={confirmRef}
            style={{ ...styles.modalButton, ...(tone === 'danger' ? styles.modalButtonConfirm : styles.modalButtonPrimary) }}
            onClick={onConfirm}
          >
            {confirmLabel} (Enter)
          </button>
          <button
            ref={cancelRef}
            style={{ ...styles.modalButton, ...styles.modalButtonCancel }}
            onClick={onCancel}
          >
            {cancelLabel || 'Cancel'} (Esc)
          </button>
        </div>
      </div>
    </div>
  )
}

const App = () => {
  const [playlist, setPlaylist] = useState([])
  const [playlistRevision, setPlaylistRevision] = useState(-1)
  const [currentItem, setCurrentItem] = useState(null)
  const [selectedItems, setSelectedItems] = useState([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [logCollapsed, setLogCollapsed] = useState(true)
  const [activityLogs, setActivityLogs] = useState([])
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [copiedItems, setCopiedItems] = useState([])
  const lastSelectedId = useRef(null)
  const selectionFocusId = useRef(null)
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [noteInputValue, setNoteInputValue] = useState('')
  const [noteInsertIndex, setNoteInsertIndex] = useState(0)
  const [editingNoteId, setEditingNoteId] = useState(null)
  const undoStack = useRef([])
  const lastMoveAt = useRef(0)
  const pendingVolume = useRef(null)
  const queuedVolume = useRef(null)
  const volumeTimer = useRef(null)
  const wsPauseDepth = useRef(0)
  const opInFlight = useRef(false)
  const validationRefreshTimer = useRef(null)
  const validationRefreshRetries = useRef(0)
  const [serverElapsed, setServerElapsed] = useState(0)
  const [editMode, setEditMode] = useState(false)
  const [outputVolume, setOutputVolume] = useState(100)
  const [recoverySession, setRecoverySession] = useState(null)
  const autosaveReady = useRef(false)
  const autosaveTimer = useRef(null)
  const pendingAutosave = useRef(null)
  const lastAutosave = useRef(null)
  const lastAutosaveRevision = useRef(-1)
  const [timeFormat, setTimeFormat] = useState(() => {
    return localStorage.getItem('timeFormat') || '12'
  })
  const [followOnAir, setFollowOnAir] = useState(() => localStorage.getItem('followOnAir') !== '0')
  const [initialShortcuts] = useState(loadShortcuts)
  const [shortcuts, setShortcuts] = useState(initialShortcuts.bindings)
  const [capturingAction, setCapturingAction] = useState(null)
  const [shortcutMessage, setShortcutMessage] = useState('')
  const [shortcutLoadWarning, setShortcutLoadWarning] = useState(() => (
    initialShortcuts.cleared.length > 0
      ? `Saved shortcuts collided, so these actions have no key: ${initialShortcuts.cleared.join(', ')}. Set them again or use Reset all to defaults.`
      : ''
  ))
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [showOutputSettings, setShowOutputSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState('video')
  const [settingsFeedback, setSettingsFeedback] = useState(null)
  const settingsFeedbackTimer = useRef(null)
  const [outputSettings, setOutputSettings] = useState(() => {
    const saved = localStorage.getItem('outputSettings')
    const defaults = {
      resolution: '1920x1080',
      aspectRatio: '16:9',
      quality: 'max',
      scalingMode: 'stretch',
      externalOutputEnabled: false,
      selectedDisplayId: null,
      networkStreamingEnabled: false,
      audioDeviceLabel: ''
    }
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults
  })
  const [availableDisplays, setAvailableDisplays] = useState([])
  const [audioDevices, setAudioDevices] = useState([])
  const [outputWindowActive, setOutputWindowActive] = useState(false)
  const [diagnostics, setDiagnostics] = useState(null)
  const [performanceMode, setPerformanceMode] = useState(loadPerformanceMode)
  const [previewOverride, setPreviewOverride] = useState(false)
  const [diagnosticsDismissed, setDiagnosticsDismissed] = useState(() => localStorage.getItem(DIAGNOSTICS_DISMISS_KEY) || '')
  const [hardwareAcceleration, setHardwareAcceleration] = useState(true)
  const [hardwareAccelerationPending, setHardwareAccelerationPending] = useState(false)
  const [audioLevelSource] = useState(createAudioLevelSource)
  const performanceAutoLogged = useRef('')
  const [networkInfo, setNetworkInfo] = useState({ local_ip: '127.0.0.1', port: 8000, player_url: 'http://127.0.0.1:8000/player' })

  const [updateState, setUpdateState] = useState({
    status: 'idle',
    version: '',
    notes: '',
    url: '',
    downloaded: false,
    progress: 0,
    error: '',
    enabled: true
  })
  const [showUpdatePanel, setShowUpdatePanel] = useState(false)
  const updateDownloadRequested = useRef(false)

  const [obsSettings, setOBSSettings] = useState(() => {
    const saved = localStorage.getItem('obsSettings')
    return saved ? JSON.parse(saved) : {
      enabled: false,
      host: 'localhost',
      port: 4455,
      password: ''
    }
  })
  const [obsConnected, setOBSConnected] = useState(false)
  const [obsStatusMessage, setOBSStatusMessage] = useState('')
  const [obsScenes, setOBSScenes] = useState([])
  const [obsSelectedScene, setOBSSelectedScene] = useState('')
  const [obsCurrentScene, setObsCurrentScene] = useState('')
  const [obsSources, setOBSSources] = useState([])
  const [showOBSEventModal, setShowOBSEventModal] = useState(false)
  const [obsEventInsertIndex, setOBSEventInsertIndex] = useState(0)
  const [obsEventScene, setOBSEventScene] = useState('')
  const [obsEventSource, setOBSEventSource] = useState('')
  const [obsEventAction, setOBSEventAction] = useState('show')
  const [obsEventSources, setOBSEventSources] = useState([])
  const [obsEventTransition, setOBSEventTransition] = useState('')
  const [obsEventTransitionDuration, setOBSEventTransitionDuration] = useState(0)
  const [obsTransitions, setOBSTransitions] = useState([])
  const [obsEditingItemId, setOBSEditingItemId] = useState(null)

  const playlistRef = useRef(playlist)
  const visibleItemsRef = useRef(playlist)
  const filterActiveRef = useRef(false)
  const searchOpenRef = useRef(false)
  const shortcutsRef = useRef(shortcuts)
  const bindingLookupRef = useRef({})
  const capturingActionRef = useRef(null)
  const openPlaylistFileRef = useRef(null)
  const playlistRevisionRef = useRef(playlistRevision)
  const currentItemRef = useRef(currentItem)
  const isPlayingRef = useRef(isPlaying)
  const selectedItemsRef = useRef(selectedItems)
  const copiedItemsRef = useRef(copiedItems)
  const outputSettingsRef = useRef(outputSettings)
  const obsSettingsRef = useRef(obsSettings)
  const obsScenesRef = useRef(obsScenes)
  const obsConnectedRef = useRef(false)
  const obsReconnectStep = useRef(0)
  const obsNextAttempt = useRef(0)

  useEffect(() => {
    playlistRef.current = playlist
    playlistRevisionRef.current = playlistRevision
    currentItemRef.current = currentItem
    isPlayingRef.current = isPlaying
    selectedItemsRef.current = selectedItems
    copiedItemsRef.current = copiedItems
    outputSettingsRef.current = outputSettings
    obsSettingsRef.current = obsSettings
    obsScenesRef.current = obsScenes
  }, [playlist, playlistRevision, currentItem, isPlaying, selectedItems, copiedItems, outputSettings, obsSettings, obsScenes])

  const searchNeedle = searchOpen ? searchQuery.trim().toLowerCase() : ''
  const filterActive = searchNeedle.length > 0

  const visibleItems = useMemo(() => {
    if (!searchNeedle) return playlist
    const currentId = currentItem ? currentItem.id : null
    return playlist.filter(item => item.id === currentId || matchesSearch(item, searchNeedle))
  }, [playlist, currentItem, searchNeedle])

  const hiddenCount = playlist.length - visibleItems.length

  const bindingLookup = useMemo(() => {
    const lookup = {}
    SHORTCUT_ACTIONS.forEach(action => {
      const binding = shortcuts[action.id]
      if (binding && !lookup[binding]) lookup[binding] = action.id
    })
    return lookup
  }, [shortcuts])

  useEffect(() => {
    visibleItemsRef.current = visibleItems
    filterActiveRef.current = filterActive
    searchOpenRef.current = searchOpen
    shortcutsRef.current = shortcuts
    bindingLookupRef.current = bindingLookup
    capturingActionRef.current = capturingAction
  }, [visibleItems, filterActive, searchOpen, shortcuts, bindingLookup, capturingAction])

  useEffect(() => {
    if (!filterActive) return
    const visibleIds = new Set(visibleItems.map(item => item.id))
    setSelectedItems(prev => {
      const next = prev.filter(item => visibleIds.has(item.id))
      return next.length === prev.length ? prev : next
    })
  }, [filterActive, visibleItems])

  const addLog = useCallback((message, type = 'info') => {
    const now = new Date()
    const time = now.toLocaleTimeString('en-US', { hour12: false })
    const newLog = { id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`, time, message, type }
    setActivityLogs(prev => [newLog, ...prev].slice(0, MAX_LOG_ENTRIES))
  }, [])

  const pauseWS = useCallback(() => {
    wsPauseDepth.current += 1
  }, [])

  const resumeWS = useCallback(() => {
    wsPauseDepth.current = Math.max(0, wsPauseDepth.current - 1)
  }, [])

  const isRedundantState = useCallback((state) => {
    if (typeof state.revision !== 'number' || state.revision !== playlistRevisionRef.current) return false
    if ('is_playing' in state && Boolean(state.is_playing) !== isPlayingRef.current) return false
    if ('current_item' in state) {
      const incomingId = state.current_item ? state.current_item.id : null
      const knownId = currentItemRef.current ? currentItemRef.current.id : null
      if (incomingId !== knownId) return false
    }
    if (Array.isArray(state.playlist)) {
      const known = playlistRef.current
      if (state.playlist.length !== known.length) return false
      for (let index = 0; index < state.playlist.length; index++) {
        if (state.playlist[index].id !== known[index].id) return false
        if (state.playlist[index].start_time !== known[index].start_time) return false
      }
    }
    return true
  }, [])

  const applyPlaylistState = useCallback((state, force) => {
    if (!state) return
    if (!force && isRedundantState(state)) return
    if (Array.isArray(state.playlist)) setPlaylist(state.playlist)
    if ('current_item' in state) setCurrentItem(state.current_item || null)
    if ('is_playing' in state) setIsPlaying(Boolean(state.is_playing))
    if (typeof state.revision === 'number') setPlaylistRevision(state.revision)
  }, [isRedundantState])

  const pushAction = useCallback((action) => {
    const stack = undoStack.current
    stack.push(action)
    if (stack.length > MAX_UNDO_ENTRIES) {
      stack.splice(0, stack.length - MAX_UNDO_ENTRIES)
    }
  }, [])

  const clearUndoStack = useCallback(() => {
    undoStack.current = []
  }, [])

  const getCurrentIndex = useCallback(() => {
    const current = currentItemRef.current
    return current ? playlistRef.current.findIndex(i => i.id === current.id) : -1
  }, [])

  const clampInsertIndex = useCallback((index) => {
    const currentIndex = getCurrentIndex()
    if (isPlayingRef.current && currentIndex >= 0 && index <= currentIndex) {
      return currentIndex + 1
    }
    return index
  }, [getCurrentIndex])

  const toPlaylistIndex = useCallback((viewIndex) => {
    if (!filterActiveRef.current) return viewIndex
    const items = playlistRef.current
    const view = visibleItemsRef.current
    if (typeof viewIndex !== 'number' || viewIndex >= view.length) return items.length
    const target = view[Math.max(0, viewIndex)]
    const index = items.findIndex(item => item.id === target.id)
    return index >= 0 ? index : items.length
  }, [])

  const insertItemAt = useCallback((item, index) => {
    if (item.type === 'stop') {
      return api.insertStopEvent(index)
    }
    if (item.type === 'note') {
      return api.insertNote(index, item.note || '')
    }
    if (item.type === 'obs') {
      return api.insertOBSEvent(index, item.obs_scene || '', item.obs_source || '', item.obs_action || 'show', item.obs_transition || '', item.obs_transition_duration || 0)
    }
    if (item.location) {
      return api.addItem(item.location, index, item.loop)
    }
    return Promise.resolve(null)
  }, [])

  const insertedItemId = useCallback((result) => {
    return result && result.item ? result.item.id : null
  }, [])

  const insertSerializedItems = useCallback(async (items, position) => {
    if (!items || items.length === 0) return []
    try {
      const result = await api.restoreItems(items, position)
      if (result && result.success !== false && Array.isArray(result.items)) {
        return result.items.map(item => item.id).filter(id => id !== undefined && id !== null)
      }
    } catch (error) {
    }

    const ids = []
    let offset = 0
    for (const item of items) {
      const id = insertedItemId(await insertItemAt(item, position + offset))
      offset++
      if (id !== null) ids.push(id)
    }
    return ids
  }, [insertItemAt, insertedItemId])

  const duplicateItemAt = useCallback((item, index) => {
    if (item.type === 'video' || item.type === 'image') {
      return api.duplicateItem(item.id, index)
    }
    return insertItemAt(item, index)
  }, [insertItemAt])

  const beginOperation = useCallback(() => {
    if (opInFlight.current) {
      addLog('Another playlist operation is still running', 'warning')
      return false
    }
    opInFlight.current = true
    return true
  }, [addLog])

  const endOperation = useCallback(() => {
    opInFlight.current = false
  }, [])

  const scheduleValidationRefresh = useCallback((isRetry) => {
    clearTimeout(validationRefreshTimer.current)
    if (!isRetry) validationRefreshRetries.current = 0
    validationRefreshTimer.current = setTimeout(() => {
      if (wsPauseDepth.current !== 0) {
        if (validationRefreshRetries.current >= VALIDATION_REFRESH_RETRIES) return
        validationRefreshRetries.current += 1
        scheduleValidationRefresh(true)
        return
      }
      api.getPlaylist()
        .then(state => {
          applyPlaylistState(state)
          const pending = state && Array.isArray(state.playlist) && state.playlist.some(item => item.status === 'validating')
          if (!pending || validationRefreshRetries.current >= VALIDATION_REFRESH_RETRIES) return
          validationRefreshRetries.current += 1
          scheduleValidationRefresh(true)
        })
        .catch(() => {})
    }, VALIDATION_REFRESH_MS)
  }, [applyPlaylistState])

  const loadPlaylist = useCallback(async () => {
    try {
      const data = await api.getPlaylist()
      applyPlaylistState(data)
    } catch (error) {
    }
  }, [applyPlaylistState])

  const loadDisplays = useCallback(async () => {
    const electron = getElectron()
    if (!electron) return
    try {
      const displays = await electron.ipcRenderer.invoke('get-displays')
      setAvailableDisplays(displays)
    } catch (error) {
    }
  }, [])

  const loadAudioDevices = useCallback(async () => {
    const electron = getElectron()
    if (!electron) return
    try {
      const devices = await electron.ipcRenderer.invoke('audio:list-devices')
      setAudioDevices(Array.isArray(devices) ? devices : [])
    } catch (error) {
      setAudioDevices([])
    }
  }, [])

  const loadNetworkInfo = useCallback(async () => {
    try {
      const info = await api.getNetworkInfo()
      setNetworkInfo(info)
    } catch (error) {
    }
  }, [])

  const loadDiagnostics = useCallback(async (options) => {
    const electron = getElectron()
    if (!electron) return
    const refresh = Boolean(options && options.refresh)
    const adoptAcceleration = Boolean(options && options.adoptAcceleration)
    try {
      const report = normalizeDiagnostics(await electron.ipcRenderer.invoke('system:diagnostics', { refresh }))
      if (!report) return
      setDiagnostics(report)
      if (adoptAcceleration) setHardwareAcceleration(!report.gpu.accelerationDisabled)
    } catch (error) {
    }
  }, [])

  const restoreOutputWindow = useCallback(async () => {
    const electron = getElectron()
    if (!electron) return
    try {
      const isOpen = await electron.ipcRenderer.invoke('is-output-window-open')
      const settings = outputSettingsRef.current

      if (!settings.externalOutputEnabled || !settings.selectedDisplayId) {
        setOutputWindowActive(isOpen)
        return
      }

      const displays = await electron.ipcRenderer.invoke('get-displays')
      const available = Array.isArray(displays) && displays.some(display => display.id === settings.selectedDisplayId)

      if (!available) {
        setOutputSettings(prev => {
          const updated = { ...prev, externalOutputEnabled: false }
          localStorage.setItem('outputSettings', JSON.stringify(updated))
          return updated
        })
        setOutputWindowActive(false)
        addLog('The display used for the external output is not connected, output stays off', 'warning')
        return
      }

      if (!isOpen) {
        electron.ipcRenderer.send('open-output-window', settings.selectedDisplayId)
        setOutputWindowActive(true)
      } else {
        setOutputWindowActive(isOpen)
      }
    } catch (error) {
    }
  }, [addLog])

  const refreshUpdateState = useCallback(async () => {
    const electron = getElectron()
    if (!electron) return
    try {
      const state = await electron.ipcRenderer.invoke('update:get-state')
      if (state && typeof state === 'object') {
        setUpdateState(prev => ({ ...prev, ...state }))
      }
    } catch (error) {
    }
  }, [])

  useEffect(() => {
    loadPlaylist()
    loadDisplays()
    loadNetworkInfo()
    loadDiagnostics({ adoptAcceleration: true })
    restoreOutputWindow()

    api.updateOutputSettings(outputSettingsRef.current).catch(() => {})
    if (obsSettingsRef.current.enabled) {
      api.updateOBSSettings(obsSettingsRef.current)
        .then(() => api.obsConnect())
        .then(result => {
          if (result && result.success) {
            setOBSConnected(true)
            setOBSStatusMessage(`Connected to OBS v${result.obs_version}`)
            addLog(`OBS connected (v${result.obs_version})`, 'info')
          }
        })
        .catch(() => {})
    }

    const ws = api.connectWebSocket((data) => {
      if (data.type === 'playlist_updated') {
        if (wsPauseDepth.current === 0) {
          applyPlaylistState(data)
        }
        if (data.elapsed !== undefined) {
          setServerElapsed(data.elapsed)
        }
      } else if (data.type === 'playback_state_changed') {
        if ('is_playing' in data) setIsPlaying(Boolean(data.is_playing))
        if ('current_item' in data) setCurrentItem(data.current_item || null)
      } else if (data.type === 'item_cued') {
        if ('current_item' in data) setCurrentItem(data.current_item || null)
        if ('is_playing' in data) setIsPlaying(Boolean(data.is_playing))
        if (wsPauseDepth.current === 0 && Array.isArray(data.playlist)) {
          setPlaylist(data.playlist)
          if (typeof data.revision === 'number') setPlaylistRevision(data.revision)
        }
      } else if (data.type === 'volume_changed') {
        if (typeof data.volume === 'number') {
          if (pendingVolume.current === null || pendingVolume.current === data.volume) {
            pendingVolume.current = null
            setOutputVolume(data.volume)
          }
        }
      } else if (data.type === 'player_seek') {
        if (wsPauseDepth.current === 0 && Array.isArray(data.playlist)) {
          setPlaylist(data.playlist)
          if (typeof data.revision === 'number') setPlaylistRevision(data.revision)
        }
        if (typeof data.position === 'number') {
          setServerElapsed(Math.floor(data.position))
        }
      } else if (data.type === 'item_issue') {
        const authoritative = Array.isArray(data.playlist) ? data.playlist : null
        if (wsPauseDepth.current === 0) {
          if (authoritative) {
            applyPlaylistState(data, true)
          } else if (data.playability || data.issues || data.status) {
            setPlaylist(prev => prev.map(item => item.id === data.item_id
              ? {
                ...item,
                playability: data.playability || item.playability,
                issues: data.issues || item.issues,
                status: data.status || item.status
              }
              : item))
          }
        }
        const affected = (authoritative || playlistRef.current).find(item => item.id === data.item_id)
        const playability = affected ? affected.playability : data.playability
        if (affected && playability === 'unsupported') {
          addLog(`Playback issue: ${describeItem(affected)}`, 'warning')
        }
      } else if (data.type === 'audio_level') {
        audioLevelSource.publish(typeof data.level === 'number' ? data.level : 0)
      } else if (data.type === 'file_missing') {
        addLog(`File missing: ${data.message}`, 'error')
      }
    })

    const electron = getElectron()
    if (electron) {
      const { ipcRenderer } = electron
      ipcRenderer.on('output-window-closed', (event, info) => {
        setOutputWindowActive(false)
        setOutputSettings(prev => ({ ...prev, externalOutputEnabled: false }))
        const reason = info && info.reason
        if (reason === 'display-missing') {
          addLog('External output display is not connected', 'warning')
        } else if (reason === 'display-removed') {
          addLog('External output display was disconnected', 'warning')
        } else {
          addLog('External output closed', 'info')
        }
      })
      ipcRenderer.on('output-window-opened', () => {
        setOutputWindowActive(true)
      })
      ipcRenderer.on('displays-changed', () => {
        loadDisplays()
      })
      ipcRenderer.on('backend-restarted', () => {
        clearUndoStack()
        loadPlaylist()
        const settings = outputSettingsRef.current
        api.getOutputSettings()
          .then(engineSettings => {
            if (engineSettings && ENGINE_OUTPUT_KEYS.every(key => engineSettings[key] === settings[key])) return null
            return api.updateOutputSettings(settings).then(() => {
              addLog('Output settings re-applied to the engine', 'info')
            })
          })
          .catch(() => {})
        const obs = obsSettingsRef.current
        if (obs.enabled) {
          obsReconnectStep.current = 0
          obsNextAttempt.current = 0
          api.updateOBSSettings(obs)
            .then(() => api.obsConnect())
            .then(result => {
              if (result && result.success) {
                setOBSConnected(true)
                addLog('OBS reconnected after the engine restart', 'info')
              }
            })
            .catch(() => {})
        }
        addLog('Playout engine restarted after an unexpected stop', 'error')
      })
      ipcRenderer.on('open-playlist-file', (event, filePath) => {
        if (openPlaylistFileRef.current) openPlaylistFileRef.current(filePath)
      })
      ipcRenderer.on('update-available', (event, update) => {
        if (update && update.version) {
          setUpdateState(prev => ({
            ...prev,
            status: prev.status === 'downloading' || prev.status === 'ready' ? prev.status : 'available',
            version: update.version,
            notes: update.notes || prev.notes,
            url: update.url || prev.url
          }))
        }
      })
      ipcRenderer.on('update:state', (event, state) => {
        if (state && typeof state === 'object') {
          setUpdateState(prev => ({ ...prev, ...state }))
        }
      })
      ipcRenderer.on('update:progress', (event, progress) => {
        if (!progress) return
        const percent = typeof progress.percent === 'number'
          ? progress.percent
          : (progress.totalBytes ? (progress.receivedBytes / progress.totalBytes) * 100 : 0)
        setUpdateState(prev => ({ ...prev, status: 'downloading', progress: Math.max(0, Math.min(100, percent)) }))
      })
      Promise.all([ipcRenderer.invoke('read-autosave'), api.getPlaylist()])
        .then(([saved, current]) => {
          const items = extractPlaylistItems(saved)
          const backendEmpty = current && Array.isArray(current.playlist) && current.playlist.length === 0
          if (items.length > 0 && backendEmpty) {
            setRecoverySession({ items, savedAt: saved.savedAt })
          } else {
            autosaveReady.current = true
          }
        })
        .catch(() => {
          autosaveReady.current = true
        })
    } else {
      autosaveReady.current = true
    }

    return () => {
      ws.close()
      clearTimeout(validationRefreshTimer.current)
      clearTimeout(autosaveTimer.current)
      if (electron) {
        IPC_CHANNELS.forEach(channel => electron.ipcRenderer.removeAllListeners(channel))
      }
    }
  }, [addLog, applyPlaylistState, audioLevelSource, clearUndoStack, loadDiagnostics, loadDisplays, loadNetworkInfo, loadPlaylist, restoreOutputWindow])

  useEffect(() => {
    if (recoverySession && playlist.length > 0) {
      setRecoverySession(null)
      autosaveReady.current = true
    }
  }, [playlist, recoverySession])

  useEffect(() => {
    if (!autosaveReady.current) return
    if (playlistRevision >= 0) {
      if (playlistRevision === lastAutosaveRevision.current) return
      lastAutosaveRevision.current = playlistRevision
    }
    const payload = serializePlaylistItems(playlist)
    const signature = JSON.stringify(payload)
    if (signature === lastAutosave.current || signature === pendingAutosave.current) return
    pendingAutosave.current = signature
    clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => {
      const electron = getElectron()
      if (electron) {
        electron.ipcRenderer.send('write-autosave', payload)
      }
      lastAutosave.current = signature
      pendingAutosave.current = null
    }, AUTOSAVE_DELAY_MS)
  }, [playlist, playlistRevision])

  useEffect(() => {
    if (!obsSettings.enabled) {
      setOBSConnected(false)
      obsConnectedRef.current = false
      obsReconnectStep.current = 0
      obsNextAttempt.current = 0
      return
    }

    let cancelled = false

    const attemptReconnect = async () => {
      const now = Date.now()
      if (obsNextAttempt.current === 0) {
        obsNextAttempt.current = now + OBS_RECONNECT_DELAYS[0]
        return
      }
      if (now < obsNextAttempt.current) return
      const step = Math.min(obsReconnectStep.current + 1, OBS_RECONNECT_DELAYS.length - 1)
      obsReconnectStep.current = step
      obsNextAttempt.current = now + OBS_RECONNECT_DELAYS[step]
      try {
        const result = await api.obsConnect()
        if (cancelled || !result || !result.success) return
        obsReconnectStep.current = 0
        obsNextAttempt.current = 0
        obsConnectedRef.current = true
        setOBSConnected(true)
        setOBSStatusMessage(`Connected to OBS v${result.obs_version}`)
        addLog(`OBS reconnected (v${result.obs_version})`, 'info')
      } catch (error) {
      }
    }

    const checkStatus = async () => {
      let connected = false
      try {
        const status = await api.getOBSStatus()
        connected = Boolean(status && status.connected)
      } catch (error) {
        connected = false
      }
      if (cancelled) return

      if (connected) {
        obsReconnectStep.current = 0
        obsNextAttempt.current = 0
        if (!obsConnectedRef.current) {
          obsConnectedRef.current = true
          setOBSConnected(true)
        }
        return
      }

      if (obsConnectedRef.current) {
        obsConnectedRef.current = false
        setOBSConnected(false)
        setOBSStatusMessage('Connection lost, reconnecting...')
        addLog('OBS connection lost, reconnecting', 'warning')
      } else {
        setOBSConnected(false)
      }
      await attemptReconnect()
    }

    checkStatus()
    const interval = setInterval(checkStatus, OBS_STATUS_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [obsSettings.enabled, addLog])

  useEffect(() => {
    if (obsConnected) {
      api.getOBSScenes().then(data => {
        setOBSScenes(data.scenes || [])
        if (data.scenes && data.scenes.length > 0 && !obsSelectedScene) {
          setOBSSelectedScene(data.scenes[0])
        }
      }).catch(() => setOBSScenes([]))
      api.getOBSCurrentScene().then(data => {
        if (data && data.scene) setObsCurrentScene(data.scene)
      }).catch(() => {})
    } else {
      setOBSScenes([])
      setOBSSources([])
      setObsCurrentScene('')
    }
  }, [obsConnected, obsSelectedScene])

  useEffect(() => {
    if (obsConnected && obsSelectedScene) {
      api.getOBSSceneSources(obsSelectedScene).then(data => {
        setOBSSources(data.sources || [])
      }).catch(() => setOBSSources([]))
    } else {
      setOBSSources([])
    }
  }, [obsConnected, obsSelectedScene])

  useEffect(() => {
    if (showOBSEventModal && obsEventScene) {
      api.getOBSSceneSources(obsEventScene).then(data => {
        const sources = data.sources || []
        setOBSEventSources(sources)
        if (sources.length > 0) {
          setOBSEventSource(sources[0].sourceName)
        }
      }).catch(() => setOBSEventSources([]))
    }
  }, [showOBSEventModal, obsEventScene])

  useEffect(() => {
    if (!getElectron()) return
    refreshUpdateState()
    const interval = setInterval(refreshUpdateState, UPDATE_POLL_MS)
    return () => clearInterval(interval)
  }, [refreshUpdateState])

  useEffect(() => {
    if (updateState.status !== 'downloading') return
    const interval = setInterval(refreshUpdateState, UPDATE_PROGRESS_POLL_MS)
    return () => clearInterval(interval)
  }, [updateState.status, refreshUpdateState])

  useEffect(() => {
    if (!updateDownloadRequested.current) return
    if (updateState.status === 'ready') {
      updateDownloadRequested.current = false
      addLog('Update downloaded and ready to install', 'info')
    } else if (updateState.status === 'error') {
      updateDownloadRequested.current = false
      addLog(`Update download failed${updateState.error ? `: ${updateState.error}` : ''}`, 'error')
    }
  }, [updateState.status, updateState.error, addLog])

  useEffect(() => {
    if (showOutputSettings && settingsTab === 'output') {
      loadAudioDevices()
    }
  }, [showOutputSettings, settingsTab, loadAudioDevices])

  useEffect(() => {
    return () => {
      clearTimeout(settingsFeedbackTimer.current)
      clearTimeout(volumeTimer.current)
    }
  }, [])

  const flashSettingsFeedback = useCallback((message, tone = 'ok') => {
    setSettingsFeedback({ message, tone })
    clearTimeout(settingsFeedbackTimer.current)
    settingsFeedbackTimer.current = setTimeout(() => setSettingsFeedback(null), SETTINGS_FEEDBACK_MS)
  }, [])

  const requestConfirm = useCallback((options) => {
    setConfirmDialog(options)
  }, [])

  const runConfirmDialog = useCallback(() => {
    const dialog = confirmDialog
    setConfirmDialog(null)
    if (dialog && dialog.onConfirm) dialog.onConfirm()
  }, [confirmDialog])

  const cancelConfirmDialog = useCallback(() => {
    const dialog = confirmDialog
    setConfirmDialog(null)
    if (dialog && dialog.onCancel) dialog.onCancel()
  }, [confirmDialog])

  const handleUndo = useCallback(async () => {
    if (undoStack.current.length === 0) {
      addLog('Nothing to undo', 'warning')
      return
    }
    if (!beginOperation()) return
    pauseWS()

    const action = undoStack.current.pop()
    const progress = { started: false }

    try {
      const state = await api.getPlaylist()
      const items = state.playlist || []
      const playing = Boolean(state.is_playing)
      const currentId = state.current_item ? state.current_item.id : null
      const currentIndex = currentId !== null ? items.findIndex(i => i.id === currentId) : -1

      const refusal = undoRefusalReason(action, items, currentIndex, playing, currentId)
      if (refusal) {
        applyPlaylistState(state)
        addLog(`Undo refused (${action.label}): ${refusal}`, 'warning')
        return
      }

      const outcome = await applyUndoAction(action, items, progress)

      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)
      setSelectedItems(prev => {
        const liveIds = new Set((finalState.playlist || []).map(item => item.id))
        return prev.filter(item => liveIds.has(item.id))
      })

      if (outcome.applied) {
        if (outcome.partial) {
          addLog(`Undo partly applied (${action.label}): ${outcome.partial}`, 'warning')
        } else {
          addLog(`Undone: ${action.label}`, 'info')
        }
        if (action.type === 'removed_items') scheduleValidationRefresh()
      } else {
        addLog(`Undo refused (${action.label}): the engine did not accept it`, 'warning')
      }
    } catch (error) {
      if (progress.started) {
        addLog(`Undo failed: ${action.label}, the playlist may be partly changed`, 'error')
      } else {
        undoStack.current.push(action)
        addLog(`Undo failed: ${action.label}, it is still on the undo stack`, 'error')
      }
    } finally {
      resumeWS()
      endOperation()
    }
  }, [addLog, applyPlaylistState, beginOperation, endOperation, pauseWS, resumeWS, scheduleValidationRefresh])

  const handleSelectItem = useCallback((item, isCtrl, isShift) => {
    const items = visibleItemsRef.current
    const currentIndex = items.findIndex(i => i.id === item.id)
    const anchorIndex = lastSelectedId.current !== null
      ? items.findIndex(i => i.id === lastSelectedId.current)
      : -1

    if (isShift && anchorIndex >= 0) {
      const start = Math.min(anchorIndex, currentIndex)
      const end = Math.max(anchorIndex, currentIndex)
      setSelectedItems(items.slice(start, end + 1))
      selectionFocusId.current = item.id
    } else if (isCtrl) {
      const selected = selectedItemsRef.current
      const isAlreadySelected = selected.some(i => i.id === item.id)
      if (isAlreadySelected) {
        setSelectedItems(selected.filter(i => i.id !== item.id))
      } else {
        const nextIds = new Set(selected.map(i => i.id))
        nextIds.add(item.id)
        setSelectedItems(items.filter(i => nextIds.has(i.id)))
      }
      lastSelectedId.current = item.id
      selectionFocusId.current = item.id
    } else {
      setSelectedItems([item])
      lastSelectedId.current = item.id
      selectionFocusId.current = item.id
    }
  }, [])

  const handleClearSelection = useCallback(() => {
    lastSelectedId.current = null
    selectionFocusId.current = null
    setSelectedItems(prev => (prev.length === 0 ? prev : []))
  }, [])

  const handleArrowNavigation = useCallback((direction) => {
    const items = visibleItemsRef.current
    if (items.length === 0) return

    const selected = selectedItemsRef.current
    if (selected.length === 0) {
      setSelectedItems([items[0]])
      lastSelectedId.current = items[0].id
      selectionFocusId.current = items[0].id
      return
    }

    const focusIndex = items.findIndex(i => i.id === selectionFocusId.current)
    const reference = focusIndex >= 0 ? focusIndex : items.findIndex(i => i.id === selected[0].id)
    if (reference < 0) {
      setSelectedItems([items[0]])
      lastSelectedId.current = items[0].id
      selectionFocusId.current = items[0].id
      return
    }

    const newIndex = direction === 'up'
      ? Math.max(0, reference - 1)
      : Math.min(items.length - 1, reference + 1)

    if (newIndex !== reference || selected.length > 1) {
      setSelectedItems([items[newIndex]])
      lastSelectedId.current = items[newIndex].id
      selectionFocusId.current = items[newIndex].id
    }
  }, [])

  const handleExtendSelection = useCallback((direction) => {
    const items = visibleItemsRef.current
    if (items.length === 0) return

    const anchorIndex = items.findIndex(i => i.id === lastSelectedId.current)
    if (anchorIndex < 0) {
      handleArrowNavigation(direction)
      return
    }

    const focusIndex = items.findIndex(i => i.id === selectionFocusId.current)
    const reference = focusIndex >= 0 ? focusIndex : anchorIndex
    const newFocus = direction === 'up'
      ? Math.max(0, reference - 1)
      : Math.min(items.length - 1, reference + 1)

    selectionFocusId.current = items[newFocus].id
    const start = Math.min(anchorIndex, newFocus)
    const end = Math.max(anchorIndex, newFocus)
    setSelectedItems(items.slice(start, end + 1))
  }, [handleArrowNavigation])

  const handlePasteItems = useCallback(async () => {
    const copied = copiedItemsRef.current
    if (copied.length === 0) return
    if (!beginOperation()) return
    pauseWS()

    try {
      const items = playlistRef.current
      const selected = selectedItemsRef.current
      let insertIndex = items.length
      if (selected.length >= 1) {
        const lastIndex = items.findIndex(i => i.id === selected[selected.length - 1].id)
        if (lastIndex >= 0) insertIndex = lastIndex + 1
      }
      insertIndex = clampInsertIndex(insertIndex)

      const pastedIds = await insertSerializedItems(serializePlaylistItems(copied), insertIndex)

      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)

      if (pastedIds.length > 0) {
        pushAction({ type: 'added_items', itemIds: pastedIds, label: `pasted ${itemCountLabel(pastedIds.length)}` })
        const pastedSet = new Set(pastedIds)
        setSelectedItems((finalState.playlist || []).filter(i => pastedSet.has(i.id)))
      }

      addLog(`Pasted ${pastedIds.length} item(s)`, 'info')
      scheduleValidationRefresh()
    } catch (error) {
      addLog('Error pasting items', 'error')
    } finally {
      resumeWS()
      endOperation()
    }
  }, [addLog, applyPlaylistState, beginOperation, clampInsertIndex, endOperation, insertSerializedItems, pauseWS, pushAction, resumeWS, scheduleValidationRefresh])

  const handleDeleteConfirmed = useCallback(async () => {
    const selected = selectedItemsRef.current
    const current = currentItemRef.current
    const hasPlayingItem = selected.some(item => current && item.id === current.id)
    if (hasPlayingItem) {
      addLog('Cannot delete the item currently on air', 'warning')
      return
    }
    if (selected.length === 0) return
    if (!beginOperation()) return

    const items = playlistRef.current
    const itemsToDelete = [...selected]
    const originalIndices = itemsToDelete.map(item => items.findIndex(i => i.id === item.id))

    setSelectedItems([])
    pauseWS()

    try {
      await Promise.all(itemsToDelete.map(item => api.removeItem(item.id)))

      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)

      if (itemsToDelete.length <= MAX_UNDO_ITEMS) {
        pushAction({
          type: 'removed_items',
          runs: buildRestoreRuns(serializePlaylistItems(itemsToDelete), originalIndices),
          label: `deleted ${itemCountLabel(itemsToDelete.length)}`
        })
      } else {
        addLog('Too many items to keep an undo action', 'warning')
      }

      addLog(`Deleted ${itemsToDelete.length} item(s)`, 'info')
    } catch (error) {
      addLog('Error deleting items', 'error')
    } finally {
      resumeWS()
      endOperation()
    }
  }, [addLog, applyPlaylistState, beginOperation, endOperation, pauseWS, pushAction, resumeWS])

  const requestDeleteSelected = useCallback(() => {
    const selected = selectedItemsRef.current
    if (selected.length === 0) return
    const current = currentItemRef.current
    if (selected.some(item => current && item.id === current.id)) {
      addLog('Cannot delete the item currently on air', 'warning')
      return
    }
    requestConfirm({
      title: 'Delete items',
      body: `Delete ${itemCountLabel(selected.length)} from the playlist? The files stay on disk and Undo puts the rows back.`,
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: handleDeleteConfirmed
    })
  }, [addLog, handleDeleteConfirmed, requestConfirm])

  const handleCopySelection = useCallback(() => {
    const selected = selectedItemsRef.current
    if (selected.length === 0) return
    const selectedIds = new Set(selected.map(item => item.id))
    setCopiedItems(playlistRef.current.filter(item => selectedIds.has(item.id)))
    addLog(`Copied ${selected.length} item(s)`, 'info')
  }, [addLog])

  const handleSelectAll = useCallback(() => {
    const items = visibleItemsRef.current
    if (items.length === 0) return
    setSelectedItems(items)
    lastSelectedId.current = items[0].id
    selectionFocusId.current = items[items.length - 1].id
  }, [])

  const handleAddFiles = useCallback(async () => {
    const electron = getElectron()
    if (!electron) return
    if (!beginOperation()) return

    let paused = false
    try {
      const filePaths = await electron.ipcRenderer.invoke('select-files')
      if (!filePaths || filePaths.length === 0) return

      addLog(`Adding ${filePaths.length} file(s) to playlist...`, 'info')
      pauseWS()
      paused = true

      const addedIds = []
      for (const filepath of filePaths) {
        try {
          const id = insertedItemId(await api.addItem(filepath))
          if (id !== null) {
            addedIds.push(id)
          }
        } catch (error) {
          addLog(`Failed to add ${filepath}`, 'error')
        }
      }

      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)

      if (addedIds.length > 0) {
        pushAction({ type: 'added_items', itemIds: addedIds, label: `added ${itemCountLabel(addedIds.length)}` })
      }
      addLog(`Successfully added ${addedIds.length} file(s)`, 'info')
    } catch (error) {
      addLog('Error selecting files', 'error')
    } finally {
      if (paused) resumeWS()
      endOperation()
    }
  }, [addLog, applyPlaylistState, beginOperation, endOperation, insertedItemId, pauseWS, pushAction, resumeWS])

  const clearPlaylistConfirmed = useCallback(async () => {
    if (!beginOperation()) return
    pauseWS()

    const itemsToDelete = [...playlistRef.current]
    try {
      let cleared = false
      try {
        const result = await api.clearPlaylist()
        cleared = Boolean(result && result.success)
      } catch (error) {
        cleared = false
      }

      if (!cleared) {
        const current = currentItemRef.current
        for (const item of itemsToDelete) {
          if (current && item.id === current.id && isPlayingRef.current) continue
          await api.removeItem(item.id)
        }
      }

      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)

      const remaining = finalState.playlist || []
      if (remaining.length > 0) {
        addLog('The playlist was only partly cleared, no undo entry was kept', 'warning')
      } else if (itemsToDelete.length > MAX_UNDO_ITEMS) {
        addLog('Too many items to keep an undo action', 'warning')
      } else if (itemsToDelete.length > 0) {
        pushAction({
          type: 'removed_items',
          runs: [{ position: 0, items: serializePlaylistItems(itemsToDelete) }],
          label: `cleared the playlist (${itemCountLabel(itemsToDelete.length)})`
        })
      }

      setSelectedItems([])
      addLog('Playlist cleared', 'info')
    } catch (error) {
      addLog('Error clearing playlist', 'error')
    } finally {
      resumeWS()
      endOperation()
    }
  }, [addLog, applyPlaylistState, beginOperation, endOperation, pauseWS, pushAction, resumeWS])

  const handleClearPlaylist = useCallback(() => {
    if (isPlayingRef.current && currentItemRef.current) {
      addLog('Stop playback before clearing the playlist', 'warning')
      return
    }
    const count = playlistRef.current.length
    if (count === 0) {
      addLog('The playlist is already empty', 'info')
      return
    }
    requestConfirm({
      title: 'Clear Playlist',
      body: `Remove all ${itemCountLabel(count)} from the playlist? Nothing is deleted from disk and Undo puts them back.`,
      confirmLabel: 'Clear',
      tone: 'danger',
      onConfirm: clearPlaylistConfirmed
    })
  }, [addLog, clearPlaylistConfirmed, requestConfirm])

  const resolvePlaylistInsertIndex = useCallback(() => {
    const items = playlistRef.current
    const selected = selectedItemsRef.current
    if (selected.length === 0) return items.length
    const lastSelectedIndex = items.findIndex(item => item.id === selected[selected.length - 1].id)
    if (lastSelectedIndex < 0) return items.length
    const currentIndex = getCurrentIndex()
    if (currentIndex >= 0 && lastSelectedIndex < currentIndex) return null
    return lastSelectedIndex + 1
  }, [getCurrentIndex])

  const insertPlaylistItems = useCallback(async (items, insertIndex, label) => {
    let insertedIds = []
    pauseWS()
    try {
      insertedIds = await insertSerializedItems(items, insertIndex)
      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)
    } finally {
      resumeWS()
    }

    if (insertedIds.length > 0) {
      pushAction({
        type: 'added_items',
        itemIds: insertedIds,
        label: `${label} (${itemCountLabel(insertedIds.length)})`
      })
    }

    scheduleValidationRefresh()
    return insertedIds.length
  }, [applyPlaylistState, insertSerializedItems, pauseWS, pushAction, resumeWS, scheduleValidationRefresh])

  const loadPlaylistFile = useCallback(async (file, insertIndex) => {
    addLog(`Loading playlist: ${file.name}`, 'info')
    try {
      const items = extractPlaylistItems(JSON.parse(await file.text()))
      const count = await insertPlaylistItems(items, insertIndex, 'loaded a playlist')
      addLog(`Loaded ${count} items from ${file.name}`, 'info')
    } catch (error) {
      addLog('Error loading playlist file', 'error')
    }
  }, [addLog, insertPlaylistItems])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    e.stopPropagation()

    const files = Array.from(e.dataTransfer.files)
    const playlistFile = files.find(f => f.name.toLowerCase().endsWith('.flowair'))
    if (!playlistFile) return

    const insertIndex = resolvePlaylistInsertIndex()
    if (insertIndex === null) {
      addLog('Cannot insert playlist in grayed area', 'warning')
      return
    }
    if (!beginOperation()) return
    try {
      await loadPlaylistFile(playlistFile, insertIndex)
    } finally {
      endOperation()
    }
  }, [addLog, beginOperation, endOperation, loadPlaylistFile, resolvePlaylistInsertIndex])

  const handleExternalDrop = useCallback(async (files, viewIndex) => {
    if (!files || files.length === 0) return
    const filesArray = Array.from(files)
    const insertIndex = toPlaylistIndex(viewIndex)

    const playlistFile = filesArray.find(f => f.name.toLowerCase().endsWith('.flowair'))
    if (playlistFile) {
      if (!beginOperation()) return
      try {
        await loadPlaylistFile(playlistFile, clampInsertIndex(insertIndex))
      } finally {
        endOperation()
      }
      return
    }

    if (!beginOperation()) return
    const electron = getElectron()
    addLog(`Adding ${filesArray.length} file(s) via drag & drop...`, 'info')
    pauseWS()

    const addedIds = []
    let offset = 0
    const baseIndex = clampInsertIndex(insertIndex)
    try {
      for (const file of filesArray) {
        const filepath = electron && electron.webUtils ? electron.webUtils.getPathForFile(file) : file.path
        if (!filepath) {
          addLog(`Cannot read the location of ${file.name}`, 'error')
          continue
        }
        try {
          const id = insertedItemId(await api.addItem(filepath, baseIndex + offset))
          offset++
          if (id !== null) {
            addedIds.push(id)
          }
        } catch (error) {
          offset++
          addLog(`Failed to add ${file.name}`, 'error')
        }
      }

      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)

      if (addedIds.length > 0) {
        pushAction({ type: 'added_items', itemIds: addedIds, label: `added ${itemCountLabel(addedIds.length)}` })
      }
      addLog(`Successfully added ${addedIds.length} file(s)`, 'info')
    } catch (error) {
      addLog('Error adding dropped files', 'error')
    } finally {
      resumeWS()
      endOperation()
      scheduleValidationRefresh()
    }
  }, [addLog, applyPlaylistState, beginOperation, clampInsertIndex, endOperation, insertedItemId, loadPlaylistFile, pauseWS, pushAction, resumeWS, scheduleValidationRefresh, toPlaylistIndex])

  const handleDuplicateItem = useCallback(async (itemId, viewIndex) => {
    if (!beginOperation()) return
    pauseWS()
    try {
      const items = playlistRef.current
      const sourceIndex = items.findIndex(i => i.id === itemId)
      if (sourceIndex < 0) {
        addLog('The item to duplicate is no longer in the playlist', 'warning')
        return
      }
      const target = typeof viewIndex === 'number' && viewIndex >= 0 ? toPlaylistIndex(viewIndex) : sourceIndex + 1
      const result = await duplicateItemAt(items[sourceIndex], clampInsertIndex(target))
      const newId = insertedItemId(result)

      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)

      if (newId !== null) {
        pushAction({ type: 'added_items', itemIds: [newId], label: 'a duplicated item' })
        addLog('Item duplicated', 'info')
      } else {
        addLog('The item could not be duplicated', 'warning')
      }
    } catch (error) {
      addLog('Error duplicating item', 'error')
    } finally {
      resumeWS()
      endOperation()
    }
  }, [addLog, applyPlaylistState, beginOperation, clampInsertIndex, duplicateItemAt, endOperation, insertedItemId, pauseWS, pushAction, resumeWS, toPlaylistIndex])

  const handlePlay = useCallback(async () => {
    try {
      await api.play()
      setIsPlaying(true)
      addLog('Playback started', 'playback')
    } catch (error) {
      addLog('Error starting playback', 'error')
    }
  }, [addLog])

  const handleStop = useCallback(async () => {
    try {
      await api.stop()
      setIsPlaying(false)
      addLog('Playback stopped', 'playback')
    } catch (error) {
      addLog('Error stopping playback', 'error')
    }
  }, [addLog])

  const handleNext = useCallback(async () => {
    try {
      const selected = selectedItemsRef.current
      if (selected.length === 1) {
        const item = selected[0]
        const current = currentItemRef.current
        const isCurrentPlaying = current && current.id === item.id

        if (isCurrentPlaying) {
          await api.next()
          setSelectedItems([])
          addLog('Skipped to next item', 'playback')
        } else if (item.type === 'video' || item.type === 'image') {
          await api.cue(item.id)
          await api.play()
          setSelectedItems([])
          addLog(`Jumped to selected item: ${item.name}`, 'playback')
        } else {
          await api.next()
          addLog('Skipped to next item', 'playback')
        }
      } else {
        await api.next()
        addLog('Skipped to next item', 'playback')
      }
    } catch (error) {
      addLog('Error skipping to next', 'error')
    }
  }, [addLog])

  const handleExit = useCallback(() => {
    requestConfirm({
      title: 'Exit FlowAir',
      body: 'This closes the application completely. Anything currently on air stops.',
      confirmLabel: 'Exit',
      tone: 'danger',
      onConfirm: () => {
        const electron = getElectron()
        if (electron) {
          electron.ipcRenderer.send('exit-app')
        } else {
          window.close()
        }
      }
    })
  }, [requestConfirm])

  const handleSavePlaylist = useCallback(async () => {
    const electron = getElectron()
    if (!electron) return
    try {
      const result = await electron.ipcRenderer.invoke('save-playlist', serializePlaylistItems(playlistRef.current))
      if (result.success) {
        addLog(`Playlist saved: ${result.path}`, 'info')
      } else if (!result.canceled) {
        addLog('Error saving playlist', 'error')
      }
    } catch (error) {
      addLog('Error saving playlist', 'error')
    }
  }, [addLog])

  const handleLoadPlaylist = useCallback(async () => {
    const electron = getElectron()
    if (!electron) return
    if (!beginOperation()) return
    try {
      const result = await electron.ipcRenderer.invoke('load-playlist')
      if (result.success && result.data) {
        const insertIndex = resolvePlaylistInsertIndex()
        if (insertIndex === null) {
          addLog('Cannot insert playlist in grayed area', 'warning')
          return
        }
        const count = await insertPlaylistItems(extractPlaylistItems(result.data), clampInsertIndex(insertIndex), 'loaded a playlist')
        addLog(`Loaded ${count} items from playlist`, 'info')
      } else if (!result.canceled) {
        addLog('Error loading playlist', 'error')
      }
    } catch (error) {
      addLog('Error loading playlist', 'error')
    } finally {
      endOperation()
    }
  }, [addLog, beginOperation, clampInsertIndex, endOperation, insertPlaylistItems, resolvePlaylistInsertIndex])

  const loadPlaylistFromPath = useCallback(async (filePath) => {
    const fs = getNodeFs()
    if (!fs) return
    const name = fileNameFromPath(filePath)
    if (!beginOperation()) return
    try {
      const items = extractPlaylistItems(JSON.parse(await fs.promises.readFile(filePath, 'utf8')))
      if (items.length === 0) {
        addLog(`No playlist items in ${name}`, 'warning')
        return
      }
      const count = await insertPlaylistItems(items, playlistRef.current.length, 'loaded a playlist')
      addLog(`Loaded ${count} item(s) from ${name}`, 'info')
    } catch (error) {
      addLog(`Error loading ${name}`, 'error')
    } finally {
      endOperation()
    }
  }, [addLog, beginOperation, endOperation, insertPlaylistItems])

  const handleOpenPlaylistFile = useCallback((filePath) => {
    if (typeof filePath !== 'string' || filePath.length === 0) return
    const name = fileNameFromPath(filePath)
    const current = playlistRef.current.length
    if (current === 0) {
      loadPlaylistFromPath(filePath)
      return
    }
    requestConfirm({
      title: 'Load playlist file',
      body: `Add the items of "${name}" after the ${itemCountLabel(current)} already in the playlist? Nothing on air is touched.`,
      confirmLabel: 'Load',
      onConfirm: () => loadPlaylistFromPath(filePath)
    })
  }, [loadPlaylistFromPath, requestConfirm])

  useEffect(() => {
    openPlaylistFileRef.current = handleOpenPlaylistFile
  }, [handleOpenPlaylistFile])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
  }, [])

  const handleSearchChange = useCallback((text) => {
    setSearchOpen(true)
    setSearchQuery(typeof text === 'string' ? text : '')
  }, [])

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
  }, [])

  const handleRestoreSession = useCallback(async () => {
    if (!recoverySession) return
    const { items } = recoverySession
    setRecoverySession(null)
    autosaveReady.current = true
    if (!beginOperation()) return
    try {
      const count = await insertPlaylistItems(items, playlistRef.current.length, 'restored the last session')
      addLog(`Restored ${count} item(s) from the last session`, 'info')
    } catch (error) {
      addLog('Error restoring the last session', 'error')
    } finally {
      endOperation()
    }
  }, [addLog, beginOperation, endOperation, insertPlaylistItems, recoverySession])

  const handleDismissSession = useCallback(() => {
    setRecoverySession(null)
    autosaveReady.current = true
    lastAutosave.current = JSON.stringify([])
    const electron = getElectron()
    if (electron) {
      electron.ipcRenderer.send('write-autosave', [])
    }
  }, [])

  const sendVolume = useCallback((vol) => {
    api.setPlayerVolume(vol)
      .then(result => {
        if (pendingVolume.current !== vol) return
        pendingVolume.current = null
        if (result && typeof result.volume === 'number') setOutputVolume(result.volume)
      })
      .catch(() => {
        if (pendingVolume.current === vol) pendingVolume.current = null
      })
  }, [])

  const flushVolume = useCallback(() => {
    volumeTimer.current = null
    if (queuedVolume.current === null) return
    const vol = queuedVolume.current
    queuedVolume.current = null
    sendVolume(vol)
    volumeTimer.current = setTimeout(flushVolume, VOLUME_THROTTLE_MS)
  }, [sendVolume])

  const handleVolumeChange = useCallback((value) => {
    const vol = Math.max(0, Math.min(100, Math.round(value)))
    setOutputVolume(vol)
    pendingVolume.current = vol
    if (volumeTimer.current) {
      queuedVolume.current = vol
      return
    }
    sendVolume(vol)
    volumeTimer.current = setTimeout(flushVolume, VOLUME_THROTTLE_MS)
  }, [flushVolume, sendVolume])

  const handleSeek = useCallback((position, itemId) => {
    const current = currentItemRef.current
    if (!current || current.type !== 'video') return
    const targetId = itemId === undefined || itemId === null ? current.id : itemId
    if (targetId !== current.id) return
    setServerElapsed(Math.floor(position))
    api.seekPlayer(position, targetId)
      .then(result => {
        if (result && result.success === false) {
          addLog('Seek ignored, the item on air changed', 'warning')
        }
      })
      .catch(() => addLog('Error seeking video', 'error'))
  }, [addLog])

  const handleCue = useCallback(async (itemId) => {
    try {
      await api.cue(itemId)
      addLog('Item cued and loaded to preview', 'info')
    } catch (error) {
      addLog('Error cueing item', 'error')
    }
  }, [addLog])

  const handleCueSelected = useCallback(() => {
    const selected = selectedItemsRef.current
    if (selected.length === 1) handleCue(selected[0].id)
  }, [handleCue])

  const handleRemoveItem = useCallback(async (itemId) => {
    if (!beginOperation()) return
    pauseWS()
    try {
      const currentPlaylist = await api.getPlaylist()
      const items = currentPlaylist.playlist || []
      const itemIndex = items.findIndex(i => i.id === itemId)
      const itemToDelete = itemIndex >= 0 ? items[itemIndex] : null

      await api.removeItem(itemId)

      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)
      setSelectedItems(prev => prev.filter(i => i.id !== itemId))

      if (itemToDelete) {
        pushAction({
          type: 'removed_items',
          runs: [{ position: itemIndex, items: serializePlaylistItems([itemToDelete]) }],
          label: `deleted "${describeItem(itemToDelete)}"`
        })
      }

      addLog('Item removed from playlist', 'info')
    } catch (error) {
      addLog('Error removing item', 'error')
    } finally {
      resumeWS()
      endOperation()
    }
  }, [addLog, applyPlaylistState, beginOperation, endOperation, pauseWS, pushAction, resumeWS])

  const handleRequestRemove = useCallback((itemId) => {
    const item = playlistRef.current.find(i => i.id === itemId)
    if (!item) return
    const current = currentItemRef.current
    if (current && current.id === itemId && isPlayingRef.current) {
      addLog('Cannot delete the item currently on air', 'warning')
      return
    }
    requestConfirm({
      title: 'Remove Item',
      body: `Remove "${describeItem(item)}" from the playlist?`,
      confirmLabel: 'Remove',
      tone: 'danger',
      onConfirm: () => handleRemoveItem(itemId)
    })
  }, [addLog, handleRemoveItem, requestConfirm])

  const handleReorder = useCallback(async (fromIndex, toIndex) => {
    if (filterActiveRef.current) {
      addLog('Clear the find filter before moving items', 'warning')
      return
    }
    const items = playlistRef.current
    const draggedItem = items[fromIndex]
    if (!draggedItem) return
    if (!beginOperation()) return
    pauseWS()

    try {
      const selected = selectedItemsRef.current
      const selectedIds = new Set(selected.map(item => item.id))
      const isItemSelected = selectedIds.has(draggedItem.id)

      if (isItemSelected && selected.length > 1) {
        const movingIds = items.filter(item => selectedIds.has(item.id)).map(item => item.id)
        const tailIds = items.slice(getCurrentIndex() + 1).map(item => item.id)
        const position = items.slice(0, toIndex).filter(item => !selectedIds.has(item.id)).length

        const result = await api.moveItems(movingIds, position)
        if (result && result.success) {
          pushAction({ type: 'restore_order', itemIds: tailIds, label: `the move of ${itemCountLabel(movingIds.length)}` })
          addLog(`Moved ${movingIds.length} items`, 'info')
        } else {
          addLog('Items cannot be moved to that position', 'warning')
        }
      } else {
        const adjustedToIndex = toIndex > fromIndex ? toIndex - 1 : toIndex
        if (adjustedToIndex !== fromIndex) {
          const tailIds = items.slice(getCurrentIndex() + 1).map(item => item.id)
          const result = await api.reorderItems(fromIndex, adjustedToIndex)
          if (result && result.success === false) {
            addLog('The item cannot be moved to that position', 'warning')
          } else {
            pushAction({ type: 'restore_order', itemIds: tailIds, label: 'the reorder' })
            addLog(`Reordered item from position ${fromIndex + 1} to ${adjustedToIndex + 1}`, 'info')
          }
        }
      }

      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)
    } catch (error) {
      addLog('Error reordering items', 'error')
    } finally {
      resumeWS()
      endOperation()
    }
  }, [addLog, applyPlaylistState, beginOperation, endOperation, getCurrentIndex, pauseWS, pushAction, resumeWS])

  const handleMoveSelection = useCallback(async (direction) => {
    const now = Date.now()
    if (now - lastMoveAt.current < MOVE_THROTTLE_MS) return
    if (opInFlight.current) return
    lastMoveAt.current = now

    if (filterActiveRef.current) {
      addLog('Clear the find filter before moving items', 'warning')
      return
    }

    const items = playlistRef.current
    const selected = selectedItemsRef.current
    if (items.length === 0 || selected.length === 0) return

    const selectedIds = new Set(selected.map(item => item.id))
    const indices = items.reduce((acc, item, index) => {
      if (selectedIds.has(item.id)) acc.push(index)
      return acc
    }, [])
    if (indices.length === 0) return

    const first = indices[0]
    const last = indices[indices.length - 1]
    const aboveCount = items.slice(0, first).filter(item => !selectedIds.has(item.id)).length
    const belowCount = items.slice(last + 1).filter(item => !selectedIds.has(item.id)).length
    if (direction === 'up' && aboveCount === 0) return
    if (direction === 'down' && belowCount === 0) return

    const currentIndex = getCurrentIndex()
    const position = direction === 'up' ? aboveCount - 1 : aboveCount + 1

    if (isPlayingRef.current && currentIndex >= 0) {
      const lockedCount = items.slice(0, currentIndex + 1).filter(item => !selectedIds.has(item.id)).length
      if (first <= currentIndex || position < lockedCount) {
        addLog('Items at or before the item on air cannot be moved', 'warning')
        return
      }
    }

    if (!beginOperation()) return
    pauseWS()

    try {
      const movingIds = items.filter(item => selectedIds.has(item.id)).map(item => item.id)
      const tailIds = items.slice(currentIndex + 1).map(item => item.id)
      const result = await api.moveItems(movingIds, position)

      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)

      if (result && result.success) {
        pushAction({ type: 'restore_order', itemIds: tailIds, label: `the move of ${itemCountLabel(movingIds.length)}` })
        const movedSet = new Set(movingIds)
        setSelectedItems((finalState.playlist || []).filter(item => movedSet.has(item.id)))
      } else {
        addLog('Items cannot be moved to that position', 'warning')
      }
    } catch (error) {
      addLog('Error moving items', 'error')
    } finally {
      resumeWS()
      endOperation()
    }
  }, [addLog, applyPlaylistState, beginOperation, endOperation, getCurrentIndex, pauseWS, pushAction, resumeWS])

  const handleStopEvent = useCallback(async (viewIndex) => {
    if (!beginOperation()) return
    pauseWS()
    try {
      const id = insertedItemId(await api.insertStopEvent(clampInsertIndex(toPlaylistIndex(viewIndex))))

      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)

      if (id !== null) {
        pushAction({ type: 'added_items', itemIds: [id], label: 'the inserted STOP event' })
      }

      addLog('STOP EVENT inserted into playlist', 'info')
    } catch (error) {
      addLog('Error inserting stop event', 'error')
    } finally {
      resumeWS()
      endOperation()
    }
  }, [addLog, applyPlaylistState, beginOperation, clampInsertIndex, endOperation, insertedItemId, pauseWS, pushAction, resumeWS, toPlaylistIndex])

  const handleAddNote = useCallback(async (insertIndex, note, itemId) => {
    if (itemId) {
      const item = playlistRef.current.find(i => i.id === itemId)
      setNoteInputValue(item ? (item.note || '') : '')
      setEditingNoteId(itemId)
      setNoteInsertIndex(toPlaylistIndex(insertIndex))
      setShowNoteInput(true)
      return
    }

    if (!note) {
      setEditingNoteId(null)
      setNoteInputValue('')
      setNoteInsertIndex(toPlaylistIndex(insertIndex))
      setShowNoteInput(true)
      return
    }

    if (!beginOperation()) return
    pauseWS()
    try {
      const id = insertedItemId(await api.insertNote(clampInsertIndex(insertIndex), note))

      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)

      if (id !== null) {
        pushAction({ type: 'added_items', itemIds: [id], label: 'the inserted note' })
      }

      addLog(`Note inserted: "${note}"`, 'info')
      setShowNoteInput(false)
      setNoteInputValue('')
    } catch (error) {
      addLog('Error inserting note', 'error')
    } finally {
      resumeWS()
      endOperation()
    }
  }, [addLog, applyPlaylistState, beginOperation, clampInsertIndex, endOperation, insertedItemId, pauseWS, pushAction, resumeWS, toPlaylistIndex])

  const handleNoteConfirm = useCallback(async () => {
    const value = noteInputValue.trim()
    if (!value) {
      setShowNoteInput(false)
      setNoteInputValue('')
      setEditingNoteId(null)
      return
    }

    if (editingNoteId) {
      if (!beginOperation()) return
      const previous = playlistRef.current.find(item => item.id === editingNoteId)
      const previousNote = previous ? (previous.note || '') : null
      pauseWS()
      try {
        await api.updateNote(editingNoteId, value)

        const finalState = await api.getPlaylist()
        applyPlaylistState(finalState)

        if (previousNote !== null && previousNote !== value) {
          pushAction({ type: 'note_edit', itemId: editingNoteId, previousNote, label: 'the note edit' })
        }

        addLog(`Note updated: "${value}"`, 'info')
        setShowNoteInput(false)
        setNoteInputValue('')
        setEditingNoteId(null)
      } catch (error) {
        addLog('Error updating note', 'error')
      } finally {
        resumeWS()
        endOperation()
      }
      return
    }

    await handleAddNote(noteInsertIndex, value)
  }, [addLog, applyPlaylistState, beginOperation, editingNoteId, endOperation, handleAddNote, noteInputValue, noteInsertIndex, pauseWS, pushAction, resumeWS])

  const handleToggleLoop = useCallback(async (itemId) => {
    if (!beginOperation()) return
    const previous = playlistRef.current.find(item => item.id === itemId)
    const previousLoop = previous ? Boolean(previous.loop) : null
    pauseWS()
    try {
      const result = await api.toggleLoop(itemId)

      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)

      if (previousLoop !== null) {
        pushAction({ type: 'loop_toggle', itemId, previousLoop, label: 'the loop change' })
      }

      addLog(result && result.loop ? 'Loop enabled' : 'Loop disabled', 'info')
    } catch (error) {
      addLog('Error toggling loop', 'error')
    } finally {
      resumeWS()
      endOperation()
    }
  }, [addLog, applyPlaylistState, beginOperation, endOperation, pauseWS, pushAction, resumeWS])

  const handleTimeFormatChange = useCallback((format) => {
    setTimeFormat(format)
    localStorage.setItem('timeFormat', format)
  }, [])

  const handleToggleFollow = useCallback(() => {
    setFollowOnAir(prev => {
      const next = !prev
      localStorage.setItem('followOnAir', next ? '1' : '0')
      return next
    })
  }, [])

  const handleToggleLog = useCallback(() => {
    setLogCollapsed(prev => !prev)
  }, [])

  const handlePerformanceModeChange = useCallback((mode) => {
    if (!PERFORMANCE_MODES.includes(mode)) return
    localStorage.setItem(PERFORMANCE_MODE_KEY, mode)
    setPerformanceMode(mode)
    setPreviewOverride(false)
  }, [])

  const handleResumePreview = useCallback(() => {
    setPreviewOverride(true)
  }, [])

  const handleOpenDiagnostics = useCallback(() => {
    setSettingsTab('diagnostics')
    setShowOutputSettings(true)
  }, [])

  const handleDismissDiagnostics = useCallback(() => {
    const signature = diagnosticsSignature(diagnostics)
    localStorage.setItem(DIAGNOSTICS_DISMISS_KEY, signature)
    setDiagnosticsDismissed(signature)
  }, [diagnostics])

  const handleCopyDiagnostics = useCallback(() => {
    const text = diagnostics ? diagnostics.text : ''
    const fallback = () => {
      if (!text) {
        flashSettingsFeedback('Not copied', 'error')
        return
      }
      navigator.clipboard.writeText(text)
        .then(() => flashSettingsFeedback('Copied'))
        .catch(() => flashSettingsFeedback('Not copied', 'error'))
    }
    const electron = getElectron()
    if (!electron) {
      fallback()
      return
    }
    electron.ipcRenderer.invoke('system:copy-diagnostics')
      .then(result => {
        if (result && result.success === false) {
          fallback()
          return
        }
        flashSettingsFeedback('Copied')
      })
      .catch(fallback)
  }, [diagnostics, flashSettingsFeedback])

  const handleHardwareAccelerationChange = useCallback((enabled) => {
    const electron = getElectron()
    if (!electron) return
    setHardwareAcceleration(enabled)
    electron.ipcRenderer.invoke('system:set-hardware-acceleration', { enabled })
      .then(result => {
        if (result && result.success === false) {
          setHardwareAcceleration(typeof result.enabled === 'boolean' ? result.enabled : !enabled)
          flashSettingsFeedback('Not saved', 'error')
          return
        }
        if (result && typeof result.enabled === 'boolean') setHardwareAcceleration(result.enabled)
        setHardwareAccelerationPending(!result || result.restartRequired !== false)
        flashSettingsFeedback('Saved')
        loadDiagnostics({ refresh: true })
      })
      .catch(() => {
        setHardwareAcceleration(!enabled)
        flashSettingsFeedback('Not saved', 'error')
      })
  }, [flashSettingsFeedback, loadDiagnostics])

  const handleOutputSettingsChange = useCallback((key, value) => {
    setOutputSettings(prev => {
      const updated = { ...prev, [key]: value }
      localStorage.setItem('outputSettings', JSON.stringify(updated))
      return updated
    })
  }, [])

  const handleApplyVideoSettings = useCallback(async () => {
    const settings = outputSettingsRef.current
    try {
      const result = await api.updateOutputSettings(settings)
      if (!result || result.success === false) {
        flashSettingsFeedback('Not applied', 'error')
        addLog('The engine did not accept the video settings', 'error')
        return
      }
      flashSettingsFeedback('Applied')
      addLog(`Video output set to ${settings.resolution} ${settings.aspectRatio} (${settings.scalingMode})`, 'info')
    } catch (error) {
      flashSettingsFeedback('Not applied', 'error')
      addLog('Error applying video settings', 'error')
    }
  }, [addLog, flashSettingsFeedback])

  const handleApplyExternalOutput = useCallback(async () => {
    const electron = getElectron()
    const settings = outputSettingsRef.current
    let engineAccepted = false
    try {
      const result = await api.updateOutputSettings(settings)
      engineAccepted = Boolean(result && result.success !== false)
      if (engineAccepted) {
        flashSettingsFeedback('Applied')
      } else {
        flashSettingsFeedback('Not applied', 'error')
        addLog('The engine did not accept the output settings', 'error')
      }
    } catch (error) {
      flashSettingsFeedback('Not applied', 'error')
      addLog('Error applying output settings', 'error')
    }

    if (!electron) return
    try {
      if (settings.externalOutputEnabled && settings.selectedDisplayId) {
        electron.ipcRenderer.send('open-output-window', settings.selectedDisplayId)
        setOutputWindowActive(true)
        addLog('External output window opened', 'info')
      } else if (!settings.externalOutputEnabled && outputWindowActive) {
        electron.ipcRenderer.send('close-output-window')
        setOutputWindowActive(false)
        addLog('External output window closed', 'info')
      }
      if (engineAccepted) {
        addLog(settings.audioDeviceLabel
          ? `Audio output set to "${settings.audioDeviceLabel}"`
          : 'Audio output set to the system default', 'info')
      }
    } catch (error) {
      flashSettingsFeedback('Not applied', 'error')
      addLog('Error applying external output', 'error')
    }
  }, [addLog, flashSettingsFeedback, outputWindowActive])

  const handleApplyNetworkStreaming = useCallback(async () => {
    const settings = outputSettingsRef.current
    try {
      const result = await api.updateOutputSettings(settings)
      if (!result || result.success === false) {
        flashSettingsFeedback('Not applied', 'error')
        addLog('The engine did not accept the network streaming settings', 'error')
        return
      }
      flashSettingsFeedback('Applied')
      addLog(`Network streaming ${settings.networkStreamingEnabled ? 'enabled' : 'disabled'}`, 'info')
    } catch (error) {
      flashSettingsFeedback('Not applied', 'error')
      addLog('Error applying network streaming settings', 'error')
    }
  }, [addLog, flashSettingsFeedback])

  const handleOBSSettingsChange = useCallback((key, value) => {
    setOBSSettings(prev => {
      const updated = { ...prev, [key]: value }
      localStorage.setItem('obsSettings', JSON.stringify(updated))
      return updated
    })
  }, [])

  const handleApplyOBSSettings = useCallback(async () => {
    setOBSStatusMessage('Connecting...')
    obsReconnectStep.current = 0
    obsNextAttempt.current = 0
    try {
      const settings = obsSettingsRef.current
      const saved = await api.updateOBSSettings(settings)
      if (!saved || saved.success === false) {
        setOBSStatusMessage('The engine did not accept the OBS settings')
        flashSettingsFeedback('Not applied', 'error')
        addLog('The engine did not accept the OBS settings', 'error')
        return
      }
      if (settings.enabled) {
        const result = await api.obsConnect()
        const connected = Boolean(result && result.success)
        obsConnectedRef.current = connected
        setOBSConnected(connected)
        if (connected) {
          setOBSStatusMessage(`Connected to OBS v${result.obs_version}`)
          flashSettingsFeedback('Connected')
          addLog(`OBS connected (v${result.obs_version})`, 'info')
        } else {
          setOBSStatusMessage(`Failed: ${(result && result.error) || 'Unknown error'}`)
          flashSettingsFeedback('Not connected', 'error')
          addLog(`OBS connection failed: ${(result && result.error) || 'Unknown error'}`, 'error')
        }
      } else {
        await api.obsDisconnect()
        obsConnectedRef.current = false
        setOBSConnected(false)
        setOBSStatusMessage('')
        flashSettingsFeedback('Applied')
        addLog('OBS integration disabled', 'info')
      }
    } catch (err) {
      setOBSStatusMessage(`Error: ${err.message || 'Could not reach backend'}`)
      flashSettingsFeedback('Not applied', 'error')
      addLog('Error applying OBS settings', 'error')
    }
  }, [addLog, flashSettingsFeedback])

  const handleOBSSourceToggle = useCallback(async (sourceName, currentVisible) => {
    try {
      await api.setOBSSourceVisibility(obsSelectedScene, sourceName, !currentVisible)
      const data = await api.getOBSSceneSources(obsSelectedScene)
      setOBSSources(data.sources || [])
    } catch (error) {
      addLog('Error toggling OBS source', 'error')
    }
  }, [addLog, obsSelectedScene])

  const handleActivateOBSScene = useCallback(async () => {
    if (!obsSelectedScene) return
    try {
      const result = await api.setOBSScene(obsSelectedScene)
      if (result && result.success) {
        setObsCurrentScene(obsSelectedScene)
        addLog(`OBS: switched to scene "${obsSelectedScene}"`, 'playback')
      } else {
        addLog('Error switching OBS scene', 'error')
      }
    } catch (error) {
      addLog('Error switching OBS scene', 'error')
    }
  }, [addLog, obsSelectedScene])

  const handleInsertOBSEvent = useCallback(async (insertIndex, obsScene, obsSource, obsAction, obsTransition = '', obsTransitionDuration = 0, itemId = null) => {
    if (!beginOperation()) return
    const edited = itemId ? playlistRef.current.find(item => item.id === itemId) : null
    pauseWS()
    try {
      const result = await api.insertOBSEvent(itemId ? insertIndex : clampInsertIndex(insertIndex), obsScene, obsSource, obsAction, obsTransition, obsTransitionDuration, itemId)
      const finalState = await api.getPlaylist()
      applyPlaylistState(finalState)

      const newId = itemId ? null : insertedItemId(result)
      if (newId !== null) {
        pushAction({ type: 'added_items', itemIds: [newId], label: 'the inserted OBS event' })
      } else if (edited) {
        pushAction({
          type: 'obs_edit',
          itemId,
          previous: {
            scene: edited.obs_scene || '',
            source: edited.obs_source || '',
            action: edited.obs_action || 'show',
            transition: edited.obs_transition || '',
            transitionDuration: edited.obs_transition_duration || 0
          },
          label: 'the OBS event edit'
        })
      }

      const verb = itemId ? 'updated' : 'added'
      if (obsAction === 'switch_scene') {
        addLog(`OBS Event ${verb}: switch to "${obsScene}"`, 'info')
      } else {
        addLog(`OBS Event ${verb}: ${obsAction} "${obsSource}" in "${obsScene}"`, 'info')
      }
    } catch (error) {
      addLog('Error saving OBS event', 'error')
    } finally {
      resumeWS()
      endOperation()
    }
  }, [addLog, applyPlaylistState, beginOperation, clampInsertIndex, endOperation, insertedItemId, pauseWS, pushAction, resumeWS])

  const loadOBSTransitions = useCallback(async () => {
    try {
      const data = await api.getOBSTransitions()
      setOBSTransitions(data.transitions || [])
      return data
    } catch (error) {
      setOBSTransitions([])
      return { transitions: [], current: null }
    }
  }, [])

  const handleShowOBSEventModal = useCallback((insertIndex) => {
    setOBSEditingItemId(null)
    setOBSEventInsertIndex(toPlaylistIndex(insertIndex))
    setOBSEventScene(obsScenesRef.current[0] || '')
    setOBSEventSource('')
    setOBSEventAction('show')
    setOBSEventSources([])
    setOBSEventTransition('')
    setOBSEventTransitionDuration(0)
    loadOBSTransitions()
    setShowOBSEventModal(true)
  }, [loadOBSTransitions, toPlaylistIndex])

  const handleEditOBSEvent = useCallback((item) => {
    if (!item || item.type !== 'obs') return
    setOBSEditingItemId(item.id)
    setOBSEventScene(item.obs_scene || obsScenesRef.current[0] || '')
    setOBSEventSource(item.obs_source || '')
    setOBSEventAction(item.obs_action || 'show')
    setOBSEventTransition(item.obs_transition || '')
    setOBSEventTransitionDuration(item.obs_transition_duration || 0)
    setOBSEventSources([])
    loadOBSTransitions()
    setShowOBSEventModal(true)
  }, [loadOBSTransitions])

  const resetOutputSettingsConfirmed = useCallback(async () => {
    const defaults = {
      resolution: '1920x1080',
      aspectRatio: '16:9',
      quality: 'max',
      scalingMode: 'stretch',
      externalOutputEnabled: false,
      selectedDisplayId: null,
      networkStreamingEnabled: false,
      audioDeviceLabel: ''
    }
    setOutputSettings(defaults)
    localStorage.setItem('outputSettings', JSON.stringify(defaults))

    try {
      const electron = getElectron()
      if (electron) {
        electron.ipcRenderer.send('close-output-window')
      }
      setOutputWindowActive(false)

      const result = await api.updateOutputSettings(defaults)
      if (!result || result.success === false) {
        flashSettingsFeedback('Not applied', 'error')
        addLog('The engine did not accept the default output settings', 'error')
        return
      }

      const obsDefaults = { enabled: false, host: 'localhost', port: 4455, password: '' }
      setOBSSettings(obsDefaults)
      localStorage.setItem('obsSettings', JSON.stringify(obsDefaults))
      await api.obsDisconnect().catch(() => {})
      obsConnectedRef.current = false
      setOBSConnected(false)

      flashSettingsFeedback('Reset to defaults')
      addLog('All settings reset to factory defaults', 'info')
    } catch (error) {
      flashSettingsFeedback('Not applied', 'error')
      addLog('Error resetting settings', 'error')
    }
  }, [addLog, flashSettingsFeedback])

  const handleResetOutputSettings = useCallback(() => {
    requestConfirm({
      title: 'Reset to Factory',
      body: 'This closes the external output window, disconnects OBS and restores every setting to its default value.',
      confirmLabel: 'Reset',
      tone: 'danger',
      onConfirm: resetOutputSettingsConfirmed
    })
  }, [requestConfirm, resetOutputSettingsConfirmed])

  const startUpdateDownload = useCallback(() => {
    const electron = getElectron()
    if (!electron) return
    updateDownloadRequested.current = true
    electron.ipcRenderer.invoke('update:download')
      .then(state => {
        if (state && typeof state === 'object') setUpdateState(prev => ({ ...prev, ...state }))
        const status = state && state.status
        if (status === 'downloading') {
          addLog('Downloading the update in the background', 'info')
        } else if (status !== 'ready' && status !== 'error') {
          updateDownloadRequested.current = false
        }
      })
      .catch(() => {
        updateDownloadRequested.current = false
        setUpdateState(prev => ({ ...prev, status: 'error', error: 'The download could not be started' }))
      })
  }, [addLog])

  const cancelUpdateDownload = useCallback(() => {
    const electron = getElectron()
    if (!electron) return
    updateDownloadRequested.current = false
    electron.ipcRenderer.invoke('update:cancel')
      .then(() => refreshUpdateState())
      .catch(() => {})
    addLog('Update download cancelled', 'info')
  }, [addLog, refreshUpdateState])

  const dismissUpdateVersion = useCallback(() => {
    const electron = getElectron()
    if (!electron) return
    const version = updateState.version
    electron.ipcRenderer.invoke('update:dismiss', { version }).catch(() => {})
    setUpdateState(prev => ({ ...prev, status: 'idle', progress: 0, error: '', downloaded: false }))
    setShowUpdatePanel(false)
    addLog(`Update v${version} will not be offered again`, 'info')
  }, [addLog, updateState.version])

  const setUpdateChecksEnabled = useCallback((enabled) => {
    const electron = getElectron()
    if (!electron) return
    setUpdateState(prev => ({ ...prev, enabled }))
    electron.ipcRenderer.invoke('update:set-enabled', { enabled })
      .then(state => {
        if (state && typeof state === 'object') setUpdateState(prev => ({ ...prev, ...state }))
        addLog(`Automatic update checks ${enabled ? 'enabled' : 'disabled'}`, 'info')
      })
      .catch(() => {})
  }, [addLog])

  const installUpdate = useCallback(() => {
    const electron = getElectron()
    if (!electron) return
    const run = (force) => {
      setShowUpdatePanel(false)
      addLog('Installing the update, FlowAir will close', 'info')
      electron.ipcRenderer.invoke('update:install', { force })
        .then(result => {
          if (result && result.success === false) {
            const reason = result.reason
            const message = INSTALL_FAILURE_MESSAGES[reason] || 'The update could not be installed'
            addLog(message, reason === 'on-air' || reason === 'installing' ? 'warning' : 'error')
          }
        })
        .catch(() => {
          addLog('The update could not be installed', 'error')
        })
    }
    if (isPlayingRef.current || currentItemRef.current) {
      requestConfirm({
        title: 'Install while on air?',
        body: 'FlowAir is on air. Installing closes the application and the channel goes off air for about two minutes. Stop playback first unless this is planned.',
        confirmLabel: 'Install anyway',
        tone: 'danger',
        onConfirm: () => run(true)
      })
      return
    }
    run(false)
  }, [addLog, requestConfirm])

  const openReleasePage = useCallback(() => {
    const electron = getElectron()
    if (electron) electron.ipcRenderer.send('open-release-page')
  }, [])

  const storeShortcuts = useCallback((bindings) => {
    setShortcuts(bindings)
    setShortcutLoadWarning('')
    shortcutsRef.current = bindings
    try {
      localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(bindings))
    } catch (error) {
    }
  }, [])

  const assignShortcut = useCallback(async (actionId, binding) => {
    const action = SHORTCUT_ACTIONS.find(item => item.id === actionId)
    if (!action) return
    if (!isValidBinding(binding)) {
      setShortcutMessage('That key cannot be used as a shortcut')
      return
    }
    if (isReservedBinding(binding)) {
      setShortcutMessage(RESERVED_KEY_TOKENS.includes(bindingKeyToken(binding))
        ? 'The arrow keys belong to playlist navigation and cannot be assigned'
        : `${binding} is reserved by Windows or by FlowAir`)
      return
    }
    if (action.global && !binding.includes('+')) {
      setShortcutMessage('A shortcut that works outside FlowAir needs Ctrl, Alt or Shift')
      return
    }
    const current = shortcutsRef.current
    if (current[actionId] === binding) {
      setCapturingAction(null)
      setShortcutMessage('')
      return
    }
    const owner = SHORTCUT_ACTIONS.find(item => item.id !== actionId && current[item.id] === binding)
    if (owner) {
      setShortcutMessage(`${binding} is already used by "${owner.label}"`)
      return
    }
    if (action.global) {
      const answer = await requestGlobalShortcut(toAccelerator(binding))
      if (!answer || answer.success === false) {
        setShortcutMessage((answer && answer.message) || `${binding} was refused, the previous shortcut is still active`)
        return
      }
    }
    storeShortcuts({ ...current, [actionId]: binding })
    setCapturingAction(null)
    setShortcutMessage('')
    flashSettingsFeedback('Applied')
  }, [flashSettingsFeedback, storeShortcuts])

  const startShortcutCapture = useCallback((actionId) => {
    setShortcutMessage('')
    setCapturingAction(prev => (prev === actionId ? null : actionId))
  }, [])

  const resetShortcut = useCallback((actionId) => {
    const action = SHORTCUT_ACTIONS.find(item => item.id === actionId)
    if (!action) return
    setCapturingAction(null)
    assignShortcut(actionId, action.defaultBinding)
  }, [assignShortcut])

  const resetAllShortcuts = useCallback(async () => {
    const bindings = { ...DEFAULT_SHORTCUTS }
    let message = ''
    if (shortcutsRef.current.output !== DEFAULT_SHORTCUTS.output) {
      const answer = await requestGlobalShortcut(toAccelerator(DEFAULT_SHORTCUTS.output))
      if (!answer || answer.success === false) {
        bindings.output = shortcutsRef.current.output
        message = (answer && answer.message) || `${DEFAULT_SHORTCUTS.output} was refused, the previous shortcut is still active`
      }
    }
    setCapturingAction(null)
    setShortcutMessage(message)
    storeShortcuts(bindings)
    flashSettingsFeedback(message ? 'Partly applied' : 'Applied')
  }, [flashSettingsFeedback, storeShortcuts])

  useEffect(() => {
    if (!capturingAction) return
    const handleCapture = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      if (e.key === 'Escape') {
        setCapturingAction(null)
        setShortcutMessage('')
        return
      }
      const binding = bindingFromEvent(e)
      if (!binding) return
      assignShortcut(capturingAction, binding)
    }
    window.addEventListener('keydown', handleCapture, true)
    return () => window.removeEventListener('keydown', handleCapture, true)
  }, [assignShortcut, capturingAction])

  useEffect(() => {
    if (showOutputSettings && settingsTab === 'shortcuts') return
    setCapturingAction(null)
    setShortcutMessage('')
  }, [showOutputSettings, settingsTab])

  useEffect(() => {
    const binding = shortcutsRef.current.output
    if (!binding || binding === DEFAULT_SHORTCUTS.output) return
    requestGlobalShortcut(toAccelerator(binding)).catch(() => {})
  }, [])

  const runShortcutAction = useCallback((actionId) => {
    if (actionId === 'play') {
      if (isPlayingRef.current) {
        handleStop()
      } else {
        handlePlay()
      }
      return
    }
    if (actionId === 'stop') {
      handleStop()
      return
    }
    if (actionId === 'next') {
      handleNext()
      return
    }
    if (actionId === 'cue') {
      handleCueSelected()
      return
    }
    if (actionId === 'remove') {
      requestDeleteSelected()
      return
    }
    if (actionId === 'undo') {
      handleUndo()
      return
    }
    if (actionId === 'copy') {
      handleCopySelection()
      return
    }
    if (actionId === 'paste') {
      if (copiedItemsRef.current.length > 0) handlePasteItems()
      return
    }
    if (actionId === 'search') {
      openSearch()
      return
    }
    if (actionId === 'selectAll') {
      handleSelectAll()
      return
    }
    if (actionId === 'exit') {
      handleExit()
    }
  }, [
    handleCopySelection,
    handleCueSelected,
    handleExit,
    handleNext,
    handlePasteItems,
    handlePlay,
    handleSelectAll,
    handleStop,
    handleUndo,
    openSearch,
    requestDeleteSelected
  ])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (capturingActionRef.current) return

      const typing = isTypingTarget(e.target)
      const binding = bindingFromEvent(e)

      if (binding && !typing && binding === shortcutsRef.current.output && outputWindowActive) {
        e.preventDefault()
        const electron = getElectron()
        if (electron) {
          electron.ipcRenderer.send('close-output-window')
          setOutputWindowActive(false)
          setOutputSettings(prev => {
            const updated = { ...prev, externalOutputEnabled: false }
            localStorage.setItem('outputSettings', JSON.stringify(updated))
            return updated
          })
          addLog('External output closed', 'info')
        }
        return
      }

      if (confirmDialog) {
        if (e.repeat) {
          e.preventDefault()
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          runConfirmDialog()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancelConfirmDialog()
        }
        return
      }

      if (recoverySession) {
        if (e.repeat) {
          e.preventDefault()
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          handleRestoreSession()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          handleDismissSession()
        }
        return
      }

      if (showNoteInput) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowNoteInput(false)
          setNoteInputValue('')
        }
        return
      }

      if (showOBSEventModal) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowOBSEventModal(false)
        }
        return
      }

      if (showOutputSettings) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowOutputSettings(false)
        }
        return
      }

      if (showUpdatePanel && e.key === 'Escape') {
        e.preventDefault()
        setShowUpdatePanel(false)
        return
      }

      if (searchOpenRef.current && e.key === 'Escape') {
        e.preventDefault()
        handleSearchClose()
        return
      }

      if (typing) return

      const key = typeof e.key === 'string' ? e.key.toLowerCase() : ''
      const isArrow = key === 'arrowup' || key === 'arrowdown'

      if (isArrow) {
        const direction = key === 'arrowup' ? 'up' : 'down'
        if (e.altKey || e.metaKey) return
        e.preventDefault()
        if (e.ctrlKey && !e.shiftKey) {
          handleMoveSelection(direction)
        } else if (e.shiftKey && !e.ctrlKey) {
          handleExtendSelection(direction)
        } else if (!e.ctrlKey && !e.shiftKey) {
          handleArrowNavigation(direction)
        }
        return
      }

      if (!binding) return

      const actionId = bindingLookupRef.current[binding]
      if (!actionId || actionId === 'output') return
      if (isActivationTarget(e.target, e.key)) return

      e.preventDefault()
      if (e.repeat) return
      runShortcutAction(actionId)
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    addLog,
    cancelConfirmDialog,
    confirmDialog,
    handleArrowNavigation,
    handleDismissSession,
    handleExtendSelection,
    handleMoveSelection,
    handleRestoreSession,
    handleSearchClose,
    outputWindowActive,
    recoverySession,
    runConfirmDialog,
    runShortcutAction,
    showNoteInput,
    showOBSEventModal,
    showOutputSettings,
    showUpdatePanel
  ])

  const selectedItem = useMemo(() => (selectedItems.length === 1 ? selectedItems[0] : null), [selectedItems])

  const nextHighlightId = useMemo(
    () => resolveNextHighlightId(playlist, currentItem, isPlaying, serverElapsed),
    [playlist, currentItem, isPlaying, serverElapsed]
  )

  const handleOpenLocation = useCallback(async (filepath) => {
    if (!filepath) {
      addLog('This item has no file location', 'warning')
      return
    }
    const electron = getElectron()
    if (!electron) return
    try {
      const result = await electron.ipcRenderer.invoke('shell:show-item', filepath)
      if (!result || result.success === false) {
        addLog(`The folder for "${filepath}" could not be opened`, 'warning')
      }
    } catch (error) {
      addLog('The file location could not be opened', 'warning')
    }
  }, [addLog])

  const handleRevalidateItem = useCallback(async (itemId) => {
    try {
      const result = await api.revalidateItem(itemId)
      if (!result || result.success === false) {
        addLog('This item can no longer be checked', 'warning')
        return
      }
      await loadPlaylist()
      scheduleValidationRefresh()
    } catch (error) {
      addLog('The item could not be checked again', 'error')
    }
  }, [addLog, loadPlaylist, scheduleValidationRefresh])

  const handleContainerClick = useCallback((e) => {
    if (confirmDialog || recoverySession || showNoteInput || showOBSEventModal || showOutputSettings || showUpdatePanel) return

    const clickedPlaylist = e.target.closest('.playlist-container')
    const clickedButton = e.target.closest('button')
    const clickedInput = e.target.closest('input')

    if (!clickedPlaylist && !clickedButton && !clickedInput) {
      handleClearSelection()
    }
  }, [confirmDialog, handleClearSelection, recoverySession, showNoteInput, showOBSEventModal, showOutputSettings, showUpdatePanel])

  const electronAvailable = useMemo(() => Boolean(getElectron()), [])

  const audioDeviceOptions = useMemo(() => {
    const labels = []
    audioDevices.forEach(device => {
      const label = device && device.label ? device.label : ''
      if (label && !labels.includes(label)) labels.push(label)
    })
    return labels
  }, [audioDevices])

  const audioDeviceMissing = Boolean(outputSettings.audioDeviceLabel) && audioDeviceOptions.length > 0 && !audioDeviceOptions.includes(outputSettings.audioDeviceLabel)

  const diagnosticsLevel = diagnostics ? diagnostics.health.level : 'ok'
  const performanceActive = performanceMode === 'on' || (performanceMode === 'auto' && diagnosticsLevel !== 'ok')
  const previewSuspended = performanceActive && outputWindowActive && !previewOverride
  const previewCountdown = previewSuspended ? formatRemaining(currentItem, serverElapsed) : ''

  useEffect(() => {
    if (!outputWindowActive) setPreviewOverride(false)
  }, [outputWindowActive])

  useEffect(() => {
    if (performanceMode !== 'auto' || !previewSuspended) return
    const signature = diagnosticsSignature(diagnostics)
    if (performanceAutoLogged.current === signature) return
    performanceAutoLogged.current = signature
    addLog('Performance mode on: the preview stopped decoding while the output window is live', 'warning')
  }, [addLog, diagnostics, performanceMode, previewSuspended])

  useEffect(() => {
    if (!showOutputSettings || settingsTab !== 'diagnostics') return
    loadDiagnostics({ refresh: true })
  }, [loadDiagnostics, settingsTab, showOutputSettings])

  const diagnosticsBannerVisible = diagnosticsLevel !== 'ok' && diagnosticsDismissed !== diagnosticsSignature(diagnostics)

  const updateAvailable = updateState.status === 'available' || updateState.status === 'downloading' || updateState.status === 'ready' || updateState.status === 'installing'
  const releaseNotes = (updateState.notes || '').slice(0, MAX_RELEASE_NOTES)
  const updateProgress = Math.max(0, Math.min(100, Math.round(updateState.progress || 0)))

  return (
    <div style={styles.container} onDragOver={handleDragOver} onDrop={handleDrop} onClick={handleContainerClick}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.brand}>
            <h1 style={styles.title}>FlowAir</h1>
            <span style={styles.credits}>© TridentSky</span>
            <span style={styles.version}>v{APP_VERSION}</span>
          </div>
          <LiveIndicator isPlaying={isPlaying} />
          <HeaderClock timeFormat={timeFormat} />
          <button
            style={timeFormat === '12' ? styles.timeFormatButtonActive : styles.timeFormatButton}
            onClick={() => handleTimeFormatChange('12')}
          >
            12:00
          </button>
          <button
            style={timeFormat === '24' ? styles.timeFormatButtonActive : styles.timeFormatButton}
            onClick={() => handleTimeFormatChange('24')}
          >
            24:00
          </button>
        </div>
        <div style={styles.headerRight}>
          {electronAvailable && (
            <button
              style={updateAvailable ? { ...styles.headerButton, ...styles.updateButton } : { ...styles.headerButton, ...styles.headerIconButton }}
              onClick={() => setShowUpdatePanel(prev => !prev)}
              title={updateAvailable ? `FlowAir v${updateState.version} is available` : 'Updates'}
            >
              <Icon name="download" size={14} />
              {updateAvailable && <span>v{updateState.version}</span>}
            </button>
          )}
          <button style={styles.headerButton} onClick={() => setShowOutputSettings(true)} title="Settings">
            <Icon name="settings" size={14} />
            <span>Settings</span>
          </button>
          <button style={{ ...styles.headerButton, ...styles.clearButton }} onClick={handleClearPlaylist} title="Remove every item from the playlist">
            <Icon name="trash" size={14} />
            <span>Clear Playlist</span>
          </button>
          <button style={styles.headerButton} onClick={handleAddFiles} title="Add media files to the playlist">
            <Icon name="plus" size={14} />
            <span>Add Files</span>
          </button>
          <button style={styles.headerButton} onClick={handleSavePlaylist} title="Save the playlist to a .flowair file">
            <Icon name="save" size={14} />
            <span>Save</span>
          </button>
          <button style={styles.headerButton} onClick={handleLoadPlaylist} title="Load a .flowair playlist">
            <Icon name="folder" size={14} />
            <span>Load</span>
          </button>
          <button style={{ ...styles.headerButton, ...styles.exitHeaderButton }} onClick={handleExit} title={shortcuts.exit ? `Exit FlowAir (${shortcuts.exit})` : 'Exit FlowAir'}>
            <Icon name="close" size={14} />
            <span>Exit</span>
          </button>
        </div>
      </div>

      {diagnosticsBannerVisible && (
        <div style={diagnosticsLevel === 'critical' ? { ...styles.diagBanner, ...styles.diagBannerCritical } : styles.diagBanner}>
          <span style={styles.diagBannerIcon}><Icon name="alert" size={16} /></span>
          <div style={styles.diagBannerText}>
            <span style={styles.diagBannerTitle}>
              {diagnosticsLevel === 'critical'
                ? 'This PC cannot play video smoothly'
                : 'This PC may not play video smoothly'}
            </span>
            <span style={styles.diagBannerBody}>
              {diagnostics && diagnostics.health.reasons.length > 0
                ? diagnostics.health.reasons[0]
                : 'Video is being decoded by the processor because no graphics driver is active. Playback may stutter and the countdown may freeze. Install the graphics driver from the support page of the PC maker.'}
            </span>
          </div>
          <button className="btn-subtle" style={styles.diagBannerButton} onClick={handleOpenDiagnostics}>
            Details
          </button>
          <button
            className="close-button-hover"
            style={styles.closeButton}
            onClick={handleDismissDiagnostics}
            title="Hide this message until the diagnosis changes"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {showUpdatePanel && (
        <div style={styles.flyoutAnchor}>
          <div style={styles.updatePanel} className="update-panel">
            <div style={styles.updatePanelHeader}>
              <span style={styles.updatePanelTitle}>
                {updateAvailable ? `FlowAir v${updateState.version}` : 'Software updates'}
              </span>
              <button
                className="close-button-hover"
                style={styles.closeButton}
                onClick={() => setShowUpdatePanel(false)}
                title="Close (Esc)"
              >
                <Icon name="close" size={14} />
              </button>
            </div>

            <div style={styles.updatePanelBody}>
              {!updateAvailable && updateState.status !== 'error' && (
                <div style={styles.updateText}>FlowAir is up to date.</div>
              )}

              {updateState.status === 'available' && (
                <>
                  <div style={styles.updateText}>A new version is available. Downloading is safe while on air, installing is not.</div>
                  {releaseNotes && <div style={styles.updateNotes}>{releaseNotes}</div>}
                </>
              )}

              {updateState.status === 'downloading' && (
                <>
                  <div style={styles.updateText}>Downloading... {updateProgress}%</div>
                  <div style={styles.progressTrack}>
                    <div style={{ ...styles.progressFill, width: `${updateProgress}%` }} />
                  </div>
                </>
              )}

              {updateState.status === 'ready' && (
                <div style={styles.updateText}>
                  The update is downloaded. FlowAir closes during the installation and the channel is off air for about two minutes.
                </div>
              )}

              {updateState.status === 'installing' && (
                <div style={styles.updateText}>Installing... FlowAir closes as soon as the installer starts.</div>
              )}

              {(updateState.error || updateState.status === 'error') && (
                <div style={styles.updateError}>{updateState.error || 'The update could not be downloaded.'}</div>
              )}

              <label style={styles.updateToggle}>
                <input
                  type="checkbox"
                  checked={updateState.enabled !== false}
                  onChange={(e) => setUpdateChecksEnabled(e.target.checked)}
                  style={styles.checkbox}
                />
                Check for updates automatically
              </label>
              <div style={styles.updateHint}>
                Only checks and tells you here. Nothing is downloaded or installed unless you ask for it.
              </div>
            </div>

            <div style={styles.updatePanelButtons}>
              {updateState.status === 'available' && (
                <button style={{ ...styles.modalButton, ...styles.modalButtonPrimary }} onClick={startUpdateDownload}>Download</button>
              )}
              {updateState.status === 'downloading' && (
                <button style={{ ...styles.modalButton, ...styles.modalButtonCancel }} onClick={cancelUpdateDownload}>Cancel</button>
              )}
              {updateState.status === 'ready' && (
                <button style={{ ...styles.modalButton, ...styles.modalButtonPrimary }} onClick={installUpdate}>Install now</button>
              )}
              {updateState.status === 'error' && (
                <button style={{ ...styles.modalButton, ...styles.modalButtonPrimary }} onClick={startUpdateDownload}>Retry</button>
              )}
              {updateState.url && (
                <button style={{ ...styles.modalButton, ...styles.modalButtonCancel }} onClick={openReleasePage}>Release page</button>
              )}
              {updateAvailable && updateState.status !== 'installing' && (
                <button className="btn-subtle" style={styles.updateSubtleButton} onClick={dismissUpdateVersion}>Don't show this version again</button>
              )}
              <button style={{ ...styles.modalButton, ...styles.modalButtonCancel }} onClick={() => setShowUpdatePanel(false)}>Later</button>
            </div>
          </div>
        </div>
      )}

      <div style={styles.mainContent} className="main-content-area">
        <div style={styles.leftPanel}>
          <MemoControls
            isPlaying={isPlaying}
            selectedItem={selectedItem}
            selectedItems={selectedItems}
            onPlay={handlePlay}
            onStop={handleStop}
            onNext={handleNext}
            onCue={handleCueSelected}
            shortcuts={shortcuts}
          />

          <MemoTimer
            currentItem={currentItem}
            isPlaying={isPlaying}
            serverElapsed={serverElapsed}
            editMode={editMode}
            onToggleEditMode={setEditMode}
            onSeek={handleSeek}
            volume={outputVolume}
            onVolumeChange={handleVolumeChange}
          />

          <MemoPlaylist
            items={visibleItems}
            currentItem={currentItem}
            isPlaying={isPlaying}
            selectedItems={selectedItems}
            onSelectItem={handleSelectItem}
            onRemoveItem={handleRemoveItem}
            onRequestRemove={handleRequestRemove}
            onDuplicateItem={handleDuplicateItem}
            onCueItem={handleCue}
            onReorder={handleReorder}
            onStopEvent={handleStopEvent}
            onAddNote={handleAddNote}
            onToggleLoop={handleToggleLoop}
            onExternalDrop={handleExternalDrop}
            timeFormat={timeFormat}
            onInsertOBSEvent={handleShowOBSEventModal}
            onEditOBSEvent={handleEditOBSEvent}
            obsConnected={obsConnected}
            followOnAir={followOnAir}
            onToggleFollow={handleToggleFollow}
            nextHighlightId={nextHighlightId}
            onOpenLocation={handleOpenLocation}
            onRevalidateItem={handleRevalidateItem}
            onClearSelection={handleClearSelection}
            searchOpen={searchOpen}
            searchQuery={searchQuery}
            filterActive={filterActive}
            hiddenCount={hiddenCount}
            onSearchChange={handleSearchChange}
            onSearchClose={handleSearchClose}
          />
        </div>

        <div style={styles.rightPanel}>
          <MemoPreview
            currentItem={currentItem}
            isPlaying={isPlaying}
            decoding={!previewSuspended}
            lowPower={performanceActive}
            countdown={previewCountdown}
            onResumePreview={handleResumePreview}
            audioLevelSource={audioLevelSource}
          />
          {obsSettings.enabled && obsConnected && (
            <div style={styles.obsControlPanel}>
              <div style={styles.obsControlHeader}>
                <span style={styles.obsControlTitle}>OBS CONTROL</span>
                <span style={styles.obsConnectedTag}>CONNECTED</span>
              </div>
              <div style={styles.obsControlBody}>
                <div style={styles.obsSceneRow}>
                  <select
                    style={styles.obsSceneSelect}
                    value={obsSelectedScene}
                    onChange={(e) => setOBSSelectedScene(e.target.value)}
                  >
                    {obsScenes.map(scene => (
                      <option key={scene} value={scene}>{scene}</option>
                    ))}
                  </select>
                  <button
                    style={{
                      ...styles.obsActivateButton,
                      ...(obsCurrentScene === obsSelectedScene ? styles.obsActivateButtonActive : {})
                    }}
                    onClick={handleActivateOBSScene}
                    disabled={obsCurrentScene === obsSelectedScene}
                    title={obsCurrentScene === obsSelectedScene ? 'This scene is already live' : 'Switch the program to this scene'}
                  >
                    {obsCurrentScene === obsSelectedScene ? 'ON AIR' : 'Activate'}
                  </button>
                </div>
                <div style={styles.obsSourceList}>
                  {obsSources.map(source => (
                    <div key={source.sourceName} style={styles.obsSourceRow}>
                      <span style={styles.obsSourceName}>{source.sourceName}</span>
                      <button
                        style={{
                          ...styles.obsToggleButton,
                          ...(source.sceneItemEnabled ? styles.obsToggleActive : {})
                        }}
                        onClick={() => handleOBSSourceToggle(source.sourceName, source.sceneItemEnabled)}
                      >
                        {source.sceneItemEnabled ? 'VISIBLE' : 'HIDDEN'}
                      </button>
                    </div>
                  ))}
                  {obsSources.length === 0 && (
                    <div style={styles.obsEmptyText}>
                      No sources in this scene
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <MemoActivityLog
        collapsed={logCollapsed}
        onToggle={handleToggleLog}
        logs={activityLogs}
      />

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          body={confirmDialog.body}
          confirmLabel={confirmDialog.confirmLabel}
          cancelLabel={confirmDialog.cancelLabel}
          tone={confirmDialog.tone}
          focus={confirmDialog.focus}
          outputBinding={shortcuts.output}
          onConfirm={runConfirmDialog}
          onCancel={cancelConfirmDialog}
        />
      )}

      {!confirmDialog && recoverySession && (
        <ConfirmDialog
          title="Restore last session"
          body={`The last session ended with ${itemCountLabel(recoverySession.items.length)} in the playlist${recoverySession.savedAt ? ` (saved ${new Date(recoverySession.savedAt).toLocaleString('en-US')})` : ''}. Load them into the empty playlist?`}
          confirmLabel="Restore"
          cancelLabel="Dismiss"
          focus="confirm"
          outputBinding={shortcuts.output}
          onConfirm={handleRestoreSession}
          onCancel={handleDismissSession}
        />
      )}

      {showNoteInput && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>Insert Note</div>
            <div style={styles.modalBody}>
              <input
                type="text"
                style={styles.noteInput}
                value={noteInputValue}
                onChange={(e) => setNoteInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    handleNoteConfirm()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setShowNoteInput(false)
                    setNoteInputValue('')
                  }
                }}
                placeholder="Enter note text..."
                autoFocus
              />
            </div>
            <div style={styles.modalButtons}>
              <button
                style={{ ...styles.modalButton, ...styles.modalButtonConfirm }}
                onClick={handleNoteConfirm}
              >
                Insert (Enter)
              </button>
              <button
                style={{ ...styles.modalButton, ...styles.modalButtonCancel }}
                onClick={() => {
                  setShowNoteInput(false)
                  setNoteInputValue('')
                }}
              >
                Cancel (Esc)
              </button>
            </div>
          </div>
        </div>
      )}

      {showOBSEventModal && (() => {
        const isSwitchScene = obsEventAction === 'switch_scene'
        const canSubmit = obsEventScene && (isSwitchScene || obsEventSource)
        const submitOBSEvent = async () => {
          if (!canSubmit) return
          await handleInsertOBSEvent(
            obsEventInsertIndex,
            obsEventScene,
            isSwitchScene ? '' : obsEventSource,
            obsEventAction,
            isSwitchScene ? obsEventTransition : '',
            isSwitchScene ? Number(obsEventTransitionDuration) || 0 : 0,
            obsEditingItemId
          )
          setShowOBSEventModal(false)
        }
        return (
        <div style={styles.modalOverlay} onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setShowOBSEventModal(false)
          } else if (e.key === 'Enter') {
            submitOBSEvent()
          }
        }}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>{obsEditingItemId ? 'Edit OBS Event' : 'Insert OBS Event'}</div>
            <div style={styles.modalBody}>
              <div style={styles.settingRow}>
                <label style={styles.settingLabel}>Action</label>
                <select
                  style={styles.settingSelect}
                  value={obsEventAction}
                  onChange={(e) => setOBSEventAction(e.target.value)}
                >
                  <option value="switch_scene">Switch Scene (Program)</option>
                  <option value="show">Show Source</option>
                  <option value="hide">Hide Source</option>
                </select>
              </div>
              <div style={styles.settingRow}>
                <label style={styles.settingLabel}>{isSwitchScene ? 'Target Scene' : 'Scene'}</label>
                <select
                  style={styles.settingSelect}
                  value={obsEventScene}
                  onChange={(e) => setOBSEventScene(e.target.value)}
                >
                  {obsScenes.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {!isSwitchScene && (
                <div style={styles.settingRow}>
                  <label style={styles.settingLabel}>Source</label>
                  <select
                    style={styles.settingSelect}
                    value={obsEventSource}
                    onChange={(e) => setOBSEventSource(e.target.value)}
                  >
                    <option value="">-- Select a source --</option>
                    {obsEventSources.map(s => (
                      <option key={s.sourceName} value={s.sourceName}>{s.sourceName}</option>
                    ))}
                  </select>
                </div>
              )}
              {isSwitchScene && (
                <>
                  <div style={styles.settingRow}>
                    <label style={styles.settingLabel}>Transition</label>
                    <select
                      style={styles.settingSelect}
                      value={obsEventTransition}
                      onChange={(e) => setOBSEventTransition(e.target.value)}
                    >
                      <option value="">Use current transition</option>
                      {obsTransitions.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div style={styles.settingRow}>
                    <label style={styles.settingLabel}>Duration (ms)</label>
                    <input
                      type="number"
                      min="0"
                      step="50"
                      style={styles.settingSelect}
                      value={obsEventTransitionDuration}
                      onChange={(e) => setOBSEventTransitionDuration(e.target.value)}
                      placeholder="0 = keep current"
                    />
                  </div>
                </>
              )}
            </div>
            <div style={styles.modalButtons}>
              <button
                style={{ ...styles.modalButton, ...styles.modalButtonPrimary, ...(!canSubmit && { opacity: 0.45, cursor: 'not-allowed' }) }}
                disabled={!canSubmit}
                onClick={submitOBSEvent}
              >
                {obsEditingItemId ? 'Save' : 'Insert'}
              </button>
              <button
                style={{ ...styles.modalButton, ...styles.modalButtonCancel }}
                onClick={() => setShowOBSEventModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
        )
      })()}

      {showOutputSettings && (
        <div style={styles.modalOverlay}>
          <div style={styles.outputModal}>
            <div style={styles.modalHeader}>
              <span>Settings</span>
              <div style={styles.settingsHeaderRight}>
                {settingsFeedback && (
                  <span style={settingsFeedback.tone === 'error' ? styles.settingsFeedbackError : styles.settingsFeedback}>
                    {settingsFeedback.message}
                  </span>
                )}
                <button
                  className="close-button-hover"
                  style={styles.closeButton}
                  onClick={() => setShowOutputSettings(false)}
                  title="Close (Esc)"
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            </div>

            <div style={styles.tabBar}>
              <button
                className="btn-subtle"
                style={settingsTab === 'video' ? { ...styles.tab, ...styles.tabActive } : styles.tab}
                onClick={() => setSettingsTab('video')}
              >
                Video
              </button>
              <button
                className="btn-subtle"
                style={settingsTab === 'output' ? { ...styles.tab, ...styles.tabActive } : styles.tab}
                onClick={() => setSettingsTab('output')}
              >
                Output
              </button>
              <button
                className="btn-subtle"
                style={settingsTab === 'network' ? { ...styles.tab, ...styles.tabActive } : styles.tab}
                onClick={() => setSettingsTab('network')}
              >
                Network
              </button>
              <button
                className="btn-subtle"
                style={settingsTab === 'obs' ? { ...styles.tab, ...styles.tabActive } : styles.tab}
                onClick={() => setSettingsTab('obs')}
              >
                OBS
              </button>
              <button
                className="btn-subtle"
                style={settingsTab === 'shortcuts' ? { ...styles.tab, ...styles.tabActive } : styles.tab}
                onClick={() => setSettingsTab('shortcuts')}
              >
                Shortcuts
              </button>
              <button
                className="btn-subtle"
                style={settingsTab === 'diagnostics' ? { ...styles.tab, ...styles.tabActive } : styles.tab}
                onClick={() => setSettingsTab('diagnostics')}
              >
                Diagnostics
              </button>
            </div>

            <div style={styles.outputModalBody}>

              {settingsTab === 'video' && (
                <div style={styles.settingSection}>
                  <div style={styles.settingGroupTitle}>Program picture</div>
                  <div style={styles.settingGroupDesc}>
                    How the picture leaving FlowAir is built. It applies to the fullscreen output, the network player and OBS captures.
                  </div>

                  <div style={styles.settingRow}>
                    <label style={styles.settingLabel}>Resolution</label>
                    <select
                      style={styles.settingSelect}
                      value={outputSettings.resolution}
                      onChange={(e) => handleOutputSettingsChange('resolution', e.target.value)}
                    >
                      <option value="1920x1080">1920x1080 (Full HD)</option>
                      <option value="1280x720">1280x720 (HD)</option>
                      <option value="2560x1440">2560x1440 (QHD)</option>
                      <option value="3840x2160">3840x2160 (4K UHD)</option>
                    </select>
                  </div>
                  <div style={styles.settingHint}>The size of the output picture. Higher numbers cost more CPU on this machine.</div>

                  <div style={styles.settingRow}>
                    <label style={styles.settingLabel}>Aspect Ratio</label>
                    <select
                      style={styles.settingSelect}
                      value={outputSettings.aspectRatio}
                      onChange={(e) => handleOutputSettingsChange('aspectRatio', e.target.value)}
                    >
                      <option value="16:9">16:9 (Widescreen)</option>
                      <option value="9:16">9:16 (Vertical)</option>
                      <option value="4:3">4:3 (Standard)</option>
                      <option value="1:1">1:1 (Square)</option>
                      <option value="21:9">21:9 (Ultrawide)</option>
                    </select>
                  </div>
                  <div style={styles.settingHint}>The shape of the output picture. Use 16:9 for a normal television channel.</div>

                  <div style={styles.settingRow}>
                    <label style={styles.settingLabel}>Scaling Mode</label>
                    <select
                      style={styles.settingSelect}
                      value={outputSettings.scalingMode}
                      onChange={(e) => handleOutputSettingsChange('scalingMode', e.target.value)}
                    >
                      <option value="stretch">Stretch (Force Fullscreen)</option>
                      <option value="fit">Fit (Maintain Aspect Ratio)</option>
                      <option value="fill">Fill (Crop to Fit)</option>
                    </select>
                  </div>
                  <div style={styles.settingHint}>
                    What happens when a clip does not match the output shape: Stretch fills the screen, Fit keeps the clip whole with
                    black bars, Fill crops the edges away.
                  </div>

                  <div style={styles.sectionButtonRow}>
                    {settingsFeedback && (
                      <span style={settingsFeedback.tone === 'error' ? styles.settingsFeedbackError : styles.settingsFeedback}>
                        {settingsFeedback.message}
                      </span>
                    )}
                    <button
                      style={{ ...styles.sectionButton, ...styles.sectionButtonPrimary }}
                      onClick={handleApplyVideoSettings}
                    >
                      Apply Video Settings
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'output' && (
                <div style={styles.settingSection}>
                  <div style={styles.settingGroupTitle}>Fullscreen output</div>
                  <div style={styles.settingGroupDesc}>
                    The second screen that carries the channel. Closing it takes the channel off that screen immediately.
                  </div>

                  <div style={styles.settingRow}>
                    <label style={styles.settingLabel}>
                      <input
                        type="checkbox"
                        checked={outputSettings.externalOutputEnabled || false}
                        onChange={(e) => handleOutputSettingsChange('externalOutputEnabled', e.target.checked)}
                        style={styles.checkbox}
                      />
                      Enable External Output
                    </label>
                  </div>
                  <div style={styles.settingHint}>Opens a fullscreen window on the chosen display when you apply.</div>

                  {outputSettings.externalOutputEnabled && (
                    <div style={styles.settingRow}>
                      <label style={styles.settingLabel}>Select Display</label>
                      <select
                        style={styles.settingSelect}
                        value={outputSettings.selectedDisplayId || ''}
                        onChange={(e) => handleOutputSettingsChange('selectedDisplayId', parseInt(e.target.value))}
                      >
                        <option value="">Choose a display...</option>
                        {availableDisplays.map(display => (
                          <option key={display.id} value={display.id}>
                            {display.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {outputWindowActive && (
                    <div style={styles.outputStatus}>
                      <span style={styles.outputStatusDot} /> Output Window Active
                    </div>
                  )}

                  <div style={styles.settingTip}>
                    Press <strong>{shortcuts.output || 'the output shortcut'}</strong> to close external output window from anywhere.
                  </div>

                  <div style={styles.settingGroupTitle}>Audio</div>
                  <div style={styles.settingGroupDesc}>
                    Where the sound of the channel is played. Stored by device name, so it survives a reboot.
                  </div>

                  <div style={styles.settingRow}>
                    <label style={styles.settingLabel}>Audio Output</label>
                    <select
                      style={styles.settingSelect}
                      value={outputSettings.audioDeviceLabel || ''}
                      onChange={(e) => handleOutputSettingsChange('audioDeviceLabel', e.target.value)}
                    >
                      <option value="">System default</option>
                      {audioDeviceOptions.map(label => (
                        <option key={label} value={label}>{label}</option>
                      ))}
                      {audioDeviceMissing && (
                        <option value={outputSettings.audioDeviceLabel}>{outputSettings.audioDeviceLabel}</option>
                      )}
                    </select>
                    <button
                      style={styles.refreshButton}
                      onClick={loadAudioDevices}
                      title="Refresh the list of audio devices"
                    >
                      <Icon name="refresh" size={14} />
                    </button>
                  </div>

                  <div style={styles.settingTip}>
                    The audio device applies to the fullscreen output window only. The preview panel always stays silent.
                    Choose <strong>System default</strong> to follow the Windows playback device.
                  </div>

                  {audioDeviceMissing && (
                    <div style={styles.settingWarning}>
                      "{outputSettings.audioDeviceLabel}" is not connected right now. The output falls back to the system default until it is available again.
                    </div>
                  )}

                  <div style={styles.sectionButtonRow}>
                    {settingsFeedback && (
                      <span style={settingsFeedback.tone === 'error' ? styles.settingsFeedbackError : styles.settingsFeedback}>
                        {settingsFeedback.message}
                      </span>
                    )}
                    <button
                      style={{ ...styles.sectionButton, ...styles.sectionButtonPrimary }}
                      onClick={handleApplyExternalOutput}
                    >
                      Apply Output Settings
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'obs' && (
                <div style={styles.settingSection}>
                  <div style={styles.settingGroupTitle}>OBS Studio</div>
                  <div style={styles.settingGroupDesc}>
                    Lets playlist OBS events switch scenes and show or hide sources while the channel runs.
                  </div>

                  <div style={styles.settingRow}>
                    <label style={styles.settingLabel}>
                      <input
                        type="checkbox"
                        checked={obsSettings.enabled}
                        onChange={(e) => handleOBSSettingsChange('enabled', e.target.checked)}
                        style={styles.checkbox}
                      />
                      Enable OBS Integration
                    </label>
                  </div>

                  {obsSettings.enabled && (
                    <>
                      <div style={styles.settingRow}>
                        <label style={styles.settingLabel}>Host</label>
                        <input
                          type="text"
                          style={styles.settingSelect}
                          value={obsSettings.host}
                          onChange={(e) => handleOBSSettingsChange('host', e.target.value)}
                        />
                      </div>
                      <div style={styles.settingRow}>
                        <label style={styles.settingLabel}>Port</label>
                        <input
                          type="number"
                          style={styles.settingSelect}
                          value={obsSettings.port}
                          onChange={(e) => handleOBSSettingsChange('port', parseInt(e.target.value) || 4455)}
                        />
                      </div>
                      <div style={styles.settingRow}>
                        <label style={styles.settingLabel}>Password</label>
                        <input
                          type="password"
                          style={styles.settingSelect}
                          value={obsSettings.password}
                          onChange={(e) => handleOBSSettingsChange('password', e.target.value)}
                          placeholder="Leave empty if no password"
                        />
                      </div>
                      <div style={styles.settingRow}>
                        <div>
                          <span style={obsConnected ? styles.obsStatusOnline : styles.obsStatusOffline}>
                            <span style={obsConnected ? styles.obsStatusDotOnline : styles.obsStatusDotOffline} />
                            {obsConnected ? 'Connected to OBS' : 'Disconnected'}
                          </span>
                          {obsStatusMessage && (
                            <div style={obsConnected ? styles.obsStatusDetailOnline : styles.obsStatusDetailOffline}>
                              {obsStatusMessage}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  <div style={styles.settingTip}>
                    OBS WebSocket must be enabled in OBS Studio (Tools → obs-websocket Settings). Default port: 4455.
                    FlowAir reconnects on its own if OBS restarts.
                  </div>

                  <div style={styles.sectionButtonRow}>
                    {settingsFeedback && (
                      <span style={settingsFeedback.tone === 'error' ? styles.settingsFeedbackError : styles.settingsFeedback}>
                        {settingsFeedback.message}
                      </span>
                    )}
                    <button
                      style={{ ...styles.sectionButton, ...styles.sectionButtonPrimary }}
                      onClick={handleApplyOBSSettings}
                    >
                      {obsSettings.enabled ? 'Connect to OBS' : 'Apply OBS Settings'}
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'shortcuts' && (
                <div style={styles.settingSection}>
                  <div style={styles.settingGroupTitle}>Keyboard shortcuts</div>
                  <div style={styles.settingGroupDesc}>
                    Press Change and then the combination you want. Escape cancels the capture. Every change is saved at once
                    and comes back the next time FlowAir starts.
                  </div>

                  {shortcutMessage && <div style={styles.settingWarning}>{shortcutMessage}</div>}
                  {shortcutLoadWarning && <div style={styles.settingWarning}>{shortcutLoadWarning}</div>}

                  <div style={styles.shortcutList}>
                    {SHORTCUT_ACTIONS.map(action => {
                      const capturing = capturingAction === action.id
                      const isDefault = shortcuts[action.id] === action.defaultBinding
                      return (
                        <div key={action.id} style={styles.shortcutRow}>
                          <span style={styles.shortcutName}>{action.label}</span>
                          <span style={capturing ? styles.shortcutValueCapturing : styles.shortcutValue}>
                            {capturing ? 'Press a key...' : (shortcuts[action.id] || 'Not set')}
                          </span>
                          <button
                            className="btn-subtle"
                            style={styles.shortcutButton}
                            onClick={() => startShortcutCapture(action.id)}
                          >
                            {capturing ? 'Cancel' : 'Change'}
                          </button>
                          <button
                            className="btn-subtle"
                            style={{ ...styles.shortcutButton, ...(isDefault && { opacity: 0.35, cursor: 'not-allowed' }) }}
                            disabled={isDefault}
                            onClick={() => resetShortcut(action.id)}
                          >
                            Reset
                          </button>
                        </div>
                      )
                    })}
                  </div>

                  <div style={styles.settingTip}>
                    "Show / hide output" also works when FlowAir is not the active window, so Windows can refuse a combination that
                    another program already owns. In that case the previous shortcut stays active.
                  </div>

                  <div style={styles.sectionButtonRow}>
                    {settingsFeedback && (
                      <span style={settingsFeedback.tone === 'error' ? styles.settingsFeedbackError : styles.settingsFeedback}>
                        {settingsFeedback.message}
                      </span>
                    )}
                    <button
                      style={{ ...styles.sectionButton, ...styles.sectionButtonPrimary }}
                      onClick={resetAllShortcuts}
                    >
                      Reset all to defaults
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'network' && (
                <div style={styles.settingSection}>
                  <div style={styles.settingGroupTitle}>Player links</div>
                  <div style={styles.settingGroupDesc}>
                    Addresses where the program picture can be watched. The local link is the one to give OBS on this machine.
                  </div>

                  <div style={styles.playerInfoBox}>
                    <div style={styles.playerInfoHeader}>
                      <span style={styles.playerInfoIcon}><Icon name="monitor" size={20} /></span>
                      <div style={styles.playerInfoContent}>
                        <div style={styles.playerInfoTitle}>Local Player (Recommended)</div>
                        <div style={styles.playerInfoDesc}>Fast, robust, low-latency. Perfect for OBS on same PC.</div>
                      </div>
                    </div>
                    <div style={styles.urlRow}>
                      <input
                        type="text"
                        value="http://localhost:8000/player"
                        readOnly
                        style={styles.urlInput}
                        onClick={(e) => e.target.select()}
                      />
                      <button
                        style={styles.copyButton}
                        onClick={() => {
                          navigator.clipboard.writeText('http://localhost:8000/player')
                          addLog('Local URL copied to clipboard', 'info')
                        }}
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  <div style={styles.settingRow}>
                    <label style={styles.settingLabel}>
                      <input
                        type="checkbox"
                        checked={outputSettings.networkStreamingEnabled || false}
                        onChange={(e) => handleOutputSettingsChange('networkStreamingEnabled', e.target.checked)}
                        style={styles.checkbox}
                      />
                      Enable Network Streaming
                    </label>
                  </div>
                  <div style={styles.settingHint}>
                    Allows other devices on the local network to open the player. Leave it off on a station that must stay private.
                  </div>

                  {outputSettings.networkStreamingEnabled && (
                    <div style={styles.playerInfoBox}>
                      <div style={styles.playerInfoHeader}>
                        <span style={styles.playerInfoIcon}><Icon name="network" size={20} /></span>
                        <div style={styles.playerInfoContent}>
                          <div style={styles.playerInfoTitle}>Network Player</div>
                          <div style={styles.playerInfoDesc}>Share stream with other devices on local network.</div>
                        </div>
                      </div>
                      <div style={styles.networkDetails}>
                        <div style={styles.networkDetailRow}>
                          <span style={styles.networkDetailLabel}>Local IP:</span>
                          <span style={styles.networkDetailValue}>{networkInfo.local_ip}</span>
                        </div>
                        <div style={styles.networkDetailRow}>
                          <span style={styles.networkDetailLabel}>Port:</span>
                          <span style={styles.networkDetailValue}>{networkInfo.port}</span>
                        </div>
                      </div>
                      <div style={styles.urlRow}>
                        <input
                          type="text"
                          value={networkInfo.player_url}
                          readOnly
                          style={styles.urlInput}
                          onClick={(e) => e.target.select()}
                        />
                        <button
                          style={styles.copyButton}
                          onClick={() => {
                            navigator.clipboard.writeText(networkInfo.player_url)
                            addLog('Network URL copied to clipboard', 'info')
                          }}
                        >
                          Copy
                        </button>
                      </div>
                      <div style={styles.networkNote}>
                        <strong>Use Cases:</strong> OBS on separate PC, mobile monitoring, multi-device quality control.
                      </div>
                    </div>
                  )}

                  <div style={styles.sectionButtonRow}>
                    {settingsFeedback && (
                      <span style={settingsFeedback.tone === 'error' ? styles.settingsFeedbackError : styles.settingsFeedback}>
                        {settingsFeedback.message}
                      </span>
                    )}
                    <button
                      style={{ ...styles.sectionButton, ...styles.sectionButtonPrimary }}
                      onClick={handleApplyNetworkStreaming}
                    >
                      Apply Network Streaming
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'diagnostics' && (
                <div style={styles.settingSection}>
                  <div style={styles.settingGroupTitle}>This machine</div>
                  <div style={styles.settingGroupDesc}>
                    What FlowAir can see about the graphics and the processor of this PC. Copy it into a support message when
                    playback is not smooth.
                  </div>

                  {!diagnostics && (
                    <div style={styles.settingHint}>Diagnostics are only available inside the FlowAir desktop window.</div>
                  )}

                  {diagnostics && (
                    <>
                      {diagnostics.health.reasons.length > 0 ? (
                        <div style={styles.settingWarning}>
                          {diagnostics.health.reasons.map(reason => (
                            <div key={reason} style={styles.diagReason}>{reason}</div>
                          ))}
                        </div>
                      ) : (
                        <div style={styles.settingTip}>Graphics acceleration is working on this PC. Nothing to fix here.</div>
                      )}

                      <div style={styles.diagGrid}>
                        <div style={styles.diagRow}>
                          <span style={styles.diagKey}>Graphics</span>
                          <span style={styles.diagValue}>{orUnknown(`${diagnostics.gpu.vendor} ${diagnostics.gpu.model}`.trim())}</span>
                        </div>
                        <div style={styles.diagRow}>
                          <span style={styles.diagKey}>Driver version</span>
                          <span style={styles.diagValue}>{orUnknown(diagnostics.gpu.driverVersion)}</span>
                        </div>
                        {[
                          ['Video decode', diagnostics.gpu.videoDecode],
                          ['Compositing', diagnostics.gpu.compositing],
                          ['Drawing', diagnostics.gpu.rasterization]
                        ].map(([label, raw]) => {
                          const state = featureState(raw)
                          return (
                            <div key={label} style={styles.diagRow}>
                              <span style={styles.diagKey}>{label}</span>
                              <span style={{ ...styles.diagValue, color: FEATURE_COLORS[state], fontWeight: '600' }}>
                                {FEATURE_LABELS[state]}
                              </span>
                            </div>
                          )
                        })}
                        {[
                          ['Processor', orUnknown(diagnostics.system.cpuModel)],
                          ['Cores', orUnknown(diagnostics.system.cpuCores)],
                          ['Memory', `${formatMemoryMb(diagnostics.system.freeMemoryMb)} free of ${formatMemoryMb(diagnostics.system.totalMemoryMb)}`],
                          ['System', orUnknown(`${diagnostics.system.platform} ${diagnostics.system.release} ${diagnostics.system.arch}`.trim())],
                          ['FlowAir', `v${orUnknown(diagnostics.app.version)}`],
                          ['Playout engine', orUnknown(diagnostics.app.engineVersion)],
                          ['Electron', orUnknown(diagnostics.app.electron)],
                          ['Chromium', orUnknown(diagnostics.app.chrome)]
                        ].map(([label, value]) => (
                          <div key={label} style={styles.diagRow}>
                            <span style={styles.diagKey}>{label}</span>
                            <span style={styles.diagValue}>{value}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <div style={styles.settingGroupTitle}>Graphics</div>

                  <div style={styles.settingRow}>
                    <label style={styles.settingLabel}>
                      <input
                        type="checkbox"
                        checked={hardwareAcceleration}
                        disabled={!electronAvailable}
                        onChange={(e) => handleHardwareAccelerationChange(e.target.checked)}
                        style={styles.checkbox}
                      />
                      Hardware acceleration
                    </label>
                  </div>
                  <div style={styles.settingHint}>
                    Leave this on. Turning it off makes the picture slower on almost every PC, including the fullscreen output that
                    goes to air. Only turn it off when a broken driver makes the screen tear or go black. It takes effect the next
                    time FlowAir starts.
                  </div>
                  {hardwareAccelerationPending && (
                    <div style={styles.settingWarning}>Close and open FlowAir to apply the hardware acceleration change.</div>
                  )}

                  <div style={styles.settingGroupTitle}>Lighter playback</div>

                  <div style={styles.settingRow}>
                    <label style={styles.settingLabel}>Performance mode</label>
                    <select
                      style={styles.settingSelect}
                      value={performanceMode}
                      onChange={(e) => handlePerformanceModeChange(e.target.value)}
                    >
                      <option value="auto">Auto (on when this PC needs it)</option>
                      <option value="on">Always on</option>
                      <option value="off">Off</option>
                    </select>
                  </div>
                  <div style={styles.settingHint}>
                    Stops the preview from decoding the same clip a second time while the fullscreen output is live. The output
                    picture, the timing and the playlist never change.
                  </div>
                  <div style={styles.settingTip}>
                    {performanceActive
                      ? (previewSuspended
                        ? 'Performance mode is on and the preview is paused. The file name, the countdown and the on-air state stay visible.'
                        : 'Performance mode is on. The preview pauses as soon as the fullscreen output window is open.')
                      : 'Performance mode is off. The preview decodes video at the same time as the fullscreen output.'}
                  </div>

                  <div style={styles.sectionButtonRow}>
                    {settingsFeedback && (
                      <span style={settingsFeedback.tone === 'error' ? styles.settingsFeedbackError : styles.settingsFeedback}>
                        {settingsFeedback.message}
                      </span>
                    )}
                    <button
                      style={{ ...styles.sectionButton, ...styles.sectionButtonPrimary }}
                      onClick={handleCopyDiagnostics}
                    >
                      Copy diagnostics
                    </button>
                  </div>
                </div>
              )}

            </div>

            <div style={styles.settingsFooter}>
              <button
                className="btn-subtle"
                style={styles.resetButton}
                onClick={handleResetOutputSettings}
              >
                Reset to Factory
              </button>
              <button
                style={{ ...styles.modalButton, ...styles.modalButtonPrimary }}
                onClick={() => setShowOutputSettings(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  container: {
    width: '100vw',
    height: '100vh',
    background: 'var(--bg-base)',
    color: 'var(--text-primary)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    userSelect: 'none',
    position: 'relative'
  },
  header: {
    background: 'var(--bg-layer-2)',
    padding: '10px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid var(--stroke)'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px'
  },
  brand: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.1
  },
  title: {
    fontSize: '17px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    margin: 0
  },
  credits: {
    fontSize: '10px',
    fontWeight: '400',
    color: 'var(--text-tertiary)',
    fontStyle: 'italic'
  },
  version: {
    fontSize: '9px',
    fontWeight: '600',
    color: 'var(--accent)',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.5px',
    marginTop: '1px'
  },
  date: {
    fontSize: '13px',
    fontWeight: '500',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums'
  },
  clock: {
    fontSize: '15px',
    fontWeight: '600',
    color: 'var(--accent)',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '1px',
    fontVariantNumeric: 'tabular-nums'
  },
  timeFormatButton: {
    padding: '4px 10px',
    background: 'var(--bg-layer-3)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-tertiary)',
    fontSize: '11px',
    fontWeight: '500',
    fontFamily: 'var(--font-mono)'
  },
  timeFormatButtonActive: {
    padding: '4px 10px',
    background: 'var(--accent-soft)',
    border: '1px solid var(--accent)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--accent-hover)',
    fontSize: '11px',
    fontWeight: '600',
    fontFamily: 'var(--font-mono)'
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  headerButton: {
    padding: '6px 14px',
    background: 'var(--bg-layer-3)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-primary)',
    fontSize: '12px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    gap: '7px'
  },
  headerIconButton: {
    padding: '6px 10px',
    color: 'var(--text-tertiary)'
  },
  clearButton: {
    background: 'var(--danger-soft)',
    borderColor: 'rgba(255, 91, 91, 0.4)',
    color: '#ff8d8d'
  },
  exitHeaderButton: {
    background: 'var(--danger-soft)',
    borderColor: 'rgba(255, 91, 91, 0.4)',
    color: '#ff7a7a'
  },
  updateButton: {
    background: 'var(--accent-soft)',
    borderColor: 'rgba(76, 194, 255, 0.5)',
    color: 'var(--accent-hover)',
    fontWeight: '600'
  },
  diagBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 20px',
    background: 'rgba(224, 179, 65, 0.12)',
    borderBottom: '1px solid rgba(224, 179, 65, 0.35)',
    color: 'var(--warning-text)'
  },
  diagBannerCritical: {
    background: 'var(--danger-soft)',
    borderBottom: '1px solid rgba(255, 91, 91, 0.4)',
    color: 'var(--danger-text)'
  },
  diagBannerIcon: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0
  },
  diagBannerText: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  diagBannerTitle: {
    fontSize: '12px',
    fontWeight: '600'
  },
  diagBannerBody: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    lineHeight: '1.45'
  },
  diagBannerButton: {
    flexShrink: 0,
    padding: '5px 12px',
    border: '1px solid currentColor',
    borderRadius: 'var(--radius)',
    color: 'inherit',
    fontSize: '11px',
    fontWeight: '600'
  },
  diagGrid: {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-layer-1)',
    border: '1px solid var(--stroke)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden'
  },
  diagRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    padding: '6px 12px',
    borderBottom: '1px solid var(--stroke-subtle)'
  },
  diagKey: {
    fontSize: '11px',
    color: 'var(--text-tertiary)',
    fontWeight: '600',
    flexShrink: 0
  },
  diagValue: {
    fontSize: '11px',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-mono)',
    textAlign: 'right',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  diagReason: {
    marginBottom: '4px'
  },
  flyoutAnchor: {
    position: 'relative',
    height: 0,
    zIndex: 9000
  },
  updatePanel: {
    position: 'absolute',
    top: '4px',
    right: '20px',
    width: '380px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-flyout)',
    zIndex: 9000
  },
  updatePanelHeader: {
    padding: '12px 16px',
    borderBottom: '1px solid var(--stroke)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  updatePanelTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--text-primary)'
  },
  updatePanelBody: {
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  updateText: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    lineHeight: '1.5'
  },
  updateNotes: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
    maxHeight: '160px',
    overflowY: 'auto',
    padding: '8px 10px',
    background: 'var(--bg-layer-1)',
    border: '1px solid var(--stroke)',
    borderRadius: 'var(--radius)'
  },
  updateError: {
    fontSize: '12px',
    color: '#ff8d8d',
    lineHeight: '1.5'
  },
  updateToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '11px',
    color: 'var(--text-tertiary)'
  },
  updatePanelButtons: {
    padding: '12px 16px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    justifyContent: 'flex-end',
    borderTop: '1px solid var(--stroke)'
  },
  updateSubtleButton: {
    border: 'none',
    color: 'var(--text-tertiary)',
    fontSize: '11px',
    padding: '8px 4px'
  },
  progressTrack: {
    width: '100%',
    height: '6px',
    background: 'var(--bg-layer-3)',
    borderRadius: '999px',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    background: 'var(--accent)',
    borderRadius: '999px'
  },
  shortcutList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  shortcutRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '6px 10px',
    background: 'var(--bg-layer-1)',
    border: '1px solid var(--stroke)',
    borderRadius: 'var(--radius)'
  },
  shortcutName: {
    flex: 1,
    fontSize: '12px',
    color: 'var(--text-primary)'
  },
  shortcutValue: {
    minWidth: '120px',
    textAlign: 'center',
    padding: '3px 8px',
    background: 'var(--bg-layer-3)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)',
    fontSize: '11px',
    fontWeight: '600',
    fontFamily: 'var(--font-mono)'
  },
  shortcutValueCapturing: {
    minWidth: '120px',
    textAlign: 'center',
    padding: '3px 8px',
    background: 'var(--accent-soft)',
    border: '1px solid rgba(76, 194, 255, 0.5)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--accent-hover)',
    fontSize: '11px',
    fontWeight: '600',
    fontFamily: 'var(--font-mono)'
  },
  shortcutButton: {
    border: '1px solid var(--stroke-strong)',
    background: 'var(--bg-layer-3)',
    color: 'var(--text-secondary)',
    borderRadius: 'var(--radius-sm)',
    fontSize: '11px',
    fontWeight: '600',
    padding: '4px 10px'
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    gap: '1px',
    background: 'var(--stroke)',
    overflow: 'hidden'
  },
  leftPanel: {
    flex: 1,
    background: 'var(--bg-base)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  rightPanel: {
    width: 'var(--right-panel)',
    flexShrink: 0,
    background: 'var(--bg-base)',
    borderLeft: '1px solid var(--stroke)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000
  },
  modal: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius-lg)',
    width: '400px',
    boxShadow: 'var(--shadow-flyout)'
  },
  modalHeader: {
    padding: '16px 20px',
    borderBottom: '1px solid var(--stroke)',
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    padding: '0',
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-sm)'
  },
  modalBody: {
    padding: '20px',
    fontSize: '13px',
    color: 'var(--text-primary)',
    lineHeight: '1.5'
  },
  noteInput: {
    width: '100%',
    padding: '10px',
    background: 'var(--bg-base)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-primary)',
    fontSize: '13px'
  },
  modalButtons: {
    padding: '12px 20px',
    display: 'flex',
    gap: '10px',
    justifyContent: 'flex-end',
    borderTop: '1px solid var(--stroke)'
  },
  modalButton: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: 'var(--radius)',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  modalButtonPrimary: {
    background: '#0a84e0',
    color: '#fff'
  },
  modalButtonConfirm: {
    background: '#c42b1c',
    color: '#fff'
  },
  modalButtonCancel: {
    background: 'var(--bg-layer-3)',
    color: 'var(--text-primary)'
  },
  settingsFooter: {
    padding: '12px 20px',
    display: 'flex',
    gap: '10px',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTop: '1px solid var(--stroke)'
  },
  resetButton: {
    border: 'none',
    color: '#ff8d8d',
    fontSize: '11px',
    fontWeight: '600',
    padding: '8px 4px'
  },
  outputModal: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius-lg)',
    width: '600px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: 'var(--shadow-flyout)'
  },
  outputModalBody: {
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  settingSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  settingGroupTitle: {
    fontSize: '11px',
    fontWeight: '700',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
    paddingBottom: '4px',
    borderBottom: '1px solid var(--stroke)'
  },
  settingGroupDesc: {
    fontSize: '11px',
    color: 'var(--text-tertiary)',
    lineHeight: '1.5',
    marginTop: '-6px'
  },
  settingHint: {
    fontSize: '11px',
    color: 'var(--text-tertiary)',
    lineHeight: '1.5',
    marginTop: '-6px'
  },
  settingsHeaderRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  settingsFeedback: {
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--success)',
    background: 'var(--success-soft)',
    border: '1px solid rgba(74, 222, 128, 0.35)',
    borderRadius: 'var(--radius-sm)',
    padding: '3px 8px'
  },
  settingsFeedbackError: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#ff8d8d',
    background: 'var(--danger-soft)',
    border: '1px solid rgba(255, 91, 91, 0.4)',
    borderRadius: 'var(--radius-sm)',
    padding: '3px 8px'
  },
  updateHint: {
    fontSize: '10px',
    color: 'var(--text-tertiary)',
    lineHeight: '1.5',
    marginTop: '-4px'
  },
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid var(--stroke)',
    background: 'var(--bg-layer-2)'
  },
  tab: {
    flex: 1,
    padding: '10px 0',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: 'var(--text-tertiary)',
    fontSize: '12px',
    fontWeight: '500'
  },
  tabActive: {
    color: 'var(--accent)',
    borderBottom: '2px solid var(--accent)',
    background: 'var(--accent-soft)'
  },
  settingRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '20px'
  },
  settingLabel: {
    fontSize: '13px',
    fontWeight: '500',
    color: 'var(--text-primary)',
    minWidth: '120px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  checkbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
    accentColor: 'var(--accent)'
  },
  refreshButton: {
    flexShrink: 0,
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-layer-3)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-secondary)'
  },
  outputStatus: {
    fontSize: '13px',
    color: 'var(--success)',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    background: 'var(--success-soft)',
    borderRadius: 'var(--radius)',
    border: '1px solid rgba(74, 222, 128, 0.3)'
  },
  outputStatusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--success)',
    display: 'inline-block',
    flexShrink: 0,
    animation: 'pulse 2s ease-in-out infinite'
  },
  settingSelect: {
    flex: 1,
    padding: '8px 12px',
    background: 'var(--bg-base)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-primary)',
    fontSize: '12px',
    cursor: 'pointer'
  },
  urlInput: {
    flex: 1,
    padding: '6px 10px',
    background: 'var(--bg-base)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--accent)',
    fontSize: '11px',
    fontFamily: 'var(--font-mono)',
    cursor: 'text'
  },
  copyButton: {
    padding: '6px 12px',
    background: 'var(--accent-soft)',
    border: '1px solid rgba(76, 194, 255, 0.35)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--accent-hover)',
    fontSize: '11px',
    fontWeight: '600',
    whiteSpace: 'nowrap'
  },
  playerInfoBox: {
    background: 'var(--bg-layer-1)',
    border: '1px solid var(--stroke)',
    borderRadius: 'var(--radius)',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  playerInfoHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px'
  },
  playerInfoIcon: {
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    lineHeight: '1'
  },
  playerInfoContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  playerInfoTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--text-primary)'
  },
  playerInfoDesc: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    lineHeight: '1.4'
  },
  urlRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center'
  },
  networkDetails: {
    display: 'flex',
    gap: '14px',
    padding: '8px 0'
  },
  networkDetailRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px'
  },
  networkDetailLabel: {
    fontWeight: '600',
    color: 'var(--accent)'
  },
  networkDetailValue: {
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-primary)',
    background: 'var(--bg-base)',
    padding: '3px 7px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--stroke)'
  },
  networkNote: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    lineHeight: '1.5',
    paddingTop: '4px',
    borderTop: '1px solid var(--stroke-subtle)'
  },
  sectionButtonRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '10px',
    marginTop: '12px'
  },
  sectionButton: {
    padding: '7px 14px',
    border: 'none',
    borderRadius: 'var(--radius)',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  sectionButtonPrimary: {
    background: '#0a84e0',
    color: '#fff'
  },
  settingTip: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    lineHeight: '1.5',
    padding: '8px 10px',
    background: 'var(--bg-layer-1)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--stroke)',
    marginTop: '8px'
  },
  settingWarning: {
    fontSize: '11px',
    color: '#f0cd7a',
    lineHeight: '1.5',
    padding: '8px 10px',
    background: 'rgba(224, 179, 65, 0.12)',
    borderRadius: 'var(--radius)',
    border: '1px solid rgba(224, 179, 65, 0.35)'
  },
  obsControlPanel: {
    margin: '0 10px 10px 10px',
    background: 'var(--bg-layer-1)',
    border: '1px solid var(--stroke)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden',
    flexShrink: 0
  },
  obsControlHeader: {
    background: 'var(--bg-layer-2)',
    padding: '8px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid var(--stroke)'
  },
  obsControlTitle: {
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.6px'
  },
  obsConnectedTag: {
    fontSize: '9px',
    color: 'var(--success)',
    fontWeight: '600',
    letterSpacing: '0.4px'
  },
  obsControlBody: {
    padding: '10px',
    maxHeight: '200px',
    overflowY: 'auto'
  },
  obsSceneRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center'
  },
  obsSceneSelect: {
    flex: 1,
    minWidth: 0,
    padding: '6px 8px',
    background: 'var(--bg-base)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-primary)',
    fontSize: '11px'
  },
  obsActivateButton: {
    flexShrink: 0,
    minWidth: '76px',
    textAlign: 'center',
    padding: '6px 12px',
    background: 'var(--accent-soft)',
    border: '1px solid rgba(76, 194, 255, 0.4)',
    borderRadius: 'var(--radius)',
    color: 'var(--accent-hover)',
    fontSize: '10px',
    fontWeight: '700',
    letterSpacing: '0.4px'
  },
  obsActivateButtonActive: {
    background: 'var(--success-soft)',
    borderColor: 'rgba(74, 222, 128, 0.5)',
    color: '#7ee6a0'
  },
  obsSourceList: {
    marginTop: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  obsSourceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 8px',
    background: 'var(--bg-base)',
    borderRadius: 'var(--radius-sm)'
  },
  obsSourceName: {
    fontSize: '11px',
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
    marginRight: '8px'
  },
  obsEmptyText: {
    fontSize: '10px',
    color: 'var(--text-tertiary)',
    textAlign: 'center',
    padding: '10px 0'
  },
  obsStatusOnline: {
    fontSize: '11px',
    color: 'var(--success)',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  obsStatusOffline: {
    fontSize: '11px',
    color: '#ff8d8d',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  obsStatusDotOnline: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--success)',
    display: 'inline-block'
  },
  obsStatusDotOffline: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#ff5b5b',
    display: 'inline-block'
  },
  obsStatusDetailOnline: {
    fontSize: '10px',
    color: '#88ff88',
    marginTop: '4px',
    wordBreak: 'break-word'
  },
  obsStatusDetailOffline: {
    fontSize: '10px',
    color: '#ff8888',
    marginTop: '4px',
    wordBreak: 'break-word'
  },
  obsToggleButton: {
    padding: '3px 8px',
    background: 'var(--danger-soft)',
    border: '1px solid rgba(255, 91, 91, 0.4)',
    borderRadius: 'var(--radius-sm)',
    color: '#ff8d8d',
    fontSize: '9px',
    fontWeight: '600',
    flexShrink: 0
  },
  obsToggleActive: {
    background: 'var(--success-soft)',
    borderColor: 'rgba(74, 222, 128, 0.4)',
    color: '#7ee6a0'
  }
}

export default App
