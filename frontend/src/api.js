const API_BASE = 'http://localhost:8000'

export const api = {
  async getPlaylist() {
    const response = await fetch(`${API_BASE}/playlist`)
    return response.json()
  },

  async addItem(filepath, insertIndex = null) {
    const response = await fetch(`${API_BASE}/playlist/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filepath, insertIndex })
    })
    return response.json()
  },

  async removeItem(itemId) {
    const response = await fetch(`${API_BASE}/playlist/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId })
    })
    return response.json()
  },

  async play() {
    const response = await fetch(`${API_BASE}/player/play`, { method: 'POST' })
    return response.json()
  },

  async stop() {
    const response = await fetch(`${API_BASE}/player/stop`, { method: 'POST' })
    return response.json()
  },

  async pause() {
    const response = await fetch(`${API_BASE}/player/pause`, { method: 'POST' })
    return response.json()
  },

  async next() {
    const response = await fetch(`${API_BASE}/player/next`, { method: 'POST' })
    return response.json()
  },

  async cue(itemId) {
    const response = await fetch(`${API_BASE}/player/cue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId })
    })
    return response.json()
  },

  async reorderItems(fromIndex, toIndex) {
    const response = await fetch(`${API_BASE}/playlist/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_index: fromIndex, to_index: toIndex })
    })
    return response.json()
  },

  async insertStopEvent(insertIndex) {
    const response = await fetch(`${API_BASE}/playlist/insert_stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insert_index: insertIndex })
    })
    return response.json()
  },

  async insertNote(insertIndex, note) {
    const response = await fetch(`${API_BASE}/playlist/insert_note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insert_index: insertIndex, note: note })
    })
    return response.json()
  },

  async updateNote(itemId, note) {
    const response = await fetch(`${API_BASE}/playlist/update_note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, note: note })
    })
    return response.json()
  },

  async toggleLoop(itemId) {
    const response = await fetch(`${API_BASE}/playlist/toggle_loop/${itemId}`, {
      method: 'POST'
    })
    return response.json()
  },

  async checkFileExists(filepath) {
    const response = await fetch(`${API_BASE}/playlist/check-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filepath })
    })
    return response.json()
  },

  async getNetworkInfo() {
    const response = await fetch(`${API_BASE}/network_info`)
    return response.json()
  },

  async getOBSSettings() {
    const response = await fetch(`${API_BASE}/obs/settings`)
    return response.json()
  },

  async updateOBSSettings(settings) {
    const response = await fetch(`${API_BASE}/obs/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    })
    return response.json()
  },

  async obsConnect() {
    const response = await fetch(`${API_BASE}/obs/connect`, { method: 'POST' })
    return response.json()
  },

  async obsDisconnect() {
    const response = await fetch(`${API_BASE}/obs/disconnect`, { method: 'POST' })
    return response.json()
  },

  async getOBSStatus() {
    const response = await fetch(`${API_BASE}/obs/status`)
    return response.json()
  },

  async getOBSScenes() {
    const response = await fetch(`${API_BASE}/obs/scenes`)
    return response.json()
  },

  async getOBSSceneSources(sceneName) {
    const response = await fetch(`${API_BASE}/obs/scenes/${encodeURIComponent(sceneName)}/sources`)
    return response.json()
  },

  async setOBSSourceVisibility(sceneName, sourceName, visible) {
    const response = await fetch(`${API_BASE}/obs/source/visibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene_name: sceneName, source_name: sourceName, visible })
    })
    return response.json()
  },

  async insertOBSEvent(insertIndex, obsScene, obsSource, obsAction, obsTransition = '', obsTransitionDuration = 0, itemId = null) {
    const response = await fetch(`${API_BASE}/playlist/insert_obs_event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        insert_index: insertIndex,
        obs_scene: obsScene,
        obs_source: obsSource,
        obs_action: obsAction,
        obs_transition: obsTransition,
        obs_transition_duration: obsTransitionDuration,
        item_id: itemId
      })
    })
    return response.json()
  },

  async seekPlayer(position) {
    const response = await fetch(`${API_BASE}/player/seek`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position })
    })
    return response.json()
  },

  async setPlayerVolume(volume) {
    const response = await fetch(`${API_BASE}/player/volume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume })
    })
    return response.json()
  },

  async getOBSCurrentScene() {
    const response = await fetch(`${API_BASE}/obs/current_scene`)
    return response.json()
  },

  async setOBSScene(sceneName) {
    const response = await fetch(`${API_BASE}/obs/set_scene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene_name: sceneName })
    })
    return response.json()
  },

  async getOBSTransitions() {
    const response = await fetch(`${API_BASE}/obs/transitions`)
    return response.json()
  },

  async setOBSTransition(transitionName, durationMs = 0) {
    const response = await fetch(`${API_BASE}/obs/set_transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition_name: transitionName, duration_ms: durationMs })
    })
    return response.json()
  },

  connectWebSocket(onMessage) {
    let ws
    let reconnectAttempts = 0
    const maxReconnectDelay = 10000

    const connect = () => {
      try {
        ws = new WebSocket('ws://localhost:8000/ws')

        ws.onopen = () => {
          reconnectAttempts = 0
        }

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data)
          onMessage(data)
        }

        ws.onerror = () => {
        }

        ws.onclose = () => {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), maxReconnectDelay)
          reconnectAttempts++
          setTimeout(connect, delay)
        }
      } catch (error) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), maxReconnectDelay)
        reconnectAttempts++
        setTimeout(connect, delay)
      }
    }

    connect()
    return ws
  }
}
