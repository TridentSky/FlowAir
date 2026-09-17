const { app, BrowserWindow, clipboard, dialog, ipcMain, screen, globalShortcut, powerSaveBlocker, shell, net, session } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const http = require('http')
const crypto = require('crypto')
const { spawn, execFileSync } = require('child_process')

const APP_ID = 'com.tridentsky.flowair'
const BACKEND_HOST = '127.0.0.1'
const BACKEND_PORT = 8000
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`
const DEV_SERVER_URL = 'http://localhost:3000'
const OUTPUT_PLAYER_URL = `${BACKEND_URL}/player?output=1`
const RELEASES_API_URLS = [
  'https://api.github.com/repositories/1258116151/releases/latest',
  'https://api.github.com/repos/BrandSilva/FlowAir/releases/latest'
]
const RELEASES_PAGE_URL = 'https://github.com/BrandSilva/FlowAir/releases/latest'
const BACKEND_START_TIMEOUT_MS = 45000
const BACKEND_RESTART_LIMIT = 5
const BACKEND_RESTART_WINDOW_MS = 120000
const UPDATE_CHECK_DELAY_MS = 20000
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const UPDATE_REQUEST_TIMEOUT_MS = 15000
const WINDOW_SHOW_FALLBACK_MS = 8000
const UPDATE_RETRY_DELAYS_MS = [120000, 600000, 1800000]
const UPDATE_STALL_TIMEOUT_MS = 30000
const UPDATE_PROGRESS_INTERVAL_MS = 500
const UPDATE_NOTES_LIMIT = 2000
const UPDATE_BODY_LIMIT = 1048576
const UPDATE_DISMISSED_LIMIT = 20
const UPDATE_ASSET_NAME = 'FlowAir-Setup.exe'
const UPDATE_DIRECTORY = 'updates'
const UPDATE_STATE_FILE = 'update-state.json'
const UPDATE_RENAME_ATTEMPTS = 10
const INSTALL_QUIT_DELAY_MS = 1500
const AUDIO_DEVICES_SCRIPT = `(async () => {
  const media = navigator.mediaDevices
  if (!media || !media.enumerateDevices) return []
  const read = () => media.enumerateDevices().then(list => list.filter(device => device.kind === 'audiooutput').map(device => ({ deviceId: device.deviceId, label: device.label }))).catch(() => [])
  let devices = await read()
  if (!devices.some(device => device.label) && media.getUserMedia) {
    try {
      const stream = await media.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop())
      const relabelled = await read()
      if (relabelled.length) devices = relabelled
    } catch (error) {
    }
  }
  return devices
})()`
const ALLOWED_PERMISSIONS = ['media', 'audioCapture', 'speaker-selection']
const TASKKILL_PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
const WINDOWS_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^<>:"|?*\\/\u0000-\u001f]+[\\/][^<>:"|?*\\/\u0000-\u001f]+)[^<>:"|?*\u0000-\u001f]*$/
const WINDOWS_DEVICE_PATTERN = /^[\\/]{2}[.?][\\/]/
const WINDOWS_PATH_LIMIT = 4096
const REVEAL_DEBOUNCE_MS = 500
const REVEAL_TIMEOUT_MS = 3000
const DEFAULT_OUTPUT_ACCELERATOR = 'CommandOrControl+Shift+E'
const ACCELERATOR_MODIFIERS = {
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  control: 'Control',
  ctrl: 'Control',
  command: 'Command',
  cmd: 'Command',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super'
}
const ACCELERATOR_MODIFIER_GROUPS = {
  CommandOrControl: 'ctrl',
  Control: 'ctrl',
  Command: 'ctrl',
  Alt: 'alt',
  Shift: 'shift',
  Super: 'super'
}
const ACCELERATOR_GROUP_ORDER = ['ctrl', 'alt', 'shift', 'super']
const ACCELERATOR_KEYS = {
  space: 'Space',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  escape: 'Escape',
  esc: 'Escape',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown'
}
const RESERVED_ACCELERATORS = ['alt+f4', 'alt+tab', 'alt+escape', 'ctrl+alt+delete', 'ctrl+escape', 'ctrl+shift+escape', 'ctrl+shift+i', 'super+l', 'super+shift+s']
const ACCELERATOR_MIN_MODIFIER_GROUPS = 2
const ACCELERATOR_MESSAGES = {
  invalid: 'That key combination cannot be used outside FlowAir.',
  'needs-modifier': 'A shortcut that works outside FlowAir needs two of Ctrl, Alt and Shift, so it never takes a key away from other programs.',
  reserved: 'Windows reserves that key combination.',
  unavailable: 'Another program is already using that key combination.'
}
const PLAYLIST_EXTENSION = '.flowair'
const PLAYLIST_FILE_LIMIT = 16 * 1024 * 1024
const PLAYLIST_FILE_DELIVERY_MS = 300
const PLAYLIST_FILE_QUEUE_LIMIT = 8
const DIAGNOSTICS_GPU_TIMEOUT_MS = 2500
const DIAGNOSTICS_GPU_VENDORS = { 4098: 'AMD', 4318: 'NVIDIA', 5140: 'Microsoft', 32902: 'Intel' }
const DIAGNOSTICS_REASON_DECODE = 'Video is being decoded by the processor because no graphics driver is active. Playback starts late, stutters and the countdown can freeze. Install the graphics driver from the support page of the PC maker and restart the computer.'
const DIAGNOSTICS_REASON_COMPOSITING = 'The picture is drawn by the processor instead of the graphics chip, so FlowAir stays slow even when the processor looks idle. Installing the graphics driver fixes it.'
const DIAGNOSTICS_REASON_RASTERIZATION = 'Graphics are rasterized by the processor, which leaves less room for playback on a small computer.'
const DIAGNOSTICS_REASON_ACCELERATION_OFF = 'Hardware acceleration is turned off in FlowAir, so the processor does all the video work. Turn it on again in Settings and restart FlowAir.'
const DIAGNOSTICS_REASON_ACCELERATION_RESTART = 'Hardware acceleration is turned on again, but this run of FlowAir still works without it. Restart FlowAir to use the graphics chip.'
const DIAGNOSTICS_FEATURE_LEVELS = {
  enabled: 'enabled',
  enabled_on: 'enabled',
  enabled_force: 'enabled',
  enabled_force_on: 'enabled',
  enabled_readback: 'enabled',
  disabled_off_ok: 'unknown',
  unavailable_off_ok: 'unknown',
  disabled_off: 'disabled',
  unavailable_off: 'disabled',
  disabled_software: 'software',
  disabled_software_animated: 'software',
  unavailable_software: 'software'
}
const CACHE_DIRECTORIES = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Shared Dictionary']
const SPLASH_HTML = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>FlowAir</title><style>html,body{margin:0;height:100%;background:#1b1b1b;color:#ececec;font-family:"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;user-select:none}body{display:flex;flex-direction:column;align-items:center;justify-content:center}h1{margin:0 0 10px;font-size:30px;font-weight:600}p{margin:0;color:#767676;font-size:13px}</style></head><body><h1>FlowAir</h1><p>Starting playout engine...</p></body></html>'

let mainWindow = null
let outputWindow = null
let outputDisplayId = null
let outputRequestId = 0
let isCreatingOutputWindow = false
let backendProcess = null
let backendSpawnError = null
let backendInstance = ''
let backendStarted = false
let backendRestartTimes = []
let isQuitting = false
let interfaceLoaded = false
let availableUpdate = null
let powerSaveBlockerId = null
let updateSettings = null
let updateState = { status: 'idle', version: '', notes: '', url: RELEASES_PAGE_URL, downloaded: false, progress: 0, error: '', enabled: true }
let updateAsset = null
let updateDownload = null
let updateInstallerPath = ''
let updateCheckTimer = null
let updateRetryTimer = null
let updateRetryIndex = 0
let updateCheckInterval = null
let emergencyShortcutActive = false
let outputAccelerator = DEFAULT_OUTPUT_ACCELERATOR
let outputReopenDisplayId = null
let pendingPlaylistFiles = []
let rendererReady = false
let rendererLoadToken = 0
let revealPending = null
let revealSettledAt = 0
let backendVersion = ''
let hardwareAccelerationEnabled = true
let diagnosticsCache = null
let diagnosticsPending = null

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function sendToMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
  mainWindow.focus()
}

function writeFileAtomic(filePath, content) {
  const tempPath = `${filePath}.tmp`
  fs.writeFileSync(tempPath, content, 'utf-8')
  fs.renameSync(tempPath, filePath)
}

function clearStaleCaches() {
  const userData = app.getPath('userData')
  const marker = path.join(userData, 'app-version')
  let previousVersion = null
  try {
    previousVersion = fs.readFileSync(marker, 'utf-8').trim()
  } catch (error) {
  }
  if (previousVersion === app.getVersion()) return

  for (const directory of CACHE_DIRECTORIES) {
    try {
      fs.rmSync(path.join(userData, directory), { recursive: true, force: true })
    } catch (error) {
    }
  }
  try {
    fs.mkdirSync(userData, { recursive: true })
    fs.writeFileSync(marker, app.getVersion())
  } catch (error) {
  }
}

function backendLaunchSpec() {
  if (app.isPackaged) {
    const directory = path.join(process.resourcesPath, 'backend')
    return {
      command: path.join(directory, 'flowair-backend.exe'),
      args: [],
      cwd: directory,
      ffmpegDir: path.join(process.resourcesPath, 'ffmpeg'),
      cacheDir: mediaCacheDirectory()
    }
  }
  const directory = path.join(__dirname, '..', '..', 'backend')
  return {
    command: path.join(directory, 'venv', 'Scripts', 'python.exe'),
    args: ['main.py'],
    cwd: directory,
    ffmpegDir: null,
    cacheDir: null
  }
}

function mediaCacheDirectory() {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return null
  const directory = path.join(localAppData, 'FlowAir', 'media-cache')
  try {
    fs.mkdirSync(directory, { recursive: true })
  } catch (error) {
    return null
  }
  return directory
}

function probeBackend(timeoutMs = 1500) {
  return new Promise(resolve => {
    let settled = false
    const finish = (result) => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }
    const request = http.get({ host: BACKEND_HOST, port: BACKEND_PORT, path: '/', timeout: timeoutMs }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        try {
          const data = JSON.parse(body)
          if (data && data.message === 'FlowAir Broadcast API') {
            finish({ state: 'flowair', instance: data.instance || '', version: typeof data.version === 'string' ? data.version : '' })
            return
          }
        } catch (error) {
        }
        finish({ state: 'foreign' })
      })
      response.on('error', () => finish({ state: 'foreign' }))
    })
    request.on('timeout', () => {
      request.destroy()
      finish({ state: 'foreign' })
    })
    request.on('error', error => finish({ state: error.code === 'ECONNREFUSED' ? 'free' : 'foreign' }))
  })
}

async function waitForPortRelease(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const probe = await probeBackend(1000)
    if (probe.state === 'free') return true
    await delay(300)
  }
  return false
}

function startBackendProcess() {
  const spec = backendLaunchSpec()
  backendInstance = crypto.randomUUID()
  backendSpawnError = null

  const env = {
    ...process.env,
    FLOWAIR_PARENT_PID: String(process.pid),
    FLOWAIR_INSTANCE: backendInstance,
    FLOWAIR_VERSION: app.getVersion(),
    PYTHONIOENCODING: 'utf-8'
  }
  if (spec.ffmpegDir) {
    env.FLOWAIR_FFMPEG_DIR = spec.ffmpegDir
  }
  if (spec.cacheDir) {
    env.FLOWAIR_CACHE_DIR = spec.cacheDir
  }

  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env, windowsHide: true, stdio: 'ignore' })
  backendProcess = child

  child.on('error', error => {
    backendSpawnError = error
  })
  child.on('exit', () => {
    if (backendProcess !== child) return
    backendProcess = null
    if (backendStarted && !isQuitting) {
      scheduleBackendRestart()
    }
  })
  return child
}

async function waitForBackend(child) {
  const deadline = Date.now() + BACKEND_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (backendSpawnError || child.exitCode !== null) return false
    const probe = await probeBackend(1000)
    if (probe.state === 'flowair' && probe.instance === backendInstance) {
      backendVersion = probe.version || ''
      return true
    }
    await delay(250)
  }
  return false
}

function stopBackend() {
  const child = backendProcess
  backendProcess = null
  if (!child || child.exitCode !== null || !child.pid) return
  try {
    execFileSync(TASKKILL_PATH, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } catch (error) {
    try {
      child.kill()
    } catch (killError) {
    }
  }
}

async function launchBackend() {
  const probe = await probeBackend()
  if (probe.state === 'flowair') {
    if (!app.isPackaged) {
      backendVersion = probe.version || ''
      return { ok: true }
    }
    const released = await waitForPortRelease(6000)
    if (!released) return { ok: false, reason: 'already-running' }
  } else if (probe.state === 'foreign') {
    return { ok: false, reason: 'port-in-use' }
  }

  const child = startBackendProcess()
  if (await waitForBackend(child)) return { ok: true }

  const result = {
    ok: false,
    reason: backendSpawnError ? 'spawn-failed' : 'not-responding',
    detail: backendSpawnError ? backendSpawnError.message : ''
  }
  stopBackend()
  return result
}

function scheduleBackendRestart() {
  const now = Date.now()
  backendRestartTimes = backendRestartTimes.filter(time => now - time < BACKEND_RESTART_WINDOW_MS)
  if (backendRestartTimes.length >= BACKEND_RESTART_LIMIT) {
    showErrorDialog(
      'The FlowAir playout engine stopped several times and will not be restarted automatically.',
      'Close FlowAir and open it again. If the problem continues, reinstall FlowAir.'
    )
    return
  }
  backendRestartTimes.push(now)

  setTimeout(async () => {
    if (isQuitting) return
    const result = await launchBackend()
    if (isQuitting) return
    if (result.ok) {
      sendToMain('backend-restarted')
    } else {
      scheduleBackendRestart()
    }
  }, 1000)
}

function startupErrorText(result) {
  if (result.reason === 'port-in-use') {
    return {
      message: `FlowAir cannot start because port ${BACKEND_PORT} is being used by another program.`,
      detail: `FlowAir needs port ${BACKEND_PORT} for its playout engine. Close the program that is using it (or restart the computer) and open FlowAir again.`
    }
  }
  if (result.reason === 'already-running') {
    return {
      message: 'FlowAir is already running.',
      detail: 'Another FlowAir session, possibly from another Windows user, is using the playout engine. Close it and try again.'
    }
  }
  return {
    message: 'The FlowAir playout engine could not start.',
    detail: `If your antivirus blocked or quarantined files in the FlowAir folder, restore them or add an exception, then reinstall FlowAir.${result.detail ? `\n\n${result.detail}` : ''}`
  }
}

function showErrorDialog(message, detail) {
  const options = { type: 'error', title: 'FlowAir', message, detail, buttons: ['OK'] }
  if (mainWindow && !mainWindow.isDestroyed()) {
    return dialog.showMessageBox(mainWindow, options)
  }
  return dialog.showMessageBox(options)
}

function loadInterface() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  interfaceLoaded = true
  rendererReady = false
  rendererLoadToken += 1
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL(DEV_SERVER_URL)
  }
}

function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    title: 'FlowAir',
    backgroundColor: '#1b1b1b',
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  })

  if (app.isPackaged) {
    mainWindow.setMenu(null)
  }

  mainWindow.once('ready-to-show', revealMainWindow)
  setTimeout(revealMainWindow, WINDOW_SHOW_FALLBACK_MS)

  const contents = mainWindow.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    const target = (event && event.url) || url || ''
    if (app.isPackaged || !target.startsWith(DEV_SERVER_URL)) {
      event.preventDefault()
    }
  })
  contents.on('will-frame-navigate', details => {
    if (!details.isMainFrame && !details.url.startsWith(`${BACKEND_URL}/`)) {
      details.preventDefault()
    }
  })
  contents.on('did-finish-load', () => {
    if (!interfaceLoaded) return
    const token = rendererLoadToken
    setTimeout(() => {
      if (token !== rendererLoadToken || !mainWindow || mainWindow.isDestroyed()) return
      markRendererReady()
    }, PLAYLIST_FILE_DELIVERY_MS)
  })
  contents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || app.isPackaged || !String(validatedURL).startsWith(DEV_SERVER_URL)) return
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(DEV_SERVER_URL)
    }, 1000)
  })
  contents.on('render-process-gone', (event, details) => {
    if (details.reason !== 'clean-exit' && interfaceLoaded && !isQuitting) {
      loadInterface()
    }
  })

  mainWindow.on('close', event => {
    if (isQuitting) return
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Cancel', 'Exit'],
      title: 'Confirm Exit',
      message: 'Are you sure you want to close FlowAir?',
      defaultId: 0,
      cancelId: 0
    })
    if (choice === 1) {
      isQuitting = true
    } else {
      event.preventDefault()
    }
  })

  mainWindow.on('session-end', () => {
    isQuitting = true
    stopBackend()
  })

  mainWindow.on('closed', () => {
    closeOutputWindow()
    mainWindow = null
  })

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`)
}

