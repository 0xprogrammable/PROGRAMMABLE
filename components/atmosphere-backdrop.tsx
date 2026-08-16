import Image from "next/image";
import type { CSSProperties } from "react";

const TWINKLE_COUNT = 72;
const LOWER_TWINKLE_COUNT = 24;
const PLANT_SIZES = "(max-width: 520px) 46vw, (max-width: 1500px) 22vw, 330px";

type SparkleStyle = CSSProperties & {
  "--sparkle-delay": string;
  "--sparkle-duration": string;
  "--sparkle-size": string;
};

function sparkleStyle(index: number, seed: number): SparkleStyle {
  const horizontal = (index * 37.37 + seed * 19.19) % 98;
  const vertical = (index * 61.61 + seed * 11.73) % 96;
  const duration = 6.8 + ((index * 29 + seed * 7) % 37) / 10;
  const delay = -((index * 17 + seed * 13) % 89) / 10;
  const size = 0.62 + ((index * 11 + seed * 3) % 7) / 20;

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
      <span className="atmosphere-botanicals">
        <Image
          className="atmosphere-plant atmosphere-plant-left"
          src="/brand/atmosphere/programmable-botanical-left-v2.webp"
          width={1024}
          height={1536}
          sizes={PLANT_SIZES}
          priority
          alt=""
        />
        <Image
          className="atmosphere-plant atmosphere-plant-right"
          src="/brand/atmosphere/programmable-botanical-right-v2.webp"
          width={1024}
          height={1536}
          sizes={PLANT_SIZES}
          priority
          alt=""
        />
      </span>
      <span className="atmosphere-veil" />
    </div>
  );
}
