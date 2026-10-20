// Risk score 0-100 as a short gauge: green, amber from 30, coral from 50.
export function RiskBadge({ score }: { score: number }) {
  const tone = score >= 50 ? "high" : score >= 30 ? "mid" : "low";
  return (
    <span className={`risk ${tone}`} title="Score de risque">
      <i>
        <span style={{ width: `${Math.max(score, 4)}%` }} />
      </i>
      {score}
    </span>
  );
}
