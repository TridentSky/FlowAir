const API_BASE = 'http://localhost:8000'
const WS_URL = 'ws://localhost:8000/ws'
const CLIENT_HEADERS = { 'X-FlowAir-Client': '1' }

const get = async (path) => {
  const response = await fetch(`${API_BASE}${path}`)
  return response.json()
}

const post = async (path, body) => {
  const options = { method: 'POST', headers: { ...CLIENT_HEADERS } }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(`${API_BASE}${path}`, options)
  return response.json()
}

export const api = {
  getPlaylist: () => get('/playlist'),
  addItem: (filepath, insertIndex = null, loop = false) => post('/playlist/add', { filepath, insertIndex, loop: Boolean(loop) }),
  removeItem: (itemId) => post('/playlist/remove', { item_id: itemId }),
  play: () => post('/player/play'),
  stop: () => post('/player/stop'),
  pause: () => post('/player/pause'),
  next: () => post('/player/next'),
  cue: (itemId) => post('/player/cue', { item_id: itemId }),
  reorderItems: (fromIndex, toIndex) => post('/playlist/reorder', { from_index: fromIndex, to_index: toIndex }),
  moveItems: (itemIds, position) => post('/playlist/move', { item_ids: itemIds, position }),
  insertStopEvent: (insertIndex) => post('/playlist/insert_stop', { insert_index: insertIndex }),
  insertNote: (insertIndex, note) => post('/playlist/insert_note', { insert_index: insertIndex, note }),
  updateNote: (itemId, note) => post('/playlist/update_note', { item_id: itemId, note }),
  toggleLoop: (itemId) => post(`/playlist/toggle_loop/${itemId}`),
  checkFileExists: (filepath) => post('/playlist/check-file', { filepath }),
  getNetworkInfo: () => get('/network_info'),
  updateOutputSettings: (settings) => post('/output_settings', settings),
  getOBSSettings: () => get('/obs/settings'),
  updateOBSSettings: (settings) => post('/obs/settings', settings),
  obsConnect: () => post('/obs/connect'),
  obsDisconnect: () => post('/obs/disconnect'),
  getOBSStatus: () => get('/obs/status'),
  getOBSScenes: () => get('/obs/scenes'),
  getOBSSceneSources: (sceneName) => get(`/obs/scenes/${encodeURIComponent(sceneName)}/sources`),
  setOBSSourceVisibility: (sceneName, sourceName, visible) => post('/obs/source/visibility', { scene_name: sceneName, source_name: sourceName, visible }),
  insertOBSEvent: (insertIndex, obsScene, obsSource, obsAction, obsTransition = '', obsTransitionDuration = 0, itemId = null) => post('/playlist/insert_obs_event', {
    insert_index: insertIndex,
    obs_scene: obsScene,
    obs_source: obsSource,
    obs_action: obsAction,
    obs_transition: obsTransition,
    obs_transition_duration: obsTransitionDuration,
    item_id: itemId
  }),
  seekPlayer: (position) => post('/player/seek', { position }),
  setPlayerVolume: (volume) => post('/player/volume', { volume }),
  getOBSCurrentScene: () => get('/obs/current_scene'),
  setOBSScene: (sceneName) => post('/obs/set_scene', { scene_name: sceneName }),
  getOBSTransitions: () => get('/obs/transitions'),
  setOBSTransition: (transitionName, durationMs = 0) => post('/obs/set_transition', { transition_name: transitionName, duration_ms: durationMs }),

  connectWebSocket(onMessage) {
    let ws = null
    let closed = false
    let reconnectAttempts = 0
    let reconnectTimer = null
    const maxReconnectDelay = 10000

    const scheduleReconnect = () => {
      if (closed) return
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), maxReconnectDelay)
      reconnectAttempts++
      reconnectTimer = setTimeout(connect, delay)
    }

    const connect = () => {
      try {
        ws = new WebSocket(WS_URL)
        ws.onopen = () => {
          reconnectAttempts = 0
        }
        ws.onmessage = (event) => {
          try {
            onMessage(JSON.parse(event.data))
          } catch (error) {
          }
        }
        ws.onerror = () => {
        }
        ws.onclose = scheduleReconnect
      } catch (error) {
        scheduleReconnect()
      }
    }

    connect()

    return {
      close() {
        closed = true
        clearTimeout(reconnectTimer)
        if (ws) ws.close()
      }
    }
  }
}
