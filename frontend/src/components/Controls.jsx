import React from 'react'
import Icon from './Icon'

const DEFAULT_KEYS = { play: 'Space', next: 'N', stop: 'S', cue: 'Enter' }

const HINTS = [
  { id: 'play', label: 'Play/Stop' },
  { id: 'next', label: 'Next' },
  { id: 'stop', label: 'Stop' },
  { id: 'cue', label: 'Cue' }
]

const keyOf = (shortcuts, id) => {
  const value = shortcuts ? shortcuts[id] : ''
  return typeof value === 'string' && value ? value : DEFAULT_KEYS[id]
}

const Controls = ({ isPlaying, selectedItem, selectedItems = [], onPlay, onStop, onNext, onCue, shortcuts }) => {
  const playKey = keyOf(shortcuts, 'play')
  const stopKey = keyOf(shortcuts, 'stop')
  const nextKey = keyOf(shortcuts, 'next')
  const cueKey = keyOf(shortcuts, 'cue')

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
          style={isPlaying ? styles.playButtonActive : styles.playButton}
          onClick={onPlay}
          title={`Play (${playKey})`}
        >
          <Icon name="play" size={18} />
          PLAY
        </button>
        <button
          style={isPlaying ? styles.stopButtonArmed : styles.stopButton}
          onClick={onStop}
          title={`Stop (${stopKey})`}
        >
          <Icon name="stop" size={18} />
          STOP
        </button>
        <button
          style={styles.nextButton}
          onClick={onNext}
          title={`Next (${nextKey})`}
        >
          <Icon name="next" size={18} />
          NEXT
        </button>
        <button
          style={selectedItem ? styles.cueButton : styles.cueButtonDisabled}
          onClick={onCue}
          disabled={!selectedItem}
          title={selectedItem ? `Cue selected item (${cueKey})` : 'Select an item first'}
        >
          <Icon name="cue" size={18} />
          CUE
        </button>
      </div>

      <div style={styles.shortcuts}>
        {HINTS.map(hint => (
          <div key={hint.id} style={styles.shortcutGroup}>
            <span style={styles.shortcutKey}>{keyOf(shortcuts, hint.id)}</span>
            <span style={styles.shortcutLabel}>{hint.label}</span>
          </div>
        ))}
        <div style={styles.durationInfo}>
          {getSelectionText()}
        </div>
      </div>
    </div>
  )
}

const buttonBase = {
  flex: 1,
  padding: '11px 16px',
  minHeight: '40px',
  border: '1px solid transparent',
  borderRadius: 'var(--radius)',
  fontSize: '13px',
  fontWeight: '600',
  letterSpacing: '0.3px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px'
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
  playButton: {
    ...buttonBase,
    background: 'rgba(74, 222, 128, 0.14)',
    color: '#7ee6a0',
    border: '1px solid rgba(74, 222, 128, 0.35)'
  },
  playButtonActive: {
    ...buttonBase,
    background: 'rgba(74, 222, 128, 0.28)',
    color: '#a8f0c2',
    border: '1px solid rgba(74, 222, 128, 0.6)',
    boxShadow: 'inset 0 0 0 1px rgba(74, 222, 128, 0.35)'
  },
  stopButton: {
    ...buttonBase,
    background: 'var(--danger-soft)',
    color: 'var(--danger-text)',
    border: '1px solid rgba(255, 91, 91, 0.35)'
  },
  stopButtonArmed: {
    ...buttonBase,
    background: 'rgba(255, 91, 91, 0.26)',
    color: '#ffb3b3',
    border: '1px solid rgba(255, 91, 91, 0.6)'
  },
  nextButton: {
    ...buttonBase,
    background: 'var(--accent-soft)',
    color: 'var(--accent-hover)',
    border: '1px solid rgba(76, 194, 255, 0.35)'
  },
  cueButton: {
    ...buttonBase,
    background: 'rgba(224, 179, 65, 0.14)',
    color: 'var(--warning-text)',
    border: '1px solid rgba(224, 179, 65, 0.35)'
  },
  cueButtonDisabled: {
    ...buttonBase,
    background: 'rgba(224, 179, 65, 0.14)',
    color: 'var(--warning-text)',
    border: '1px solid rgba(224, 179, 65, 0.35)',
    opacity: 0.35,
    cursor: 'not-allowed'
  },
  shortcuts: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'nowrap',
    overflow: 'hidden',
    padding: '4px 0',
    minHeight: '26px',
    alignItems: 'center'
  },
  shortcutGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0
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
    fontFamily: 'var(--font-mono)',
    whiteSpace: 'nowrap'
  },
  shortcutLabel: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap'
  },
  durationInfo: {
    marginLeft: 'auto',
    padding: '3px 10px',
    background: 'var(--accent-soft)',
    borderRadius: '999px',
    fontSize: '11px',
    color: 'var(--accent-hover)',
    fontWeight: '600',
    border: '1px solid rgba(76, 194, 255, 0.3)',
    minWidth: '184px',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    flexShrink: 0
  }
}

export default Controls
