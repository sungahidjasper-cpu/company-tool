import { Progress } from "@/components/ui/progress";

type CategoryScoreBarProps = {
  label: string;
  score: number;
  reasoning?: string;
};

export default function CategoryScoreBar({ label, score, reasoning }: CategoryScoreBarProps) {
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
