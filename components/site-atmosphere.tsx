const particles = [
  { className: "atmosphere-particle atmosphere-particle-one" },
  { className: "atmosphere-particle atmosphere-particle-two" },
  { className: "atmosphere-particle atmosphere-particle-three" },
  { className: "atmosphere-particle atmosphere-particle-four" },
  { className: "atmosphere-particle atmosphere-particle-five" },
  { className: "atmosphere-particle atmosphere-particle-six" },
] as const;

export function SiteAtmosphere() {
  return (
    <div className="site-atmosphere" aria-hidden="true">
      <span className="atmosphere-glow" />
      {particles.map((particle) => (
        <span className={particle.className} key={particle.className} />
      ))}
    </div>
  );
}
