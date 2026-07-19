import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentActivity } from '../types'
import { QueryScheduler, type QueryJobSpec } from '../lib/queryScheduler'

export function useQueryScheduler() {
  const schedulerRef = useRef<QueryScheduler | null>(null)
  if (!schedulerRef.current) schedulerRef.current = new QueryScheduler(8, 4)
  const [activities, setActivities] = useState<DocumentActivity[]>([])

  useEffect(() => schedulerRef.current!.subscribe(setActivities), [])

  const submit = useCallback(<T,>(spec: QueryJobSpec<T>) => (
    schedulerRef.current!.submit<T>(spec)
  ), [])
  const cancel = useCallback((requestId: string) => schedulerRef.current!.cancel(requestId), [])
  const cancelDocument = useCallback((documentId: string) => schedulerRef.current!.cancelDocument(documentId), [])
  const cancelDocuments = useCallback((documentIds: readonly string[]) => schedulerRef.current!.cancelDocuments(documentIds), [])

  return { activities, submit, cancel, cancelDocument, cancelDocuments }
}