function closeOutputWindow() {
  const window = outputWindow
  outputRequestId += 1
  outputWindow = null
  outputDisplayId = null
  setEmergencyExitShortcut(false)
  if (window && !window.isDestroyed()) {
    window.close()
  }
}

function openOutputWindow(displayId) {
  if (isCreatingOutputWindow) return

  const targetDisplay = screen.getAllDisplays().find(display => display.id === displayId)
  if (!targetDisplay) {
    outputReopenDisplayId = null
    closeOutputWindow()
    sendToMain('output-window-closed', { reason: 'display-missing' })
    return
  }
  outputReopenDisplayId = null

  isCreatingOutputWindow = true
  closeOutputWindow()
  const requestId = outputRequestId

  setTimeout(() => {
    if (requestId !== outputRequestId) {
      isCreatingOutputWindow = false
      return
    }
    try {
      createOutputWindow(targetDisplay)
    } catch (error) {
      sendToMain('output-window-closed', { reason: 'failed' })
    }
    isCreatingOutputWindow = false
  }, 200)
}

function createOutputWindow(targetDisplay) {
  const window = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    kiosk: false,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  })
  outputWindow = window
  outputDisplayId = targetDisplay.id
  setEmergencyExitShortcut(true)

  window.setMenu(null)
  window.setAlwaysOnTop(true, 'screen-saver', 1)
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.setFullScreenable(true)

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  let focusedOnce = false
  window.webContents.on('did-finish-load', () => {
    window.webContents.insertCSS('html, body, * { cursor: none !important; } video { cursor: none !important; }').catch(() => {})
    if (focusedOnce) return
    focusedOnce = true
    focusMainWindow()
  })
  let retryTimer = null
  window.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (!window.isDestroyed()) window.loadURL(OUTPUT_PLAYER_URL)
    }, 2000)
  })
  window.webContents.on('render-process-gone', () => {
    if (!window.isDestroyed()) window.loadURL(OUTPUT_PLAYER_URL)
  })
  window.on('closed', () => {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    if (outputWindow === window) {
      outputWindow = null
      outputDisplayId = null
      setEmergencyExitShortcut(false)
    }
  })

  window.loadURL(OUTPUT_PLAYER_URL)
}

