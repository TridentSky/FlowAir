import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Icon from './Icon'

const SPECIAL_TYPES = ['stop', 'note', 'obs']

const FIND_HINT = 'Filters the visible rows by name, location, note or OBS scene. Reordering by drag is disabled while a filter is active, because a filtered list has no meaningful drop position. Escape closes the field.'
const POSITION_HINT = 'Clear the find field to insert or duplicate at a position'
const SEARCH_DEBOUNCE_MS = 130

const dropFocus = (e) => {
  if (e && e.currentTarget && e.currentTarget.blur) e.currentTarget.blur()
}

const stopEvent = (e) => {
  e.stopPropagation()
}

const rowIcon = (item) => {
  if (item.type === 'stop') return 'stop'
  if (item.type === 'note') return 'note'
  if (item.type === 'obs') return 'obs'
  if (item.type === 'image') return 'image'
  return 'video'
}

const rowLabel = (item) => {
  if (item.type === 'stop') return 'STOP EVENT'
  if (item.type === 'note') return `NOTE: ${item.note || 'Note'}`
  if (item.type === 'obs') {
    if (item.obs_action === 'switch_scene') {
      return `OBS: Switch to "${item.obs_scene}"${item.obs_transition ? ` (${item.obs_transition})` : ''}`
    }
    return `OBS: ${(item.obs_action || '').toUpperCase()} "${item.obs_source}" in "${item.obs_scene}"`
  }
  return item.name
}

const issueTitle = (item) => {
  if (!item.issues || item.issues.length === 0) return ''
  return item.issues.map(issue => issue.message).join(' • ')
}

const ACTIVE_CONVERSION = ['queued', 'running']
const CONVERTIBLE_PLANS = ['remux', 'audio', 'full']
const SKIPPED_ON_AIR = 'It is skipped on air until it is ready.'

const VIDEO_CODEC_LABELS = {
  h264: 'H.264',
  hevc: 'HEVC',
  h265: 'HEVC',
  mpeg2video: 'MPEG-2',
  mpeg1video: 'MPEG-1',
  vc1: 'VC-1',
  wmv1: 'WMV 7',
  wmv2: 'WMV 8',
  wmv3: 'WMV 9',
  mpeg4: 'MPEG-4 Part 2',
  msmpeg4v2: 'MS MPEG-4',
  msmpeg4v3: 'MS MPEG-4',
  prores: 'ProRes',
  dnxhd: 'DNxHD',
  mjpeg: 'Motion JPEG',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8'
}

const AUDIO_CODEC_LABELS = {
  aac: 'AAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  dts: 'DTS',
  truehd: 'Dolby TrueHD',
  mp2: 'MP2',
  mp3: 'MP3',
  wmav2: 'WMA',
  wmapro: 'WMA Pro'
}

const ENCODER_LABELS = {
  h264_qsv: 'Intel Quick Sync',
  h264_nvenc: 'NVIDIA NVENC',
  h264_amf: 'AMD AMF',
  h264_mf: 'Windows Media Foundation',
  libx264: 'the processor (x264)'
}

const codecLabel = (labels, value) => {
  const key = String(value || '').toLowerCase()
  if (!key) return ''
  if (labels[key]) return labels[key]
  if (key.startsWith('pcm_')) return 'PCM'
  return key.toUpperCase()
}

const videoCodecOf = (item) => {
  if (item.video_codec) return codecLabel(VIDEO_CODEC_LABELS, item.video_codec)
  const match = /\(([^)]+)\)/.exec(item.format || '')
  return match ? codecLabel(VIDEO_CODEC_LABELS, match[1]) : ''
}

const conversionOf = (item) => {
  const conversion = item && item.conversion
  if (!conversion || typeof conversion !== 'object') return null
  if (!CONVERTIBLE_PLANS.includes(conversion.plan)) return null
  return {
    plan: conversion.plan,
    status: conversion.status || 'none',
    progress: Math.max(0, Math.min(100, Math.floor(Number(conversion.progress) || 0))),
    encoder: conversion.encoder || '',
    error: conversion.error || ''
  }
}

const isPreparing = (item) => {
  const conversion = conversionOf(item)
  return item.playability === 'preparing' || !!(conversion && ACTIVE_CONVERSION.includes(conversion.status))
}

const canStartConversion = (item) => {
  const conversion = conversionOf(item)
  return !!conversion && !ACTIVE_CONVERSION.includes(conversion.status) && conversion.status !== 'done'
}

