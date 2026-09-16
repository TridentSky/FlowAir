import React, { useState, useEffect } from 'react'

const getVuColor = (level) => {
  if (level < 60) return 'var(--success)'
  if (level < 80) return 'var(--warning)'
  return 'var(--danger)'
}

const getBitrateTag = (bitrate) => {
  const mbpsMatch = bitrate.match(/(\d+(\.\d+)?)\s*Mbps/i)
  const kbpsMatch = bitrate.match(/(\d+(\.\d+)?)\s*kbps/i)

  let mbps = 0
  if (mbpsMatch) {
    mbps = parseFloat(mbpsMatch[1])
  } else if (kbpsMatch) {
    mbps = parseFloat(kbpsMatch[1]) / 1000
  } else {
    return null
  }

  if (mbps <= 5) return { label: ' [LOW]', color: 'var(--text-tertiary)' }
  if (mbps <= 15) return { label: ' [GOOD]', color: 'var(--text-secondary)' }
  return { label: ' [HIGH]', color: 'var(--warning-text)' }
}

const getStatus = (item) => {
  if (!item) return { text: '-', color: 'var(--text-tertiary)', title: '' }

  const issues = Array.isArray(item.issues) ? item.issues : []
  const reason = issues.length > 0 ? issues[0].message : ''
  const title = issues.map(issue => issue.message).join(' • ')

  if (item.status === 'corrupted') {
    return { text: 'CORRUPTED', color: 'var(--danger)', title: title }
  }
  if (item.status === 'validating') {
    return { text: 'VALIDATING', color: 'var(--accent)', title: '' }
  }
  if (item.playability === 'unsupported') {
    return { text: reason ? `UNSUPPORTED • ${reason}` : 'UNSUPPORTED', color: 'var(--danger)', title: title }
  }
  if (item.playability === 'warn') {
    return { text: reason ? `WARNING • ${reason}` : 'WARNING', color: 'var(--warning-text)', title: title }
  }
  return { text: 'OK', color: 'var(--success)', title: '' }
}

const Preview = ({ currentItem, isPlaying }) => {
  const [audioLevel, setAudioLevel] = useState(0)

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data && event.data.type === 'flowair-audio-level') {
        const level = Math.round(event.data.level || 0)
        setAudioLevel(prev => (prev === level ? prev : level))
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const hasAudio = !!(isPlaying && currentItem && currentItem.type === 'video')

  useEffect(() => {
    if (!hasAudio) {
      setAudioLevel(0)
    }
  }, [hasAudio])

  const status = getStatus(currentItem)
  const bitrateTag = currentItem && currentItem.bitrate ? getBitrateTag(currentItem.bitrate) : null

  return (
    <div style={styles.container}>
      <div style={styles.previewBox}>
        <div style={styles.header}>
          <span style={styles.title}>ON AIR PREVIEW</span>
          <span style={{ ...styles.headerStatus, color: isPlaying ? 'var(--live)' : 'var(--text-tertiary)' }}>
            {isPlaying ? 'LIVE' : 'IDLE'}
          </span>
        </div>

        <div style={styles.videoArea}>
          <iframe
            src="http://localhost:8000/player?muted=1"
            style={styles.iframe}
            title="Player Preview"
            allow="autoplay"
          />
        </div>

        <div style={styles.infoSection}>
          <div style={styles.infoRow}>
            <span style={styles.label}>File</span>
            <span style={styles.value} title={currentItem ? currentItem.name : ''}>
              {currentItem ? currentItem.name : '-'}
            </span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.label}>Duration</span>
            <span style={styles.valueNum}>
              {currentItem ? (currentItem.duration_formatted || currentItem.duration || '-') : '-'}
            </span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.label}>Size</span>
            <span style={styles.valueNum}>
              {currentItem && currentItem.file_size ? (
                <>
                  {currentItem.file_size}
                  {currentItem.bitrate && ` • ${currentItem.bitrate}`}
                  {bitrateTag && <span style={{ color: bitrateTag.color, fontWeight: '600' }}>{bitrateTag.label}</span>}
                </>
              ) : '-'}
            </span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.label}>Format</span>
            <span style={styles.value}>{currentItem && currentItem.format ? currentItem.format : '-'}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.label}>Status</span>
            <span style={{ ...styles.value, color: status.color, fontWeight: '600' }} title={status.title}>
              {status.text}
            </span>
          </div>
          <div style={styles.audioRow}>
            <span style={styles.label}>Audio</span>
            <div style={styles.vuMeterContainer}>
              <div style={{
                height: '100%',
                borderRadius: '999px',
                transition: 'width 0.08s linear, background 0.12s ease',
                width: `${hasAudio ? audioLevel : 0}%`,
                background: getVuColor(audioLevel)
              }} />
            </div>
            <span style={styles.vuLevel}>{hasAudio ? `${audioLevel}%` : '--%'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const styles = {
  container: {
    padding: '10px',
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    background: 'var(--bg-base)'
  },
  previewBox: {
    background: '#000',
    border: '1px solid var(--stroke)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden'
  },
  header: {
    background: 'var(--bg-layer-2)',
    padding: '8px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid var(--stroke)'
  },
  title: {
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.6px'
  },
  headerStatus: {
    fontSize: '11px',
    fontWeight: '700',
    letterSpacing: '0.6px',
    width: '34px',
    textAlign: 'right'
  },
  videoArea: {
    width: '100%',
    aspectRatio: '16/9',
    background: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottom: '1px solid var(--stroke)',
    position: 'relative',
    overflow: 'hidden'
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
    position: 'absolute',
    top: 0,
    left: 0
  },
  infoSection: {
    padding: '12px',
    background: 'var(--bg-layer-1)'
  },
  infoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    height: '26px',
    borderBottom: '1px solid var(--stroke-subtle)'
  },
  audioRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    height: '26px',
    borderBottom: '1px solid var(--stroke-subtle)'
  },
  label: {
    fontSize: '11px',
    color: 'var(--text-tertiary)',
    fontWeight: '600',
    width: '62px',
    flexShrink: 0
  },
  value: {
    flex: 1,
    minWidth: 0,
    fontSize: '12px',
    color: 'var(--text-primary)',
    fontWeight: '500',
    textAlign: 'right',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  valueNum: {
    flex: 1,
    minWidth: 0,
    fontSize: '12px',
    color: 'var(--text-primary)',
    fontWeight: '500',
    textAlign: 'right',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums'
  },
  vuMeterContainer: {
    flex: 1,
    minWidth: 0,
    height: '14px',
    background: 'var(--bg-base)',
    borderRadius: '999px',
    overflow: 'hidden',
    border: '1px solid var(--stroke)'
  },
  vuLevel: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    fontWeight: '600',
    width: '42px',
    flexShrink: 0,
    textAlign: 'right',
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums'
  }
}

export default Preview