function watchDisplays() {
  screen.on('display-removed', (event, display) => {
    if (display.id === outputReopenDisplayId) outputReopenDisplayId = null
    if (outputWindow && display.id === outputDisplayId) {
      closeOutputWindow()
      sendToMain('output-window-closed', { reason: 'display-removed' })
    }
    sendToMain('displays-changed')
  })
  screen.on('display-added', () => sendToMain('displays-changed'))
}

function toggleOutputWindow() {
  if (outputWindow && !outputWindow.isDestroyed()) {
    const displayId = outputDisplayId
    closeOutputWindow()
    isCreatingOutputWindow = false
    outputReopenDisplayId = displayId
    setEmergencyExitShortcut(true)
    sendToMain('output-window-closed', { reason: 'shortcut' })
    return
  }
  if (isCreatingOutputWindow) return
  const displayId = outputReopenDisplayId
  outputReopenDisplayId = null
  if (displayId === null || !screen.getAllDisplays().some(display => display.id === displayId)) {
    setEmergencyExitShortcut(false)
    return
  }
  openOutputWindow(displayId)
  sendToMain('output-window-opened', { displayId, reason: 'shortcut' })
}

function registerAccelerator(accelerator) {
  try {
    if (globalShortcut.register(accelerator, toggleOutputWindow) === false) return false
    return globalShortcut.isRegistered(accelerator)
  } catch (error) {
    return false
  }
}

function unregisterAccelerator(accelerator) {
  try {
    globalShortcut.unregister(accelerator)
  } catch (error) {
  }
}

function setEmergencyExitShortcut(enabled) {
  if (enabled === emergencyShortcutActive) return
  if (enabled) {
    emergencyShortcutActive = registerAccelerator(outputAccelerator)
    return
  }
  unregisterAccelerator(outputAccelerator)
  emergencyShortcutActive = false
}

function acceleratorKey(token) {
  if (/^[A-Za-z0-9]$/.test(token)) return token.toUpperCase()
  if (/^[Ff]([1-9]|1\d|2[0-4])$/.test(token)) return token.toUpperCase()
  return ACCELERATOR_KEYS[token.toLowerCase()] || ''
}

function parseAccelerator(value) {
  if (typeof value !== 'string') return { accelerator: '', reason: 'invalid' }
  const parts = value.trim().split('+').map(part => part.trim()).filter(Boolean)
  if (!parts.length || parts.length > 4) return { accelerator: '', reason: 'invalid' }
  const key = acceleratorKey(parts[parts.length - 1])
  if (!key) return { accelerator: '', reason: 'invalid' }
  const modifiers = []
  const groups = []
  for (const part of parts.slice(0, -1)) {
    const modifier = ACCELERATOR_MODIFIERS[part.toLowerCase()]
    const group = modifier ? ACCELERATOR_MODIFIER_GROUPS[modifier] : ''
    if (!group || groups.includes(group)) return { accelerator: '', reason: 'invalid' }
    groups.push(group)
    modifiers.push(modifier)
  }
  if (groups.length < ACCELERATOR_MIN_MODIFIER_GROUPS) return { accelerator: '', reason: 'needs-modifier' }
  const signature = ACCELERATOR_GROUP_ORDER.filter(group => groups.includes(group)).concat(key.toLowerCase()).join('+')
  if (RESERVED_ACCELERATORS.includes(signature)) return { accelerator: '', reason: 'reserved' }
  return { accelerator: modifiers.concat(key).join('+'), reason: '' }
}

function acceleratorAnswer(reason) {
  return {
    success: !reason,
    reason,
    message: reason ? ACCELERATOR_MESSAGES[reason] || ACCELERATOR_MESSAGES.invalid : '',
    accelerator: outputAccelerator
  }
}

function restoreOutputAccelerator(previous, wasActive) {
  outputAccelerator = previous
  if (!wasActive) return
  if (registerAccelerator(previous)) {
    emergencyShortcutActive = true
    return
  }
  if (previous !== DEFAULT_OUTPUT_ACCELERATOR && registerAccelerator(DEFAULT_OUTPUT_ACCELERATOR)) {
    outputAccelerator = DEFAULT_OUTPUT_ACCELERATOR
    emergencyShortcutActive = true
    return
  }
  emergencyShortcutActive = false
}

function setOutputAccelerator(value) {
  const parsed = parseAccelerator(value)
  if (!parsed.accelerator) return acceleratorAnswer(parsed.reason)

  const previous = outputAccelerator
  const wasActive = emergencyShortcutActive
  if (wasActive) {
    unregisterAccelerator(previous)
    emergencyShortcutActive = false
  }
  if (!registerAccelerator(parsed.accelerator)) {
    restoreOutputAccelerator(previous, wasActive)
    return acceleratorAnswer('unavailable')
  }

  outputAccelerator = parsed.accelerator
  if (wasActive || outputReopenDisplayId !== null || (outputWindow !== null && !outputWindow.isDestroyed())) {
    emergencyShortcutActive = true
  } else {
    unregisterAccelerator(outputAccelerator)
  }
  return acceleratorAnswer('')
}

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value || '').trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function isNewerVersion(candidate, current) {
  const next = parseVersion(candidate)
  const installed = parseVersion(current)
  if (!next || !installed) return false
  for (let i = 0; i < 3; i++) {
    if (next[i] > installed[i]) return true
    if (next[i] < installed[i]) return false
  }
  return false
}

