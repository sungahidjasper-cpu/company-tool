type SeoScoreGaugeProps = {
  score: number;
  size?: number;
  label?: string;
};

function scoreColor(score: number): string {
  if (score >= 80) return "#2e7d4f";
  if (score >= 50) return "#b8842e";
  return "#b3413a";
}

/** Hero circular indicator for the overall SEO score — plain inline SVG, no new dependency. */
export default function SeoScoreGauge({ score, size = 140, label }: SeoScoreGaugeProps) {
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const color = scoreColor(score);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold" style={{ color }}>
            {score}
          </span>
          <span className="text-xs text-slate-500">/ 100</span>
        </div>
      </div>
      {label && <span className="text-sm font-medium text-slate-600">{label}</span>}
    </div>
  );
}
