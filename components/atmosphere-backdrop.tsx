import Image from "next/image";

const TWINKLE_COUNT = 36;
const LOWER_TWINKLE_COUNT = 12;
const PLANT_SIZES = "(max-width: 520px) 46vw, (max-width: 1500px) 22vw, 330px";

export function AtmosphereBackdrop() {
  return (
    <div className="atmosphere-backdrop" aria-hidden="true">
      <span className="atmosphere-ground-glow" />
      <span className="atmosphere-stars atmosphere-stars-primary" />
      <span className="atmosphere-stars atmosphere-stars-secondary" />
      <span className="atmosphere-sparkles">
        {Array.from({ length: TWINKLE_COUNT }, (_, index) => (
          <i key={index} />
        ))}
      </span>
      <span className="atmosphere-sparkles atmosphere-sparkles-lower">
        {Array.from({ length: LOWER_TWINKLE_COUNT }, (_, index) => (
          <i key={`lower-${index}`} />
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
