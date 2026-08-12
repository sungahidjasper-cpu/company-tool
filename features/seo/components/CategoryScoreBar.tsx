import { Progress } from "@/components/ui/progress";

type CategoryScoreBarProps = {
  label: string;
  /** Null means this AI-derived score is unavailable for this run — never a fabricated 0, which would misrepresent "unknown" as a real bad score. */
  score: number | null;
  reasoning?: string;
};

export default function CategoryScoreBar({ label, score, reasoning }: CategoryScoreBarProps) {
  if (score === null) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{label}</span>
          <span className="text-slate-400">AI unavailable</span>
        </div>
        <Progress value={0} className="opacity-40" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-slate-500">{score}/100</span>
      </div>
      <Progress value={score} />
      {reasoning && <p className="text-xs text-slate-500">{reasoning}</p>}
    </div>
  );
}
