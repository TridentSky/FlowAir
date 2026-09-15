const { app, BrowserWindow, dialog, ipcMain, screen, globalShortcut, powerSaveBlocker, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const { spawn, execFileSync } = require('child_process')

const APP_ID = 'com.tridentsky.flowair'
const BACKEND_HOST = '127.0.0.1'
const BACKEND_PORT = 8000
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`
const DEV_SERVER_URL = 'http://localhost:3000'
const RELEASES_API_PATH = '/repos/TridentSky/FlowAir/releases/latest'
const RELEASES_PAGE_URL = 'https://github.com/TridentSky/FlowAir/releases/latest'
const BACKEND_START_TIMEOUT_MS = 45000
const BACKEND_RESTART_LIMIT = 5
const BACKEND_RESTART_WINDOW_MS = 120000
const UPDATE_CHECK_DELAY_MS = 20000
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const TASKKILL_PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
const CACHE_DIRECTORIES = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Shared Dictionary']
const SPLASH_HTML = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>FlowAir</title><style>html,body{margin:0;height:100%;background:#1b1b1b;color:#ececec;font-family:"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;user-select:none}body{display:flex;flex-direction:column;align-items:center;justify-content:center}h1{margin:0 0 10px;font-size:30px;font-weight:600}p{margin:0;color:#767676;font-size:13px}</style></head><body><h1>FlowAir</h1><p>Starting playout engine...</p></body></html>'

let mainWindow = null
let outputWindow = null
let outputDisplayId = null
let isCreatingOutputWindow = false
let backendProcess = null
let backendSpawnError = null
let backendInstance = ''
let backendStarted = false
let backendRestartTimes = []
let isQuitting = false
let interfaceLoaded = false
let availableUpdate = null

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function sendToMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
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
      ffmpegDir: path.join(process.resourcesPath, 'ffmpeg')
    }
  }
  const directory = path.join(__dirname, '..', '..', 'backend')
  return {
    command: path.join(directory, 'venv', 'Scripts', 'python.exe'),
    args: ['main.py'],
    cwd: directory,
    ffmpegDir: null
  }
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
            finish({ state: 'flowair', instance: data.instance || '' })
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
    if (probe.state === 'flowair' && probe.instance === backendInstance) return true
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
    if (!app.isPackaged) return { ok: true }
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
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL(DEV_SERVER_URL)
  }
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

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
  })

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
  outputWindow = null
  outputDisplayId = null
  if (window && !window.isDestroyed()) {
    window.close()
  }
}

function openOutputWindow(displayId) {
  if (isCreatingOutputWindow) return

  const targetDisplay = screen.getAllDisplays().find(display => display.id === displayId)
  if (!targetDisplay) {
    closeOutputWindow()
    sendToMain('output-window-closed', { reason: 'display-missing' })
    return
  }

  isCreatingOutputWindow = true
  closeOutputWindow()

  setTimeout(() => {
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

    window.setMenu(null)
    window.setAlwaysOnTop(true, 'screen-saver', 1)
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.setFullScreenable(true)

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('did-finish-load', () => {
      window.webContents.insertCSS('html, body, * { cursor: none !important; } video { cursor: none !important; }')
      window.webContents.executeJavaScript(`
        document.body.style.cursor = 'none';
        document.documentElement.style.cursor = 'none';
        setInterval(() => {
          document.body.style.cursor = 'none';
          document.documentElement.style.cursor = 'none';
        }, 100);
      `).catch(() => {})
    })
    window.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      setTimeout(() => {
        if (!window.isDestroyed()) window.loadURL(`${BACKEND_URL}/player`)
      }, 2000)
    })
    window.webContents.on('render-process-gone', () => {
      if (!window.isDestroyed()) window.reload()
    })
    window.on('closed', () => {
      if (outputWindow === window) {
        outputWindow = null
        outputDisplayId = null
      }
    })

    window.loadURL(`${BACKEND_URL}/player`)
    isCreatingOutputWindow = false
  }, 200)
}

function watchDisplays() {
  screen.on('display-removed', (event, display) => {
    if (outputWindow && display.id === outputDisplayId) {
      closeOutputWindow()
      sendToMain('output-window-closed', { reason: 'display-removed' })
    }
    sendToMain('displays-changed')
  })
  screen.on('display-added', () => sendToMain('displays-changed'))
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+E', () => {
    if (outputWindow && !outputWindow.isDestroyed()) {
      closeOutputWindow()
      isCreatingOutputWindow = false
      sendToMain('output-window-closed', { reason: 'shortcut' })
    }
  })
}

function isNewerVersion(candidate, current) {
  const next = String(candidate).split('.').map(part => parseInt(part, 10) || 0)
  const installed = String(current).split('.').map(part => parseInt(part, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((next[i] || 0) > (installed[i] || 0)) return true
    if ((next[i] || 0) < (installed[i] || 0)) return false
  }
  return false
}

function fetchLatestRelease() {
  return new Promise(resolve => {
    const request = https.get({
      hostname: 'api.github.com',
      path: RELEASES_API_PATH,
      headers: { 'User-Agent': 'FlowAir', Accept: 'application/vnd.github+json' },
      timeout: 10000
    }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        if (response.statusCode !== 200) {
          resolve(null)
          return
        }
        try {
          const release = JSON.parse(body)
          resolve({ version: String(release.tag_name || '').replace(/^v/i, '') })
        } catch (error) {
          resolve(null)
        }
      })
      response.on('error', () => resolve(null))
    })
    request.on('timeout', () => request.destroy())
    request.on('error', () => resolve(null))
  })
}

async function checkForUpdates() {
  const release = await fetchLatestRelease()
  if (release && release.version && isNewerVersion(release.version, app.getVersion())) {
    availableUpdate = { version: release.version }
    sendToMain('update-available', availableUpdate)
  }
}

function scheduleUpdateChecks() {
  if (!app.isPackaged) return
  setTimeout(checkForUpdates, UPDATE_CHECK_DELAY_MS)
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS)
}

function autosavePath() {
  return path.join(app.getPath('userData'), 'autosave.flowair')
}

function registerIpcHandlers() {
  ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Videos', extensions: ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'mpeg', 'mpg'] },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tiff', 'gif'] },
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
    shell.openExternal(RELEASES_PAGE_URL).catch(() => {})
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
  clearStaleCaches()
  registerIpcHandlers()

  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    powerSaveBlocker.start('prevent-display-sleep')
    createMainWindow()
    registerShortcuts()
    watchDisplays()

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
    globalShortcut.unregisterAll()
    stopBackend()
  })

  process.on('exit', stopBackend)
}
