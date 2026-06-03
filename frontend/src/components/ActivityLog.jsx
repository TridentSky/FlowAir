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
                color: log.type === 'error' ? '#ff6666' :
                       log.type === 'warning' ? '#ffaa66' :
                       log.type === 'playback' ? '#66aaff' :
                       '#aaaaaa'
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
    background: '#1e1e1e',
    borderTop: '1px solid #333',
    maxHeight: '200px',
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    background: '#242424',
    padding: '10px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    borderBottom: '1px solid #333'
  },
  title: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#aaa',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  collapseIcon: {
    fontSize: '10px',
    color: '#666'
  },
  logContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 0'
  },
  logEntry: {
    display: 'flex',
    gap: '12px',
    padding: '6px 20px',
    fontSize: '11px',
    borderBottom: '1px solid #272727'
  },
  logTime: {
    color: '#666',
    fontFamily: 'monospace',
    flexShrink: 0
  },
  logMessage: {
    flex: 1,
    fontFamily: 'monospace'
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    color: '#666'
  },
  emptyText: {
    fontSize: '12px'
  },
  collapsedContainer: {
    background: '#242424',
    padding: '8px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    borderTop: '1px solid #333'
  },
  collapsedText: {
    fontSize: '11px',
    color: '#888',
    fontWeight: '600'
  },
  collapsedIcon: {
    fontSize: '10px',
    color: '#666'
  }
}

export default ActivityLog
