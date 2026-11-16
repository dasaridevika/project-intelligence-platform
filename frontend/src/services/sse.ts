export interface SSEMessage {
  id?: string;
  event: string;
  data: any;
}

export function subscribeToSearchEvents(
  searchRunId: string,
  onEvent: (msg: SSEMessage) => void,
  onError?: (err: any) => void
): () => void {
  const url = `/api/v1/search/${searchRunId}/events`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ id: e.lastEventId, event: 'message', data });
    } catch {
      onEvent({ id: e.lastEventId, event: 'message', data: e.data });
    }
  };

  const knownEvents = [
    'search_created',
    'query_analyzed',
    'job_published',
    'provider_started',
    'provider_completed',
    'provider_failed',
    'provider_fallback',
    'url_fetched',
    'candidate_accepted',
    'candidate_rejected',
    'extraction_started',
    'extraction_completed',
    'deduplication_completed',
    'ranking_evaluated',
    'projects_saved',
    'search_completed',
    'search_failed',
    'done'
  ];

  for (const evName of knownEvents) {
    eventSource.addEventListener(evName, (e: any) => {
      try {
        const data = JSON.parse(e.data);
        onEvent({ id: e.lastEventId, event: evName, data });
      } catch {
        onEvent({ id: e.lastEventId, event: evName, data: e.data });
      }
    });
  }

  eventSource.onerror = (err) => {
    if (onError) onError(err);
  };

  return () => {
    eventSource.close();
  };
}
