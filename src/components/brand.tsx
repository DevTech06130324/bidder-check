import { Layers2 } from "lucide-react";
import { cn } from "@/lib/utils";
export function Brand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
        <Layers2 size={20} strokeWidth={2.2} />
      </span>
      {!compact && (
        <span className="text-lg font-bold tracking-[-.6px]">
          bidder<span className="font-normal">check</span>
          <span className="text-primary">.</span>
        </span>
      )}
    </div>
  );
}
