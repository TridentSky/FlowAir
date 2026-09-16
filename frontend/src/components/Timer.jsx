import React, { useState, useRef } from 'react'
import Icon from './Icon'

const Timer = ({ currentItem, isPlaying, serverElapsed = 0, editMode = false, onToggleEditMode, onSeek, volume = 100, onVolumeChange }) => {
  const [dragPct, setDragPct] = useState(null)
  const barRef = useRef(null)
  const dragRef = useRef(false)
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
  const baseProgress = totalTime > 0 ? (currentTime / totalTime) * 100 : 0
  const isVideo = currentItem && currentItem.type === 'video' && totalTime > 0
  const canScrub = editMode && isVideo
  const progress = dragPct !== null ? dragPct * 100 : baseProgress
  const countsDown = isPlaying && totalTime > 0 && !(currentItem && currentItem.loop && currentItem.type === 'video')
  const remainingStyle = countsDown && remaining <= 5
    ? styles.timeValueCritical
    : (countsDown && remaining <= 10 ? styles.timeValueWarning : styles.timeValue)

  const pctFromClientX = (clientX) => {
    const el = barRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  const startScrub = (e) => {
    if (!canScrub || dragRef.current) return
    e.preventDefault()

    const target = e.currentTarget
    const pointerId = e.pointerId
    const itemId = currentItem ? currentItem.id : null
    dragRef.current = true
    setDragPct(pctFromClientX(e.clientX))

    const detach = () => {
      dragRef.current = false
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onCancel)
      try {
        target.releasePointerCapture(pointerId)
      } catch (error) {}
      setDragPct(null)
    }

    const onMove = (ev) => {
      if (ev.buttons === 0) {
        detach()
        return
      }
      setDragPct(pctFromClientX(ev.clientX))
    }

    const onUp = (ev) => {
      const pct = pctFromClientX(ev.clientX)
      detach()
      if (onSeek) onSeek(pct * totalTime, itemId)
    }

    const onCancel = () => detach()

    try {
      target.setPointerCapture(pointerId)
    } catch (error) {}
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onCancel)
  }

  return (
    <div style={styles.container}>
      <div style={styles.timeDisplay}>
        <div style={styles.timeLabel}>Remaining</div>
        <div style={remainingStyle}>{formatTime(remaining)}</div>
        <button
          style={editMode ? styles.editToggleActive : styles.editToggle}
          onClick={() => onToggleEditMode && onToggleEditMode(!editMode)}
          title="Enable manual seeking on the progress bar (off by default to prevent accidental changes)"
        >
          <span style={editMode ? styles.editDotOn : styles.editDotOff} />
          EDIT
        </button>
      </div>

      <div
        style={canScrub ? styles.barHitScrub : styles.barHit}
        onPointerDown={startScrub}
        title={canScrub ? 'Drag or click to seek — this also shifts the next start times' : ''}
      >
        <div
          ref={barRef}
          style={canScrub ? styles.progressBarScrub : styles.progressBar}
        >
          <div style={{ ...styles.progressFill, width: `${Math.min(100, progress)}%`, ...(dragPct !== null ? { transition: 'none' } : {}) }} />
          {canScrub && <div style={{ ...styles.scrubThumb, left: `${Math.min(100, progress)}%` }} />}
        </div>
      </div>

      <div style={styles.timeInfo}>
        <span style={styles.infoText}>{formatTime(currentTime)} elapsed</span>
        <span style={styles.infoText}>{formatTime(totalTime)} total</span>
      </div>

      <div style={styles.volumeRow}>
        <span style={volume === 0 ? styles.volumeIconMuted : styles.volumeIcon}>
          <Icon name="volume" size={16} />
        </span>
        <input
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={(e) => onVolumeChange && onVolumeChange(Number(e.target.value))}
          style={styles.volumeSlider}
          title="Output volume"
        />
        <span style={styles.volumeValue}>{volume}%</span>
      </div>
    </div>
  )
}

const editToggleBase = {
  marginLeft: 'auto',
  padding: '0 12px',
  minHeight: '26px',
  minWidth: '84px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '7px',
  background: 'var(--bg-layer-3)',
  border: '1px solid var(--stroke-strong)',
  borderRadius: '999px',
  color: 'var(--text-tertiary)',
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '0.5px'
}

const editDotBase = {
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  flexShrink: 0
}

const timeValueBase = {
  fontSize: '34px',
  fontWeight: '600',
  fontFamily: 'var(--font-mono)',
  letterSpacing: '1px',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1,
  minWidth: '5ch',
  transition: 'color 0.12s ease'
}

const volumeSliderBase = {
  flex: 1,
  height: '18px',
  accentColor: 'var(--accent)',
  cursor: 'pointer'
}

const styles = {
  container: {
    background: 'var(--bg-layer-1)',
    padding: '14px 18px',
    borderBottom: '1px solid var(--stroke)'
  },
  timeDisplay: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '10px'
  },
  timeLabel: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.6px'
  },
  timeValue: {
    ...timeValueBase,
    color: 'var(--accent)'
  },
  timeValueWarning: {
    ...timeValueBase,
    color: 'var(--warning)'
  },
  timeValueCritical: {
    ...timeValueBase,
    color: 'var(--danger)'
  },
  editToggle: editToggleBase,
  editToggleActive: {
    ...editToggleBase,
    background: 'var(--accent-soft)',
    borderColor: 'rgba(76, 194, 255, 0.5)',
    color: 'var(--accent-hover)'
  },
  editDotOn: {
    ...editDotBase,
    background: 'var(--accent)'
  },
  editDotOff: {
    ...editDotBase,
    background: 'var(--text-quaternary)'
  },
  barHit: {
    padding: '7px 0',
    marginBottom: '1px'
  },
  barHitScrub: {
    padding: '7px 0',
    marginBottom: '1px',
    cursor: 'pointer'
  },
  progressBar: {
    position: 'relative',
    width: '100%',
    height: '6px',
    background: 'var(--bg-layer-3)',
    borderRadius: '999px'
  },
  progressBarScrub: {
    position: 'relative',
    width: '100%',
    height: '8px',
    background: 'var(--bg-layer-3)',
    borderRadius: '999px',
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
    gap: '10px',
    marginTop: '10px',
    paddingTop: '10px',
    borderTop: '1px solid var(--stroke-subtle)'
  },
  volumeIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    color: 'var(--text-secondary)'
  },
  volumeIconMuted: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    color: 'var(--text-quaternary)'
  },
  volumeSlider: volumeSliderBase,
  volumeValue: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums',
    minWidth: '42px',
    textAlign: 'right'
  }
}

export default Timer
