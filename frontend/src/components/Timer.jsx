import React from 'react'

const Timer = ({ currentItem, isPlaying, serverElapsed = 0, editMode = false, onToggleEditMode, onSeek, volume = 100, onVolumeChange }) => {
  const currentTime = Math.floor(serverElapsed)

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  const parseDuration = (durationStr) => {
    if (!durationStr || durationStr === 'STATIC' || typeof durationStr !== 'string') return 0
    const parts = durationStr.split(':')
    if (parts.length === 3) {
      return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
    }
    return 0
  }

  const totalTime = currentItem ? parseDuration(currentItem.duration_formatted || currentItem.duration) : 0
  const remaining = Math.max(0, totalTime - currentTime)
  const progress = totalTime > 0 ? (currentTime / totalTime) * 100 : 0
  const isVideo = currentItem && currentItem.type === 'video' && totalTime > 0
  const canScrub = editMode && isVideo

  const handleScrub = (e) => {
    if (!canScrub) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    if (onSeek) onSeek(ratio * totalTime)
  }

  return (
    <div style={styles.container}>
      <div style={styles.timeDisplay}>
        <div style={styles.timeLabel}>Remaining</div>
        <div style={styles.timeValue}>{formatTime(remaining)}</div>
        <button
          style={{ ...styles.editToggle, ...(editMode ? styles.editToggleActive : {}) }}
          onClick={() => onToggleEditMode && onToggleEditMode(!editMode)}
          title="Enable manual editing of position and volume (off by default to prevent accidental changes)"
        >
          {editMode ? '● EDIT ON' : 'EDIT'}
        </button>
      </div>

      <div
        style={{ ...styles.progressBar, ...(canScrub ? styles.progressBarScrub : {}) }}
        onClick={handleScrub}
        title={canScrub ? 'Click to seek — this also shifts the next start times' : ''}
      >
        <div style={{ ...styles.progressFill, width: `${Math.min(100, progress)}%` }} />
        {canScrub && <div style={{ ...styles.scrubThumb, left: `${Math.min(100, progress)}%` }} />}
      </div>

      <div style={styles.timeInfo}>
        <span style={styles.infoText}>{formatTime(currentTime)} elapsed</span>
        <span style={styles.infoText}>{formatTime(totalTime)} total</span>
      </div>

      <div style={styles.volumeRow}>
        <span style={styles.volumeIcon}>{volume === 0 ? '🔇' : volume < 50 ? '🔉' : '🔊'}</span>
        <input
          type="range"
          min="0"
          max="100"
          value={volume}
          disabled={!editMode}
          onChange={(e) => onVolumeChange && onVolumeChange(Number(e.target.value))}
          style={{ ...styles.volumeSlider, ...(editMode ? {} : styles.volumeSliderDisabled) }}
          title={editMode ? 'Output volume' : 'Enable EDIT to change volume'}
        />
        <span style={styles.volumeValue}>{volume}%</span>
      </div>
    </div>
  )
}

const styles = {
  container: {
    background: 'var(--bg-layer-1)',
    padding: '14px 18px',
    borderBottom: '1px solid var(--stroke)'
  },
  timeDisplay: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    marginBottom: '12px'
  },
  timeLabel: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.6px'
  },
  timeValue: {
    fontSize: '34px',
    fontWeight: '600',
    color: 'var(--accent)',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '1px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1
  },
  editToggle: {
    marginLeft: 'auto',
    padding: '3px 10px',
    background: 'var(--bg-layer-3)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: '999px',
    color: 'var(--text-tertiary)',
    fontSize: '10px',
    fontWeight: '700',
    letterSpacing: '0.5px'
  },
  editToggleActive: {
    background: 'var(--accent-soft)',
    borderColor: 'rgba(76, 194, 255, 0.5)',
    color: 'var(--accent-hover)'
  },
  progressBar: {
    position: 'relative',
    width: '100%',
    height: '6px',
    background: 'var(--bg-layer-3)',
    borderRadius: '999px',
    marginBottom: '8px'
  },
  progressBarScrub: {
    height: '8px',
    cursor: 'pointer',
    boxShadow: '0 0 0 1px rgba(76, 194, 255, 0.35)'
  },
  progressFill: {
    height: '100%',
    background: 'var(--accent)',
    borderRadius: '999px',
    transition: 'width 0.3s ease'
  },
  scrubThumb: {
    position: 'absolute',
    top: '50%',
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    background: '#fff',
    border: '2px solid var(--accent)',
    transform: 'translate(-50%, -50%)',
    boxShadow: '0 0 4px rgba(0,0,0,0.5)',
    pointerEvents: 'none'
  },
  timeInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: 'var(--text-tertiary)'
  },
  infoText: {
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums'
  },
  volumeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '10px',
    paddingTop: '10px',
    borderTop: '1px solid var(--stroke-subtle)'
  },
  volumeIcon: {
    fontSize: '13px',
    width: '18px',
    textAlign: 'center'
  },
  volumeSlider: {
    flex: 1,
    height: '4px',
    accentColor: 'var(--accent)',
    cursor: 'pointer'
  },
  volumeSliderDisabled: {
    cursor: 'not-allowed',
    opacity: 0.4
  },
  volumeValue: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums',
    minWidth: '36px',
    textAlign: 'right'
  }
}

export default Timer
