const { app, BrowserWindow, dialog, ipcMain, screen, globalShortcut } = require('electron')
const path = require('path')
const { exec } = require('child_process')
const fs = require('fs')

let mainWindow
let outputWindow = null
let isCreatingOutputWindow = false

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    },
    icon: path.join(__dirname, '../../assets/flowair.png'),
    autoHideMenuBar: true,
    frame: true
  })

  const fs = require('fs')
  const distPath = path.join(__dirname, '../dist/index.html')
  const isDev = !fs.existsSync(distPath)

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000')
  } else {
    mainWindow.loadFile(distPath)
  }

  mainWindow.on('close', (e) => {
    const { dialog } = require('electron')
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Cancel', 'Exit'],
      title: 'Confirm Exit',
      message: 'Are you sure you want to close FlowAir?',
      defaultId: 0,
      cancelId: 0
    })

    if (choice !== 1) {
      e.preventDefault()
    }
  })

  mainWindow.on('closed', () => {
    if (outputWindow && !outputWindow.isDestroyed()) {
      outputWindow.close()
      outputWindow = null
    }

    const lockFilePath = path.join(__dirname, '../../.flowair.lock')
    try {
      if (fs.existsSync(lockFilePath)) {
        fs.unlinkSync(lockFilePath)
      }
    } catch (e) {
    }
    mainWindow = null
  })
}

ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'mpeg'] },
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
      fs.writeFileSync(result.filePath, JSON.stringify(playlistData, null, 2), 'utf-8')
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
  if (isCreatingOutputWindow) {
    return
  }

  isCreatingOutputWindow = true

  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.close()
    outputWindow = null
  }

  setTimeout(() => {
    const displays = screen.getAllDisplays()
    const targetDisplay = displays.find(d => d.id === displayId) || displays[0]

    outputWindow = new BrowserWindow({
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
        webSecurity: true
      }
    })

    outputWindow.setAlwaysOnTop(true, 'screen-saver', 1)
    outputWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    outputWindow.setFullScreenable(true)

    outputWindow.loadURL('http://localhost:8000/player')

    outputWindow.webContents.on('did-finish-load', () => {
      outputWindow.webContents.insertCSS('html, body, * { cursor: none !important; } video { cursor: none !important; }')
      outputWindow.webContents.executeJavaScript(`
        document.body.style.cursor = 'none';
        document.documentElement.style.cursor = 'none';
        setInterval(() => {
          document.body.style.cursor = 'none';
          document.documentElement.style.cursor = 'none';
        }, 100);
      `)
    })

    outputWindow.on('closed', () => {
      outputWindow = null
      isCreatingOutputWindow = false
    })

    isCreatingOutputWindow = false
  }, 200)
})

ipcMain.on('close-output-window', () => {
  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.close()
    outputWindow = null
  }
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

ipcMain.on('exit-app', () => {
  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.close()
    outputWindow = null
  }

  const lockFilePath = path.join(__dirname, '../../.flowair.lock')

  try {
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath)
    }
  } catch (e) {
  }

  exec('cmd /c "taskkill /F /IM python.exe 2>nul & taskkill /F /IM node.exe 2>nul"', (error) => {
    setTimeout(() => {
      app.quit()
    }, 500)
  })
})

app.whenReady().then(() => {
  createWindow()

  globalShortcut.register('CommandOrControl+Shift+E', () => {
    if (outputWindow && !outputWindow.isDestroyed()) {
      outputWindow.close()
      outputWindow = null
      isCreatingOutputWindow = false
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('output-window-closed')
      }
    }
  })
})

function cleanupLockFile() {
  const lockFilePath = path.join(process.cwd(), '.flowair.lock')
  try {
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath)
    }
  } catch (e) {
  }
}

app.on('window-all-closed', () => {
  cleanupLockFile()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  cleanupLockFile()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  cleanupLockFile()
})

process.on('exit', () => {
  cleanupLockFile()
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})
