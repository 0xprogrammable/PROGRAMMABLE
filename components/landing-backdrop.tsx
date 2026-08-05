"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import styles from "@/components/landing-page.module.css";

const motionVideo =
  "/brand/landing/programmable-botanical-cosmos-motion-v3-1080.mp4";

export function LandingBackdrop() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const applyMotionPreference = () => {
      if (motionPreference.matches) {
        video.pause();
        return;
      }

      void video.play().catch(() => {
        setIsPlaying(false);
      });
    };

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    motionPreference.addEventListener("change", applyMotionPreference);
    applyMotionPreference();

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      motionPreference.removeEventListener("change", applyMotionPreference);
    };
  }, []);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play().catch(() => {
        setIsPlaying(false);
      });
      return;
    }

    video.pause();
  }

  const controlLabel = isPlaying
    ? "Pause background animation"
    : "Play background animation";

  return (
    <>
      <video
        ref={videoRef}
        className={styles.backdropVideo}
        aria-hidden="true"
        loop
        muted
        playsInline
        preload="metadata"
      >
        <source src={motionVideo} type="video/mp4" />
      </video>
      <button
        className={styles.motionControl}
        type="button"
        aria-label={controlLabel}
        title={controlLabel}
        onClick={togglePlayback}
      >
        {isPlaying ? (
          <Pause aria-hidden="true" size={18} strokeWidth={1.8} />
        ) : (
          <Play aria-hidden="true" size={18} strokeWidth={1.8} />
        )}
      </button>
    </>
  );
}
