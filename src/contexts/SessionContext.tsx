import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react'
import {
  getSessions,
  createSession as apiCreateSession,
  deleteSession as apiDeleteSession,
  subscribeToEvents,
  type ApiSession,
  type SessionListParams,
} from '../api'
import { childSessionStore } from '../store/childSessionStore'
import { followupQueueStore } from '../store/followupQueueStore'
import { todoStore } from '../store/todoStore'
import { useDirectory } from './useDirectory'
import { sessionErrorHandler, normalizeToForwardSlash, isSameDirectory, autoDetectPathStyle } from '../utils'
import { SessionContext, type SessionContextValue } from './SessionContext.shared'

const SESSIONS_CACHE_PREFIX = 'opencode:sessions-cache:'

function getSessionsCacheKey(directory: string | undefined): string {
  return SESSIONS_CACHE_PREFIX + (directory ? normalizeToForwardSlash(directory) : 'global')
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { currentDirectory } = useDirectory()

  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [search, setSearch] = useState('')

  const requestIdRef = useRef(0)
  const searchTimerRef = useRef<number | null>(null)
  const currentDirectoryRef = useRef(currentDirectory)
  const searchRef = useRef(search)
  const isLoadingMoreRef = useRef(false)
  const isFetchingRef = useRef(false)
  const fetchSessionsRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const currentLimitRef = useRef(30)

  useEffect(() => {
    currentDirectoryRef.current = currentDirectory
  }, [currentDirectory])

  useEffect(() => {
    searchRef.current = search
  }, [search])

  const fetchSessions = useCallback(
    async (params: SessionListParams & { append?: boolean } = {}) => {
      const { append = false, ...queryParams } = params
      const requestId = ++requestIdRef.current
      isFetchingRef.current = true

      const targetDir = normalizeToForwardSlash(currentDirectory) || undefined
      const isSearchMode = !!search
      let showLoading = true

      if (!append && !isSearchMode && !isLoadingMoreRef.current) {
        try {
          const cached = localStorage.getItem(getSessionsCacheKey(targetDir))
          if (cached) {
            const parsed = JSON.parse(cached)
            if (Array.isArray(parsed) && parsed.length > 0) {
              setSessions(parsed.filter(s => !s.parentID))
              showLoading = false
            }
          }
        } catch {}
      }

      if (append) {
        setIsLoadingMore(true)
      } else if (showLoading) {
        setIsLoading(true)
      }

      try {
        const data = await getSessions({
          limit: currentLimitRef.current,
          directory: targetDir,
          search: search || undefined,
          ...queryParams,
        })

        if (requestId !== requestIdRef.current) return

        if (data.length > 0 && data[0].directory) {
          autoDetectPathStyle(data[0].directory)
        }

        if (append) {
          setSessions(prev => {
            const existingIds = new Set(prev.map(s => s.id))
            const newSessions = data.filter(s => !existingIds.has(s.id) && !s.parentID)
            return [...prev, ...newSessions]
          })
        } else {
          setSessions(data.filter(s => !s.parentID))
          if (!isSearchMode && targetDir) {
            try { localStorage.setItem(getSessionsCacheKey(targetDir), JSON.stringify(data)) } catch {}
          }
        }
        setHasMore(data.length >= currentLimitRef.current)
      } catch (e) {
        sessionErrorHandler('fetch sessions', e)
      } finally {
        if (requestId === requestIdRef.current) {
          isFetchingRef.current = false
          setIsLoading(false)
          setIsLoadingMore(false)
        }
      }
    },
    [currentDirectory, search],
  )

  // 保持 fetchSessions ref 同步（用于 SSE onReconnected 回调）
  fetchSessionsRef.current = fetchSessions

  const matchesCurrentDirectory = useCallback((session: ApiSession) => {
    return !currentDirectoryRef.current || isSameDirectory(currentDirectoryRef.current, session.directory)
  }, [])

  // 监听 directory 和 search 变化
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)

    currentLimitRef.current = 30

    // 在 timer 之前同步读取缓存，避免 loading 闪烁
    if (!search) {
      const dir = normalizeToForwardSlash(currentDirectory) || undefined
      try {
        const cached = localStorage.getItem(getSessionsCacheKey(dir))
        if (cached) {
          const parsed = JSON.parse(cached)
          if (Array.isArray(parsed) && parsed.length > 0) {
            setSessions(parsed)
            setIsLoading(false)
          }
        }
      } catch {}
    }

    searchTimerRef.current = window.setTimeout(
      () => {
        fetchSessions()
      },
      search ? 300 : 0,
    )

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [fetchSessions, search, currentDirectory])

  function writeSessionCache(directory: string | undefined, sessions: ApiSession[]) {
    if (!directory) return
    try { localStorage.setItem(getSessionsCacheKey(directory), JSON.stringify(sessions)) } catch {}
  }

  // 订阅 SSE 事件，实时更新 session 列表
  useEffect(() => {
    const unsubscribe = subscribeToEvents({
      onSessionCreated: session => {
        if (!matchesCurrentDirectory(session)) return
        if (session.parentID) return

        if (searchRef.current) {
          fetchSessionsRef.current()
          return
        }

        setSessions(prev => {
          if (prev.some(s => s.id === session.id)) return prev
          const updated = [session, ...prev]
          writeSessionCache(currentDirectoryRef.current, updated)
          return updated
        })
      },
      onSessionUpdated: session => {
        if (session.parentID) {
          setSessions(prev => {
            const filtered = prev.filter(s => s.id !== session.id)
            if (filtered.length !== prev.length) {
              writeSessionCache(currentDirectoryRef.current, filtered)
            }
            return filtered
          })
          return
        }

        if (searchRef.current) {
          if (matchesCurrentDirectory(session)) {
            fetchSessionsRef.current()
          } else {
            setSessions(prev => {
              const filtered = prev.filter(s => s.id !== session.id)
              writeSessionCache(currentDirectoryRef.current, filtered)
              return filtered
            })
          }
          return
        }

        setSessions(prev => {
          if (!matchesCurrentDirectory(session)) {
            const filtered = prev.filter(s => s.id !== session.id)
            if (filtered.length !== prev.length) {
              writeSessionCache(currentDirectoryRef.current, filtered)
            }
            return filtered
          }

          const filtered = prev.filter(s => s.id !== session.id)
          const updated = [session, ...filtered]
          writeSessionCache(currentDirectoryRef.current, updated)
          return updated
        })
      },
      onTodoUpdated: data => {
        // 更新 todoStore
        todoStore.setTodos(data.sessionID, data.todos)
      },
      onReconnected: () => {
        // SSE 重连成功后，如果已经有请求在进行中，跳过重复拉取
        if (isFetchingRef.current) return
        // 清空旧 session 列表，重新从服务器拉取
        setSessions([])
        fetchSessionsRef.current()
      },
    })

    return unsubscribe
  }, [matchesCurrentDirectory])

  // Actions
  const refresh = useCallback(() => fetchSessions(), [fetchSessions])

  const loadMore = useCallback(async () => {
    // 使用 ref 检查，防止并发请求
    if (isLoadingMoreRef.current || !hasMore || sessions.length === 0) return
    isLoadingMoreRef.current = true

    try {
      // 跟官方 webui 一样，递增 limit 重新请求整个列表
      currentLimitRef.current += 15
      setIsLoadingMore(true)
      await fetchSessions()
    } finally {
      isLoadingMoreRef.current = false
      setIsLoadingMore(false)
    }
  }, [hasMore, sessions, fetchSessions])

  const createSession = useCallback(
    async (title?: string) => {
      // 使用正斜杠格式传给后端
      const targetDir = normalizeToForwardSlash(currentDirectory) || undefined

      const newSession = await apiCreateSession({
        title,
        directory: targetDir,
      })
      return newSession
    },
    [currentDirectory],
  )

  const deleteSession = useCallback(
    async (id: string) => {
      const targetDir = normalizeToForwardSlash(currentDirectory) || undefined
      await apiDeleteSession(id, targetDir)
      childSessionStore.clearChildren(id)
      followupQueueStore.clearSession(id)
      setSessions(prev => {
        const updated = prev.filter(s => s.id !== id)
        writeSessionCache(currentDirectoryRef.current, updated)
        return updated
      })
    },
    [currentDirectory],
  )

  // 稳定化 Provider value，避免每次渲染创建新对象导致子组件不必要重渲染
  const value = useMemo<SessionContextValue>(
    () => ({
      sessions,
      isLoading,
      isLoadingMore,
      hasMore,
      search,
      setSearch,
      refresh,
      loadMore,
      createSession,
      deleteSession,
    }),
    [sessions, isLoading, isLoadingMore, hasMore, search, refresh, loadMore, createSession, deleteSession],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
