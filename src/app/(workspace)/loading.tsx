export default function WorkspaceLoading() {
  return (
    <div aria-label="Loading workspace" aria-busy="true" className="space-y-8">
      <div className="space-y-3">
        <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        <div className="h-9 w-64 max-w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="panel h-28 animate-pulse bg-muted/40" />
        ))}
      </div>
      <div className="panel h-[28rem] animate-pulse bg-muted/30" />
    </div>
  );
}
