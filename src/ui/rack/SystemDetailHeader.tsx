import { ChevronRight, SlidersHorizontal } from "lucide-react";

interface SystemDetailHeaderProps {
  systemName: string;
  builderUnlocked: boolean;
  onBack: () => void;
  onConfigure: () => void;
}

export function SystemDetailHeader({
  systemName,
  builderUnlocked,
  onBack,
  onConfigure,
}: SystemDetailHeaderProps) {
  return (
    <div className="system-detail-header">
      <button
        type="button"
        className="system-detail-back"
        onClick={onBack}
        title="Back to rack"
      >
        <ChevronRight size={12} style={{ transform: "rotate(180deg)" }} />
        <span>Rack</span>
      </button>
      <span className="system-detail-name">{systemName}</span>
      {builderUnlocked && (
        <button
          type="button"
          className="system-detail-configure"
          onClick={onConfigure}
          title={`Configure parts on ${systemName}`}
        >
          <SlidersHorizontal size={12} />
          <span>Configure parts</span>
        </button>
      )}
    </div>
  );
}