function updateStatePath() {
  return path.join(app.getPath('userData'), UPDATE_STATE_FILE)
}

function updatesDirectory() {
  return path.join(app.getPath('userData'), UPDATE_DIRECTORY)
}

function readUpdateSettings() {
  if (updateSettings) return updateSettings
  let stored = null
  try {
    stored = JSON.parse(fs.readFileSync(updateStatePath(), 'utf-8'))
  } catch (error) {
  }
  const source = stored && typeof stored === 'object' ? stored : {}
  updateSettings = {
    enabled: source.enabled !== false,
    hardwareAcceleration: source.hardwareAcceleration !== false,
    dismissed: Array.isArray(source.dismissed) ? source.dismissed.filter(version => typeof version === 'string').slice(-UPDATE_DISMISSED_LIMIT) : [],
    downloadedVersion: typeof source.downloadedVersion === 'string' ? source.downloadedVersion : '',
    downloadedPath: typeof source.downloadedPath === 'string' ? source.downloadedPath : '',
    downloadedSize: Number(source.downloadedSize) || 0,
    downloadedNotes: typeof source.downloadedNotes === 'string' ? source.downloadedNotes.slice(0, UPDATE_NOTES_LIMIT) : '',
    downloadedUrl: typeof source.downloadedUrl === 'string' && source.downloadedUrl.startsWith('https://github.com/') ? source.downloadedUrl : RELEASES_PAGE_URL
  }
  return updateSettings
}

function forgetDownloadedUpdate(settings, removeFile) {
  if (removeFile && settings.downloadedPath) {
    try {
      fs.rmSync(settings.downloadedPath, { force: true })
    } catch (error) {
    }
  }
  settings.downloadedVersion = ''
  settings.downloadedPath = ''
  settings.downloadedSize = 0
  settings.downloadedNotes = ''
  settings.downloadedUrl = RELEASES_PAGE_URL
  updateInstallerPath = ''
  writeUpdateSettings()
}

function writeUpdateSettings() {
  try {
    writeFileAtomic(updateStatePath(), JSON.stringify(readUpdateSettings()))
  } catch (error) {
  }
}

function updateStateSnapshot() {
  return { ...updateState, enabled: readUpdateSettings().enabled }
}

function emitUpdateState() {
  sendToMain('update:state', updateStateSnapshot())
}

function setUpdateState(changes) {
  updateState = { ...updateState, ...changes }
  emitUpdateState()
}

function releaseNotes(value) {
  return String(value || '').replace(/\r/g, '').trim().slice(0, UPDATE_NOTES_LIMIT)
}

function releaseAsset(release) {
  const assets = Array.isArray(release.assets) ? release.assets : []
  const match = assets.find(asset => asset && asset.name === UPDATE_ASSET_NAME)
  if (!match || typeof match.browser_download_url !== 'string' || !match.browser_download_url.startsWith('https://github.com/')) return null
  const size = Number(match.size) || 0
  if (size <= 0) return null
  return {
    url: match.browser_download_url,
    size,
    digest: typeof match.digest === 'string' ? match.digest : ''
  }
}

function parseRelease(body) {
  try {
    const release = JSON.parse(body)
    if (!release || typeof release !== 'object') return null
    const version = String(release.tag_name || '').trim().replace(/^v/i, '')
    if (!parseVersion(version)) return null
    const pageUrl = typeof release.html_url === 'string' && release.html_url.startsWith('https://github.com/') ? release.html_url : RELEASES_PAGE_URL
    return { version, notes: releaseNotes(release.body), pageUrl, asset: releaseAsset(release) }
  } catch (error) {
    return null
  }
}

async function fetchLatestRelease() {
  for (const url of RELEASES_API_URLS) {
    const release = await requestRelease(url)
    if (release) return release
  }
  return null
}

function requestRelease(url) {
  return new Promise(resolve => {
    let settled = false
    let timer = null
    let request = null
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(value)
    }
    try {
      request = net.request({ method: 'GET', url, redirect: 'follow' })
    } catch (error) {
      finish(null)
      return
    }
    const abort = () => {
      try {
        request.abort()
      } catch (error) {
      }
    }
    timer = setTimeout(() => {
      abort()
      finish(null)
    }, UPDATE_REQUEST_TIMEOUT_MS)
    request.setHeader('User-Agent', 'FlowAir')
    request.setHeader('Accept', 'application/vnd.github+json')
    request.on('response', response => {
      if (response.statusCode !== 200) {
        abort()
        finish(null)
        return
      }
      const chunks = []
      let size = 0
      response.on('data', chunk => {
        if (size >= UPDATE_BODY_LIMIT) return
        size += chunk.length
        chunks.push(chunk)
      })
      response.on('end', () => finish(parseRelease(Buffer.concat(chunks).toString('utf8'))))
      response.on('error', () => finish(null))
    })
    request.on('error', () => finish(null))
    request.on('abort', () => finish(null))
    try {
      request.end()
    } catch (error) {
      finish(null)
    }
  })
}

function scheduleUpdateRetry() {
  if (!app.isPackaged || !readUpdateSettings().enabled) return
  if (updateRetryTimer) clearTimeout(updateRetryTimer)
  const delay = UPDATE_RETRY_DELAYS_MS[Math.min(updateRetryIndex, UPDATE_RETRY_DELAYS_MS.length - 1)]
  updateRetryIndex += 1
  updateRetryTimer = setTimeout(checkForUpdates, delay)
}

async function checkForUpdates() {
  const settings = readUpdateSettings()
  if (!settings.enabled || updateDownload || updateState.status === 'installing') return
  const release = await fetchLatestRelease()
  if (!release) {
    scheduleUpdateRetry()
    return
  }
  updateRetryIndex = 0
  if (!isNewerVersion(release.version, app.getVersion())) return
  if (settings.dismissed.includes(release.version)) return
  if (updateState.status === 'ready' && updateState.version === release.version) return
  if (settings.downloadedVersion && settings.downloadedVersion !== release.version) {
    forgetDownloadedUpdate(settings, true)
    clearUpdateDirectory(null)
  }
  updateAsset = release.asset
  updateInstallerPath = ''
  availableUpdate = { version: release.version }
  setUpdateState({
    status: 'available',
    version: release.version,
    notes: release.notes,
    url: release.pageUrl,
    downloaded: false,
    downloadable: Boolean(release.asset),
    progress: 0,
    error: ''
  })
  sendToMain('update-available', availableUpdate)
}

function clearUpdateTimers() {
  if (updateRetryTimer) {
    clearTimeout(updateRetryTimer)
    updateRetryTimer = null
  }
  if (updateCheckTimer) {
    clearTimeout(updateCheckTimer)
    updateCheckTimer = null
  }
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval)
    updateCheckInterval = null
  }
}

function scheduleUpdateChecks(delayMs = UPDATE_CHECK_DELAY_MS) {
  clearUpdateTimers()
  if (!app.isPackaged || !readUpdateSettings().enabled) return
  updateCheckTimer = setTimeout(checkForUpdates, delayMs)
  updateCheckInterval = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS)
}

function fileMatches(filePath, size) {
  if (!filePath || !size) return false
  try {
    return fs.statSync(filePath).size === size
  } catch (error) {
    return false
  }
}

function clearUpdateDirectory(keepName) {
  const directory = updatesDirectory()
  let entries = []
  try {
    entries = fs.readdirSync(directory)
  } catch (error) {
    return
  }
  for (const entry of entries) {
    if (entry === keepName) continue
    try {
      fs.rmSync(path.join(directory, entry), { recursive: true, force: true })
    } catch (error) {
    }
  }
}

