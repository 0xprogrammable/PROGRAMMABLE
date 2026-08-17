# Repository presentation assets

The active V4 set keeps the public product repository aligned with the Programmable GitHub profile, documentation and
Night Garden brand system.

## Active V4 set

| File                                            | Use                        | Dimensions | SHA-256                                                            |
| ----------------------------------------------- | -------------------------- | ---------- | ------------------------------------------------------------------ |
| `programmable-repository-night-garden-v4.gif`   | Animated root README cover | 1400 × 700 | `3046bfb5ffdb0278399003c46476cffc4f0fc5be8ea646bddd9a3b156cca1291` |
| `programmable-repository-night-garden-v3.png`   | Reduced-motion cover       | 1600 × 800 | `7528c99ccffa5b3efc663cf2f8061c1e39cd189423cb80a835196b81a550d216` |
| `programmable-repository-system-v4.jpg`         | Repository-system divider  | 1400 × 560 | `ae213d931ae334dcfd61aa6724e7e3d5898a3f6864bf40f6b8df57e49ab021bf` |
| `programmable-repository-social-preview-v4.jpg` | GitHub social preview      | 1280 × 640 | `1ee59b2455cdadca037d11057943a3d8bb8898f4b0bd7c096553a3993c7cbb85` |

`repository-v4-manifest.json` records the animation timing, stable garden and mark, Midjourney source job for the system
divider and the exact export hashes.

The animated cover changes only the small round stars in the black sky. The garden and exact white Programmable mark
remain fixed. GitHub clients that request reduced motion receive the PNG fallback through the README `picture`
element.

The mark was composited from the canonical Programmable loop asset rather than generated inside the floral scene. The
social preview is composed independently for GitHub's 2:1 safe area instead of being cropped from the README cover.

## Retained V1 set

`programmable-repository-cover-v1.jpg` and `programmable-social-preview-v1.jpg` are retained as release history. They
are no longer referenced by the root README or repository social preview.