const describeWork = (item, conversion) => {
  if (conversion.plan === 'remux') return 'Copying the picture and sound into an MP4 file (no re-encoding)'
  if (conversion.plan === 'audio') {
    const audio = codecLabel(AUDIO_CODEC_LABELS, item.audio_codec)
    return `Converting the ${audio ? `${audio} ` : ''}sound to AAC (the picture is copied as it is)`
  }
  const video = videoCodecOf(item)
  const source = video && video !== 'H.264' ? `${video} to H.264` : 'the video to H.264'
  const encoder = conversion.encoder ? ` with ${ENCODER_LABELS[conversion.encoder] || conversion.encoder}` : ''
  return `Converting ${source}${encoder}`
}

const conversionTitle = (item) => {
  const conversion = conversionOf(item)
  if (!conversion) return item.playability === 'preparing' ? `Preparing this file for playout. ${SKIPPED_ON_AIR}` : ''
  const work = describeWork(item, conversion)
  if (conversion.status === 'running') return `${work} (${conversion.progress}%). ${SKIPPED_ON_AIR}`
  if (conversion.status === 'queued') return `Waiting in line: ${work.charAt(0).toLowerCase()}${work.slice(1)}. ${SKIPPED_ON_AIR}`
  if (conversion.status === 'done') return 'Plays from a converted copy. The original file is not changed.'
  if (conversion.status === 'failed') {
    return `The conversion failed${conversion.error ? `: ${conversion.error}` : ''}. Right-click and choose Convert to try again.`
  }
  if (conversion.status === 'cancelled') return 'The conversion was cancelled. Right-click and choose Convert to start it again.'
  if (conversion.plan === 'full') {
    const video = videoCodecOf(item)
    return `${video && video !== 'H.264' ? video : 'This video'} cannot be played directly. Right-click and choose Convert to make a playable copy.`
  }
  return 'This file needs a quick conversion before it can play. Right-click and choose Convert.'
}

const conversionKey = (item) => {
  const conversion = item.conversion
  if (!conversion || typeof conversion !== 'object') return ''
  return `${conversion.plan}|${conversion.status}|${Math.floor(Number(conversion.progress) || 0)}|${conversion.encoder || ''}|${conversion.error || ''}`
}

const joinTitles = (...parts) => parts.filter(Boolean).join('\n')

const issuesEqual = (prev, next) => {
  const a = prev || []
  const b = next || []
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].code !== b[i].code || a[i].message !== b[i].message) return false
  }
  return true
}

const rowPropsEqual = (prev, next) => {
  const a = prev.item
  const b = next.item
  return (
    prev.index === next.index &&
    prev.startText === next.startText &&
    prev.isOnAir === next.isOnAir &&
    prev.isLive === next.isLive &&
    prev.isSelected === next.isSelected &&
    prev.isPast === next.isPast &&
    prev.isNext === next.isNext &&
    prev.canReveal === next.canReveal &&
    prev.canDrag === next.canDrag &&
    prev.isDragging === next.isDragging &&
    prev.dropTop === next.dropTop &&
    a.id === b.id &&
    a.type === b.type &&
    a.name === b.name &&
    a.location === b.location &&
    a.duration_formatted === b.duration_formatted &&
    a.status === b.status &&
    a.loop === b.loop &&
    a.note === b.note &&
    a.playability === b.playability &&
    a.format === b.format &&
    a.video_codec === b.video_codec &&
    a.audio_codec === b.audio_codec &&
    conversionKey(a) === conversionKey(b) &&
    issuesEqual(a.issues, b.issues) &&
    a.obs_action === b.obs_action &&
    a.obs_scene === b.obs_scene &&
    a.obs_source === b.obs_source &&
    a.obs_transition === b.obs_transition
  )
}