function restoreDownloadedUpdate() {
  const settings = readUpdateSettings()
  if (!settings.downloadedVersion) return
  const usable = isNewerVersion(settings.downloadedVersion, app.getVersion()) &&
    !settings.dismissed.includes(settings.downloadedVersion) &&
    fileMatches(settings.downloadedPath, settings.downloadedSize)
  if (!usable) {
    forgetDownloadedUpdate(settings, false)
    clearUpdateDirectory(null)
    return
  }
  updateInstallerPath = settings.downloadedPath
  availableUpdate = { version: settings.downloadedVersion }
  setUpdateState({
    status: 'ready',
    version: settings.downloadedVersion,
    notes: settings.downloadedNotes,
    url: settings.downloadedUrl || RELEASES_PAGE_URL,
    downloaded: true,
    downloadable: true,
    progress: 100,
    error: ''
  })
}

function hasFreeSpace(directory, required) {
  try {
    const stats = fs.statfsSync(directory)
    return Number(stats.bavail) * Number(stats.bsize) > required
  } catch (error) {
    return true
  }
}

function closeWriteStream(stream) {
  return new Promise(resolve => {
    if (!stream || stream.destroyed || stream.closed) {
      resolve()
      return
    }
    stream.once('close', resolve)
    stream.once('error', () => resolve())
    stream.end()
  })
}

async function renameWithRetry(from, to) {
  for (let attempt = 0; attempt < UPDATE_RENAME_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(from, to)
      return true
    } catch (error) {
      await delay(300)
    }
  }
  return false
}

function reportUpdateError(message) {
  setUpdateState({ status: 'error', progress: 0, downloaded: false, error: message })
  sendToMain('update-failed', { error: message })
}

function armStallTimer(download) {
  if (download.stallTimer) clearTimeout(download.stallTimer)
  download.stallTimer = setTimeout(() => {
    failDownload(download, 'The download stopped responding. Try again.')
  }, UPDATE_STALL_TIMEOUT_MS)
}

async function failDownload(download, message) {
  if (download.finished) return
  download.finished = true
  if (download.stallTimer) {
    clearTimeout(download.stallTimer)
    download.stallTimer = null
  }
  try {
    download.request.abort()
  } catch (error) {
  }
  await closeWriteStream(download.file)
  try {
    fs.rmSync(download.partPath, { force: true })
  } catch (error) {
  }
  if (updateDownload === download) updateDownload = null
  if (updateState.status !== 'downloading') return
  if (download.cancelled) {
    setUpdateState({ status: 'available', progress: 0, downloaded: false, error: '' })
    return
  }
  reportUpdateError(message)
}

function sendDownloadProgress(download, force) {
  const now = Date.now()
  if (!force && now - download.lastProgress < UPDATE_PROGRESS_INTERVAL_MS) return
  download.lastProgress = now
  const percent = download.total > 0 ? Math.min(100, Math.round((download.received / download.total) * 100)) : 0
  updateState = { ...updateState, progress: percent, receivedBytes: download.received, totalBytes: download.total }
  sendToMain('update:progress', { receivedBytes: download.received, totalBytes: download.total, percent })
  emitUpdateState()
}

async function completeDownload(download) {
  if (download.finished) return
  download.finished = true
  if (download.stallTimer) {
    clearTimeout(download.stallTimer)
    download.stallTimer = null
  }
  await closeWriteStream(download.file)
  if (updateDownload === download) updateDownload = null
  if (updateState.status !== 'downloading') {
    try {
      fs.rmSync(download.partPath, { force: true })
    } catch (error) {
    }
    return
  }
  const digest = download.hash ? download.hash.digest('hex') : ''
  if (download.received !== download.total) {
    try {
      fs.rmSync(download.partPath, { force: true })
    } catch (error) {
    }
    reportUpdateError('The download did not finish. Try again.')
    return
  }
  if (download.expectedDigest && digest !== download.expectedDigest) {
    try {
      fs.rmSync(download.partPath, { force: true })
    } catch (error) {
    }
    reportUpdateError('The downloaded file is damaged. Try again.')
    return
  }
  if (!await renameWithRetry(download.partPath, download.finalPath)) {
    try {
      fs.rmSync(download.partPath, { force: true })
    } catch (error) {
    }
    reportUpdateError('The update could not be saved. Check your antivirus and try again.')
    return
  }
  const settings = readUpdateSettings()
  settings.downloadedVersion = download.version
  settings.downloadedPath = download.finalPath
  settings.downloadedSize = download.total
  settings.downloadedNotes = updateState.notes || ''
  settings.downloadedUrl = updateState.url || RELEASES_PAGE_URL
  writeUpdateSettings()
  updateInstallerPath = download.finalPath
  setUpdateState({ status: 'ready', downloaded: true, progress: 100, error: '' })
  sendToMain('update-ready', { version: download.version, path: download.finalPath })
}

function beginUpdateDownload() {
  if (updateDownload || updateState.status === 'ready' || updateState.status === 'installing') return
  const version = updateState.version
  if (!version) return
  if (!updateAsset) {
    shell.openExternal(updateState.url || RELEASES_PAGE_URL).catch(() => {})
    return
  }
  const asset = updateAsset
  const directory = updatesDirectory()
  try {
    fs.mkdirSync(directory, { recursive: true })
  } catch (error) {
    reportUpdateError('The update folder could not be created.')
    return
  }
  clearUpdateDirectory(null)
  forgetDownloadedUpdate(readUpdateSettings(), false)
  if (!hasFreeSpace(directory, asset.size * 2)) {
    reportUpdateError('There is not enough free disk space to download the update.')
    return
  }
  const finalPath = path.join(directory, `FlowAir-Setup-${version}.exe`)
  const partPath = `${finalPath}.part`
  let file = null
  let request = null
  try {
    file = fs.createWriteStream(partPath)
  } catch (error) {
    reportUpdateError('The update could not be saved to disk.')
    return
  }
  try {
    request = net.request({ method: 'GET', url: asset.url, redirect: 'follow' })
  } catch (error) {
    file.destroy()
    reportUpdateError('The update could not be downloaded.')
    return
  }
  request.setHeader('User-Agent', 'FlowAir')
  const expectedDigest = /^sha256:[0-9a-f]{64}$/i.test(asset.digest) ? asset.digest.slice(7).toLowerCase() : ''
  const download = {
    request,
    file,
    partPath,
    finalPath,
    version,
    total: asset.size,
    received: 0,
    lastProgress: 0,
    stallTimer: null,
    finished: false,
    cancelled: false,
    expectedDigest,
    hash: expectedDigest ? crypto.createHash('sha256') : null
  }
  updateDownload = download
  setUpdateState({ status: 'downloading', progress: 0, downloaded: false, error: '' })

  file.on('error', () => failDownload(download, 'The update could not be saved to disk.'))

  request.on('response', response => {
    if (response.statusCode !== 200) {
      failDownload(download, 'The update could not be downloaded.')
      return
    }
    armStallTimer(download)
    response.on('data', chunk => {
      if (download.finished) return
      armStallTimer(download)
      download.received += chunk.length
      if (download.received > download.total) {
        failDownload(download, 'The downloaded file is damaged. Try again.')
        return
      }
      if (download.hash) download.hash.update(chunk)
      if (!file.write(chunk)) {
        response.pause()
        file.once('drain', () => response.resume())
      }
      sendDownloadProgress(download, false)
    })
    response.on('end', () => {
      if (download.finished) return
      sendDownloadProgress(download, true)
      completeDownload(download)
    })
    response.on('error', () => failDownload(download, 'The download was interrupted. Try again.'))
  })
  request.on('error', () => failDownload(download, 'The update could not be downloaded.'))
  try {
    request.end()
  } catch (error) {
    failDownload(download, 'The update could not be downloaded.')
  }
}

function cancelUpdateDownload() {
  const download = updateDownload
  if (!download) return
  download.cancelled = true
  failDownload(download, '')
}

