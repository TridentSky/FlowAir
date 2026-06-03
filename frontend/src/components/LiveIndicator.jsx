import React from 'react'

const LiveIndicator = ({ isPlaying }) => {
  return (
    <div style={styles.container}>
      {isPlaying && (
        <>
          <div style={styles.pulse} />
          <div style={styles.dot} />
        </>
      )}
      <span style={{
        ...styles.text,
        color: isPlaying ? 'var(--live)' : 'var(--text-tertiary)'
      }}>
        {isPlaying ? 'ON AIR' : 'OFF AIR'}
      </span>
    </div>
  )
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    position: 'relative'
  },
  dot: {
    width: '11px',
    height: '11px',
    borderRadius: '50%',
    background: 'var(--live)',
    boxShadow: '0 0 10px var(--live)'
  },
  pulse: {
    position: 'absolute',
    left: '0',
    width: '11px',
    height: '11px',
    borderRadius: '50%',
    background: 'var(--live)',
    animation: 'pulse 1.5s infinite',
    opacity: 0.6
  },
  text: {
    fontSize: '13px',
    fontWeight: '700',
    letterSpacing: '1px'
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