const PlaylistRow = React.memo(({
  item,
  index,
  startText,
  isOnAir,
  isLive,
  isSelected,
  isPast,
  isNext,
  canReveal,
  canDrag,
  isDragging,
  dropTop,
  registerRow,
  onSelect,
  onContext,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onCue,
  onToggleLoop,
  onRemove,
  onEditNote,
  onEditOBS,
  onOpenLocation
}) => {
  const isSpecial = SPECIAL_TYPES.includes(item.type)
  const kind = isSpecial ? item.type : 'media'
  const label = rowLabel(item)
  const preparing = !isSpecial && isPreparing(item)
  const conversion = isSpecial ? null : conversionOf(item)
  const conversionText = isSpecial ? '' : conversionTitle(item)
  const issues = preparing ? conversionText : joinTitles(issueTitle(item), conversionText)

  const setRef = useCallback((el) => registerRow(item.id, el), [registerRow, item.id])
  const handleSelect = useCallback((e) => onSelect(e, index), [onSelect, index])
  const handleContext = useCallback((e) => onContext(e, index), [onContext, index])
  const handleStart = useCallback((e) => onDragStart(e, index), [onDragStart, index])
  const handleOver = useCallback((e) => onDragOver(e, index), [onDragOver, index])
  const handleDrop = useCallback((e) => onDrop(e, index), [onDrop, index])
  const handleDouble = useCallback((e) => {
    if (item.type === 'note') {
      e.stopPropagation()
      onEditNote(index, item.note, item.id)
    } else if (item.type === 'obs') {
      e.stopPropagation()
      onEditOBS(item)
    }
  }, [onEditNote, onEditOBS, index, item])
  const handleLocationDouble = useCallback((e) => {
    e.stopPropagation()
    onOpenLocation(item.location)
  }, [onOpenLocation, item.location])

  const canOpenLocation = !isSpecial && !!item.location && canReveal

  return (
    <div ref={setRef} style={rowWrapper}>
      {dropTop && <div style={styles.dropIndicator} />}
      <div
        className="pl-row"
        data-kind={kind}
        data-state={isOnAir ? 'onair' : (isNext ? 'next' : 'normal')}
        data-live={isOnAir && isLive ? '1' : '0'}
        data-selected={isSelected ? '1' : '0'}
        data-past={isPast ? '1' : '0'}
        data-dragging={isDragging ? '1' : '0'}
        data-corrupt={item.status === 'corrupted' ? '1' : '0'}
        data-warn={preparing ? 'preparing' : (item.playability && item.playability !== 'ok' ? item.playability : 'ok')}
        draggable={canDrag}
        onDragStart={handleStart}
        onDragOver={handleOver}
        onDrop={handleDrop}
        onDragEnd={onDragEnd}
        onClick={handleSelect}
        onDoubleClick={isSpecial ? handleDouble : undefined}
        onContextMenu={handleContext}
      >
        <div className="pl-cell" title={issues}>
          {item.status === 'validating' ? <span className="pl-spin" /> : <span className="pl-dot" />}
        </div>
        <div className="pl-cell pl-cell--num">{startText}</div>
        {preparing ? (
          <div className="pl-cell pl-cell--num pl-cell--prep" title={conversionText}>
            <span className="pl-spin pl-spin--sm" />
            <span className="pl-prep-word">{conversion && conversion.status === 'queued' ? 'Queued' : 'Preparing'}</span>
            {conversion && conversion.status === 'running' && <span className="pl-prep-pct">{conversion.progress}%</span>}
          </div>
        ) : (
          <div className="pl-cell pl-cell--num">
            {isSpecial ? '--:--' : (item.status === 'validating' ? 'Validating' : (item.duration_formatted || '--:--'))}
          </div>
        )}
        <div className="pl-cell pl-cell--type">
          <Icon name={rowIcon(item)} size={16} />
        </div>
        <div className={isSpecial ? 'pl-cell pl-cell--name pl-cell--wide' : 'pl-cell pl-cell--name'} title={joinTitles(label, conversionText)}>{label}</div>
        {!isSpecial && (
          <div
            className={canOpenLocation ? 'pl-cell pl-cell--path pl-cell--link' : 'pl-cell pl-cell--path'}
            title={canOpenLocation ? `${item.location}\nDouble-click to show this file in Explorer` : item.location}
            onDoubleClick={canOpenLocation ? handleLocationDouble : undefined}
          >
            {item.location}
          </div>
        )}
        <div className="pl-cell pl-cell--actions">
          {!isSpecial && (
            <>
              <button
                className="pl-act"
                onClick={(e) => { dropFocus(e); e.stopPropagation(); onCue(item.id) }}
                title="Cue this item"
              >
                CUE
              </button>
              {item.type === 'video' && (
                <button
                  className="pl-act"
                  data-active={item.loop ? '1' : '0'}
                  onClick={(e) => { dropFocus(e); e.stopPropagation(); onToggleLoop(item.id) }}
                  title={item.loop ? 'Loop active' : 'Enable loop'}
                >
                  <Icon name="loop" size={14} />
                </button>
              )}
              <button
                className="pl-act pl-act--danger"
                onClick={(e) => { dropFocus(e); e.stopPropagation(); onRemove(item.id) }}
                title="Remove this item"
              >
                <Icon name="trash" size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}, rowPropsEqual)

const Playlist = ({
  items = [],
  currentItem,
  isPlaying = false,
  selectedItems = [],
  onSelectItem,
  onRemoveItem,
  onCueItem,
  onReorder,
  onStopEvent,
  onAddNote,
  onToggleLoop,
  onExternalDrop,
  timeFormat = '12',
  onInsertOBSEvent,
  onEditOBSEvent,
  obsConnected = false,
  onDuplicateItem,
  onRequestRemove,
  followOnAir,
  onToggleFollow,
  nextHighlightId = null,
  onOpenLocation,
  onRevalidateItem,
  onConvertItem,
  onCancelConversion,
  onClearSelection,
  searchOpen = false,
  filterActive = false,
  hiddenCount = 0,
  searchQuery,
  onSearchChange,
  onSearchClose,
  onContextMenuOpenChange
}) => {
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [internalFollow, setInternalFollow] = useState(true)
  const [internalQuery, setInternalQuery] = useState('')

  const currentIndex = items.findIndex(i => currentItem && i.id === currentItem.id)
  const selectedIds = useMemo(() => new Set(selectedItems.map(i => i.id)), [selectedItems])
  const follow = followOnAir === undefined ? internalFollow : followOnAir
  const canReveal = !!onOpenLocation
  const menuOpen = !!contextMenu

  const propsRef = useRef({})
  propsRef.current = {
    items,
    currentItem,
    currentIndex,
    selectedItems,
    onSelectItem,
    onRemoveItem,
    onRequestRemove,
    onCueItem,
    onReorder,
    onDuplicateItem,
    onExternalDrop,
    onAddNote,
    onEditOBSEvent,
    onToggleLoop,
    onOpenLocation,
    onRevalidateItem,
    onConvertItem,
    onCancelConversion,
    onClearSelection,
    filterActive,
    searchQuery,
    onSearchChange,
    onSearchClose,
    onContextMenuOpenChange
  }

  const searchRef = useRef(null)
  const searchTimerRef = useRef(null)
  const draggedRef = useRef(null)
  const lastValidRef = useRef(null)
  const dragIntentRef = useRef('move')
  const rowRefs = useRef(new Map())
  const manualScrollRef = useRef(0)
  const followRef = useRef(follow)
  followRef.current = follow
  const hasSelectionRef = useRef(false)
  hasSelectionRef.current = selectedItems.length > 0

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

  const registerRow = useCallback((id, el) => {
    if (el) {
      rowRefs.current.set(id, el)
    } else {
      rowRefs.current.delete(id)
    }
  }, [])

  const resetDrag = useCallback(() => {
    draggedRef.current = null
    lastValidRef.current = null
    dragIntentRef.current = 'move'
    setDraggedIndex(null)
    setDragOverIndex(null)
  }, [])

  const duplicateItem = useCallback((itemId, insertIndex) => {
    const { onDuplicateItem: duplicate } = propsRef.current
    if (duplicate) duplicate(itemId, insertIndex)
  }, [])

  const handleSelect = useCallback((e, index) => {
    const item = propsRef.current.items[index]
    if (item) propsRef.current.onSelectItem(item, e.ctrlKey, e.shiftKey)
  }, [])

  const handleRemove = useCallback((itemId) => {
    const { onRequestRemove: request, onRemoveItem: remove, currentItem: current } = propsRef.current
    if (request) {
      request(itemId)
      return
    }
    if (current && current.id === itemId) return
    if (remove) remove(itemId)
  }, [])

  const handleCue = useCallback((itemId) => {
    propsRef.current.onCueItem(itemId)
  }, [])

  const handleToggleLoop = useCallback((itemId) => {
    propsRef.current.onToggleLoop(itemId)
  }, [])

  const handleEditNote = useCallback((index, note, itemId) => {
    propsRef.current.onAddNote(index, note, itemId)
  }, [])

  const handleEditOBS = useCallback((item) => {
    if (propsRef.current.onEditOBSEvent) propsRef.current.onEditOBSEvent(item)
  }, [])

  const handleOpenLocation = useCallback((location) => {
    const { onOpenLocation: open } = propsRef.current
    if (open && location) open(location)
  }, [])

  const handleBackgroundClick = useCallback((e) => {
    if (e.target.closest('.pl-row') || e.target.closest('button') || e.target.closest('.context-menu') || e.target.closest('.pl-find')) return
    const { onClearSelection: clear, selectedItems: selection } = propsRef.current
    if (clear && selection.length > 0) clear()
  }, [])

  const cancelSearchTimer = useCallback(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
      searchTimerRef.current = null
    }
  }, [])

  const handleSearchInput = useCallback((e) => {
    const value = e.target.value
    setInternalQuery(value)
    cancelSearchTimer()
    searchTimerRef.current = setTimeout(() => {
      searchTimerRef.current = null
      const { onSearchChange: change } = propsRef.current
      if (change) change(value)
    }, SEARCH_DEBOUNCE_MS)
  }, [cancelSearchTimer])

  const closeSearch = useCallback(() => {
    cancelSearchTimer()
    setInternalQuery('')
    const { onSearchClose: close } = propsRef.current
    if (close) close()
  }, [cancelSearchTimer])

  const handleSearchKeyDown = useCallback((e) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSearch()
    }
  }, [closeSearch])

  const handleSearchClear = useCallback((e) => {
    dropFocus(e)
    closeSearch()
  }, [closeSearch])

  const handleDragStart = useCallback((e, index) => {
    const { items: list, currentItem: current, currentIndex: ci, selectedItems: selection, filterActive: filtered } = propsRef.current
    const item = list[index]
    if (!item) return

    if (filtered) {
      e.preventDefault()
      return
    }

    const isLocked = !!(current && current.id === item.id) || (ci >= 0 && index < ci)
    const inMultiSelection = selection.length > 1 && selection.some(i => i.id === item.id)
    const selectionLocked = inMultiSelection && selection.some(entry => {
      const at = list.findIndex(row => row.id === entry.id)
      return at >= 0 && ci >= 0 && at <= ci
    })

    if (selectionLocked || (isLocked && !e.ctrlKey)) {
      e.preventDefault()
      return
    }

    dragIntentRef.current = e.ctrlKey ? 'duplicate' : 'move'
    draggedRef.current = { index, id: item.id }
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('text/plain', String(item.id))
  }, [])

  const handleDragOver = useCallback((e, index) => {
    e.preventDefault()
    e.stopPropagation()

    if (propsRef.current.filterActive) {
      e.dataTransfer.dropEffect = 'none'
      lastValidRef.current = null
      setDragOverIndex(null)
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const mouseY = e.clientY - rect.top
    let targetIndex = mouseY > rect.height * 0.5 ? index + 1 : index

    const ci = propsRef.current.currentIndex
    if (ci >= 0 && targetIndex <= ci) {
      targetIndex = ci + 1
    }

    if (draggedRef.current !== null) {
      e.dataTransfer.dropEffect = dragIntentRef.current === 'duplicate' ? 'copy' : 'move'
    }

    lastValidRef.current = targetIndex
    setDragOverIndex(prev => (prev === targetIndex ? prev : targetIndex))
  }, [])

  const handleDrop = useCallback((e, dropIndex) => {
    e.preventDefault()
    e.stopPropagation()

    if (propsRef.current.filterActive) {
      resetDrag()
      return
    }

    const finalIndex = lastValidRef.current !== null ? lastValidRef.current : dropIndex

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      if (propsRef.current.onExternalDrop) {
        propsRef.current.onExternalDrop(files, finalIndex)
      }
      resetDrag()
      return
    }

    const dragged = draggedRef.current
    if (dragged) {
      const isDuplicate = dragIntentRef.current === 'duplicate'
      if (isDuplicate) {
        duplicateItem(dragged.id, finalIndex)
      } else if (dragged.index !== finalIndex) {
        propsRef.current.onReorder(dragged.index, finalIndex, false)
      }
    }

    resetDrag()
  }, [resetDrag, duplicateItem])

  const handleDragEnd = useCallback(() => {
    resetDrag()
  }, [resetDrag])

  const handleContainerDragLeave = useCallback((e) => {
    const next = e.relatedTarget
    if (next && e.currentTarget.contains(next)) return
    lastValidRef.current = null
    setDragOverIndex(null)
  }, [])

  const handleHeadDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'none'
    lastValidRef.current = null
    setDragOverIndex(null)
  }, [])

  const handleHeadDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    resetDrag()
  }, [resetDrag])

  const handleContainerDragOver = useCallback((e) => {
    e.preventDefault()
    if (propsRef.current.filterActive) {
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'none'
      return
    }
    if (draggedRef.current !== null) {
      e.stopPropagation()
      e.dataTransfer.dropEffect = dragIntentRef.current === 'duplicate' ? 'copy' : 'move'
    }
  }, [])

  const handleContainerDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()

    if (propsRef.current.filterActive) {
      resetDrag()
      return
    }

    const list = propsRef.current.items
    const finalIndex = lastValidRef.current !== null ? lastValidRef.current : list.length

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      if (propsRef.current.onExternalDrop) {
        propsRef.current.onExternalDrop(files, finalIndex)
      }
      resetDrag()
      return
    }

    const dragged = draggedRef.current
    if (dragged) {
      const isDuplicate = dragIntentRef.current === 'duplicate'
      if (isDuplicate) {
        duplicateItem(dragged.id, finalIndex)
      } else if (dragged.index !== finalIndex) {
        propsRef.current.onReorder(dragged.index, finalIndex, false)
      }
    }

    resetDrag()
  }, [resetDrag, duplicateItem])

  const handleZoneDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (propsRef.current.filterActive) {
      e.dataTransfer.dropEffect = 'none'
      lastValidRef.current = null
      setDragOverIndex(null)
      return
    }
    const end = propsRef.current.items.length
    if (draggedRef.current !== null) {
      e.dataTransfer.dropEffect = dragIntentRef.current === 'duplicate' ? 'copy' : 'move'
    }
    lastValidRef.current = end
    setDragOverIndex(prev => (prev === end ? prev : end))
  }, [])

  const handleZoneDrop = useCallback((e) => {
    handleDrop(e, propsRef.current.items.length)
  }, [handleDrop])

  const handleWheel = useCallback(() => {
    manualScrollRef.current = Date.now()
  }, [])

  const handleContextMenu = useCallback((e, index) => {
    e.preventDefault()
    e.stopPropagation()
    const item = index === null ? null : propsRef.current.items[index]
    setContextMenu({ x: e.clientX, y: e.clientY, item: item || null })
  }, [])

  const handleEmptyContextMenu = useCallback((e) => {
    if (e.target === e.currentTarget || e.target.closest('.pl-row') === null) {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY, item: null })
    }
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const toggleFollow = useCallback((e) => {
    dropFocus(e)
    if (onToggleFollow) {
      onToggleFollow()
    } else {
      setInternalFollow(prev => !prev)
    }
  }, [onToggleFollow])

  const insertIndexForMenu = () => {
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

    return insertIndex
  }

  const handleDuplicateMenu = () => {
    if (filterActive) return
    duplicateItem(contextMenu.item.id, insertIndexForMenu())
    closeContextMenu()
  }

  const handleRevalidateMenu = () => {
    const revalidate = propsRef.current.onRevalidateItem
    if (revalidate && contextMenu.item) revalidate(contextMenu.item.id)
    closeContextMenu()
  }

  const handleConvertMenu = () => {
    const convert = propsRef.current.onConvertItem
    if (convert && contextMenu.item) convert(contextMenu.item.id)
    closeContextMenu()
  }

  const handleCancelConversionMenu = () => {
    const cancel = propsRef.current.onCancelConversion
    if (cancel && contextMenu.item) cancel(contextMenu.item.id)
    closeContextMenu()
  }

  const handleCopyPath = () => {
    const location = contextMenu.item ? contextMenu.item.location : ''
    if (location && navigator.clipboard) {
      navigator.clipboard.writeText(location).catch(() => {})
    }
    closeContextMenu()
  }

  const handleInsertStopEvent = () => {
    if (filterActive) return
    onStopEvent(insertIndexForMenu())
    closeContextMenu()
  }

  const handleInsertNote = () => {
    if (filterActive) return
    onAddNote(insertIndexForMenu())
    closeContextMenu()
  }

  const handleInsertOBSEventMenu = () => {
    if (filterActive) return
    onInsertOBSEvent(insertIndexForMenu())
    closeContextMenu()
  }

  useEffect(() => {
    const notify = propsRef.current.onContextMenuOpenChange
    if (notify) notify(menuOpen)
  }, [menuOpen])

  useEffect(() => () => {
    const notify = propsRef.current.onContextMenuOpenChange
    if (notify) notify(false)
  }, [])

  useEffect(() => {
    if (!searchOpen) {
      setInternalQuery('')
      return cancelSearchTimer
    }
    setInternalQuery(propsRef.current.searchQuery || '')
    const el = searchRef.current
    if (el) {
      el.focus()
      el.select()
    }
    return cancelSearchTimer
  }, [searchOpen, cancelSearchTimer])

  useEffect(() => {
    if (!contextMenu) return

    const handleClick = (e) => {
      if (!e.target.closest('.context-menu')) {
        setContextMenu(null)
      }
    }
    const handleKey = (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        setContextMenu(null)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick)
    }, 0)
    document.addEventListener('keydown', handleKey)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  const currentId = currentItem ? currentItem.id : null

  useEffect(() => {
    if (currentId === null) return
    if (!followRef.current) return
    if (hasSelectionRef.current) return
    if (Date.now() - manualScrollRef.current < 5000) return

    const el = rowRefs.current.get(currentId)
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [currentId, follow])

  const menuItem = contextMenu ? contextMenu.item : null
  const canCopyPath = !!(menuItem && !SPECIAL_TYPES.includes(menuItem.type) && menuItem.location)
  const menuMedia = !!(menuItem && !SPECIAL_TYPES.includes(menuItem.type))
  const menuPreparing = menuMedia && isPreparing(menuItem)
  const menuConversion = menuMedia ? conversionOf(menuItem) : null
  const canConvert = !!(menuMedia && onConvertItem && !menuPreparing && canStartConversion(menuItem))
  const canCancelConversion = !!(menuConversion && onCancelConversion && ACTIVE_CONVERSION.includes(menuConversion.status))
  const canRevalidate = !!(menuMedia && onRevalidateItem && !menuPreparing &&
    (menuItem.status === 'corrupted' || menuItem.playability === 'unsupported'))
  const menuEntries = (menuItem ? 1 : 0) + (canConvert ? 1 : 0) + (canCancelConversion ? 1 : 0) + (canRevalidate ? 1 : 0) + (canCopyPath ? 1 : 0) + 2 + (obsConnected ? 1 : 0)
  const menuHeight = 52 + menuEntries * 34

  return (
    <div
      style={styles.container}
      className="playlist-container"
      onDragLeave={handleContainerDragLeave}
      onClick={handleBackgroundClick}
    >
      <div style={styles.playlistTable}>
        {searchOpen && (
          <div className="pl-find" onClick={stopEvent} onMouseDown={stopEvent} onKeyDown={handleSearchKeyDown}>
            <span className="pl-find-icon"><Icon name="search" size={14} /></span>
            <input
              ref={searchRef}
              className="pl-find-input"
              type="text"
              value={internalQuery}
              placeholder="Find in playlist"
              spellCheck={false}
              autoComplete="off"
              title={FIND_HINT}
              onChange={handleSearchInput}
            />
            {hiddenCount > 0 && <span className="pl-find-count">{hiddenCount} hidden</span>}
            <button
              className="pl-find-clear"
              onClick={handleSearchClear}
              title="Close find (Escape)"
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        )}
        <div
          className="pl-body"
          onWheel={handleWheel}
          onDragOver={handleContainerDragOver}
          onDrop={handleContainerDrop}
          onContextMenu={handleEmptyContextMenu}
        >
          <div className="pl-head" onDragOver={handleHeadDragOver} onDrop={handleHeadDrop}>
            <div className="pl-head-cell" />
            <div className="pl-head-cell">Start Time</div>
            <div className="pl-head-cell">Duration</div>
            <div className="pl-head-cell pl-head-cell--type">Type</div>
            <div className="pl-head-cell">Name</div>
            <div className="pl-head-cell">Location</div>
            <div className="pl-head-cell pl-head-cell--actions">
              <button
                className="pl-follow"
                data-active={follow ? '1' : '0'}
                onClick={toggleFollow}
                title={follow
                  ? 'Follow on air is ON: the list scrolls by itself to keep the item that is on air in view'
                  : 'Follow on air is OFF: the list never scrolls by itself, click to keep the item on air in view'}
              >
                <Icon name="cue" size={13} />
                FOLLOW ON AIR
              </button>
            </div>
          </div>

          {items.map((item, index) => (
            <PlaylistRow
              key={item.id}
              item={item}
              index={index}
              startText={formatStartTime(item.start_time)}
              isOnAir={!!(currentItem && currentItem.id === item.id)}
              isLive={!!(currentItem && currentItem.id === item.id) && isPlaying}
              isSelected={selectedIds.has(item.id)}
              isPast={currentIndex >= 0 && index < currentIndex}
              isNext={nextHighlightId !== null && item.id === nextHighlightId}
              canReveal={canReveal}
              canDrag={!filterActive}
              isDragging={draggedIndex === index}
              dropTop={dragOverIndex === index}
              registerRow={registerRow}
              onSelect={handleSelect}
              onContext={handleContextMenu}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              onCue={handleCue}
              onToggleLoop={handleToggleLoop}
              onRemove={handleRemove}
              onEditNote={handleEditNote}
              onEditOBS={handleEditOBS}
              onOpenLocation={handleOpenLocation}
            />
          ))}
          <div
            style={dragOverIndex === items.length ? styles.dropZoneActive : styles.dropZone}
            onDragOver={handleZoneDragOver}
            onDrop={handleZoneDrop}
            title={filterActive ? FIND_HINT : undefined}
          >
            <Icon name={filterActive ? 'search' : 'plus'} size={14} />
            {filterActive
              ? 'Filtered view — close the find field to add or reorder items'
              : (items.length === 0 ? 'Drop videos or images here, or use Add Files' : 'Drop files here to add them to the end')}
          </div>
        </div>
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{
            ...styles.contextMenu,
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 232)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - menuHeight))
          }}
          onClick={stopEvent}
          onMouseDown={stopEvent}
          onDoubleClick={stopEvent}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
        >
          <div style={styles.contextMenuHeader}>
            {contextMenu.item ? contextMenu.item.name || rowLabel(contextMenu.item) : 'Playlist'}
          </div>
          {contextMenu.item && (
            <button
              className="pl-menu-item btn-subtle"
              onClick={handleDuplicateMenu}
              disabled={filterActive}
              title={filterActive ? POSITION_HINT : undefined}
            >
              <Icon name="plus" size={16} />
              Duplicate Item
            </button>
          )}
          {canConvert && (
            <button
              className="pl-menu-item btn-subtle"
              onClick={handleConvertMenu}
              title={menuConversion && menuConversion.plan === 'full'
                ? 'Make a playable H.264 copy of this file. It can take a while and uses the graphics chip when it can. The original file is not changed.'
                : 'Make a playable MP4 copy of this file. It takes a few seconds. The original file is not changed.'}
            >
              <Icon name="video" size={16} />
              Convert
            </button>
          )}
          {canCancelConversion && (
            <button
              className="pl-menu-item btn-subtle"
              onClick={handleCancelConversionMenu}
              title="Stop preparing this file. It stays in the playlist and is skipped on air."
            >
              <Icon name="close" size={16} />
              Cancel conversion
            </button>
          )}
          {canRevalidate && (
            <button
              className="pl-menu-item btn-subtle"
              onClick={handleRevalidateMenu}
              title="Analyse this file again, in case it was marked as damaged by mistake"
            >
              <Icon name="refresh" size={16} />
              Check Again
            </button>
          )}
          {canCopyPath && (
            <button className="pl-menu-item btn-subtle" onClick={handleCopyPath}>
              <Icon name="copy" size={16} />
              Copy Path
            </button>
          )}
          <button
            className="pl-menu-item btn-subtle"
            onClick={handleInsertStopEvent}
            disabled={filterActive}
            title={filterActive ? POSITION_HINT : undefined}
          >
            <Icon name="stop" size={16} />
            Insert STOP Event
          </button>
          <button
            className="pl-menu-item btn-subtle"
            onClick={handleInsertNote}
            disabled={filterActive}
            title={filterActive ? POSITION_HINT : undefined}
          >
            <Icon name="note" size={16} />
            Insert Note
          </button>
          {obsConnected && (
            <button
              className="pl-menu-item btn-subtle"
              onClick={handleInsertOBSEventMenu}
              disabled={filterActive}
              title={filterActive ? POSITION_HINT : undefined}
            >
              <Icon name="obs" size={16} />
              Insert OBS Event
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const rowWrapper = { position: 'relative', scrollMarginTop: '36px' }

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
  dropIndicator: {
    position: 'absolute',
    top: '-1px',
    left: 0,
    right: 0,
    height: '2px',
    background: 'var(--accent)',
    zIndex: 4,
    boxShadow: '0 0 6px rgba(76, 194, 255, 0.9)',
    pointerEvents: 'none'
  },
  dropZone: {
    minHeight: '72px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    margin: '6px 1px 0',
    border: '1px dashed var(--stroke-strong)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-tertiary)',
    fontSize: '11px',
    transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease'
  },
  dropZoneActive: {
    minHeight: '72px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    margin: '6px 1px 0',
    border: '1px dashed var(--accent)',
    borderRadius: 'var(--radius)',
    background: 'var(--accent-soft)',
    color: 'var(--accent-hover)',
    fontSize: '11px',
    transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease'
  },
  contextMenu: {
    position: 'fixed',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--stroke-strong)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow-flyout)',
    zIndex: 10000,
    minWidth: '216px',
    padding: '5px'
  },
  contextMenuHeader: {
    padding: '6px 9px 8px',
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase',
    borderBottom: '1px solid var(--stroke)',
    marginBottom: '4px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  }
}

export default Playlist