function dismissUpdate(version) {
  const target = typeof version === 'string' && version ? version.replace(/^v/i, '') : updateState.version
  if (!target) return
  const settings = readUpdateSettings()
  if (!settings.dismissed.includes(target)) {
    settings.dismissed = settings.dismissed.concat(target).slice(-UPDATE_DISMISSED_LIMIT)
  }
  if (updateDownload && updateDownload.version === target) {
    updateDownload.cancelled = true
    failDownload(updateDownload, '')
  }
  if (settings.downloadedVersion === target) forgetDownloadedUpdate(settings, true)
  writeUpdateSettings()
  if (updateState.version === target) {
    updateAsset = null
    availableUpdate = null
    updateInstallerPath = ''
    setUpdateState({ status: 'idle', version: '', notes: '', url: RELEASES_PAGE_URL, downloaded: false, downloadable: false, progress: 0, error: '' })
  }
}

function setUpdatesEnabled(enabled) {
  const settings = readUpdateSettings()
  settings.enabled = enabled !== false
  writeUpdateSettings()
  if (!settings.enabled) {
    clearUpdateTimers()
    if (updateDownload) {
      updateDownload.cancelled = true
      failDownload(updateDownload, '')
    }
    updateAsset = null
    availableUpdate = null
    setUpdateState({ status: 'idle', version: '', notes: '', downloaded: false, downloadable: false, progress: 0, error: '' })
    return
  }
  restoreDownloadedUpdate()
  emitUpdateState()
  scheduleUpdateChecks(1000)
}

function gpuFeatureLevel(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return 'unknown'
  const known = DIAGNOSTICS_FEATURE_LEVELS[text]
  if (known) return known
  if (text.endsWith('_ok')) return 'unknown'
  if (text.includes('software')) return 'software'
  if (text.includes('disabled') || text.includes('unavailable')) return 'disabled'
  if (text.includes('enabled')) return 'enabled'
  return 'unknown'
}

function isDegradedFeature(level) {
  return level === 'software' || level === 'disabled'
}

function gpuFeatureLevels() {
  let status = null
  try {
    status = app.getGPUFeatureStatus()
  } catch (error) {
    status = null
  }
  const source = status && typeof status === 'object' ? status : {}
  return {
    videoDecode: gpuFeatureLevel(source.video_decode),
    compositing: gpuFeatureLevel(source.gpu_compositing),
    rasterization: gpuFeatureLevel(source.rasterization)
  }
}

function gpuInfo(infoType) {
  return new Promise(resolve => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), DIAGNOSTICS_GPU_TIMEOUT_MS)
    try {
      app.getGPUInfo(infoType).then(info => finish(info), () => finish(null))
    } catch (error) {
      finish(null)
    }
  })
}

function gpuVendorName(device) {
  const named = device && typeof device.vendorString === 'string' ? device.vendorString.trim() : ''
  if (named) return named
  const id = Number(device && device.vendorId)
  if (!id) return ''
  return DIAGNOSTICS_GPU_VENDORS[id] || `0x${id.toString(16)}`
}

function gpuModelName(device, auxAttributes) {
  const named = device && typeof device.deviceString === 'string' ? device.deviceString.trim() : ''
  if (named) return named
  const renderer = typeof auxAttributes.glRenderer === 'string' ? auxAttributes.glRenderer.trim() : ''
  if (renderer) return renderer
  const id = Number(device && device.deviceId)
  return id ? `0x${id.toString(16)}` : ''
}

async function readGpuDevice() {
  const info = await gpuInfo('complete') || await gpuInfo('basic')
  const devices = info && Array.isArray(info.gpuDevice) ? info.gpuDevice.filter(entry => entry && typeof entry === 'object') : []
  const device = devices.find(entry => entry.active) || devices[0] || null
  const auxAttributes = info && info.auxAttributes && typeof info.auxAttributes === 'object' ? info.auxAttributes : {}
  return {
    vendor: gpuVendorName(device),
    model: gpuModelName(device, auxAttributes),
    driverVersion: device && typeof device.driverVersion === 'string' ? device.driverVersion.trim() : ''
  }
}

function healthReasons(gpu, level) {
  if (level === 'ok') return []
  if (gpu.accelerationDisabledNow) return [gpu.accelerationDisabled ? DIAGNOSTICS_REASON_ACCELERATION_OFF : DIAGNOSTICS_REASON_ACCELERATION_RESTART]
  const reasons = []
  if (isDegradedFeature(gpu.videoDecode)) reasons.push(DIAGNOSTICS_REASON_DECODE)
  if (isDegradedFeature(gpu.compositing)) reasons.push(DIAGNOSTICS_REASON_COMPOSITING)
  if (isDegradedFeature(gpu.rasterization)) reasons.push(DIAGNOSTICS_REASON_RASTERIZATION)
  return reasons
}

function healthSummary(gpu) {
  const degraded = [gpu.videoDecode, gpu.compositing].filter(isDegradedFeature).length
  let level = 'ok'
  if (degraded >= 2) level = 'critical'
  else if (degraded === 1) level = 'warning'
  return { level, reasons: healthReasons(gpu, level) }
}

function systemSnapshot() {
  const snapshot = { platform: process.platform, release: '', arch: process.arch, cpuModel: '', cpuCores: 0, totalMemoryMb: 0, freeMemoryMb: 0 }
  try {
    const cpus = os.cpus() || []
    snapshot.release = os.release()
    snapshot.cpuModel = cpus.length && cpus[0].model ? String(cpus[0].model).trim() : ''
    snapshot.cpuCores = cpus.length
    snapshot.totalMemoryMb = Math.round(os.totalmem() / 1048576)
    snapshot.freeMemoryMb = Math.round(os.freemem() / 1048576)
  } catch (error) {
  }
  return snapshot
}

function appSnapshot() {
  let version = ''
  try {
    version = app.getVersion()
  } catch (error) {
    version = ''
  }
  return {
    version,
    engineVersion: backendVersion,
    electron: process.versions.electron || '',
    chrome: process.versions.chrome || ''
  }
}

function accelerationSnapshot() {
  let disabled = !hardwareAccelerationEnabled
  try {
    disabled = !readUpdateSettings().hardwareAcceleration
  } catch (error) {
    disabled = !hardwareAccelerationEnabled
  }
  return { accelerationDisabled: disabled, accelerationDisabledNow: !hardwareAccelerationEnabled }
}

function diagnosticsText(diagnostics) {
  const gpu = diagnostics.gpu
  const system = diagnostics.system
  const versions = diagnostics.app
  const unknown = 'unknown'
  const lines = [
    `FlowAir ${versions.version} diagnostics`,
    `Engine ${versions.engineVersion || unknown} | Electron ${versions.electron} | Chrome ${versions.chrome}`,
    `System ${system.platform} ${system.release || unknown} ${system.arch}`,
    `CPU ${system.cpuModel || unknown} (${system.cpuCores} cores)`,
    `Memory ${system.freeMemoryMb} MB free of ${system.totalMemoryMb} MB`,
    `GPU ${gpu.model || unknown} by ${gpu.vendor || unknown} (driver ${gpu.driverVersion || unknown})`,
    `Video decode ${gpu.videoDecode} | Compositing ${gpu.compositing} | Rasterization ${gpu.rasterization}`,
    `Hardware acceleration ${gpu.accelerationDisabledNow ? 'off' : 'on'}`
  ]
  if (gpu.accelerationDisabled !== gpu.accelerationDisabledNow) {
    lines.push(`Hardware acceleration after restart ${gpu.accelerationDisabled ? 'off' : 'on'}`)
  }
  lines.push(`Status ${diagnostics.health.level}`)
  return lines.concat(diagnostics.health.reasons.map(reason => `- ${reason}`)).join('\n')
}

function emptyDiagnostics() {
  const gpu = { vendor: '', model: '', driverVersion: '', videoDecode: 'unknown', compositing: 'unknown', rasterization: 'unknown', ...accelerationSnapshot() }
  const diagnostics = { gpu, system: systemSnapshot(), app: appSnapshot(), health: healthSummary(gpu) }
  diagnostics.text = diagnosticsText(diagnostics)
  return diagnostics
}

async function composeDiagnostics() {
  const device = await readGpuDevice()
  const gpu = { ...device, ...gpuFeatureLevels(), ...accelerationSnapshot() }
  const diagnostics = { gpu, system: systemSnapshot(), app: appSnapshot(), health: healthSummary(gpu) }
  diagnostics.text = diagnosticsText(diagnostics)
  return diagnostics
}

