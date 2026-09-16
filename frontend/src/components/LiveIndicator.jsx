import React from 'react'

const LiveIndicator = ({ isPlaying }) => {
  return (
    <div style={styles.container}>
      <div style={styles.dotBox}>
        <div style={isPlaying ? styles.pulseOn : styles.pulseOff} />
        <div style={isPlaying ? styles.dotOn : styles.dotOff} />
      </div>
      <span style={isPlaying ? styles.textOn : styles.textOff}>
        {isPlaying ? 'ON AIR' : 'OFF AIR'}
      </span>
    </div>
  )
}

const dotBase = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '11px',
  height: '11px',
  borderRadius: '50%'
}

const textBase = {
  width: '68px',
  display: 'inline-block',
  textAlign: 'left',
  fontFamily: 'var(--font-display)',
  fontSize: '13px',
  fontWeight: '700',
  letterSpacing: '1px',
  fontVariantNumeric: 'tabular-nums',
  transition: 'color 0.14s ease'
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: '92px',
    flexShrink: 0,
    justifyContent: 'flex-start'
  },
  dotBox: {
    position: 'relative',
    width: '11px',
    height: '11px',
    flexShrink: 0
  },
  dotOn: {
    ...dotBase,
    background: 'var(--live)',
    boxShadow: '0 0 10px var(--live)'
  },
  dotOff: {
    ...dotBase,
    background: 'var(--text-quaternary)',
    boxShadow: 'none'
  },
  pulseOn: {
    ...dotBase,
    background: 'var(--live)',
    animation: 'pulse 1.5s infinite',
    opacity: 0.6
  },
  pulseOff: {
    ...dotBase,
    background: 'var(--live)',
    animation: 'none',
    opacity: 0
  },
  textOn: {
    ...textBase,
    color: 'var(--live)'
  },
  textOff: {
    ...textBase,
    color: 'var(--text-tertiary)'
  }
}

const styleSheet = document.createElement('style')
styleSheet.textContent = `
  @keyframes pulse {
    0% {
      transform: scale(1);
      opacity: 0.8;
    }
    50% {
      transform: scale(1.8);
      opacity: 0;
    }
    100% {
      transform: scale(1);
      opacity: 0;
    }
  }
`
document.head.appendChild(styleSheet)

export default LiveIndicator
