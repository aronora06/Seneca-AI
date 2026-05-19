/**
 * Compact mic level indicator — thin wrapper around {@link BarSpectrumCanvas}.
 */
import { BarSpectrumCanvas } from "./BarSpectrumCanvas";

interface Props {
  active: boolean;
  width?: number;
  height?: number;
  bars?: number;
  className?: string;
}

export function Waveform({
  active,
  width = 56,
  height = 18,
  bars = 7,
  className,
}: Props) {
  return (
    <BarSpectrumCanvas
      active={active}
      source="mic"
      width={width}
      height={height}
      bars={bars}
      colorVar="--c-accent"
      colorFallback="180 96 80"
      anchor="center"
      className={className}
    />
  );
}
