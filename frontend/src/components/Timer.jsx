import React from 'react'

const Timer = ({ currentItem, isPlaying, serverElapsed = 0 }) => {
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

  return (
    <div style={styles.container}>
      <div style={styles.timeDisplay}>
        <div style={styles.timeLabel}>Remaining</div>
        <div style={styles.timeValue}>{formatTime(remaining)}</div>
      </div>

      <div style={styles.progressBar}>
        <div style={{
          ...styles.progressFill,
          width: `${Math.min(100, progress)}%`
        }} />
      </div>

      <div style={styles.timeInfo}>
        <span style={styles.infoText}>{formatTime(currentTime)} elapsed</span>
        <span style={styles.infoText}>{formatTime(totalTime)} total</span>
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
  progressBar: {
    width: '100%',
    height: '6px',
    background: 'var(--bg-layer-3)',
    borderRadius: '999px',
    overflow: 'hidden',
    marginBottom: '8px'
  },
  progressFill: {
    height: '100%',
    background: 'var(--accent)',
    borderRadius: '999px',
    transition: 'width 0.3s ease'
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
  }
}

export default Timer
