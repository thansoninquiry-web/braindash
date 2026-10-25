import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HallScene } from "../src/components/CloudVoid.js";
import {
  DAWN_END,
  DAWN_START,
  DUSK_END,
  DUSK_START,
  NIGHT_GLOW,
  NIGHT_STRIPS,
  NIGHT_VEIL,
  hallLightingAt,
  minutesOfDay,
} from "../src/hallLight.js";

const at = (hour: number, minute = 0) => hour * 60 + minute;

function render(minutes: number): string {
  return renderToStaticMarkup(<HallScene lighting={hallLightingAt(minutes)} />);
}

describe("hallLightingAt", () => {
  it("is at its darkest in the small hours", () => {
    const night = hallLightingAt(at(2));
    assert.equal(night.level, 0);
    assert.equal(night.phase, "night");
    assert.equal(night.strips, NIGHT_STRIPS);
    assert.equal(night.glow, NIGHT_GLOW);
    assert.equal(night.veil, NIGHT_VEIL);
  });

  it("is fully lit through the middle of the day", () => {
    const day = hallLightingAt(at(12));
    assert.equal(day.level, 1);
    assert.equal(day.phase, "day");
    assert.equal(day.strips, 1);
    assert.equal(day.glow, 1);
    assert.equal(day.veil, 0);
  });

  it("lifts across dawn and settles by the time morning starts", () => {
    assert.equal(hallLightingAt(DAWN_START).level, 0, "dawn starts from night");
    assert.equal(hallLightingAt(DAWN_START).phase, "dawn");
    assert.equal(hallLightingAt((DAWN_START + DAWN_END) / 2).level, 0.5, "half-way at 06:00");
    assert.equal(hallLightingAt(DAWN_END).level, 1, "full day at 07:00");
    assert.equal(hallLightingAt(DAWN_END).phase, "day");

    // No jump backwards anywhere on the way up.
    let previous = -1;
    for (let minute = DAWN_START; minute <= DAWN_END; minute += 5) {
      const { level } = hallLightingAt(minute);
      assert.ok(level >= previous, `${minute} min: ${level} >= ${previous}`);
      previous = level;
    }
  });

  it("dims across dusk on the same curve", () => {
    assert.equal(hallLightingAt(DUSK_START).level, 1);
    assert.equal(hallLightingAt(DUSK_START).phase, "dusk");
    assert.equal(hallLightingAt((DUSK_START + DUSK_END) / 2).level, 0.5);
    assert.equal(hallLightingAt(DUSK_END).level, 0);
    assert.equal(hallLightingAt(DUSK_END).phase, "night");

    let previous = 2;
    for (let minute = DUSK_START; minute <= DUSK_END; minute += 5) {
      const { level } = hallLightingAt(minute);
      assert.ok(level <= previous);
      previous = level;
    }
  });

  it("keeps the strip lights above the glow at night, and the glow above zero", () => {
    const night = hallLightingAt(at(23));
    assert.ok(night.strips < 0.5, "strips are mostly off");
    assert.ok(night.glow > night.strips, "the doorway is still the brightest thing");
    assert.ok(night.glow > 0);
  });

  it("wraps times past midnight instead of producing an out-of-range level", () => {
    assert.deepEqual(hallLightingAt(at(25)), hallLightingAt(at(1)));
    assert.deepEqual(hallLightingAt(-60), hallLightingAt(at(23)));
    assert.deepEqual(hallLightingAt(1440 + at(6)), hallLightingAt(at(6)));
  });

  it("survives a non-finite input by falling back to midnight", () => {
    assert.deepEqual(hallLightingAt(Number.NaN), hallLightingAt(0));
  });
});

describe("minutesOfDay", () => {
  it("returns fractional minutes from the local wall clock", () => {
    assert.equal(minutesOfDay(new Date(2026, 0, 1, 6, 30, 30)), at(6, 30) + 0.5);
    assert.equal(minutesOfDay(new Date(2026, 0, 1, 0, 0, 0)), 0);
  });
});

describe("HallScene lighting", () => {
  it("dims the strips, the doorway glow and the room at night", () => {
    const markup = render(at(2));
    assert.ok(markup.includes('data-hall-phase="night"'));
    assert.ok(markup.includes(`class="void-lights" style="opacity:${NIGHT_STRIPS}"`));
    assert.ok(markup.includes(`class="void-glow" style="opacity:${NIGHT_GLOW}"`));
    assert.ok(markup.includes(`class="void-night"`));
    assert.ok(markup.includes(`style="opacity:${NIGHT_VEIL}"`));
    assert.ok(markup.includes(`style="opacity:${NIGHT_GLOW}"`), "the door outline dims too");
  });

  it("runs the lamps at full strength at noon, with no night veil", () => {
    const markup = render(at(12));
    assert.ok(markup.includes('data-hall-phase="day"'));
    assert.ok(markup.includes('class="void-lights" style="opacity:1"'));
    assert.ok(markup.includes('class="void-glow" style="opacity:1"'));
    assert.match(markup, /<rect class="void-night"[^>]*style="opacity:0"/);
  });

  it("keeps the ceiling's near-to-far brightness gradient at every hour", () => {
    for (const minutes of [at(2), at(6), at(12), at(20)]) {
      const markup = render(minutes);
      const plates = [...markup.matchAll(/class="void-lights"[\s\S]*?<\/g>/g)][0]?.[0] ?? "";
      const opacities = [...plates.matchAll(/<polygon[^>]*style="opacity:([\d.]+)"/g)].map((match) =>
        Number(match[1]),
      );
      assert.ok(opacities.length >= 3, `${minutes}: plates rendered`);
      assert.ok(new Set(opacities).size > 1, `${minutes}: plates are not one flat value`);
      assert.equal(opacities[0], Math.min(...opacities), `${minutes}: dimmest overhead`);
      assert.equal(opacities.at(-1), Math.max(...opacities), `${minutes}: brightest at the far end`);
    }
  });
});
