/** Tiny dependency-free SVG sparkline (server- or client-renderable). */
export function Sparkline({
  values,
  width = 96,
  height = 24,
  color = "#2f81f7",
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length < 2 || values.every((v) => v === 0)) {
    return <svg width={width} height={height} aria-hidden><line x1="0" x2={width} y1={height - 1} y2={height - 1} stroke="#3f3f46" /></svg>;
  }
  const max = Math.max(...values);
  const step = width / (values.length - 1);
  const y = (v: number) => height - 1 - (v / max) * (height - 3);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} aria-label={`trend, peak ${max}`}>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={color} fillOpacity={0.12} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
