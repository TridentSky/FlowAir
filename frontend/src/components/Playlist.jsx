import React, { useState, useEffect, useMemo } from 'react'

const Playlist = ({
  items = [],
  currentItem,
  selectedItems = [],
  onSelectItem,
  onRemoveItem,
  onCueItem,
  onReorder,
  onStopEvent,
  onAddNote,
  onToggleLoop,
  isCtrlPressed,
  onExternalDrop,
  timeFormat = '12',
  onInsertOBSEvent,
  obsConnected = false
}) => {
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const [lastValidDragOver, setLastValidDragOver] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)

  const currentIndex = items.findIndex(i => currentItem && i.id === currentItem.id)

  const formatStartTime = useMemo(() => {
    return (timeStr) => {
      if (!timeStr || timeStr === '--:--:--') return '--:--:--'

      if (timeFormat === '24') {
        const match = timeStr.match(/(\d+):(\d+):(\d+)\s*(AM|PM)?/i)
        if (!match) return timeStr

        const [_, hourStr, minute, second, ampm] = match
        let hour = parseInt(hourStr)

        if (ampm) {
          if (ampm.toUpperCase() === 'PM' && hour !== 12) {
            hour += 12
          } else if (ampm.toUpperCase() === 'AM' && hour === 12) {
            hour = 0
          }
        }

        return `${hour.toString().padStart(2, '0')}:${minute}:${second}`
      }

      return timeStr
    }
  }, [timeFormat])

  const handleRemove = (itemId) => {
    const item = items.find(i => i.id === itemId)
    const isPlaying = currentItem && currentItem.id === itemId

    if (isPlaying) {
      alert('Cannot delete item currently playing. Please CUE another item or STOP playback first.')
      return
    }

    if (window.confirm('Are you sure you want to remove this item?')) {
      onRemoveItem(itemId)
    }
  }

  const handleDragStart = (e, index) => {
    const item = items[index]
    const isPlaying = currentItem && currentItem.id === item.id
    const isPast = currentIndex >= 0 && index < currentIndex

    if (isPlaying || isPast) {
      e.preventDefault()
      return
    }

    const isItemSelected = selectedItems.find(i => i.id === item.id)
    if (!isItemSelected && selectedItems.length > 0) {
      const hasPlayingInSelection = selectedItems.some(selected =>
        currentItem && selected.id === currentItem.id
      )
      if (hasPlayingInSelection) {
        e.preventDefault()
        return
      }
    }

    const hasPastInSelection = selectedItems.some(selected => {
      const selectedIndex = items.findIndex(i => i.id === selected.id)
      return selectedIndex >= 0 && selectedIndex < currentIndex
    })
    if (hasPastInSelection) {
      e.preventDefault()
      return
    }

    setDraggedIndex(index)
    if (isCtrlPressed && isCtrlPressed.current) {
      e.dataTransfer.effectAllowed = 'copy'
    } else {
      e.dataTransfer.effectAllowed = 'move'
    }
    e.dataTransfer.setData('text/html', e.currentTarget)
  }

  const handleDragOver = (e, index) => {
    e.preventDefault()
    e.stopPropagation()

    const rect = e.currentTarget.getBoundingClientRect()
    const mouseY = e.clientY - rect.top
    const itemHeight = rect.height

    let targetIndex = mouseY > itemHeight * 0.5 ? index + 1 : index

    if (targetIndex <= currentIndex) {
      targetIndex = currentIndex + 1
      e.dataTransfer.dropEffect = 'none'
    } else {
      if (isCtrlPressed && isCtrlPressed.current) {
        e.dataTransfer.dropEffect = 'copy'
      } else {
        e.dataTransfer.dropEffect = 'move'
      }
    }

    if (targetIndex !== dragOverIndex) {
      setDragOverIndex(targetIndex)
    }
    if (targetIndex !== lastValidDragOver) {
      setLastValidDragOver(targetIndex)
    }
  }

  const handleDrop = (e, dropIndex) => {
    e.preventDefault()
    e.stopPropagation()

    let finalIndex = dragOverIndex !== null ? dragOverIndex : (lastValidDragOver !== null ? lastValidDragOver : dropIndex)

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      if (onExternalDrop) {
        onExternalDrop(files, finalIndex)
      }
      setDraggedIndex(null)
      setDragOverIndex(null)
      setLastValidDragOver(null)
      return
    }

    if (draggedIndex !== null && draggedIndex !== finalIndex) {
      const isDuplicate = isCtrlPressed && isCtrlPressed.current
      onReorder(draggedIndex, finalIndex, isDuplicate)
    }
    setDraggedIndex(null)
    setDragOverIndex(null)
    setLastValidDragOver(null)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
    setLastValidDragOver(null)
  }

  const handleContainerDragLeave = (e) => {
    if (e.target === e.currentTarget) {
      setDragOverIndex(null)
    }
  }

  const handleContainerDragOver = (e) => {
    if (draggedIndex === null) return

    e.preventDefault()
    e.stopPropagation()

    if (isCtrlPressed && isCtrlPressed.current) {
      e.dataTransfer.dropEffect = 'copy'
    } else {
      e.dataTransfer.dropEffect = 'move'
    }
  }

  const handleContainerDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()

    if (lastValidDragOver !== null && draggedIndex !== null) {
      const isDuplicate = isCtrlPressed && isCtrlPressed.current
      onReorder(draggedIndex, lastValidDragOver, isDuplicate)
    }

    setDraggedIndex(null)
    setDragOverIndex(null)
    setLastValidDragOver(null)
  }

  const handleContextMenu = (e, item) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      item: item
    })
  }

  const closeContextMenu = () => {
    setContextMenu(null)
  }

  const handleInsertStopEvent = () => {
    let insertIndex = items.length
    if (contextMenu.item) {
      insertIndex = items.findIndex(i => i.id === contextMenu.item.id) + 1
    } else if (selectedItems.length > 0) {
      const lastSelected = selectedItems[selectedItems.length - 1]
      insertIndex = items.findIndex(i => i.id === lastSelected.id) + 1
    }

    if (insertIndex <= currentIndex) {
      insertIndex = currentIndex + 1
    }

    onStopEvent(insertIndex)
    closeContextMenu()
  }

  const handleInsertNote = () => {
    let insertIndex = items.length
    if (contextMenu.item) {
      insertIndex = items.findIndex(i => i.id === contextMenu.item.id) + 1
    } else if (selectedItems.length > 0) {
      const lastSelected = selectedItems[selectedItems.length - 1]
      insertIndex = items.findIndex(i => i.id === lastSelected.id) + 1
    }

    if (insertIndex <= currentIndex) {
      insertIndex = currentIndex + 1
    }

    onAddNote(insertIndex)
    closeContextMenu()
  }

  const handleInsertOBSEventMenu = () => {
    let insertIndex = items.length
    if (contextMenu.item) {
      insertIndex = items.findIndex(i => i.id === contextMenu.item.id) + 1
    } else if (selectedItems.length > 0) {
      const lastSelected = selectedItems[selectedItems.length - 1]
      insertIndex = items.findIndex(i => i.id === lastSelected.id) + 1
    }

    if (insertIndex <= currentIndex) {
      insertIndex = currentIndex + 1
    }

    onInsertOBSEvent(insertIndex)
    closeContextMenu()
  }

  useEffect(() => {
    if (contextMenu) {
      const handleClick = (e) => {
        if (!e.target.closest('.context-menu')) {
          closeContextMenu()
        }
      }
      setTimeout(() => {
        document.addEventListener('click', handleClick)
      }, 0)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu])

  return (
    <div style={styles.container} className="playlist-container" onDragLeave={handleContainerDragLeave}>
      <div style={styles.playlistTable}>
        <div style={styles.headerRow}>
          <div style={styles.headerCell}>●</div>
          <div style={styles.headerCell}>Start Time</div>
          <div style={styles.headerCell}>Duration</div>
          <div style={styles.headerCell}>Type</div>
          <div style={styles.headerCell}>Name</div>
          <div style={styles.headerCell}>Location</div>
          <div style={{ ...styles.headerCell, flex: '0 0 180px' }}>Actions</div>
        </div>

        <div
          style={styles.itemsContainer}
          className="custom-scrollbar"
          onDragOver={handleContainerDragOver}
          onDrop={handleContainerDrop}
          onContextMenu={(e) => {
            if (e.target === e.currentTarget || e.target.closest('.custom-scrollbar') === e.currentTarget) {
              handleContextMenu(e, null)
            }
          }}
        >
          {items.map((item, index) => {
            const isPlaying = currentItem && currentItem.id === item.id
            const isSelected = selectedItems.find(i => i.id === item.id)
            const isDragging = draggedIndex === index
            const isDragOver = dragOverIndex === index
            const isPast = currentIndex >= 0 && index < currentIndex
            const isNext = currentIndex >= 0 && index === currentIndex + 1

            if (item.type === 'stop') {
              return (
                <div key={`wrapper-${item.id}`} style={{ position: 'relative' }}>
                  {dragOverIndex === index && (
                    <div style={styles.dropIndicator} />
                  )}
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    onClick={(e) => onSelectItem(item, e.ctrlKey, e.shiftKey)}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                    style={{
                      ...styles.item,
                      background: '#4a2020',
                      ...(isPast && { opacity: 0.5 }),
                      ...(isSelected && styles.itemSelected),
                      ...(isDragging && styles.itemDragging)
                    }}
                  >
                    {isSelected && <div style={styles.itemSelectedOverlay} />}
                    <div style={styles.cell}>
                      <div style={{
                        ...styles.statusDot,
                        background: '#ff4444'
                      }} />
                    </div>
                    <div style={styles.cell}>{formatStartTime(item.start_time)}</div>
                    <div style={styles.cell}>--:--</div>
                    <div style={styles.cell}>
                      <span style={styles.typeIcon}>⏹</span>
                    </div>
                    <div style={{ ...styles.cell, color: '#ff8888', fontWeight: '600' }}>
                      STOP EVENT
                    </div>
                    <div style={styles.cell}></div>
                    <div style={{ ...styles.cell, flex: '0 0 180px' }}></div>
                  </div>
                  {dragOverIndex === index + 1 && (
                    <div style={{...styles.dropIndicator, top: 'auto', bottom: 0}} />
                  )}
                </div>
              )
            }

            if (item.type === 'note') {
              return (
                <div key={`wrapper-note-${item.id}`} style={{ position: 'relative' }}>
                  {dragOverIndex === index && (
                    <div style={styles.dropIndicator} />
                  )}
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    onClick={(e) => onSelectItem(item, e.ctrlKey, e.shiftKey)}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      onAddNote(index, item.note, item.id)
                    }}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                    style={{
                      ...styles.item,
                      background: '#2a1a3a',
                      ...(isPast && { opacity: 0.5 }),
                      ...(isSelected && styles.itemSelected),
                      ...(isDragging && styles.itemDragging)
                    }}
                  >
                    {isSelected && <div style={styles.itemSelectedOverlay} />}
                    <div style={styles.cell}>
                      <div style={{
                        ...styles.statusDot,
                        background: '#bb88ff'
                      }} />
                    </div>
                    <div style={styles.cell}>{formatStartTime(item.start_time)}</div>
                    <div style={styles.cell}>--:--</div>
                    <div style={styles.cell}>
                      <span style={styles.typeIcon}>📝</span>
                    </div>
                    <div style={{ ...styles.cell, color: '#bb88ff', fontWeight: '600' }}>
                      NOTE: {item.note || 'Note'}
                    </div>
                    <div style={styles.cell}></div>
                    <div style={{ ...styles.cell, flex: '0 0 180px' }}></div>
                  </div>
                  {dragOverIndex === index + 1 && (
                    <div style={{...styles.dropIndicator, top: 'auto', bottom: 0}} />
                  )}
                </div>
              )
            }

            if (item.type === 'obs') {
              return (
                <div key={`wrapper-obs-${item.id}`} style={{ position: 'relative' }}>
                  {dragOverIndex === index && (
                    <div style={styles.dropIndicator} />
                  )}
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    onClick={(e) => onSelectItem(item, e.ctrlKey, e.shiftKey)}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                    style={{
                      ...styles.item,
                      background: '#1a2a3a',
                      ...(isPast && { opacity: 0.5 }),
                      ...(isSelected && styles.itemSelected),
                      ...(isDragging && styles.itemDragging)
                    }}
                  >
                    {isSelected && <div style={styles.itemSelectedOverlay} />}
                    <div style={styles.cell}>
                      <div style={{
                        ...styles.statusDot,
                        background: 'var(--accent)'
                      }} />
                    </div>
                    <div style={styles.cell}>{formatStartTime(item.start_time)}</div>
                    <div style={styles.cell}>--:--</div>
                    <div style={styles.cell}>
                      <span style={styles.typeIcon}>🎬</span>
                    </div>
                    <div style={{ ...styles.cell, color: '#88bbff', fontWeight: '600' }}>
                      OBS: {item.obs_action?.toUpperCase()} &quot;{item.obs_source}&quot; in &quot;{item.obs_scene}&quot;
                    </div>
                    <div style={styles.cell}></div>
                    <div style={{ ...styles.cell, flex: '0 0 180px' }}></div>
                  </div>
                  {dragOverIndex === index + 1 && (
                    <div style={{...styles.dropIndicator, top: 'auto', bottom: 0}} />
                  )}
                </div>
              )
            }

            return (
              <div key={`wrapper-${item.id}`} style={{ position: 'relative' }}>
                {dragOverIndex === index && (
                  <div style={styles.dropIndicator} />
                )}
                <div
                  key={item.id}
                  draggable={!isPlaying}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  onClick={(e) => onSelectItem(item, e.ctrlKey, e.shiftKey)}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                  style={{
                    ...styles.item,
                    ...(isPast && styles.itemPast),
                    ...(item.status === 'corrupted' && styles.itemCorrupted),
                    ...(isNext && styles.itemNext),
                    ...(isPlaying && styles.itemPlaying),
                    ...(isSelected && styles.itemSelected),
                    ...(isDragging && styles.itemDragging),
                    cursor: isPlaying ? 'default' : 'grab'
                  }}
                >
                {isPlaying && <div style={styles.itemPlayingOverlay} />}
                {isSelected && <div style={styles.itemSelectedOverlay} />}
                {item.status === 'corrupted' && <div style={styles.itemCorruptedOverlay} />}
                <div style={styles.cell}>
                  {item.status === 'validating' ? (
                    <div style={{
                      width: '12px',
                      height: '12px',
                      border: '2px solid var(--stroke-strong)',
                      borderTop: '2px solid var(--accent)',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }} />
                  ) : (
                    <div style={{
                      ...styles.statusDot,
                      background: item.status === 'corrupted' ? '#ff4444' :
                                 isPlaying ? '#44ff44' : '#666'
                    }} />
                  )}
                </div>
                <div style={styles.cell}>{formatStartTime(item.start_time)}</div>
                <div style={styles.cell}>
                  {item.status === 'validating' ? (
                    <span style={{ color: 'var(--accent)', fontSize: '11px' }}>Validating...</span>
                  ) : (
                    item.duration_formatted || '--:--'
                  )}
                </div>
                <div style={styles.cell}>
                  <span style={styles.typeIcon}>{item.type === 'video' ? '▶' : '🖼'}</span>
                </div>
                <div style={styles.cell} title={item.name}>
                  {item.name}
                </div>
                <div style={styles.cell} title={item.location}>
                  {item.location}
                </div>
                <div style={{ ...styles.cell, flex: '0 0 180px', gap: '4px' }}>
                  <button
                    style={styles.actionButton}
                    onClick={(e) => {
                      e.stopPropagation()
                      onCueItem(item.id)
                    }}
                    title="Cue this item"
                  >
                    CUE
                  </button>
                  {item.type === 'video' && (
                    <button
                      style={{
                        ...styles.actionButton,
                        ...(item.loop && styles.loopActive)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleLoop(item.id)
                      }}
                      title={item.loop ? "Loop active" : "Enable loop"}
                    >
                      🔁
                    </button>
                  )}
                  <button
                    style={{ ...styles.actionButton, ...styles.deleteButton }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemove(item.id)
                    }}
                    title="Remove this item"
                  >
                    ✕
                  </button>
                </div>
              </div>
                {dragOverIndex === index + 1 && (
                  <div style={{...styles.dropIndicator, top: 'auto', bottom: 0}} />
                )}
            </div>
            )
          })}
          <div
            style={{
              ...styles.dropZone,
              ...(dragOverIndex === items.length && styles.dropZoneActive),
              ...(items.length > 0 && { borderTop: '1px dashed #333', marginTop: '4px' })
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOverIndex(items.length)
            }}
            onDrop={(e) => handleDrop(e, items.length)}
          >
            {items.length === 0 ? 'Drag videos/images here or use Add Files' : ''}
          </div>
        </div>
      </div>

      {contextMenu && (
        <div className="context-menu" style={{ ...styles.contextMenu, left: contextMenu.x, top: contextMenu.y }}>
          <div style={styles.contextMenuHeader}>
            {contextMenu.item ? contextMenu.item.name || 'Item' : 'Playlist'}
          </div>
          <button style={styles.contextMenuItem} onClick={handleInsertStopEvent}>
            Insert STOP Event
          </button>
          <button style={styles.contextMenuItem} onClick={handleInsertNote}>
            Insert Note
          </button>
          {obsConnected && (
            <button style={styles.contextMenuItem} onClick={handleInsertOBSEventMenu}>
              Insert OBS Event
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'var(--bg-base)',
    border: '1px solid var(--stroke)',
    borderRadius: 'var(--radius)'
  },
  playlistTable: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%'
  },
  headerRow: {
    display: 'grid',
    gridTemplateColumns: '40px 100px 100px 50px 1fr 1fr 180px',
    gap: '1px',
    background: 'var(--stroke-subtle)',
    padding: '0 1px',
    position: 'sticky',
    top: 0,
    zIndex: 3
  },
  headerCell: {
    background: 'var(--bg-layer-2)',
    padding: '9px 10px',
    fontSize: '10px',
    fontWeight: '600',
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
    userSelect: 'none'
  },
  itemsContainer: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden'
  },
  item: {
    display: 'grid',
    gridTemplateColumns: '40px 100px 100px 50px 1fr 1fr 180px',
    gap: '1px',
    background: 'var(--stroke-subtle)',
    padding: '0 1px',
    cursor: 'pointer',
    transition: 'background 0.1s, opacity 0.1s',
    marginBottom: '1px'
  },
  itemPast: {
    opacity: 0.45,
    background: 'var(--stroke-subtle)'
  },
  itemCorrupted: {
    background: 'var(--stroke-subtle)'
  },
  itemNext: {
    background: 'var(--stroke-subtle)',
    boxShadow: 'inset 3px 0 0 var(--warning)'
  },
  itemPlaying: {
    position: 'relative'
  },
  itemPlayingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'var(--success-soft)',
    boxShadow: 'inset 3px 0 0 var(--success)',
    pointerEvents: 'none',
    zIndex: 1
  },
  itemSelected: {
    position: 'relative'
  },
  itemSelectedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'var(--accent-soft)',
    boxShadow: 'inset 0 0 0 1px rgba(76, 194, 255, 0.5)',
    pointerEvents: 'none',
    zIndex: 2
  },
  itemCorruptedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'var(--danger-soft)',
    pointerEvents: 'none',
    zIndex: 1
  },
  itemDragging: {
    opacity: 0.4,
    cursor: 'grabbing'
  },
  dropIndicator: {
    position: 'absolute',
    top: '-1px',
    left: 0,
    right: 0,
    height: '2px',
    background: 'var(--accent)',
    zIndex: 1000,
    boxShadow: '0 0 6px rgba(76, 194, 255, 0.9)',
    pointerEvents: 'none'
  },
  itemDragOver: {
    borderTop: '2px solid var(--accent)'
  },
  cell: {
    background: 'var(--bg-layer-1)',
    padding: '7px 10px',
    fontSize: '12px',
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center'
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%'
  },
  typeIcon: {
    fontSize: '12px'
  },
  actionButton: {
    background: 'var(--bg-layer-3)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)',
    padding: '4px 7px',
    fontSize: '10px',
    fontWeight: '600',
    marginRight: '3px'
  },
  deleteButton: {
    background: 'var(--danger-soft)',
    borderColor: 'rgba(255, 91, 91, 0.4)',
    color: '#ff8d8d'
  },
  loopActive: {
    background: 'var(--accent-soft)',
    borderColor: 'rgba(76, 194, 255, 0.5)',
    color: 'var(--accent-hover)'
  },
  stopEventRow: {
    width: '100%',
    height: '18px',
    background: '#4a2020',
    marginBottom: '1px',
    cursor: 'pointer',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingLeft: '10px',
    transition: 'all 0.1s'
  },
  stopEventBar: {
    fontSize: '9px',
    fontWeight: '700',
    color: '#ff8888',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap'
  },
  stopEventSelected: {
    position: 'relative'
  },
  noteSelected: {
    position: 'relative'
  },
  noteRow: {
    width: '100%',
    height: '18px',
    background: '#2a1a3a',
    marginBottom: '1px',
    cursor: 'pointer',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingLeft: '10px',
    transition: 'all 0.1s'
  },
  noteBar: {
    fontSize: '9px',
    fontWeight: '700',
    color: '#bb88ff',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap'
  },
  noteActions: {
    display: 'flex',
    gap: '4px'
  },
  contextMenu: {
    position: 'fixed',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow-flyout)',
    zIndex: 10000,
    minWidth: '208px',
    padding: '5px'
  },
  contextMenuHeader: {
    padding: '6px 9px 8px',
    fontSize: '10px',
    fontWeight: '600',
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase',
    borderBottom: '1px solid var(--stroke)',
    marginBottom: '4px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  contextMenuItem: {
    width: '100%',
    padding: '8px 10px',
    background: 'transparent',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontSize: '12px',
    textAlign: 'left'
  },
  dropZone: {
    minHeight: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-tertiary)',
    fontSize: '11px',
    transition: 'all 0.2s'
  },
  dropZoneActive: {
    background: 'var(--accent-soft)',
    borderTop: '2px solid var(--accent)'
  }
}

const styleSheet = document.createElement('style')
styleSheet.textContent = `
  .custom-scrollbar::-webkit-scrollbar {
    width: 10px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: #1a1a1a;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 5px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #555;
  }
  button:hover {
    filter: brightness(1.2);
  }
`
document.head.appendChild(styleSheet)

export default Playlist
