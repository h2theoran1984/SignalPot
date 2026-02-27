interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={[
        "bg-[#1f2028] rounded animate-pulse",
        className,
      ].join(" ")}
    />
  );
}

export function AgentCardSkeleton() {
  return (
    <div className="p-5 bg-[#111118] border border-[#1f2028] rounded-lg">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <Skeleton className="h-5 w-48 mb-2" />
          <Skeleton className="h-4 w-full mb-1" />
          <Skeleton className="h-4 w-3/4 mb-3" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        </div>
        <div className="ml-4 text-right">
          <Skeleton className="h-4 w-20 mb-1" />
          <Skeleton className="h-3 w-16 mt-2" />
        </div>
      </div>
    </div>
  );
}
