"use client";

import { useEffect, useMemo, useState } from "react";

const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789✿❀";

function getSeed(text: string) {
  let seed = 0;
  for (let index = 0; index < text.length; index += 1) {
    seed = (seed * 31 + text.charCodeAt(index)) >>> 0;
  }
  return seed;
}

function getScrambledText(text: string, revealed: number, frame: number) {
  const seed = getSeed(text);

  return Array.from(text, (character, index) => {
    if (character === " " || index < revealed) return character;
    return glyphs[(seed + index * 11 + frame * 7) % glyphs.length];
  }).join("");
}

export function ScrambleText({
  text,
  duration = 1450,
}: {
  text: string;
  duration?: number;
}) {
  const initialText = useMemo(() => getScrambledText(text, 0, 0), [text]);
  const [displayText, setDisplayText] = useState(initialText);

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );

    let animationFrame = 0;
    let timer = 0;

    if (reducedMotion.matches) {
      animationFrame = window.requestAnimationFrame(() => setDisplayText(text));
      return () => window.cancelAnimationFrame(animationFrame);
    }

    const startedAt = performance.now();
    const safeDuration = Math.max(1, duration);

    function render() {
      const elapsed = Math.min(1, (performance.now() - startedAt) / safeDuration);
      const revealed = Math.floor(elapsed * text.length);
      const frame = Math.floor((performance.now() - startedAt) / 56);

      setDisplayText(
        elapsed === 1
          ? text
          : getScrambledText(text, revealed, frame),
      );

      if (elapsed < 1) {
        timer = window.setTimeout(render, 56);
      }
    }

    animationFrame = window.requestAnimationFrame(() => {
      setDisplayText(initialText);
      render();
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timer);
    };
  }, [duration, initialText, text]);

  const segments = useMemo(() => {
    const displayCharacters = Array.from(displayText);
    let cursor = 0;

    return text.match(/\s+|\S+/gu)?.map((segment, index) => {
      const length = Array.from(segment).length;
      const display = displayCharacters
        .slice(cursor, cursor + length)
        .join("");
      cursor += length;
      return {
        display,
        key: `${index}:${segment}`,
        text: segment,
        whitespace: /^\s+$/u.test(segment),
      };
    }) ?? [];
  }, [displayText, text]);

  return (
    <span className="scramble-text">
      <span className="sr-only">{text}</span>
      <span className="scramble-text-flow" aria-hidden="true">
        {segments.map((segment) =>
          segment.whitespace ? (
            <span className="scramble-space" key={segment.key}>
              {segment.text}
            </span>
          ) : (
            <span className="scramble-word" key={segment.key}>
              <span className="scramble-word-measure">{segment.text}</span>
              <span className="scramble-word-layer">{segment.display}</span>
            </span>
          ),
        )}
      </span>
    </span>
  );
}