async function buildDiagnostics() {
  let diagnostics = null
  try {
    diagnostics = await composeDiagnostics()
  } catch (error) {
    diagnostics = null
  }
  if (diagnostics) diagnosticsCache = diagnostics
  return diagnostics || emptyDiagnostics()
}

function readDiagnostics(refresh) {
  if (diagnosticsCache && !refresh) return Promise.resolve(diagnosticsCache)
  if (!diagnosticsPending || refresh) {
    const pending = buildDiagnostics()
    diagnosticsPending = pending
    pending.then(() => {
      if (diagnosticsPending === pending) diagnosticsPending = null
    })
  }
  return diagnosticsPending
}

function setHardwareAcceleration(enabled) {
  const settings = readUpdateSettings()
  settings.hardwareAcceleration = enabled !== false
  writeUpdateSettings()
  if (diagnosticsCache) {
    diagnosticsCache.gpu.accelerationDisabled = !settings.hardwareAcceleration
    diagnosticsCache.health = healthSummary(diagnosticsCache.gpu)
    diagnosticsCache.text = diagnosticsText(diagnosticsCache)
  }
  return { success: true, enabled: settings.hardwareAcceleration, restartRequired: settings.hardwareAcceleration !== hardwareAccelerationEnabled }
}

async function copyDiagnostics() {
  const fresh = await readDiagnostics(true)
  const diagnostics = fresh && fresh.text ? fresh : diagnosticsCache
  const text = diagnostics && diagnostics.text ? diagnostics.text : ''
  if (!text) return { success: false }
  try {
    clipboard.writeText(text)
  } catch (error) {
    return { success: false }
  }
  return { success: true }
}

function fetchPlayerState(timeoutMs) {
  return new Promise(resolve => {
    let settled = false
    const finish = (value) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    const request = http.get({ host: BACKEND_HOST, port: BACKEND_PORT, path: '/player/state', timeout: timeoutMs }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        try {
          finish(JSON.parse(body))
        } catch (error) {
          finish(null)
        }
      })
      response.on('error', () => finish(null))
    })
    request.on('timeout', () => {
      request.destroy()
      finish(null)
    })
    request.on('error', () => finish(null))
  })
}

async function isChannelOnAir() {
  const state = await fetchPlayerState(2000)
  if (state && typeof state === 'object') return Boolean(state.is_playing)
  return outputWindow !== null && !outputWindow.isDestroyed()
}

async function installUpdate(force) {
  if (updateState.status === 'installing') return { success: false, reason: 'installing' }
  if (updateState.status !== 'ready' || !updateInstallerPath) return { success: false, reason: 'not-ready' }
  const settings = readUpdateSettings()
  if (!fileMatches(updateInstallerPath, settings.downloadedSize)) {
    forgetDownloadedUpdate(settings, false)
    setUpdateState({ status: 'available', downloaded: false, progress: 0, error: 'The downloaded update is missing. Download it again.' })
    return { success: false, reason: 'missing' }
  }
  if (!force && await isChannelOnAir()) return { success: false, reason: 'on-air' }

  const installerPath = updateInstallerPath
  setUpdateState({ status: 'installing', error: '' })
  sendToMain('update-installing', { version: updateState.version })
  clearUpdateTimers()

  isQuitting = true
  closeOutputWindow()
  stopBackend()
  await waitForPortRelease(10000)

  const failure = await shell.openPath(installerPath)
  if (failure) {
    isQuitting = false
    setUpdateState({ status: 'ready', error: 'The installer could not be started. Open FlowAir-Setup.exe from the updates folder.' })
    sendToMain('update-failed', { error: 'The installer could not be started.' })
    const relaunch = await launchBackend()
    if (relaunch.ok) sendToMain('backend-restarted')
    scheduleUpdateChecks(UPDATE_CHECK_INTERVAL_MS)
    return { success: false, reason: 'launch-failed' }
  }
  setTimeout(() => app.quit(), INSTALL_QUIT_DELAY_MS)
  return { success: true }
}

async function enumerateAudioOutputs(window) {
  if (!window || window.isDestroyed()) return []
  const contents = window.webContents
  if (!contents || contents.isDestroyed()) return []
  try {
    const devices = await contents.executeJavaScript(AUDIO_DEVICES_SCRIPT, true)
    return Array.isArray(devices) ? devices : []
  } catch (error) {
    return []
  }
}

function normalizeAudioOutputs(devices) {
  const seen = new Set()
  const result = []
  let index = 0
  for (const device of devices) {
    const deviceId = device && typeof device.deviceId === 'string' ? device.deviceId : ''
    if (!deviceId || deviceId === 'communications') continue
    index += 1
    const reported = device && typeof device.label === 'string' ? device.label.trim() : ''
    const label = reported || (deviceId === 'default' ? 'Default audio output' : `Audio output ${index}`)
    if (seen.has(label)) continue
    seen.add(label)
    if (deviceId === 'default') result.unshift({ deviceId, label })
    else result.push({ deviceId, label })
  }
  return result
}

async function listAudioOutputs() {
  const fromMain = await enumerateAudioOutputs(mainWindow)
  if (fromMain.some(device => device && device.label)) return normalizeAudioOutputs(fromMain)
  const fromPlayer = await enumerateAudioOutputs(outputWindow)
  if (fromPlayer.some(device => device && device.label)) return normalizeAudioOutputs(fromPlayer)
  return normalizeAudioOutputs(fromMain.length ? fromMain : fromPlayer)
}

function isTrustedOrigin(origin) {
  const value = String(origin || '')
  if (!value) return false
  return value.startsWith('file://') || value.startsWith(DEV_SERVER_URL) || value.startsWith(BACKEND_URL) || value.startsWith(`http://${BACKEND_HOST}:${BACKEND_PORT}`)
}

function isAppPermission(permission, webContents, origin) {
  if (!ALLOWED_PERMISSIONS.includes(permission)) return false
  if (isTrustedOrigin(origin)) return true
  return isTrustedOrigin(webContents && !webContents.isDestroyed() ? webContents.getURL() : '')
}

function configurePermissions() {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => isAppPermission(permission, webContents, requestingOrigin))
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isAppPermission(permission, webContents, details && details.requestingUrl))
  })
}

function revealablePath(value) {
  if (typeof value !== 'string') return ''
  const candidate = value.trim()
  if (!candidate || candidate.length > WINDOWS_PATH_LIMIT) return ''
  if (!WINDOWS_PATH_PATTERN.test(candidate) || WINDOWS_DEVICE_PATTERN.test(candidate)) return ''
  const resolved = path.win32.resolve(candidate)
  if (!WINDOWS_PATH_PATTERN.test(resolved) || WINDOWS_DEVICE_PATTERN.test(resolved)) return ''
  return resolved
}

function revealTimeout(pending) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), REVEAL_TIMEOUT_MS)
    pending.then(() => clearTimeout(timer))
  })
}

async function revealInExplorer(value) {
  const target = revealablePath(value)
  if (!target) return { success: false }
  if (revealPending || Date.now() - revealSettledAt < REVEAL_DEBOUNCE_MS) return { success: false }
  const pending = fs.promises.stat(target).then(stats => stats, () => null)
  revealPending = pending
  pending.then(() => {
    if (revealPending === pending) revealPending = null
    revealSettledAt = Date.now()
  })
  const stats = await Promise.race([pending, revealTimeout(pending)])
  if (!stats || (!stats.isFile() && !stats.isDirectory())) return { success: false }
  shell.showItemInFolder(target)
  return { success: true }
}

function autosavePath() {
  return path.join(app.getPath('userData'), 'autosave.flowair')
}

function playlistPathShape(value, baseDirectory) {
  if (typeof value !== 'string') return ''
  const candidate = value.trim().replace(/^"+|"+$/g, '')
  if (!candidate || candidate.length > WINDOWS_PATH_LIMIT) return ''
  let resolved = ''
  try {
    resolved = path.win32.resolve(baseDirectory, candidate)
  } catch (error) {
    return ''
  }
  if (path.win32.extname(resolved).toLowerCase() !== PLAYLIST_EXTENSION) return ''
  if (!WINDOWS_PATH_PATTERN.test(resolved) || WINDOWS_DEVICE_PATTERN.test(resolved)) return ''
  return resolved
}

