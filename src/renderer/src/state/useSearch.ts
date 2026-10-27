import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  SearchRequest,
  SearchResponse,
  SortDirection,
  SortKey
} from '@shared/types'

export const PAGE_SIZE = 25

export interface SearchCenter {
  query: string
  submitted: string
  sort: SortKey
  direction: SortDirection
  extensions: string[]
  folderIds: number[]
  response: SearchResponse | null
  loading: boolean
  error: string | null
  offset: number
  pageCount: number
  page: number
  setQuery(value: string): void
  submit(value?: string): void
  clear(): void
  setSort(sort: SortKey): void
  toggleDirection(): void
  toggleExtension(ext: string): void
  toggleFolder(id: number): void
  clearFilters(): void
  goToPage(page: number): void
}

function toggled(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function toggledIds(values: number[], value: number): number[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

/**
 * Owns the search form and the last response. A search runs whenever the
 * submitted query, the sorting or the filters change; typing alone does not
 * query, so the index is not hammered while the user spells an Arabic word.
 */
export function useSearch(): SearchCenter {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [sort, setSort] = useState<SortKey>('relevance')
  const [direction, setDirection] = useState<SortDirection>('desc')
  const [extensions, setExtensions] = useState<string[]>([])
  const [folderIds, setFolderIds] = useState<number[]>([])
  const [response, setResponse] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [nonce, setNonce] = useState(0)
  const requestId = useRef(0)

  useEffect(() => {
    if (submitted.trim().length === 0) {
      setResponse(null)
      setLoading(false)
      return
    }

    const id = ++requestId.current
    const request: SearchRequest = {
      query: submitted,
      sort,
      direction,
      extensions,
      folderIds,
      limit: PAGE_SIZE,
      offset
    }
    setLoading(true)
    window.api
      .search(request)
      .then((result) => {
        if (id !== requestId.current) return
        setResponse(result)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false)
      })
  }, [submitted, sort, direction, extensions, folderIds, offset, nonce])

  const submit = useCallback(
    (value?: string) => {
      if (value !== undefined) setQuery(value)
      setSubmitted(value ?? query)
      setOffset(0)
      // Re-runs the search even when the text is unchanged (after a re-index).
      setNonce((current) => current + 1)
    },
    [query]
  )

  const total = response?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return {
    query,
    submitted,
    sort,
    direction,
    extensions,
    folderIds,
    response,
    loading,
    error,
    offset,
    pageCount,
    page: Math.min(pageCount, Math.floor(offset / PAGE_SIZE) + 1),
    setQuery,
    submit,
    clear: () => {
      requestId.current += 1
      setQuery('')
      setSubmitted('')
      setResponse(null)
      setError(null)
      setOffset(0)
    },
    setSort: (next) => {
      setSort(next)
      setOffset(0)
    },
    toggleDirection: () => setDirection((current) => (current === 'asc' ? 'desc' : 'asc')),
    toggleExtension: (ext) => {
      setExtensions((current) => toggled(current, ext))
      setOffset(0)
    },
    toggleFolder: (id) => {
      setFolderIds((current) => toggledIds(current, id))
      setOffset(0)
    },
    clearFilters: () => {
      setExtensions([])
      setFolderIds([])
      setOffset(0)
    },
    goToPage: (page) => setOffset(Math.max(0, (page - 1) * PAGE_SIZE))
  }
}
