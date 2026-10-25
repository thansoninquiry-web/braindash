import type { CSSProperties } from "react";
import { starfield } from "../starfield";

/** One fixed sky for the whole session; the seed keeps it identical on reload. */
const STARS = starfield(260, 1600, 1000, 9);

/**
 * The space the dashboard floats in. Static geometry with a slow twinkle on a
 * minority of stars: parallax and drifting dust belong to the core, and a second
 * moving layer behind the text would compete with it. Hidden from assistive tech.
 */
export default function Starfield() {
  return (
    <div className="starfield" aria-hidden="true">
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" focusable="false">
        {STARS.map((star, index) => (
          <circle
            key={index}
            className={star.twinkle ? "is-twinkle" : undefined}
            cx={star.x.toFixed(1)}
            cy={star.y.toFixed(1)}
            r={star.r.toFixed(2)}
            opacity={star.o.toFixed(2)}
            style={
              star.twinkle
                ? ({ "--star-o": star.o, animationDelay: `${(index % 13) * 0.7}s` } as CSSProperties)
                : undefined
            }
          />
        ))}
      </svg>
    </div>
  );
}
