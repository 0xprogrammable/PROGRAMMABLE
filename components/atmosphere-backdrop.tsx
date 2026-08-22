import type { CSSProperties } from "react";

const TWINKLE_COUNT = 56;
const LOWER_TWINKLE_COUNT = 20;

type SparkleStyle = CSSProperties & {
  "--sparkle-delay": string;
  "--sparkle-duration": string;
  "--sparkle-size": string;
};

function sparkleStyle(index: number, seed: number): SparkleStyle {
  const horizontal = (index * 37.37 + seed * 19.19) % 98;
  const vertical = (index * 61.61 + seed * 11.73) % 96;
  const duration = 4.6 + ((index * 29 + seed * 7) % 43) / 10;
  const delay = -((index * 17 + seed * 13) % 101) / 10;
  const sizeStep = ((index * 11 + seed * 3) % 11) / 20;
  const emphasis =
    (index + seed) % 23 === 0
      ? 0.48
      : (index + seed) % 13 === 0
        ? 0.24
        : 0;
  const size = 0.64 + sizeStep + emphasis;

  return {
    left: `${horizontal + 1}%`,
    top: `${vertical + 2}%`,
    "--sparkle-delay": `${delay}s`,
    "--sparkle-duration": `${duration}s`,
    "--sparkle-size": `${size}px`,
  };
}

export function AtmosphereBackdrop() {
  return (
    <div className="atmosphere-backdrop" aria-hidden="true">
      <span className="atmosphere-ground-glow" />
      <span className="atmosphere-stars atmosphere-stars-primary" />
      <span className="atmosphere-stars atmosphere-stars-secondary" />
      <span className="atmosphere-sparkles">
        {Array.from({ length: TWINKLE_COUNT }, (_, index) => (
          <i key={index} style={sparkleStyle(index, 3)} />
        ))}
      </span>
      <span className="atmosphere-sparkles atmosphere-sparkles-lower">
        {Array.from({ length: LOWER_TWINKLE_COUNT }, (_, index) => (
          <i key={`lower-${index}`} style={sparkleStyle(index, 17)} />
        ))}
      </span>
      <span className="atmosphere-sparkles atmosphere-sparkles-dense">
        {Array.from({ length: TWINKLE_COUNT }, (_, index) => (
          <i key={`dense-${index}`} style={sparkleStyle(index, 29)} />
        ))}
      </span>
      <span className="atmosphere-sparkles atmosphere-sparkles-accent">
        {Array.from({ length: LOWER_TWINKLE_COUNT }, (_, index) => (
          <i key={`accent-${index}`} style={sparkleStyle(index, 47)} />
        ))}
      </span>
      <span className="atmosphere-veil" />
    </div>
  );
}
