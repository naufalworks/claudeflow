import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";

export default function AccountCardSkeleton() {
  return (
    <Card padding="md" elev data-testid="account-skeleton">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <Skeleton variant="text" className="w-32 mb-2" />
          <Skeleton variant="text" className="w-24 h-3" />
        </div>
        <Skeleton variant="rectangular" width={60} height={24} />
      </div>

      {/* Quota Gauge */}
      <div className="flex justify-center mb-4">
        <Skeleton variant="circular" width={120} height={120} />
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Card.Section className="p-3">
          <Skeleton variant="text" className="w-16 h-3 mb-2" />
          <Skeleton variant="text" className="w-12" />
        </Card.Section>
        <Card.Section className="p-3">
          <Skeleton variant="text" className="w-16 h-3 mb-2" />
          <Skeleton variant="text" className="w-12" />
        </Card.Section>
      </div>

      {/* Last Used */}
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-border-subtle">
        <Skeleton variant="text" className="w-16 h-3" />
        <Skeleton variant="text" className="w-20 h-3" />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Skeleton variant="rectangular" height={32} className="flex-1" />
        <Skeleton variant="rectangular" height={32} className="flex-1" />
      </div>
    </Card>
  );
}
