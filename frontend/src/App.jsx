import React, { useState, useEffect, useRef } from 'react'
import Playlist from './components/Playlist'
import Preview from './components/Preview'
import Controls from './components/Controls'
import Timer from './components/Timer'
import LiveIndicator from './components/LiveIndicator'
import ActivityLog from './components/ActivityLog'
import { api } from './api'
import packageJson from '../package.json'

const APP_VERSION = packageJson.version
const AUTOSAVE_DELAY_MS = 1500
const IPC_CHANNELS = ['output-window-closed', 'displays-changed', 'backend-restarted', 'update-available']

const getElectron = () => {
  try {
    return window.require('electron')
  } catch (error) {
    return null
  }
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

const App = () => {
  const [playlist, setPlaylist] = useState([])
  const [currentItem, setCurrentItem] = useState(null)
  const [selectedItems, setSelectedItems] = useState([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [logCollapsed, setLogCollapsed] = useState(true)
  const [currentClock, setCurrentClock] = useState(new Date())
  const [activityLogs, setActivityLogs] = useState([])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [copiedItems, setCopiedItems] = useState([])
  const [lastSelectedId, setLastSelectedId] = useState(null)
  const isCtrlPressed = useRef(false)
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [noteInputValue, setNoteInputValue] = useState('')
  const [noteInsertIndex, setNoteInsertIndex] = useState(0)
  const [editingNoteId, setEditingNoteId] = useState(null)
  const lastAction = useRef(null)
  const pauseWebSocketUpdates = useRef(false)
  const [serverElapsed, setServerElapsed] = useState(0)
  const [editMode, setEditMode] = useState(false)
  const [outputVolume, setOutputVolume] = useState(100)
  const [availableUpdate, setAvailableUpdate] = useState(null)
  const [recoverySession, setRecoverySession] = useState(null)
  const autosaveReady = useRef(false)
  const autosaveTimer = useRef(null)
  const pendingAutosave = useRef(null)
  const lastAutosave = useRef(null)
  const [timeFormat, setTimeFormat] = useState(() => {
    return localStorage.getItem('timeFormat') || '12'
  })

  const [showOutputSettings, setShowOutputSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState('video')
  const [outputSettings, setOutputSettings] = useState(() => {
    const saved = localStorage.getItem('outputSettings')
    return saved ? JSON.parse(saved) : {
      resolution: '1920x1080',
      aspectRatio: '16:9',
      quality: 'max',
      scalingMode: 'stretch',
      externalOutputEnabled: false,
      selectedDisplayId: null,
      networkStreamingEnabled: false
    }
  })
  const [availableDisplays, setAvailableDisplays] = useState([])
  const [outputWindowActive, setOutputWindowActive] = useState(false)
  const [networkInfo, setNetworkInfo] = useState({ local_ip: '127.0.0.1', port: 8000, player_url: 'http://127.0.0.1:8000/player' })

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

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentClock(new Date())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    loadPlaylist()
    loadDisplays()
    loadNetworkInfo()
    restoreOutputWindow()

    api.updateOutputSettings(outputSettings).catch(() => {})
    if (obsSettings.enabled) {
      api.updateOBSSettings(obsSettings)
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
        if (!pauseWebSocketUpdates.current) {
          setPlaylist(data.playlist)
          if (data.current_item) {
            setCurrentItem(data.current_item)
          } else {
            setCurrentItem(null)
          }
          if (data.is_playing !== undefined) {
            setIsPlaying(data.is_playing)
          }
        }
        if (data.elapsed !== undefined) {
          setServerElapsed(data.elapsed)
        }
      } else if (data.type === 'playback_state_changed') {
        setIsPlaying(data.is_playing)
        if (data.current_item) {
          setCurrentItem(data.current_item)
        } else {
          setCurrentItem(null)
        }
      } else if (data.type === 'item_cued') {
        if (data.current_item) {
          setCurrentItem(data.current_item)
          setIsPlaying(data.is_playing)
        }
        if (data.playlist) {
          setPlaylist(data.playlist)
        }
      } else if (data.type === 'volume_changed') {
        if (typeof data.volume === 'number') {
          setOutputVolume(data.volume)
        }
      } else if (data.type === 'player_seek') {
        if (data.playlist) {
          setPlaylist(data.playlist)
        }
        if (typeof data.position === 'number') {
          setServerElapsed(Math.floor(data.position))
        }
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
      ipcRenderer.on('displays-changed', () => {
        loadDisplays()
      })
      ipcRenderer.on('backend-restarted', () => {
        loadPlaylist()
        addLog('Playout engine restarted after an unexpected stop', 'error')
      })
      ipcRenderer.on('update-available', (event, update) => {
        if (update) setAvailableUpdate(update)
      })
      ipcRenderer.invoke('get-available-update')
        .then(update => {
          if (update) setAvailableUpdate(update)
        })
        .catch(() => {})
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
      if (electron) {
        IPC_CHANNELS.forEach(channel => electron.ipcRenderer.removeAllListeners(channel))
      }
    }
  }, [])

  useEffect(() => {
    if (recoverySession && playlist.length > 0) {
      setRecoverySession(null)
      autosaveReady.current = true
    }
  }, [playlist, recoverySession])

  useEffect(() => {
    if (!autosaveReady.current) return
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
  }, [playlist])

  useEffect(() => {
    if (!obsSettings.enabled) {
      setOBSConnected(false)
      return
    }
    const checkStatus = async () => {
      try {
        const status = await api.getOBSStatus()
        setOBSConnected(status.connected)
      } catch {
        setOBSConnected(false)
      }
    }
    checkStatus()
    const interval = setInterval(checkStatus, 5000)
    return () => clearInterval(interval)
  }, [obsSettings.enabled])

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
  }, [obsConnected])

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
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault()
        if (outputWindowActive) {
          try {
            const { ipcRenderer } = window.require('electron')
            ipcRenderer.send('close-output-window')
            setOutputWindowActive(false)
            setOutputSettings(prev => ({ ...prev, externalOutputEnabled: false }))
            addLog('External output closed', 'info')
          } catch (error) {
          }
        }
        return
      }

      if (showDeleteConfirm) {
        if (e.key === 'Enter') {
          e.preventDefault()
          handleDeleteConfirmed()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setShowDeleteConfirm(false)
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

      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      if (e.key === 'Control') {
        isCtrlPressed.current = true
        return
      }

      if (showOutputSettings) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowOutputSettings(false)
        }
        return
      }

      const key = typeof e.key === 'string' ? e.key.toLowerCase() : ''
      const hasModifier = e.ctrlKey || e.altKey || e.metaKey

      if (e.repeat && !hasModifier && [' ', 'enter', 'delete', 'n', 's'].includes(key)) {
        e.preventDefault()
        return
      }

      if (key === ' ' && !hasModifier) {
        e.preventDefault()
        if (isPlaying) {
          handleStop()
        } else {
          handlePlay()
        }
      } else if (key === 'enter' && !hasModifier) {
        e.preventDefault()
        if (selectedItems.length === 1) {
          handleCue(selectedItems[0].id)
        }
      } else if (key === 'delete' && !hasModifier) {
        e.preventDefault()
        if (selectedItems.length > 0) {
          const hasPlayingItem = selectedItems.some(item =>
            currentItem && item.id === currentItem.id
          )
          if (hasPlayingItem) {
            return
          }
          setShowDeleteConfirm(true)
        }
      } else if (e.ctrlKey && key === 'c') {
        e.preventDefault()
        if (selectedItems.length > 0) {
          setCopiedItems([...selectedItems])
          addLog(`Copied ${selectedItems.length} item(s)`, 'info')
        }
      } else if (e.ctrlKey && key === 'v') {
        e.preventDefault()
        if (copiedItems.length > 0) {
          handlePasteItems()
        }
      } else if (e.ctrlKey && key === 'z') {
        e.preventDefault()
        handleUndo()
      } else if (e.ctrlKey && key === 'q') {
        e.preventDefault()
        handleExit()
      } else if (key === 'arrowup' && !hasModifier) {
        e.preventDefault()
        handleArrowNavigation('up')
      } else if (key === 'arrowdown' && !hasModifier) {
        e.preventDefault()
        handleArrowNavigation('down')
      } else if (key === 'n' && !hasModifier) {
        handleNext()
      } else if (key === 's' && !hasModifier) {
        handleStop()
      }
    }

    const handleKeyUp = (e) => {
      if (e.key === 'Control') {
        isCtrlPressed.current = false
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [playlist, selectedItems, copiedItems, isPlaying, showDeleteConfirm, showNoteInput, showOBSEventModal, showOutputSettings, currentItem, outputWindowActive])

  const loadPlaylist = async () => {
    try {
      const data = await api.getPlaylist()
      setPlaylist(data.playlist || [])
      setCurrentItem(data.current_item)
      setIsPlaying(data.is_playing)
    } catch (error) {
    }
  }

  const loadDisplays = async () => {
    try {
      const { ipcRenderer } = window.require('electron')
      const displays = await ipcRenderer.invoke('get-displays')
      setAvailableDisplays(displays)
    } catch (error) {
    }
  }

  const loadNetworkInfo = async () => {
    try {
      const info = await api.getNetworkInfo()
      setNetworkInfo(info)
    } catch (error) {
    }
  }

  const restoreOutputWindow = async () => {
    try {
      const { ipcRenderer } = window.require('electron')
      const isOpen = await ipcRenderer.invoke('is-output-window-open')

      if (outputSettings.externalOutputEnabled && outputSettings.selectedDisplayId && !isOpen) {
        ipcRenderer.send('open-output-window', outputSettings.selectedDisplayId)
        setOutputWindowActive(true)
      } else {
        setOutputWindowActive(isOpen)
      }
    } catch (error) {
    }
  }

  const addLog = (message, type = 'info') => {
    const now = new Date()
    const time = now.toLocaleTimeString('en-US', { hour12: false })
    const newLog = { time, message, type }
    setActivityLogs(prev => [newLog, ...prev].slice(0, 50))
  }

  const pushAction = (action) => {
    lastAction.current = action
  }

  const getCurrentIndex = () => {
    return currentItem ? playlist.findIndex(i => i.id === currentItem.id) : -1
  }

  const insertItemAt = (item, index) => {
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
  }

  const insertedItemId = (result) => {
    return result && result.item ? result.item.id : null
  }

  const handleUndo = async () => {
    if (!lastAction.current) {
      addLog('Nothing to undo', 'warning')
      return
    }

    try {
      pauseWebSocketUpdates.current = true

      const action = lastAction.current
      const currentPlaylist = await api.getPlaylist()
      const playingId = currentItem ? currentItem.id : null
      const currentPlayingIndex = playingId !== null ? currentPlaylist.playlist.findIndex(i => i.id === playingId) : -1

      if (action.type === 'added_items') {
        for (const id of action.itemIds) {
          if (id !== playingId && currentPlaylist.playlist.some(i => i.id === id)) {
            await api.removeItem(id)
          }
        }
      } else if (action.type === 'delete_items') {
        const entries = action.items
          .map((item, i) => ({ item, index: action.originalIndices[i] }))
          .filter(entry => typeof entry.index === 'number' && entry.index >= 0)
          .sort((a, b) => a.index - b.index)

        for (const { item, index } of entries) {
          if (currentPlayingIndex >= 0 && index <= currentPlayingIndex) {
            continue
          }
          if (item.location && item.type !== 'stop' && item.type !== 'note' && item.type !== 'obs') {
            const fileCheck = await api.checkFileExists(item.location)
            if (!fileCheck.exists) {
              continue
            }
          }
          await insertItemAt(item, index)
        }
      } else if (action.type === 'reorder') {
        await api.reorderItems(action.toIndex, action.fromIndex)
      } else if (action.type === 'move_items') {
        await api.moveItems(action.itemIds, action.position)
      }

      const finalState = await api.getPlaylist()
      setPlaylist(finalState.playlist)
      lastAction.current = null
      addLog('Undo successful', 'info')
    } catch (error) {
      addLog('Undo failed', 'error')
    } finally {
      pauseWebSocketUpdates.current = false
    }
  }

  const handleSelectItem = (item, isCtrl, isShift) => {
    const currentIndex = playlist.findIndex(i => i.id === item.id)
    const anchorIndex = lastSelectedId !== null
      ? playlist.findIndex(i => i.id === lastSelectedId)
      : -1

    if (isShift && anchorIndex >= 0) {
      const start = Math.min(anchorIndex, currentIndex)
      const end = Math.max(anchorIndex, currentIndex)
      const rangeItems = playlist.slice(start, end + 1)
      setSelectedItems(rangeItems)
    } else if (isCtrl) {
      const isAlreadySelected = selectedItems.find(i => i.id === item.id)
      if (isAlreadySelected) {
        setSelectedItems(selectedItems.filter(i => i.id !== item.id))
      } else {
        setSelectedItems([...selectedItems, item])
      }
      setLastSelectedId(item.id)
    } else {
      setSelectedItems([item])
      setLastSelectedId(item.id)
    }
  }

  const handleArrowNavigation = (direction) => {
    if (playlist.length === 0) return

    if (selectedItems.length === 0) {
      setSelectedItems([playlist[0]])
      setLastSelectedId(playlist[0].id)
      return
    }

    const firstSelectedIndex = playlist.findIndex(i => i.id === selectedItems[0].id)
    let newIndex = firstSelectedIndex

    if (direction === 'up') {
      newIndex = Math.max(0, firstSelectedIndex - 1)
    } else if (direction === 'down') {
      newIndex = Math.min(playlist.length - 1, firstSelectedIndex + 1)
    }

    if (newIndex !== firstSelectedIndex) {
      setSelectedItems([playlist[newIndex]])
      setLastSelectedId(playlist[newIndex].id)
    }
  }

  const handlePasteItems = async () => {
    try {
      pauseWebSocketUpdates.current = true

      let insertIndex = playlist.length
      if (selectedItems.length === 1) {
        insertIndex = playlist.findIndex(i => i.id === selectedItems[0].id) + 1
      }
      const currentIndex = getCurrentIndex()
      if (isPlaying && currentIndex >= 0 && insertIndex <= currentIndex) {
        insertIndex = currentIndex + 1
      }

      const pastedIds = []
      for (const item of copiedItems) {
        const result = await insertItemAt(item, insertIndex + pastedIds.length)
        const id = insertedItemId(result)
        if (id !== null) {
          pastedIds.push(id)
        }
      }

      const finalState = await api.getPlaylist()
      setPlaylist(finalState.playlist)

      if (pastedIds.length > 0) {
        pushAction({ type: 'added_items', itemIds: pastedIds })
      }

      addLog(`Pasted ${pastedIds.length} item(s)`, 'info')
    } catch (error) {
      addLog('Error pasting items', 'error')
    } finally {
      pauseWebSocketUpdates.current = false
    }
  }

  const handleDeleteConfirmed = async () => {
    try {
      const hasPlayingItem = selectedItems.some(item =>
        currentItem && item.id === currentItem.id
      )
      if (hasPlayingItem) {
        setShowDeleteConfirm(false)
        addLog('Cannot delete item currently playing', 'warning')
        return
      }

      const itemsToDelete = [...selectedItems]
      const originalIndices = itemsToDelete.map(item => playlist.findIndex(i => i.id === item.id))

      setShowDeleteConfirm(false)
      setSelectedItems([])

      pauseWebSocketUpdates.current = true

      await Promise.all(selectedItems.map(item => api.removeItem(item.id)))

      const finalState = await api.getPlaylist()
      setPlaylist(finalState.playlist)

      pushAction({
        type: 'delete_items',
        items: itemsToDelete.map(item => ({
          id: item.id,
          type: item.type,
          location: item.location,
          note: item.note,
          obs_scene: item.obs_scene,
          obs_source: item.obs_source,
          obs_action: item.obs_action,
          obs_transition: item.obs_transition,
          obs_transition_duration: item.obs_transition_duration
        })),
        originalIndices
      })

      pauseWebSocketUpdates.current = false
      addLog(`Deleted ${itemsToDelete.length} item(s)`, 'info')
    } catch (error) {
      pauseWebSocketUpdates.current = false
      addLog('Error deleting items', 'error')
    }
  }

  const handleAddFiles = async () => {
    const electron = getElectron()
    if (!electron) return

    try {
      const filePaths = await electron.ipcRenderer.invoke('select-files')
      if (!filePaths || filePaths.length === 0) return

      addLog(`Adding ${filePaths.length} file(s) to playlist...`, 'info')
      pauseWebSocketUpdates.current = true

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
      setPlaylist(finalState.playlist)

      if (addedIds.length > 0) {
        pushAction({ type: 'added_items', itemIds: addedIds })
      }
      addLog(`Successfully added ${addedIds.length} file(s)`, 'info')
    } catch (error) {
      addLog('Error selecting files', 'error')
    } finally {
      pauseWebSocketUpdates.current = false
    }
  }

  const handleClearPlaylist = async () => {
    if (!window.confirm('Are you sure you want to clear the entire playlist?')) return

    try {
      const itemsToDelete = [...playlist]
      pauseWebSocketUpdates.current = true

      for (const item of itemsToDelete) {
        await api.removeItem(item.id)
      }

      const finalState = await api.getPlaylist()
      setPlaylist(finalState.playlist)

      pushAction({
        type: 'delete_items',
        items: serializePlaylistItems(itemsToDelete),
        originalIndices: itemsToDelete.map((item, index) => index)
      })

      setSelectedItems([])
      addLog('Playlist cleared', 'info')
    } catch (error) {
      addLog('Error clearing playlist', 'error')
    } finally {
      pauseWebSocketUpdates.current = false
    }
  }

  const resolvePlaylistInsertIndex = () => {
    if (selectedItems.length === 0) return playlist.length
    const lastSelectedIndex = playlist.findIndex(item => item.id === selectedItems[selectedItems.length - 1].id)
    if (lastSelectedIndex < 0) return playlist.length
    const currentIndex = getCurrentIndex()
    if (currentIndex >= 0 && lastSelectedIndex < currentIndex) return null
    return lastSelectedIndex + 1
  }

  const insertPlaylistItems = async (items, insertIndex) => {
    let inserted = 0
    pauseWebSocketUpdates.current = true
    try {
      for (const item of items) {
        const result = await insertItemAt(item, insertIndex + inserted)
        if (insertedItemId(result) !== null) {
          inserted++
        }
      }
      const finalState = await api.getPlaylist()
      setPlaylist(finalState.playlist)
    } finally {
      pauseWebSocketUpdates.current = false
    }

    setTimeout(() => {
      api.getPlaylist()
        .then(state => setPlaylist(state.playlist))
        .catch(() => {})
    }, 2000)
    return inserted
  }

  const loadPlaylistFile = async (file, insertIndex) => {
    addLog(`Loading playlist: ${file.name}`, 'info')
    try {
      const items = extractPlaylistItems(JSON.parse(await file.text()))
      const count = await insertPlaylistItems(items, insertIndex)
      addLog(`Loaded ${count} items from ${file.name}`, 'info')
    } catch (error) {
      addLog('Error loading playlist file', 'error')
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e) => {
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
    await loadPlaylistFile(playlistFile, insertIndex)
  }

  const handleExternalDrop = async (files, insertIndex) => {
    if (!files || files.length === 0) return
    const filesArray = Array.from(files)

    const playlistFile = filesArray.find(f => f.name.toLowerCase().endsWith('.flowair'))
    if (playlistFile) {
      await loadPlaylistFile(playlistFile, insertIndex)
      return
    }

    const electron = getElectron()
    addLog(`Adding ${filesArray.length} file(s) via drag & drop...`, 'info')
    pauseWebSocketUpdates.current = true

    const addedIds = []
    try {
      for (const file of filesArray) {
        const filepath = electron && electron.webUtils ? electron.webUtils.getPathForFile(file) : file.path
        if (!filepath) {
          addLog(`Cannot read the location of ${file.name}`, 'error')
          continue
        }
        try {
          const id = insertedItemId(await api.addItem(filepath, insertIndex + addedIds.length))
          if (id !== null) {
            addedIds.push(id)
          }
        } catch (error) {
          addLog(`Failed to add ${file.name}`, 'error')
        }
      }

      const finalState = await api.getPlaylist()
      setPlaylist(finalState.playlist)
    } catch (error) {
      addLog('Error adding dropped files', 'error')
    } finally {
      pauseWebSocketUpdates.current = false
    }

    if (addedIds.length > 0) {
      pushAction({ type: 'added_items', itemIds: addedIds })
    }
    addLog(`Successfully added ${addedIds.length} file(s)`, 'info')
  }

  const handlePlay = async () => {
    try {
      await api.play()
      setIsPlaying(true)
      addLog('Playback started', 'playback')
    } catch (error) {
      addLog('Error starting playback', 'error')
    }
  }

  const handleStop = async () => {
    try {
      await api.stop()
      setIsPlaying(false)
      addLog('Playback stopped', 'playback')
    } catch (error) {
      addLog('Error stopping playback', 'error')
    }
  }

  const handleNext = async () => {
    try {
      if (selectedItems.length === 1) {
        const selected = selectedItems[0]
        const isCurrentPlaying = currentItem && currentItem.id === selected.id

        if (isCurrentPlaying) {
          await api.next()
          setSelectedItems([])
          addLog('Skipped to next item', 'playback')
        } else if (selected.type === 'video' || selected.type === 'image') {
          await api.cue(selected.id)
          await api.play()
          setSelectedItems([])
          addLog(`Jumped to selected item: ${selected.name}`, 'playback')
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
  }

  const handleExit = () => {
    const confirmed = window.confirm('Are you sure you want to exit FlowAir?\n\nThis will close the application completely.')
    if (!confirmed) return
    const electron = getElectron()
    if (electron) {
      electron.ipcRenderer.send('exit-app')
    } else {
      window.close()
    }
  }

  const handleSavePlaylist = async () => {
    const electron = getElectron()
    if (!electron) return
    try {
      const result = await electron.ipcRenderer.invoke('save-playlist', serializePlaylistItems(playlist))
      if (result.success) {
        addLog(`Playlist saved: ${result.path}`, 'info')
      } else if (!result.canceled) {
        addLog('Error saving playlist', 'error')
      }
    } catch (error) {
      addLog('Error saving playlist', 'error')
    }
  }

  const handleLoadPlaylist = async () => {
    const electron = getElectron()
    if (!electron) return
    try {
      const result = await electron.ipcRenderer.invoke('load-playlist')
      if (result.success && result.data) {
        const insertIndex = resolvePlaylistInsertIndex()
        if (insertIndex === null) {
          addLog('Cannot insert playlist in grayed area', 'warning')
          return
        }
        const count = await insertPlaylistItems(extractPlaylistItems(result.data), insertIndex)
        addLog(`Loaded ${count} items from playlist`, 'info')
      } else if (!result.canceled) {
        addLog('Error loading playlist', 'error')
      }
    } catch (error) {
      addLog('Error loading playlist', 'error')
    }
  }

  const handleRestoreSession = async () => {
    if (!recoverySession) return
    const { items } = recoverySession
    setRecoverySession(null)
    autosaveReady.current = true
    try {
      const count = await insertPlaylistItems(items, playlist.length)
      addLog(`Restored ${count} item(s) from the last session`, 'info')
    } catch (error) {
      addLog('Error restoring the last session', 'error')
    }
  }

  const handleDismissSession = () => {
    setRecoverySession(null)
    autosaveReady.current = true
    lastAutosave.current = JSON.stringify([])
    const electron = getElectron()
    if (electron) {
      electron.ipcRenderer.send('write-autosave', [])
    }
  }

  const handleVolumeChange = (value) => {
    const vol = Math.max(0, Math.min(100, Math.round(value)))
    setOutputVolume(vol)
    api.setPlayerVolume(vol).catch(() => {})
  }

  const handleSeek = (position) => {
    if (!currentItem || currentItem.type !== 'video') return
    setServerElapsed(Math.floor(position))
    api.seekPlayer(position).catch(() => addLog('Error seeking video', 'error'))
  }

  const handleCue = async (itemId) => {
    try {
      await api.cue(itemId)
      addLog('Item cued and loaded to preview', 'info')
    } catch (error) {
      addLog('Error cueing item', 'error')
    }
  }

  const handleRemoveItem = async (itemId) => {
    try {
      pauseWebSocketUpdates.current = true

      const currentPlaylist = await api.getPlaylist()
      const itemIndex = currentPlaylist.playlist.findIndex(i => i.id === itemId)
      const itemToDelete = itemIndex >= 0 ? currentPlaylist.playlist[itemIndex] : null

      await api.removeItem(itemId)

      const finalState = await api.getPlaylist()
      setPlaylist(finalState.playlist)
      setSelectedItems(prev => prev.filter(i => i.id !== itemId))

      if (itemToDelete) {
        pushAction({
          type: 'delete_items',
          items: serializePlaylistItems([itemToDelete]),
          originalIndices: [itemIndex]
        })
      }

      addLog('Item removed from playlist', 'info')
    } catch (error) {
      addLog('Error removing item', 'error')
    } finally {
      pauseWebSocketUpdates.current = false
    }
  }

  const handleReorder = async (fromIndex, toIndex, isDuplicate) => {
    const draggedItem = playlist[fromIndex]
    if (!draggedItem) return

    try {
      pauseWebSocketUpdates.current = true
      const isItemSelected = selectedItems.some(i => i.id === draggedItem.id)

      if (isItemSelected && selectedItems.length > 1) {
        const selectedIds = new Set(selectedItems.map(item => item.id))
        const movingIds = playlist.filter(item => selectedIds.has(item.id)).map(item => item.id)
        const originalPosition = playlist.findIndex(item => selectedIds.has(item.id))
        const position = playlist.slice(0, toIndex).filter(item => !selectedIds.has(item.id)).length

        const result = await api.moveItems(movingIds, position)
        if (result && result.success) {
          pushAction({ type: 'move_items', itemIds: movingIds, position: originalPosition })
          addLog(`Moved ${movingIds.length} items`, 'info')
        } else {
          addLog('Items cannot be moved to that position', 'warning')
        }
      } else if (isDuplicate) {
        const id = insertedItemId(await insertItemAt(draggedItem, toIndex))
        if (id !== null) {
          pushAction({ type: 'added_items', itemIds: [id] })
        }
        addLog('Item duplicated', 'info')
      } else {
        const adjustedToIndex = toIndex > fromIndex ? toIndex - 1 : toIndex
        if (adjustedToIndex !== fromIndex) {
          pushAction({ type: 'reorder', fromIndex, toIndex: adjustedToIndex })
          await api.reorderItems(fromIndex, adjustedToIndex)
          addLog(`Reordered item from position ${fromIndex + 1} to ${adjustedToIndex + 1}`, 'info')
        }
      }

      const finalState = await api.getPlaylist()
      setPlaylist(finalState.playlist)
    } catch (error) {
      addLog('Error reordering items', 'error')
    } finally {
      pauseWebSocketUpdates.current = false
    }
  }

  const handleStopEvent = async (insertIndex) => {
    try {
      pauseWebSocketUpdates.current = true

      const id = insertedItemId(await api.insertStopEvent(insertIndex))

      const finalState = await api.getPlaylist()
      setPlaylist(finalState.playlist)

      if (id !== null) {
        pushAction({ type: 'added_items', itemIds: [id] })
      }

      addLog('STOP EVENT inserted into playlist', 'info')
    } catch (error) {
      addLog('Error inserting stop event', 'error')
    } finally {
      pauseWebSocketUpdates.current = false
    }
  }

  const handleAddNote = async (insertIndex, note, itemId) => {
    if (itemId) {
      const item = playlist.find(i => i.id === itemId)
      setNoteInputValue(item?.note || '')
      setEditingNoteId(itemId)
      setNoteInsertIndex(insertIndex)
      setShowNoteInput(true)
      return
    }

    if (!note) {
      setEditingNoteId(null)
      setNoteInputValue('')
      setNoteInsertIndex(insertIndex)
      setShowNoteInput(true)
      return
    }

    try {
      pauseWebSocketUpdates.current = true

      const id = insertedItemId(await api.insertNote(insertIndex, note))

      const finalState = await api.getPlaylist()
      setPlaylist(finalState.playlist)

      if (id !== null) {
        pushAction({ type: 'added_items', itemIds: [id] })
      }

      addLog(`Note inserted: "${note}"`, 'info')
      setShowNoteInput(false)
      setNoteInputValue('')
    } catch (error) {
      addLog('Error inserting note', 'error')
    } finally {
      pauseWebSocketUpdates.current = false
    }
  }

  const handleNoteConfirm = async () => {
    if (noteInputValue.trim()) {
      if (editingNoteId) {
        try {
          pauseWebSocketUpdates.current = true

          await api.updateNote(editingNoteId, noteInputValue.trim())

          const finalState = await api.getPlaylist()
          setPlaylist(finalState.playlist)
          pauseWebSocketUpdates.current = false

          addLog(`Note updated: "${noteInputValue.trim()}"`, 'info')
          setShowNoteInput(false)
          setNoteInputValue('')
          setEditingNoteId(null)
        } catch (error) {
          pauseWebSocketUpdates.current = false
          addLog('Error updating note', 'error')
        }
      } else {
        await handleAddNote(noteInsertIndex, noteInputValue.trim())
      }
    } else {
      setShowNoteInput(false)
      setNoteInputValue('')
      setEditingNoteId(null)
    }
  }

  const handleToggleLoop = async (itemId) => {
    try {
      pauseWebSocketUpdates.current = true

      const result = await api.toggleLoop(itemId)

      const finalState = await api.getPlaylist()
      setPlaylist(finalState.playlist)

      pauseWebSocketUpdates.current = false

      addLog(result.loop ? 'Loop enabled' : 'Loop disabled', 'info')
    } catch (error) {
      pauseWebSocketUpdates.current = false
      addLog('Error toggling loop', 'error')
    }
  }

  const handleTimeFormatChange = (format) => {
    setTimeFormat(format)
    localStorage.setItem('timeFormat', format)
  }

  const handleOutputSettingsChange = async (key, value) => {
    setOutputSettings(prev => {
      const updated = { ...prev, [key]: value }
      localStorage.setItem('outputSettings', JSON.stringify(updated))
      return updated
    })
  }

  const handleApplyVideoSettings = async () => {
    try {
      await api.updateOutputSettings(outputSettings)

      addLog('Video settings applied', 'info')
    } catch (error) {
      addLog('Error applying video settings', 'error')
    }
  }

  const handleApplyExternalOutput = async () => {
    try {
      const { ipcRenderer } = window.require('electron')

      if (outputSettings.externalOutputEnabled && outputSettings.selectedDisplayId) {
        ipcRenderer.send('open-output-window', outputSettings.selectedDisplayId)
        setOutputWindowActive(true)
        addLog('External output window opened', 'info')
      } else if (!outputSettings.externalOutputEnabled && outputWindowActive) {
        ipcRenderer.send('close-output-window')
        setOutputWindowActive(false)
        addLog('External output window closed', 'info')
      }
    } catch (error) {
      addLog('Error applying external output', 'error')
    }
  }

  const handleApplyNetworkStreaming = async () => {
    try {
      await api.updateOutputSettings(outputSettings)
      addLog(`Network streaming ${outputSettings.networkStreamingEnabled ? 'enabled' : 'disabled'}`, 'info')
    } catch (error) {
      addLog('Error applying network streaming settings', 'error')
    }
  }

  const handleOBSSettingsChange = (key, value) => {
    setOBSSettings(prev => {
      const updated = { ...prev, [key]: value }
      localStorage.setItem('obsSettings', JSON.stringify(updated))
      return updated
    })
  }

  const handleApplyOBSSettings = async () => {
    setOBSStatusMessage('Connecting...')
    try {
      await api.updateOBSSettings(obsSettings)
      if (obsSettings.enabled) {
        const result = await api.obsConnect()
        setOBSConnected(result.success || false)
        if (result.success) {
          setOBSStatusMessage(`Connected to OBS v${result.obs_version}`)
          addLog(`OBS connected (v${result.obs_version})`, 'info')
        } else {
          setOBSStatusMessage(`Failed: ${result.error || 'Unknown error'}`)
          addLog(`OBS connection failed: ${result.error || 'Unknown error'}`, 'error')
        }
      } else {
        await api.obsDisconnect()
        setOBSConnected(false)
        setOBSStatusMessage('')
        addLog('OBS integration disabled', 'info')
      }
    } catch (err) {
      setOBSStatusMessage(`Error: ${err.message || 'Could not reach backend'}`)
      addLog('Error applying OBS settings', 'error')
    }
  }

  const handleOBSSourceToggle = async (sourceName, currentVisible) => {
    try {
      await api.setOBSSourceVisibility(obsSelectedScene, sourceName, !currentVisible)
      const data = await api.getOBSSceneSources(obsSelectedScene)
      setOBSSources(data.sources || [])
    } catch {
      addLog('Error toggling OBS source', 'error')
    }
  }

  const handleActivateOBSScene = async () => {
    if (!obsSelectedScene) return
    try {
      const result = await api.setOBSScene(obsSelectedScene)
      if (result && result.success) {
        setObsCurrentScene(obsSelectedScene)
        addLog(`OBS: switched to scene "${obsSelectedScene}"`, 'playback')
      } else {
        addLog('Error switching OBS scene', 'error')
      }
    } catch {
      addLog('Error switching OBS scene', 'error')
    }
  }

  const handleInsertOBSEvent = async (insertIndex, obsScene, obsSource, obsAction, obsTransition = '', obsTransitionDuration = 0, itemId = null) => {
    try {
      pauseWebSocketUpdates.current = true
      await api.insertOBSEvent(insertIndex, obsScene, obsSource, obsAction, obsTransition, obsTransitionDuration, itemId)
      const finalState = await api.getPlaylist()
      setPlaylist(finalState.playlist)
      pauseWebSocketUpdates.current = false
      const verb = itemId ? 'updated' : 'added'
      if (obsAction === 'switch_scene') {
        addLog(`OBS Event ${verb}: switch to "${obsScene}"`, 'info')
      } else {
        addLog(`OBS Event ${verb}: ${obsAction} "${obsSource}" in "${obsScene}"`, 'info')
      }
    } catch {
      pauseWebSocketUpdates.current = false
      addLog('Error saving OBS event', 'error')
    }
  }

  const loadOBSTransitions = async () => {
    try {
      const data = await api.getOBSTransitions()
      setOBSTransitions(data.transitions || [])
      return data
    } catch {
      setOBSTransitions([])
      return { transitions: [], current: null }
    }
  }

  const handleShowOBSEventModal = (insertIndex) => {
    setOBSEditingItemId(null)
    setOBSEventInsertIndex(insertIndex)
    setOBSEventScene(obsScenes[0] || '')
    setOBSEventSource('')
    setOBSEventAction('show')
    setOBSEventSources([])
    setOBSEventTransition('')
    setOBSEventTransitionDuration(0)
    loadOBSTransitions()
    setShowOBSEventModal(true)
  }

  const handleEditOBSEvent = (item) => {
    if (!item || item.type !== 'obs') return
    setOBSEditingItemId(item.id)
    setOBSEventScene(item.obs_scene || obsScenes[0] || '')
    setOBSEventSource(item.obs_source || '')
    setOBSEventAction(item.obs_action || 'show')
    setOBSEventTransition(item.obs_transition || '')
    setOBSEventTransitionDuration(item.obs_transition_duration || 0)
    setOBSEventSources([])
    loadOBSTransitions()
    setShowOBSEventModal(true)
  }

  const handleResetOutputSettings = async () => {
    const defaults = {
      resolution: '1920x1080',
      aspectRatio: '16:9',
      quality: 'max',
      scalingMode: 'stretch',
      externalOutputEnabled: false,
      selectedDisplayId: null,
      networkStreamingEnabled: false
    }
    setOutputSettings(defaults)
    localStorage.setItem('outputSettings', JSON.stringify(defaults))

    try {
      const { ipcRenderer } = window.require('electron')
      ipcRenderer.send('close-output-window')
      setOutputWindowActive(false)

      await api.updateOutputSettings(defaults)

      const obsDefaults = { enabled: false, host: 'localhost', port: 4455, password: '' }
      setOBSSettings(obsDefaults)
      localStorage.setItem('obsSettings', JSON.stringify(obsDefaults))
      await api.obsDisconnect().catch(() => {})
      setOBSConnected(false)

      addLog('All settings reset to factory defaults', 'info')
    } catch (error) {
      addLog('Error resetting settings', 'error')
    }
  }

  const formatClock = (date) => {
    if (timeFormat === '24') {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    } else {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
    }
  }

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const selectedItem = selectedItems.length === 1 ? selectedItems[0] : null

  const handleContainerClick = (e) => {
    const clickedPlaylist = e.target.closest('.playlist-container')
    const clickedButton = e.target.closest('button')
    const clickedInput = e.target.closest('input')

    if (!clickedPlaylist && !clickedButton && !clickedInput) {
      setSelectedItems([])
    }
  }

  return (
    <div style={styles.container} onDragOver={handleDragOver} onDrop={handleDrop} onClick={handleContainerClick}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.brand}>
            <h1 style={styles.title}>FlowAir</h1>
            <span style={styles.credits}>© Trident Sky</span>
            <span style={styles.version}>v{APP_VERSION}</span>
          </div>
          <LiveIndicator isPlaying={isPlaying} />
          <span style={styles.date}>{formatDate(currentClock)}</span>
          <span style={styles.clock}>{formatClock(currentClock)}</span>
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
          {availableUpdate && (
            <button
              style={{...styles.headerButton, ...styles.updateButton}}
              onClick={() => {
                const electron = getElectron()
                if (electron) electron.ipcRenderer.send('open-release-page')
              }}
              title="A new version of FlowAir is available. Click to open the download page."
            >
              Update v{availableUpdate.version}
            </button>
          )}
          <button style={styles.headerButton} onClick={() => setShowOutputSettings(true)}>Settings</button>
          <button style={{...styles.headerButton, ...styles.clearButton}} onClick={handleClearPlaylist}>Clear Playlist</button>
          <button style={styles.headerButton} onClick={handleAddFiles}>Add Files</button>
          <button style={styles.headerButton} onClick={handleSavePlaylist}>💾 Save</button>
          <button style={styles.headerButton} onClick={handleLoadPlaylist}>📂 Load</button>
          <button style={{...styles.headerButton, ...styles.exitHeaderButton}} onClick={handleExit}>Exit</button>
        </div>
      </div>

      {recoverySession && (
        <div style={styles.recoveryBar}>
          <span style={styles.recoveryText}>
            The last session ended with {recoverySession.items.length} item(s) in the playlist
            {recoverySession.savedAt ? ` (saved ${new Date(recoverySession.savedAt).toLocaleString('en-US')})` : ''}. Restore it?
          </span>
          <button style={{...styles.headerButton, ...styles.recoveryPrimary}} onClick={handleRestoreSession}>Restore</button>
          <button style={styles.headerButton} onClick={handleDismissSession}>Dismiss</button>
        </div>
      )}

      <div style={styles.mainContent} className="main-content-area">
        <div style={styles.leftPanel}>
          <Controls
            isPlaying={isPlaying}
            selectedItem={selectedItem}
            selectedItems={selectedItems}
            onPlay={handlePlay}
            onStop={handleStop}
            onNext={handleNext}
            onCue={() => selectedItem && handleCue(selectedItem.id)}
          />

          <Timer
            currentItem={currentItem}
            isPlaying={isPlaying}
            serverElapsed={serverElapsed}
            editMode={editMode}
            onToggleEditMode={setEditMode}
            onSeek={handleSeek}
            volume={outputVolume}
            onVolumeChange={handleVolumeChange}
          />

          <Playlist
            items={playlist}
            currentItem={currentItem}
            selectedItems={selectedItems}
            onSelectItem={handleSelectItem}
            logCollapsed={logCollapsed}
            onRemoveItem={handleRemoveItem}
            onCueItem={handleCue}
            onReorder={handleReorder}
            onStopEvent={handleStopEvent}
            onAddNote={handleAddNote}
            onToggleLoop={handleToggleLoop}
            isCtrlPressed={isCtrlPressed}
            onExternalDrop={handleExternalDrop}
            timeFormat={timeFormat}
            onInsertOBSEvent={handleShowOBSEventModal}
            onEditOBSEvent={handleEditOBSEvent}
            obsConnected={obsConnected}
          />
        </div>

        <div style={styles.rightPanel}>
          <Preview currentItem={currentItem} isPlaying={isPlaying} />
          {obsSettings.enabled && obsConnected && (
            <div style={styles.obsControlPanel}>
              <div style={styles.obsControlHeader}>
                <span style={styles.obsControlTitle}>OBS CONTROL</span>
                <span style={{ fontSize: '9px', color: '#44ff44', fontWeight: '600' }}>CONNECTED</span>
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
                    <div style={{ fontSize: '10px', color: '#666', textAlign: 'center', padding: '10px 0' }}>
                      No sources in this scene
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ActivityLog
        collapsed={logCollapsed}
        onToggle={() => setLogCollapsed(!logCollapsed)}
        logs={activityLogs}
      />

      {showDeleteConfirm && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>Confirm Delete</div>
            <div style={styles.modalBody}>
              Are you sure you want to delete {selectedItems.length} item(s)?
            </div>
            <div style={styles.modalButtons}>
              <button
                style={{...styles.modalButton, ...styles.modalButtonConfirm}}
                onClick={handleDeleteConfirmed}
                autoFocus
              >
                Delete (Enter)
              </button>
              <button
                style={{...styles.modalButton, ...styles.modalButtonCancel}}
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel (Esc)
              </button>
            </div>
          </div>
        </div>
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
                style={{...styles.modalButton, ...styles.modalButtonConfirm}}
                onClick={handleNoteConfirm}
              >
                Insert (Enter)
              </button>
              <button
                style={{...styles.modalButton, ...styles.modalButtonCancel}}
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
                style={{...styles.modalButton, ...styles.modalButtonPrimary, ...(!canSubmit && { opacity: 0.45, cursor: 'not-allowed' })}}
                disabled={!canSubmit}
                onClick={submitOBSEvent}
              >
                {obsEditingItemId ? 'Save' : 'Insert'}
              </button>
              <button
                style={{...styles.modalButton, ...styles.modalButtonCancel}}
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
              <button
                className="close-button-hover"
                style={styles.closeButton}
                onClick={() => setShowOutputSettings(false)}
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            <div style={styles.tabBar}>
              <button
                style={settingsTab === 'video' ? {...styles.tab, ...styles.tabActive} : styles.tab}
                onClick={() => setSettingsTab('video')}
              >
                Video
              </button>
              <button
                style={settingsTab === 'output' ? {...styles.tab, ...styles.tabActive} : styles.tab}
                onClick={() => setSettingsTab('output')}
              >
                Output
              </button>
              <button
                style={settingsTab === 'network' ? {...styles.tab, ...styles.tabActive} : styles.tab}
                onClick={() => setSettingsTab('network')}
              >
                Network
              </button>
              <button
                style={settingsTab === 'obs' ? {...styles.tab, ...styles.tabActive} : styles.tab}
                onClick={() => setSettingsTab('obs')}
              >
                OBS
              </button>
            </div>

            <div style={styles.outputModalBody}>

              {settingsTab === 'video' && (
                <div style={styles.settingSection}>
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

                  <div style={styles.sectionButtonRow}>
                    <button
                      style={{...styles.sectionButton, ...styles.sectionButtonPrimary}}
                      onClick={handleApplyVideoSettings}
                    >
                      Apply Video Settings
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'output' && (
                <div style={styles.settingSection}>
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
                      <span style={styles.outputStatusDot}>●</span> Output Window Active
                    </div>
                  )}

                  <div style={styles.settingTip}>
                    Press <strong>Ctrl+Shift+E</strong> to close external output window from anywhere.
                  </div>

                  <div style={styles.sectionButtonRow}>
                    <button
                      style={{...styles.sectionButton, ...styles.sectionButtonPrimary}}
                      onClick={handleApplyExternalOutput}
                    >
                      Apply External Output
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'obs' && (
                <div style={styles.settingSection}>
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
                          <span style={{
                            fontSize: '11px',
                            color: obsConnected ? '#44ff44' : '#ff4444',
                            fontWeight: '600'
                          }}>
                            {obsConnected ? '● Connected to OBS' : '● Disconnected'}
                          </span>
                          {obsStatusMessage && (
                            <div style={{
                              fontSize: '10px',
                              color: obsConnected ? '#88ff88' : '#ff8888',
                              marginTop: '4px',
                              wordBreak: 'break-word'
                            }}>
                              {obsStatusMessage}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  <div style={styles.settingTip}>
                    OBS WebSocket must be enabled in OBS Studio (Tools → obs-websocket Settings). Default port: 4455.
                  </div>

                  <div style={styles.sectionButtonRow}>
                    <button
                      style={{...styles.sectionButton, ...styles.sectionButtonPrimary}}
                      onClick={handleApplyOBSSettings}
                    >
                      {obsSettings.enabled ? 'Connect to OBS' : 'Apply OBS Settings'}
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'network' && (
                <div style={styles.settingSection}>
                  <div style={styles.playerInfoBox}>
                    <div style={styles.playerInfoHeader}>
                      <span style={styles.playerInfoIcon}>💻</span>
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

                  {outputSettings.networkStreamingEnabled && (
                    <div style={styles.playerInfoBox}>
                      <div style={styles.playerInfoHeader}>
                        <span style={styles.playerInfoIcon}>🌐</span>
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
                    <button
                      style={{...styles.sectionButton, ...styles.sectionButtonPrimary}}
                      onClick={handleApplyNetworkStreaming}
                    >
                      Apply Network Streaming
                    </button>
                  </div>
                </div>
              )}

            </div>

            <div style={styles.modalButtons}>
              <button
                style={{...styles.modalButton, ...styles.modalButtonWarning}}
                onClick={handleResetOutputSettings}
              >
                Reset to Factory
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
    userSelect: 'none'
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
    fontWeight: '500'
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
  recoveryBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 20px',
    background: 'rgba(224, 179, 65, 0.12)',
    borderBottom: '1px solid rgba(224, 179, 65, 0.35)'
  },
  recoveryText: {
    flex: 1,
    fontSize: '12px',
    color: '#f0cd7a'
  },
  recoveryPrimary: {
    background: 'rgba(224, 179, 65, 0.2)',
    borderColor: 'rgba(224, 179, 65, 0.5)',
    color: '#f0cd7a',
    fontWeight: '600'
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
    width: '380px',
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
    background: 'transparent',
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
    fontSize: '20px',
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
    color: 'var(--text-primary)'
  },
  noteInput: {
    width: '100%',
    padding: '10px',
    background: 'var(--bg-base)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-primary)',
    fontSize: '13px',
    outline: 'none'
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
  modalButtonWarning: {
    background: '#8a6b00',
    color: '#fff'
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
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid var(--stroke)',
    background: 'var(--bg-layer-2)'
  },
  tab: {
    flex: 1,
    padding: '10px 0',
    background: 'transparent',
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
    fontSize: '20px',
    lineHeight: '1',
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
    cursor: 'pointer',
    outline: 'none'
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
    outline: 'none',
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
    fontSize: '22px',
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
    fontSize: '11px',
    outline: 'none'
  },
  obsActivateButton: {
    flexShrink: 0,
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
