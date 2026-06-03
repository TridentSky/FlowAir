import React from 'react'

const Controls = ({ isPlaying, selectedItem, selectedItems = [], onPlay, onStop, onNext, onCue }) => {
  const getSelectionText = () => {
    const count = selectedItems.length || 0

    if (count === 0) {
      return 'Selected items: 0'
    }

    let totalSeconds = 0
    selectedItems.forEach(item => {
      if (item.type === 'video' && item.duration) {
        totalSeconds += item.duration
      }
    })

    if (totalSeconds === 0) {
      return `Selected items: ${count}`
    }

    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = Math.floor(totalSeconds % 60)

    let durationText = ''
    if (hours > 0) {
      durationText = `${hours}h ${minutes}m ${seconds}s`
    } else if (minutes > 0) {
      durationText = `${minutes}m ${seconds}s`
    } else {
      durationText = `${seconds}s`
    }

    return `Selected items: ${count} • ${durationText}`
  }

  return (
    <div style={styles.container}>
      <div style={styles.mainButtons}>
        <button
          style={{...styles.button, ...styles.playButton}}
          onClick={onPlay}
          title="Play (Space)"
        >
          ▶ PLAY
        </button>
        <button
          style={{...styles.button, ...styles.stopButton}}
          onClick={onStop}
          title="Stop (S)"
        >
          ■ STOP
        </button>
        <button
          style={{...styles.button, ...styles.nextButton}}
          onClick={onNext}
          title="Next (N)"
        >
          ⏭ NEXT
        </button>
        <button
          style={{
            ...styles.button,
            ...styles.cueButton,
            ...(! selectedItem && styles.buttonDisabled)
          }}
          onClick={onCue}
          disabled={!selectedItem}
          title={selectedItem ? "Cue selected item" : "Select an item first"}
        >
          ⏸ CUE
        </button>
      </div>

      <div style={styles.shortcuts}>
        <div style={styles.shortcutGroup}>
          <span style={styles.shortcutKey}>Space</span>
          <span style={styles.shortcutLabel}>Play/Pause</span>
        </div>
        <div style={styles.shortcutGroup}>
          <span style={styles.shortcutKey}>N</span>
          <span style={styles.shortcutLabel}>Next</span>
        </div>
        <div style={styles.shortcutGroup}>
          <span style={styles.shortcutKey}>S</span>
          <span style={styles.shortcutLabel}>Stop</span>
        </div>
        <div style={styles.shortcutGroup}>
          <span style={styles.shortcutKey}>Enter</span>
          <span style={styles.shortcutLabel}>Cue</span>
        </div>
        <div style={styles.durationInfo}>
          {getSelectionText()}
        </div>
      </div>
    </div>
  )
}

const styles = {
  container: {
    background: '#1e1e1e',
    padding: '12px 16px',
    borderBottom: '1px solid #333'
  },
  mainButtons: {
    display: 'flex',
    gap: '10px',
    marginBottom: '10px'
  },
  button: {
    flex: 1,
    padding: '10px 16px',
    border: '1px solid #444',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px'
  },
  playButton: {
    background: '#2a5a2a',
    color: '#88ff88',
    border: '1px solid #3a7a3a'
  },
  stopButton: {
    background: '#5a2a2a',
    color: '#ff8888',
    border: '1px solid #7a3a3a'
  },
  nextButton: {
    background: '#2a4a5a',
    color: '#88ccff',
    border: '1px solid #3a5a7a'
  },
  cueButton: {
    background: '#5a4a2a',
    color: '#ffcc88',
    border: '1px solid #7a6a3a'
  },
  buttonDisabled: {
    opacity: 0.3,
    cursor: 'not-allowed'
  },
  shortcuts: {
    display: 'flex',
    gap: '14px',
    flexWrap: 'wrap',
    padding: '6px 0',
    minHeight: '26px',
    alignItems: 'center'
  },
  shortcutGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  shortcutKey: {
    background: '#2a2a2a',
    color: '#e0e0e0',
    padding: '3px 8px',
    borderRadius: '3px',
    fontSize: '10px',
    fontWeight: '600',
    border: '1px solid #444',
    fontFamily: 'monospace'
  },
  shortcutLabel: {
    fontSize: '11px',
    color: '#999'
  },
  durationInfo: {
    marginLeft: 'auto',
    padding: '3px 10px',
    background: '#2a3a4a',
    borderRadius: '3px',
    fontSize: '11px',
    color: '#4a9eff',
    fontWeight: '600',
    border: '1px solid #3a4a5a'
  }
}

export default Controls
