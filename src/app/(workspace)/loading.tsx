import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div className="space-y-6" aria-label="Loading workspace">
      <Skeleton className="h-10 w-64" />
      <div className="grid gap-5 md:grid-cols-4">
        {[1, 2, 3, 4].map((n) => (
          <Skeleton key={n} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}
