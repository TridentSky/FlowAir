import React, { useState, useEffect, useRef } from 'react'

const Preview = ({ currentItem, isPlaying, outputSettings, reloadKey = 0 }) => {
  const [audioLevel, setAudioLevel] = useState(0)

  const previewKey = `${outputSettings?.aspectRatio || '16:9'}-${outputSettings?.scalingMode || 'stretch'}-${reloadKey}`

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data && event.data.type === 'flowair-audio-level') {
        setAudioLevel(event.data.level || 0)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  useEffect(() => {
    if (!(isPlaying && currentItem && currentItem.type === 'video')) {
      setAudioLevel(0)
    }
  }, [isPlaying, currentItem])

  const getVuColor = (level) => {
    if (level < 60) return '#44ff44'
    if (level < 80) return '#ffaa00'
    return '#ff4444'
  }

  return (
    <div style={styles.container}>
      <div style={styles.previewBox}>
        <div style={styles.header}>
          <span style={styles.title}>ON AIR PREVIEW</span>
          <span style={styles.status}>
            {isPlaying ? 'LIVE' : 'IDLE'}
          </span>
        </div>

        <div style={styles.videoArea}>
          <iframe
            key={previewKey}
            src="http://localhost:8000/player?muted=1"
            style={styles.iframe}
            title="Player Preview"
            allow="autoplay"
          />
        </div>

        <div style={styles.infoSection}>
          <div style={styles.infoRow}>
            <span style={styles.label}>File:</span>
            <span style={styles.value}>{currentItem ? currentItem.name : '-'}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.label}>Duration:</span>
            <span style={styles.value}>{currentItem ? (currentItem.duration_formatted || currentItem.duration) : '-'}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.label}>Size:</span>
            <span style={styles.value}>
              {currentItem && currentItem.file_size ? (
                <>
                  {currentItem.file_size}
                  {currentItem.bitrate && (() => {
                    const bitrateText = ` • ${currentItem.bitrate}`

                    const mbpsMatch = currentItem.bitrate.match(/(\d+(\.\d+)?)\s*Mbps/i)
                    const kbpsMatch = currentItem.bitrate.match(/(\d+(\.\d+)?)\s*kbps/i)

                    let mbps = 0
                    if (mbpsMatch) {
                      mbps = parseFloat(mbpsMatch[1])
                    } else if (kbpsMatch) {
                      mbps = parseFloat(kbpsMatch[1]) / 1000
                    } else {
                      return bitrateText
                    }

                    let label = ''
                    let color = '#888'

                    if (mbps <= 5) {
                      label = ' [LOW]'
                      color = '#888'
                    } else if (mbps <= 15) {
                      label = ' [GOOD]'
                      color = '#44ff44'
                    } else {
                      label = ' [HIGH]'
                      color = '#ff4444'
                    }

                    return (
                      <>
                        {bitrateText}
                        <span style={{ color, fontWeight: '600' }}>{label}</span>
                      </>
                    )
                  })()}
                </>
              ) : '-'}
            </span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.label}>Format:</span>
            <span style={styles.value}>{currentItem && currentItem.format ? currentItem.format : '-'}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.label}>Status:</span>
            <span style={{
              ...styles.value,
              color: currentItem ? (currentItem.status === 'corrupted' ? '#ff4444' : '#44ff44') : '#888'
            }}>
              {currentItem ? (currentItem.status === 'corrupted' ? 'CORRUPTED' : 'OK') : '-'}
            </span>
          </div>
          <div style={styles.audioRow}>
            <span style={styles.label}>Audio:</span>
            {isPlaying && currentItem && currentItem.type === 'video' ? (
              <>
                <div style={styles.vuMeterContainer}>
                  <div style={{
                    ...styles.vuMeterBar,
                    width: `${audioLevel}%`,
                    background: getVuColor(audioLevel)
                  }} />
                </div>
                <span style={styles.vuLevel}>{Math.round(audioLevel)}%</span>
              </>
            ) : (
              <span style={styles.value}>-</span>
            )}
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
  status: {
    fontSize: '10px',
    color: 'var(--text-tertiary)',
    fontWeight: '600'
  },
  videoArea: {
    width: '100%',
    aspectRatio: '16/9',
    background: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottom: '1px solid #333',
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
    justifyContent: 'space-between',
    padding: '5px 0',
    borderBottom: '1px solid var(--stroke-subtle)'
  },
  audioRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '5px 0',
    borderBottom: '1px solid var(--stroke-subtle)'
  },
  label: {
    fontSize: '10px',
    color: 'var(--text-tertiary)',
    fontWeight: '600'
  },
  value: {
    fontSize: '10px',
    color: 'var(--text-primary)',
    fontWeight: '500'
  },
  vuMeterSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 0',
    borderTop: '1px solid #1a1a1a'
  },
  vuLabel: {
    fontSize: '9px',
    color: '#888',
    fontWeight: '600',
    minWidth: '40px'
  },
  vuMeterContainer: {
    flex: 1,
    height: '14px',
    background: 'var(--bg-base)',
    borderRadius: '999px',
    overflow: 'hidden',
    border: '1px solid var(--stroke)'
  },
  vuMeterBar: {
    height: '100%',
    transition: 'width 0.05s linear, background 0.1s ease',
    borderRadius: '999px'
  },
  vuLevel: {
    fontSize: '9px',
    color: 'var(--text-secondary)',
    fontWeight: '600',
    minWidth: '35px',
    textAlign: 'right',
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums'
  }
}

export default Preview
