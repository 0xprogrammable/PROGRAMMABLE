import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  predictionObservationUtcPartsV1,
  updatePredictionObservationUtcPartV1,
} from "../components/prediction-market-launch";

const root = process.cwd();
const source = readFileSync(
  join(root, "components/prediction-market-launch.tsx"),
  "utf8",
);
const styles = readFileSync(
  join(root, "components/prediction-market-launch.module.css"),
  "utf8",
);

describe("prediction market UTC time control", () => {
  it("round-trips date and time through the existing observationUtc value", () => {
    expect(predictionObservationUtcPartsV1("2026-09-01T12:30")).toEqual({
      date: "2026-09-01",
      time: "12:30",
    });
    expect(
      updatePredictionObservationUtcPartV1(
        "2026-09-01T12:30",
        "date",
        "2026-09-02",
      ),
    ).toBe("2026-09-02T12:30");
    expect(
      updatePredictionObservationUtcPartV1(
        "2026-09-01T12:30",
        "time",
        "08:45",
      ),
    ).toBe("2026-09-01T08:45");
    expect(updatePredictionObservationUtcPartV1("", "date", "2026")).toBe(
      "2026T",
    );
    expect(updatePredictionObservationUtcPartV1("", "time", "08")).toBe(
      "T08",
    );
  });

  it("uses a branded keyboard control without a platform date picker", () => {
    expect(source).not.toContain('type="datetime-local"');
    expect(source).toContain(
      '<fieldset className={`${styles.field} ${styles.utcField}`}>',
    );
    expect(source).toContain('name="observationUtc"');
    expect(source).toContain('name="observationDate"');
    expect(source).toContain('name="observationTime"');
    expect(source).toContain('placeholder="YYYY-MM-DD"');
    expect(source).toContain('placeholder="HH:MM"');
    expect(source).toContain("updatePredictionObservationUtcPartV1(");
    expect(styles).toMatch(
      /\.utcControl\s*\{[^}]*background:\s*var\(--webde-control\);[^}]*border:\s*1px solid var\(--webde-line\);/su,
    );
    expect(styles).toMatch(
      /\.utcSegment:focus-within\s*\{[^}]*outline:\s*2px solid var\(--focus\);/su,
    );
    expect(styles).toMatch(
      /\.utcSegment input\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/su,
    );
  });
});
