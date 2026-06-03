import React from 'react'

const ActivityLog = ({ collapsed, onToggle, logs = [] }) => {
  if (collapsed) {
    return (
      <div style={styles.collapsedContainer} onClick={onToggle}>
        <span style={styles.collapsedText}>Activity Log (Click to expand)</span>
        <span style={styles.collapsedIcon}>▲</span>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.header} onClick={onToggle}>
        <span style={styles.title}>Activity Log</span>
        <span style={styles.collapseIcon}>▼</span>
      </div>

      <div style={styles.logContainer}>
        {logs.length === 0 ? (
          <div style={styles.emptyState}>
            <span style={styles.emptyText}>No activity yet</span>
          </div>
        ) : (
          logs.map((log, index) => (
            <div key={index} style={styles.logEntry}>
              <span style={styles.logTime}>{log.time}</span>
              <span style={{
                ...styles.logMessage,
                color: log.type === 'error' ? '#ff7a7a' :
                       log.type === 'warning' ? '#e0b341' :
                       log.type === 'playback' ? 'var(--accent)' :
                       'var(--text-secondary)'
              }}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const styles = {
  container: {
    background: 'var(--bg-layer-1)',
    borderTop: '1px solid var(--stroke)',
    maxHeight: '200px',
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    background: 'var(--bg-layer-2)',
    padding: '9px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    borderBottom: '1px solid var(--stroke)'
  },
  title: {
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.6px'
  },
  collapseIcon: {
    fontSize: '10px',
    color: 'var(--text-tertiary)'
  },
  logContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '6px 0'
  },
  logEntry: {
    display: 'flex',
    gap: '12px',
    padding: '5px 20px',
    fontSize: '11px',
    borderBottom: '1px solid var(--stroke-subtle)'
  },
  logTime: {
    color: 'var(--text-tertiary)',
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums',
    flexShrink: 0
  },
  logMessage: {
    flex: 1,
    fontFamily: 'var(--font-mono)'
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px',
    color: 'var(--text-tertiary)'
  },
  emptyText: {
    fontSize: '12px'
  },
  collapsedContainer: {
    background: 'var(--bg-layer-2)',
    padding: '8px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    borderTop: '1px solid var(--stroke)'
  },
  collapsedText: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    fontWeight: '600'
  },
  collapsedIcon: {
    fontSize: '10px',
    color: 'var(--text-tertiary)'
  }
}

export default ActivityLog