function playlistFileRejection(resolved) {
  let stats = null
  try {
    stats = fs.statSync(resolved)
  } catch (error) {
    return 'missing'
  }
  if (!stats.isFile()) return 'missing'
  if (stats.size === 0) return 'empty'
  if (stats.size > PLAYLIST_FILE_LIMIT) return 'too-large'
  try {
    fs.accessSync(resolved, fs.constants.R_OK)
  } catch (error) {
    return 'unreadable'
  }
  return ''
}

function playlistFileArgument(argv, workingDirectory) {
  if (!Array.isArray(argv)) return ''
  let base = typeof workingDirectory === 'string' && workingDirectory.trim() ? workingDirectory : ''
  if (!base) {
    try {
      base = process.cwd()
    } catch (error) {
      base = path.win32.dirname(process.execPath)
    }
  }
  for (let index = argv.length - 1; index >= 1; index--) {
    const value = argv[index]
    if (typeof value !== 'string' || value.startsWith('-')) continue
    const resolved = playlistPathShape(value, base)
    if (resolved) return resolved
  }
  return ''
}

function deliverPlaylistFiles() {
  if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) return
  while (pendingPlaylistFiles.length) {
    const requested = pendingPlaylistFiles.shift()
    const target = playlistPathShape(requested, path.win32.dirname(requested))
    if (!target) continue
    const rejection = playlistFileRejection(target)
    if (rejection) {
      sendToMain('open-playlist-file-failed', { name: path.win32.basename(target), reason: rejection })
      continue
    }
    sendToMain('open-playlist-file', target)
  }
}

function queuePlaylistFile(filePath) {
  if (!filePath || pendingPlaylistFiles.includes(filePath)) return
  if (pendingPlaylistFiles.length >= PLAYLIST_FILE_QUEUE_LIMIT) pendingPlaylistFiles.shift()
  pendingPlaylistFiles.push(filePath)
  deliverPlaylistFiles()
}

function markRendererReady() {
  if (rendererReady) return
  rendererReady = true
  deliverPlaylistFiles()
}

function registerIpcHandlers() {
  ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Videos', extensions: ['mp4', 'm4v', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'mpeg', 'mpg'] },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tiff', 'tif', 'gif'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result.filePaths
  })

  ipcMain.handle('save-playlist', async (event, playlistData) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'playlist.flowair',
      filters: [
        { name: 'FlowAir Playlist', extensions: ['flowair'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (!result.canceled && result.filePath) {
      try {
        writeFileAtomic(result.filePath, JSON.stringify(playlistData, null, 2))
        return { success: true, path: result.filePath }
      } catch (error) {
        return { success: false, error: error.message }
      }
    }
    return { success: false, canceled: true }
  })

  ipcMain.handle('load-playlist', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'FlowAir Playlist', extensions: ['flowair'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (!result.canceled && result.filePaths.length > 0) {
      try {
        const data = fs.readFileSync(result.filePaths[0], 'utf-8')
        return { success: true, data: JSON.parse(data) }
      } catch (error) {
        return { success: false, error: error.message }
      }
    }
    return { success: false, canceled: true }
  })

  ipcMain.handle('shell:show-item', (event, payload) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return { success: false }
    return revealInExplorer(payload && typeof payload === 'object' ? payload.filepath : payload)
  })

  ipcMain.on('renderer-ready', (event) => {
    if (!interfaceLoaded || !mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return
    markRendererReady()
  })

  ipcMain.handle('shortcuts:set-global', (event, payload) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return acceleratorAnswer('invalid')
    return setOutputAccelerator(payload && typeof payload === 'object' ? payload.accelerator : payload)
  })

  ipcMain.handle('get-displays', async () => {
    const displays = screen.getAllDisplays()
    return displays.map((display, index) => ({
      id: display.id,
      label: `${index + 1} - ${display.label || 'Unknown'} - ${display.bounds.width}x${display.bounds.height}${display.primary ? ' (Primary)' : ''}`,
      bounds: display.bounds,
      primary: display.primary
    }))
  })

  ipcMain.on('open-output-window', (event, displayId) => {
    openOutputWindow(displayId)
  })

  ipcMain.on('close-output-window', () => {
    outputReopenDisplayId = null
    closeOutputWindow()
    isCreatingOutputWindow = false
  })

  ipcMain.on('reload-output-window', () => {
    if (outputWindow && !outputWindow.isDestroyed()) {
      outputWindow.reload()
    }
  })

  ipcMain.handle('is-output-window-open', () => {
    return outputWindow !== null && !outputWindow.isDestroyed()
  })

  ipcMain.handle('get-available-update', () => availableUpdate)

  ipcMain.on('open-release-page', () => {
    shell.openExternal(updateState.url || RELEASES_PAGE_URL).catch(() => {})
  })

  ipcMain.handle('update:get-state', () => updateStateSnapshot())

  ipcMain.handle('update:download', () => {
    beginUpdateDownload()
    return updateStateSnapshot()
  })

  ipcMain.handle('update:cancel', () => {
    cancelUpdateDownload()
    return updateStateSnapshot()
  })

  ipcMain.handle('update:install', (event, payload) => installUpdate(Boolean(payload && payload.force)))

  ipcMain.handle('update:dismiss', (event, payload) => {
    dismissUpdate(payload && typeof payload === 'object' ? payload.version : payload)
    return updateStateSnapshot()
  })

  ipcMain.handle('update:set-enabled', (event, payload) => {
    setUpdatesEnabled(payload && typeof payload === 'object' ? payload.enabled : payload)
    return updateStateSnapshot()
  })

  ipcMain.handle('audio:list-devices', () => listAudioOutputs())

  ipcMain.handle('system:diagnostics', (event, payload) => readDiagnostics(Boolean(payload && typeof payload === 'object' && payload.refresh)))

  ipcMain.handle('system:set-hardware-acceleration', (event, payload) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return { success: false, enabled: hardwareAccelerationEnabled, restartRequired: false }
    return setHardwareAcceleration(payload && typeof payload === 'object' ? payload.enabled : payload)
  })

  ipcMain.handle('system:copy-diagnostics', (event) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return { success: false }
    return copyDiagnostics()
  })

  ipcMain.handle('read-autosave', () => {
    try {
      const data = JSON.parse(fs.readFileSync(autosavePath(), 'utf-8'))
      return data && Array.isArray(data.items) ? data : null
    } catch (error) {
      return null
    }
  })

  ipcMain.on('write-autosave', (event, items) => {
    try {
      writeFileAtomic(autosavePath(), JSON.stringify({ savedAt: new Date().toISOString(), items: Array.isArray(items) ? items : [] }))
    } catch (error) {
    }
  })

  ipcMain.on('exit-app', () => {
    isQuitting = true
    closeOutputWindow()
    app.quit()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId(APP_ID)
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
  hardwareAccelerationEnabled = readUpdateSettings().hardwareAcceleration
  if (!hardwareAccelerationEnabled) app.disableHardwareAcceleration()
  clearStaleCaches()
  registerIpcHandlers()

  app.on('second-instance', (event, argv, workingDirectory) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    queuePlaylistFile(playlistFileArgument(argv, workingDirectory))
  })

  app.whenReady().then(async () => {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    configurePermissions()
    createMainWindow()
    watchDisplays()
    restoreDownloadedUpdate()
    queuePlaylistFile(playlistFileArgument(process.argv, ''))

    const result = await launchBackend()
    if (isQuitting) return

    if (!result.ok) {
      const { message, detail } = startupErrorText(result)
      await showErrorDialog(message, detail)
      isQuitting = true
      app.quit()
      return
    }

    backendStarted = true
    loadInterface()
    scheduleUpdateChecks()
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('will-quit', () => {
    clearUpdateTimers()
    if (updateDownload) {
      updateDownload.cancelled = true
      failDownload(updateDownload, '')
    }
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId)
      powerSaveBlockerId = null
    }
    globalShortcut.unregisterAll()
    stopBackend()
  })

  process.on('exit', stopBackend)
}
