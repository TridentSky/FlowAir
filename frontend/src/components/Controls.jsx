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
    background: 'var(--bg-layer-1)',
    padding: '12px 16px',
    borderBottom: '1px solid var(--stroke)'
  },
  mainButtons: {
    display: 'flex',
    gap: '8px',
    marginBottom: '10px'
  },
  button: {
    flex: 1,
    padding: '11px 16px',
    border: '1px solid transparent',
    borderRadius: 'var(--radius)',
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '0.3px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px'
  },
  playButton: {
    background: 'rgba(74, 222, 128, 0.14)',
    color: '#7ee6a0',
    border: '1px solid rgba(74, 222, 128, 0.35)'
  },
  stopButton: {
    background: 'var(--danger-soft)',
    color: '#ff8d8d',
    border: '1px solid rgba(255, 91, 91, 0.35)'
  },
  nextButton: {
    background: 'var(--accent-soft)',
    color: 'var(--accent-hover)',
    border: '1px solid rgba(76, 194, 255, 0.35)'
  },
  cueButton: {
    background: 'rgba(224, 179, 65, 0.14)',
    color: '#f0cd7a',
    border: '1px solid rgba(224, 179, 65, 0.35)'
  },
  buttonDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed'
  },
  shortcuts: {
    display: 'flex',
    gap: '14px',
    flexWrap: 'wrap',
    padding: '4px 0',
    minHeight: '26px',
    alignItems: 'center'
  },
  shortcutGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  shortcutKey: {
    background: 'var(--bg-layer-3)',
    color: 'var(--text-secondary)',
    padding: '2px 7px',
    borderRadius: 'var(--radius-sm)',
    fontSize: '10px',
    fontWeight: '600',
    border: '1px solid var(--stroke-strong)',
    borderBottomWidth: '2px',
    fontFamily: 'var(--font-mono)'
  },
  shortcutLabel: {
    fontSize: '11px',
    color: 'var(--text-tertiary)'
  },
  durationInfo: {
    marginLeft: 'auto',
    padding: '3px 10px',
    background: 'var(--accent-soft)',
    borderRadius: '999px',
    fontSize: '11px',
    color: 'var(--accent-hover)',
    fontWeight: '600',
    border: '1px solid rgba(76, 194, 255, 0.3)'
  }
}

export default Controls
