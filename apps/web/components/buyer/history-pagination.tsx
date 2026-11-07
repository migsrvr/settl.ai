import Link from 'next/link';
export function HistoryPagination({ nextCursor, path, query = {}, cursorKey = 'cursor', label = 'Next 25 records' }: { nextCursor: string | null; path: string; query?: Record<string, string | undefined>; cursorKey?: string; label?: string }) {
  if (!nextCursor) return null;
  const params = new URLSearchParams(); Object.entries(query).forEach(([key, value]) => { if (value) params.set(key, value); }); params.set(cursorKey, nextCursor);
  return <nav aria-label={label} className="py-4"><Link className="inline-flex min-h-10 items-center font-medium underline" href={`${path}?${params}`}>{label}</Link><p className="text-muted">Use your browser’s Back button to return to the previous page.</p></nav>;
}
