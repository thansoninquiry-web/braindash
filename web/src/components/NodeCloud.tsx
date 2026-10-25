import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import CloudVoid from "./CloudVoid";
import { CLOUD_TITLE_LINES, CLOUD_TITLE_MAX, fitCloudTitle } from "../cloudLabel";
import { cloudTitleMetrics } from "../cloudTitleMetrics";
import {
  ZOOM_STEP,
  cloudFocusIndex,
  cloudKeyAction,
  cursorTargetPath,
  stepCursor,
} from "../cloudCursor";
import {
  GRAPH_PULSE_PERIOD,
  LANDING_HOLD_SECONDS,
  advanceAmbient,
  clampPitch,
  focusNudge,
  focusPitch,
  graphPulse,
  nearestPose,
  pulseFrame,
  settleStep,
  shortestAngle,
  waveFrame,
} from "../cloudMotion";
import { galaxyHaze, galaxyPoint, galaxyStars } from "../galaxy";
import { hallOffset } from "../hallDrift";
import {
  FLARE_SECONDS,
  addedNotePaths,
  flareProgress,
  shouldFlare,
} from "../newNotes";
import type { VaultGraph } from "../types";

export type CloudState = "idle" | "scanning" | "reading" | "error";

interface NodeCloudProps {
  noteCount: number;
  /** Real wikilink/tag graph; falls back to a synthetic cloud while it loads. */
  graph: VaultGraph | null;
  byArea: Record<string, number>;
  focusTitle: string;
  focusCaption: string;
  /** Path of the note currently open in the reader, if any. */
  activePath: string | null;
  /** Drives the state pill row beneath the cloud. */
  state: CloudState;
  /** False paints one still frame — interactive, but not floating. */
  animate: boolean;
  /** Shown as a one-click way out when the sphere is still. */
  onEnableMotion?: () => void;
  onOpenNote: (path: string) => void;
}

const CLOUD_STATES: CloudState[] = ["idle", "scanning", "reading", "error"];

// Theme-driven via CSS variables (see web/src/themes.ts). Every colour the core
// paints — area dots, the spark field, and the untagged fallback — resolves
// through a token, so a theme swap repaints all of it.
const AREA_COLORS: Record<string, string> = {
  career: "var(--node-career)",
  life: "var(--node-life)",
  ideas: "var(--node-ideas)",
  unset: "var(--node-unset)",
};
/**
 * A note is a star, not a bead: a white-hot centre falling off through its area
 * colour to nothing, so it blooms into the dark instead of sitting on it.
 */
const AREA_FILLS: Record<string, string> = {
  career: "url(#node-core-career)",
  life: "url(#node-core-life)",
  ideas: "url(#node-core-ideas)",
  unset: "url(#node-core-unset)",
};
const MAX_NODES = 160;
/** Invisible pointer radius per note, in user units (~13 px on screen). */
const HIT_RADIUS = 15;

/**
 * Galaxy geometry. The viewBox is the frame's own pixel size (measured below),
 * so one unit is one CSS pixel: the disk can always be sized to the room it
 * has instead of being letterboxed inside a fixed 600x460 drawing.
 */
const VIEW = { w: 600, h: 460, cx: 300, cy: 230 };
/** Radius of the disk, not a ball: the core is a spiral seen at an angle. */
const SPHERE_R = 214;
/** Share of the frame width the disk may take; the rest is air around it. */
const DISK_WIDTH_SHARE = 0.5;
/** Vertical room a tilted disk needs: 2·sin(PITCH_LIMIT), plus breathing space. */
const DISK_HEIGHT = 2 * Math.sin(1.15) * 0.93;
const CAMERA = 900;
/** Stars in the dust layer: drawn once, rotated as one group. */
const STAR_COUNT = 9000;
/** Soft blobs of gas under the dust: enough to overlap into a band. */
const HAZE_COUNT = 900;
const YAW_RATE = 0.075; // radians per second: slow enough to click a moving node
/**
 * Resting tilt. A disk needs to be tilted toward the camera to read as a
 * spiral, but only just: near face-on keeps both arms in view and makes the
 * bulge a round core instead of a smear along one axis.
 */
const BASE_PITCH = 0.9;

/* Direct manipulation. Radians per pixel, so a drag feels the same at any size. */
const DRAG_YAW = 0.0065;
const DRAG_PITCH = 0.0048;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.6;
const DRAG_THRESHOLD = 5; // px before a gesture counts as a drag, not a click
/** Most angular speed a release may hand to the settle spring. */
const SETTLE_MAX_VELOCITY = 3;
/** A clamped pitch can stall the spring, so a settle never runs longer than this. */
const SETTLE_MAX_SECONDS = 1.1;
/** Zoom pulled in when a node's cluster is focused. */
const FOCUS_ZOOM = 1.12;
/** How much of the frame is left of the camera easing per tick. */
const FOCUS_EASE = 0.12;
/** A local scan finishes in a frame or two; the ring is held this long so it reads. */
const PULSE_HOLD_MS = 1100;

/** A note the last scan did not have, and the moment its flight began. */
interface NoteFlare {
  path: string;
  /** Seconds on the draw loop's own clock. */
  start: number;
  area: string;
}

interface Particle {
  /** Unit-sphere direction, plus how far out along it the particle sits. */
  ux: number;
  uy: number;
  uz: number;
  rad: number;
  base: number;
  phase: number;
  area: string;
  path: string | null;
  title: string | null;
  /** Notes with no wikilink and no shared tag render dimmer. */
  isolated: boolean;
}

/** Deterministic hash so a rescan does not reshuffle the cloud. */
function hash(i: number): number {
  const value = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Notes are the bright stars of the spiral: one per note, on the arms, with a
 * little radial slack so a small vault still fills the disk.
 */
function notePoint(index: number, count: number): { x: number; y: number; z: number } {
  return galaxyPoint(index, count);
}

/**
 * One particle per note, ordered so that connected notes sit next to each other:
 * a breadth-first walk from the most connected note means neighbours in the index
 * are neighbours on the Fibonacci sphere, which keeps real edges short.
 */
function orderByConnectivity(graph: VaultGraph): VaultGraph["nodes"] {
  const neighbours = new Map<string, string[]>();
  for (const edge of graph.edges) {
    neighbours.set(edge.source, [...(neighbours.get(edge.source) ?? []), edge.target]);
    neighbours.set(edge.target, [...(neighbours.get(edge.target) ?? []), edge.source]);
  }
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const ranked = [...graph.nodes].sort(
    (a, b) => (neighbours.get(b.id)?.length ?? 0) - (neighbours.get(a.id)?.length ?? 0),
  );
  const ordered: VaultGraph["nodes"] = [];
  const seen = new Set<string>();
  for (const start of ranked) {
    if (seen.has(start.id)) continue;
    const queue = [start.id];
    seen.add(start.id);
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) continue;
      const node = byId.get(id);
      if (node) ordered.push(node);
      for (const next of neighbours.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return ordered;
}

/** One particle per note in the graph, so a node is always the note it opens. */
function buildFromGraph(graph: VaultGraph): Particle[] {
  const ordered = orderByConnectivity(graph).slice(0, MAX_NODES);
  const isolated = new Set(graph.isolated);
  return ordered.map((node, index) => {
    const point = notePoint(index, ordered.length);
    const roll = hash(index);
    return {
      ux: point.x,
      uy: point.y,
      uz: point.z,
      // A note sits on the disk with a little slack toward the camera.
      rad: 0.94 + roll * 0.1,
      base: isolated.has(node.id) ? 4.2 + roll : 5.2 + roll * 1.6,
      phase: roll * Math.PI * 2,
      area: node.area ?? "unset",
      path: node.id,
      title: node.title,
      isolated: isolated.has(node.id),
    };
  });
}

/** Placeholder cloud used until the index arrives; nodes open nothing. */
function buildPlaceholder(count: number): Particle[] {
  const capped = Math.min(Math.max(count, 14), MAX_NODES);
  return Array.from({ length: capped }, (_, index) => {
    const point = notePoint(index, capped);
    const roll = hash(index);
    return {
      ux: point.x,
      uy: point.y,
      uz: point.z,
      rad: 0.94 + roll * 0.1,
      base: 5.2 + roll * 1.6,
      phase: roll * Math.PI * 2,
      area: index % 4 === 0 ? "unset" : "ideas",
      path: null,
      title: null,
      isolated: false,
    };
  });
}

export default function NodeCloud({
  noteCount,
  graph,
  byArea,
  focusTitle,
  focusCaption,
  activePath,
  state,
  animate,
  onEnableMotion,
  onOpenNote,
}: NodeCloudProps) {
  const particles = useMemo<Particle[]>(
    () => (graph && graph.nodes.length > 0 ? buildFromGraph(graph) : buildPlaceholder(noteCount)),
    [graph, noteCount],
  );
  /** The dust is not a particle: one static layer, seeded once. */
  const stars = useMemo(() => galaxyStars(STAR_COUNT, 7), []);
  /** Gas under the dust: soft, wide, drawn once with the same transform. */
  const haze = useMemo(() => galaxyHaze(HAZE_COUNT, 5), []);
  const notesCount = particles.length;

  const [hovered, setHovered] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  /** Note-local index chosen by a click: its cluster is lit and the camera eases. */
  const [selected, setSelected] = useState<number | null>(null);
  /** Path behind `selected`, so a rebuilt particle list can keep the focus. */
  const selectedPath = useRef<string | null>(null);
  /** Note the release settle landed on; named until the next interaction. */
  const [settled, setSettled] = useState<number | null>(null);
  const focused = cloudFocusIndex({ hovered, settled, selected, cursor });
  /** The core pulses while a vault scan or a note read is in flight. */
  const scanning = state === "scanning" || state === "reading";
  /** Held on for a moment after `scanning` ends, so a fast scan still registers. */
  const [pulsing, setPulsing] = useState(false);
  const pulseHold = useRef<number | null>(null);

  useEffect(() => {
    if (scanning) {
      if (pulseHold.current !== null) window.clearTimeout(pulseHold.current);
      pulseHold.current = null;
      setPulsing(true);
      return;
    }
    pulseHold.current = window.setTimeout(() => {
      setPulsing(false);
      pulseHold.current = null;
    }, PULSE_HOLD_MS);
  }, [scanning]);

  useEffect(
    () => () => {
      if (pulseHold.current !== null) window.clearTimeout(pulseHold.current);
    },
    [],
  );
  const noteParticles = particles;
  /** Unit directions, the input the settle's nearest-pose search expects. */
  const unitPoints = useMemo(
    () => noteParticles.map((particle) => ({ x: particle.ux, y: particle.uy, z: particle.uz })),
    [noteParticles],
  );
  const activeIndex = useMemo(
    () => noteParticles.findIndex((particle) => particle.path !== null && particle.path === activePath),
    [noteParticles, activePath],
  );
  const interactive = activeIndex !== -1 || noteParticles.some((particle) => particle.path !== null);

  /** Names the note a release lands on, and takes the name back on interaction. */
  const markSettled = useCallback((index: number) => setSettled(index), []);
  const clearSettled = useCallback(() => setSettled(null), []);

  /** The static star disk: its own layer, one CSS transform per frame. */
  const starsRef = useRef<SVGSVGElement | null>(null);
  const nodeRefs = useRef<(SVGCircleElement | null)[]>([]);
  // Invisible companions to each node: the dot is 3–8 px on screen, so the
  // pointer target has to be much bigger than the thing it targets.
  const hitRefs = useRef<(SVGCircleElement | null)[]>([]);
  const edgeRefs = useRef<(SVGLineElement | null)[]>([]);
  /** The expanding ring painted while the core is busy, and its idle heartbeat. */
  const pulseRef = useRef<SVGCircleElement | null>(null);
  /** The galactic bulge, which breathes with the same beat. */
  const coreGlowRef = useRef<SVGEllipseElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  /** The frame, measured so the disk can be sized to the stage it sits in. */
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ ...VIEW, r: SPHERE_R });
  /** The draw loop reads the viewport from a ref, so a resize never re-subscribes. */
  const viewRef = useRef(view);
  viewRef.current = view;
  /** The whole column, measured so the focus title fits its own width. */
  const sectionRef = useRef<HTMLElement | null>(null);
  /** The heading itself, whose computed font and tracking the fit measures. */
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const [labelWidth, setLabelWidth] = useState(0);
  /** Bumped when the font set settles, so a late webfont gets re-measured. */
  const [fontEpoch, setFontEpoch] = useState(0);
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  /** User rotation on top of the idle spin; a released drag eases it to a pose. */
  const spin = useRef({ yaw: 0, pitch: 0 });
  /** Note-local index the camera is easing onto; null when nothing is framed. */
  const focusIndex = useRef<number | null>(null);
  const zoom = useRef({ value: 1, target: 1 });
  /** Zoom to restore when a cluster focus is cleared. */
  const zoomBefore = useRef<number | null>(null);
  const drag = useRef({ active: false, moved: false, x: 0, y: 0, sx: 0, sy: 0, t: 0, vy: 0, vp: 0 });
  /** Last painted time, so a still frame can be repainted at the same pose. */
  const elapsedRef = useRef(0);
  /** Absolute pose a release is springing toward; null when nothing is settling. */
  const settle = useRef<{ yaw: number; pitch: number; elapsed: number } | null>(null);
  const settleVelocity = useRef({ yaw: 0, pitch: 0 });
  const settleFrame = useRef(0);
  /** Ambient time withheld so a landed pose stays readable for a beat. */
  const ambient = useRef({ offset: 0, hold: 0 });
  /** Set when a drag ended; swallows the click the browser fires afterwards. */
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);

  /** Notes new to this scan, each on its one flight from the bulge. */
  const [flares, setFlares] = useState<NoteFlare[]>([]);
  /** Mirror read by the draw loop, which runs outside React's render. */
  const flaresRef = useRef<NoteFlare[]>([]);
  flaresRef.current = flares;
  const flareRefs = useRef<(SVGCircleElement | null)[]>([]);
  const flareTimer = useRef<number | null>(null);
  /** Paths in the last index; null until the first real graph arrives. */
  const knownPaths = useRef<Set<string> | null>(null);

  // A note the scan has just found has no previous position to move from, so it
  // flies out of the bulge instead: the node travels along its own arm while a
  // ring in its area colour expands and fades. Only a handful of arrivals flare;
  // a folder import or a vault switch is a rescan, not a capture.
  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return;
    const paths = particles.map((particle) => particle.path);
    const previous = knownPaths.current;
    knownPaths.current = new Set(paths.filter((path): path is string => path !== null));
    if (!previous || !animate) return;
    const added = addedNotePaths(previous, paths);
    if (!shouldFlare(added)) return;
    const areaByPath = new Map(particles.map((particle) => [particle.path, particle.area]));
    const start = elapsedRef.current;
    setFlares(added.map((path) => ({ path, start, area: areaByPath.get(path) ?? "unset" })));
    if (flareTimer.current !== null) window.clearTimeout(flareTimer.current);
    flareTimer.current = window.setTimeout(() => {
      setFlares([]);
      flareTimer.current = null;
    }, (FLARE_SECONDS + 0.35) * 1000);
  }, [particles, graph, animate]);

  useEffect(
    () => () => {
      if (flareTimer.current !== null) window.clearTimeout(flareTimer.current);
    },
    [],
  );

  /** Real edges only: a line exists because a link or a shared tag exists. */
  const edges = useMemo(() => {
    if (!graph || particles.length === 0) return [];
    const indexById = new Map<string, number>();
    particles.forEach((particle, index) => {
      if (particle.path) indexById.set(particle.path, index);
    });
    const links: { from: number; to: number; type: string }[] = [];
    for (const edge of graph.edges) {
      const from = indexById.get(edge.source);
      const to = indexById.get(edge.target);
      if (from === undefined || to === undefined || from === to) continue;
      links.push({ from, to, type: edge.type });
    }
    return links;
  }, [particles, graph]);

  /** Local-index neighbour sets, derived from the edges actually drawn. */
  const neighbours = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const link of edges) {
      const from = link.from;
      const to = link.to;
      const a = map.get(from) ?? new Set<number>();
      const b = map.get(to) ?? new Set<number>();
      a.add(to);
      b.add(from);
      map.set(from, a);
      map.set(to, b);
    }
    return map;
  }, [edges]);

  // Frame loop reads interaction state from a ref so it never re-subscribes.
  const stateRef = useRef({
    hovered,
    cursor,
    activeIndex,
    selected,
    scanning: scanning || pulsing,
    motion: animate,
    neighbours,
  });
  stateRef.current = {
    hovered,
    cursor,
    activeIndex,
    selected,
    scanning: scanning || pulsing,
    motion: animate,
    neighbours,
  };

  /** Writes one frame of the sphere: rotate, project, then set SVG attributes. */
  const draw = useCallback(
    (elapsed: number) => {
      const {
        hovered: hover,
        cursor: keyCursor,
        activeIndex: current,
        selected: chosen,
        scanning: busy,
        motion,
        neighbours: linksByNote,
      } = stateRef.current;
      const focus = hover ?? chosen ?? keyCursor;
      const yaw = elapsed * YAW_RATE + pointer.current.x * 0.55 + spin.current.yaw;
      const pitch =
        BASE_PITCH +
        Math.sin(elapsed * 0.23) * 0.07 +
        pointer.current.y * 0.35 +
        spin.current.pitch;
      // Sparks take a fraction of the note layer's yaw and tilt, so the same
      // pointer move and drift slide them less: the depth cue of a farther layer.
      const zoomValue = zoom.current.value;
      const { cx, cy, r: radius } = viewRef.current;
      // The ring only animates when motion is allowed: a frozen half-faded
      // circle would read as a rendering glitch, not a scan. When the core is
      // idle the same ring becomes its heartbeat at a lower alpha, so the graph
      // keeps pulsing without ever competing with a real scan.
      const pulse = busy && motion ? pulseFrame(elapsed) : null;
      // Idle is a wave crossing the disk, not a scan ring opening at the rim.
      const heartbeatRing = !pulse && motion ? waveFrame(elapsed, GRAPH_PULSE_PERIOD) : null;
      const breathe = pulse ? 1 + 0.05 * Math.sin(elapsed * 6) : 1;
      const cluster =
        chosen === null ? null : new Set([chosen, ...(linksByNote.get(chosen) ?? [])]);

      const ring = pulseRef.current;
      if (ring) {
        if (pulse) {
          ring.setAttribute("r", (radius * pulse.radius * zoomValue).toFixed(1));
          ring.setAttribute("opacity", pulse.opacity.toFixed(3));
        } else if (heartbeatRing) {
          ring.setAttribute("r", (radius * heartbeatRing.radius * zoomValue).toFixed(1));
          ring.setAttribute("opacity", heartbeatRing.opacity.toFixed(3));
        } else {
          ring.setAttribute("opacity", "0");
        }
      }

      // The bulge breathes on a slow sine, in step with the ring: the galaxy
      // has a pulse even when every node is holding still.
      const core = coreGlowRef.current;
      if (core) {
        const beat = motion ? Math.sin(elapsed * 0.8) : 0;
        core.setAttribute("rx", (radius * 0.3 * (1 + beat * 0.07)).toFixed(1));
        core.setAttribute("ry", (radius * 0.26 * (1 + beat * 0.07)).toFixed(1));
        core.setAttribute("opacity", (0.85 + beat * 0.15).toFixed(3));
      }
      // Dots grow with the zoom, but slower than the spread between them.
      const zoomRadius = Math.sqrt(zoomValue);
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const projected: {
        x: number;
        y: number;
        depth: number;
        scale: number;
        pulse: number;
        spark: number;
      }[] = [];

      // A newly found note starts at the bulge and flies out to its slot, so it
      // enters along its own arm rather than popping into place. Its `spark`
      // decays over the same arc and both the dot and its ring use it.
      const flareByPath = new Map(flaresRef.current.map((flare) => [flare.path, flare]));
      const pathIndex = new Map<string, number>();

      // The hall drifts a few pixels opposite the sphere, on the same eased
      // pointer value, so the room reads as depth behind the disk instead of a
      // backdrop glued to it. With motion off it returns to its resting frame.
      const frame = frameRef.current;
      if (frame) {
        const drift = motion ? hallOffset(pointer.current.x, pointer.current.y) : hallOffset(0, 0);
        frame.style.setProperty("--hall-x", `${drift.x.toFixed(2)}px`);
        frame.style.setProperty("--hall-y", `${drift.y.toFixed(2)}px`);
      }

      // The star disk is its own composited layer: one CSS transform per frame
      // spins and squashes it, so a few thousand stars never repaint the notes.
      const stars = starsRef.current;
      if (stars) {
        const tilt = Math.max(0.24, Math.abs(Math.sin(pitch)));
        stars.style.transform = `scale(${zoomValue.toFixed(4)}, ${(zoomValue * tilt).toFixed(4)}) rotate(${((yaw * 180) / Math.PI).toFixed(2)}deg)`;
      }

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        if (!particle) continue;
        if (particle.path) pathIndex.set(particle.path, index);
        const flare = particle.path ? flareByPath.get(particle.path) : undefined;
        const flight = flare && motion ? flareProgress(flare.start, elapsed) : null;
        // Scaling the disk coordinates pulls the note in to the core without
        // changing its angle, so the journey runs along its assigned arm.
        const travel = flight ? flight.eased : 1;
        const x = particle.ux * particle.rad * travel;
        const y = particle.uy * particle.rad * travel;
        const z = particle.uz * particle.rad * travel;

        const rx = x * cosY - z * sinY;
        const rz = x * sinY + z * cosY;
        const ry = y * cosP - rz * sinP;
        const depth = y * sinP + rz * cosP;

        const scale = CAMERA / (CAMERA - depth * radius);
        // Each note drifts a little of its own, slower than the disk's rotation,
        // so the spiral reads as a living field rather than a rotating decal.
        const bob = Math.sin(elapsed * 0.62 + particle.phase) * 2.6;
        const sway = Math.cos(elapsed * 0.41 + particle.phase * 1.7) * 1.4;
        // A crest travels out from the bulge; each note's phase keeps notes at
        // the same radius from blinking in unison.
        const beat = motion ? graphPulse(elapsed, particle.phase, particle.rad) : 0;
        projected.push({
          x: cx + rx * radius * scale * zoomValue + sway,
          y: cy + ry * radius * scale * zoomValue + bob,
          depth,
          scale,
          pulse: beat,
          spark: flight?.spark ?? 0,
        });
      }

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        const point = projected[index];
        if (!particle || !point) continue;
        const closeness = (point.depth + 1) / 2; // 1 = nearest the camera
        const element = nodeRefs.current[index];
        if (!element) continue;

        const localIndex = index;
        const isFocus = focus === localIndex;
        const isActive = current === localIndex;
        const isChosen = chosen === localIndex;
        const inCluster = cluster?.has(localIndex) ?? false;
        const lift = isFocus ? 2.4 : isChosen ? 2 : inCluster ? 1.6 : isActive ? 1.4 : 0;
        // The heartbeat lifts a note's radius and opacity as its crest arrives,
        // never shrinking it below its resting size.
        const crest = Math.max(0, point.pulse);
        // A new note is brighter and larger while its flare is still fresh.
        const spark = point.spark;
        element.setAttribute("cx", point.x.toFixed(1));
        element.setAttribute("cy", point.y.toFixed(1));
        element.setAttribute(
          "r",
          (
            (particle.base * (0.72 + closeness * 0.55) + lift) *
            zoomRadius *
            breathe *
            (1 + crest * 0.22) *
            (1 + spark * 2.2)
          ).toFixed(2),
        );
        // Notes with no wikilink and no shared tag stay visible but dim; when one
        // cluster is chosen everything outside it fades back.
        const baseOpacity = (0.42 + closeness * 0.5) * (particle.isolated ? 0.45 : 1);
        const dim = chosen === null || inCluster ? 1 : 0.26;
        element.setAttribute(
          "opacity",
          (
            isFocus || isActive
              ? 1
              : Math.min(1, baseOpacity * dim * (1 + crest * 0.52) + spark * 0.9)
          ).toFixed(2),
        );
        element.setAttribute(
          "stroke-width",
          isChosen ? "2" : isActive || isFocus ? "1.4" : "0",
        );

        const hit = hitRefs.current[localIndex];
        if (hit) {
          hit.setAttribute("cx", point.x.toFixed(1));
          hit.setAttribute("cy", point.y.toFixed(1));
        }
      }

      // The expanding ring around each new note, in its arm's colour.
      flaresRef.current.forEach((flare, flareIndex) => {
        const ring = flareRefs.current[flareIndex];
        if (!ring) return;
        const index = pathIndex.get(flare.path);
        if (index === undefined) {
          ring.setAttribute("opacity", "0");
          return;
        }
        const point = projected[index];
        const particle = particles[index];
        if (!point || !particle) {
          ring.setAttribute("opacity", "0");
          return;
        }
        const { eased, spark } = flareProgress(flare.start, elapsed);
        ring.setAttribute("cx", point.x.toFixed(1));
        ring.setAttribute("cy", point.y.toFixed(1));
        ring.setAttribute(
          "r",
          (particle.base * (0.9 + eased * 3.6) * zoomRadius).toFixed(2),
        );
        ring.setAttribute("stroke-width", (0.8 + spark * 1.8).toFixed(2));
        ring.setAttribute("opacity", (spark * 0.7).toFixed(3));
      });

      edges.forEach((link, linkIndex) => {
        const line = edgeRefs.current[linkIndex];
        const from = projected[link.from];
        const to = projected[link.to];
        if (!line || !from || !to) return;
        line.setAttribute("x1", from.x.toFixed(1));
        line.setAttribute("y1", from.y.toFixed(1));
        line.setAttribute("x2", to.x.toFixed(1));
        line.setAttribute("y2", to.y.toFixed(1));
        const touched = focus !== null && (link.from === focus || link.to === focus);
        const lit = cluster !== null && cluster.has(link.from) && cluster.has(link.to);
        const opacity = lit ? 0.55 : touched ? 0.5 : cluster !== null ? 0.04 : 0.12;
        // A faint shimmer runs along the links while nothing is selected, so the
        // connections read as live rather than ruling.
        const shimmer =
          motion && cluster === null ? Math.max(0, Math.sin(elapsed * 1.1 + linkIndex * 0.9)) * 0.06 : 0;
        line.setAttribute("opacity", Math.min(1, opacity + shimmer).toFixed(2));
      });
    },
    [particles, edges],
  );

  /** Paints a frame and remembers its time, so still mode can repaint the same pose. */
  const drawFrame = useCallback(
    (elapsed: number) => {
      elapsedRef.current = elapsed;
      draw(elapsed);
    },
    [draw],
  );

  /**
   * Drops a clicked cluster and restores its zoom without touching the settled
   * label, so a landing can take the camera over without two names disagreeing.
   */
  const dropSelection = useCallback(() => {
    if (selected === null) return;
    selectedPath.current = null;
    setSelected(null);
    focusIndex.current = null;
    const z = zoom.current;
    if (zoomBefore.current !== null) {
      z.target = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomBefore.current));
      zoomBefore.current = null;
    }
    if (!animate) {
      z.value = z.target;
      drawFrame(elapsedRef.current);
    }
  }, [animate, drawFrame, selected]);

  /**
   * Advances the release settle by `dt`. The target is fixed at a note-facing
   * pose, but the error is recomputed from the live camera, so idle drift and
   * pointer parallax are compensated rather than fought. Returns true while the
   * spring is still moving.
   */
  const advanceSettle = useCallback((dt: number, seconds: number) => {
    const target = settle.current;
    if (!target) return false;
    const poseYaw = seconds * YAW_RATE + pointer.current.x * 0.55 + spin.current.yaw;
    const posePitch =
      BASE_PITCH +
      Math.sin(seconds * 0.23) * 0.07 +
      pointer.current.y * 0.35 +
      spin.current.pitch;

    const yawError = shortestAngle(poseYaw, target.yaw);
    const yawStep = settleStep(yawError, settleVelocity.current.yaw, dt);
    spin.current.yaw += yawError - yawStep.remaining;
    settleVelocity.current.yaw = yawStep.closing;

    const pitchError = target.pitch - posePitch;
    const pitchStep = settleStep(pitchError, settleVelocity.current.pitch, dt);
    spin.current.pitch = clampPitch(spin.current.pitch + pitchError - pitchStep.remaining);
    settleVelocity.current.pitch = pitchStep.closing;

    target.elapsed += dt;
    if ((yawStep.done && pitchStep.done) || target.elapsed >= SETTLE_MAX_SECONDS) {
      settle.current = null;
      settleVelocity.current = { yaw: 0, pitch: 0 };
      return false;
    }
    return true;
  }, []);

  /** With motion paused the main loop is not running, so settle on its own frames. */
  const startSettleFrames = useCallback(() => {
    window.cancelAnimationFrame(settleFrame.current);
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      const moving = advanceSettle(dt, elapsedRef.current);
      drawFrame(elapsedRef.current);
      if (moving) settleFrame.current = window.requestAnimationFrame(step);
    };
    settleFrame.current = window.requestAnimationFrame(step);
  }, [advanceSettle, drawFrame]);

  // Paint the first frame before the browser shows anything, then animate.
  useLayoutEffect(() => {
    // A new loop restarts its own clock, so a hold from the old one would only
    // leave the drawn time behind zero.
    ambient.current = { offset: 0, hold: 0 };
    clearSettled();
    drawFrame(0);
    if (!animate) return;

    let frame = 0;
    let start = 0;
    let previous = 0;
    const tick = (now: number) => {
      if (start === 0) start = now;
      if (previous === 0) previous = now;
      const dt = Math.min(64, now - previous) / 1000;
      previous = now;
      const ambientStep = advanceAmbient(ambient.current, (now - start) / 1000, dt);
      ambient.current = ambientStep.clock;
      const seconds = ambientStep.seconds;
      const next = pointer.current;
      // Ease toward the pointer for a parallax tilt instead of a jump.
      next.x += (next.tx - next.x) * 0.045;
      next.y += (next.ty - next.y) * 0.045;
      // Smooth wheel steps into a zoom instead of snapping.
      const z = zoom.current;
      z.value += (z.target - z.value) * 0.18;
      // A release springs the camera onto the nearest note-facing pose, then
      // holds that landing still for a beat so the note can be read.
      if (settle.current) {
        advanceSettle(dt, seconds);
        if (!settle.current) ambient.current = { ...ambient.current, hold: LANDING_HOLD_SECONDS };
      }
      // A click eases the camera until the chosen note faces front. The residual
      // is recomputed every frame, so pointer parallax and the idle drift are
      // compensated instead of fought.
      const framed = focusIndex.current;
      const particle = framed === null ? undefined : particles[framed];
      if (framed !== null && particle) {
        const pose = {
          yaw: seconds * YAW_RATE + pointer.current.x * 0.55 + spin.current.yaw,
          pitch:
            BASE_PITCH +
            Math.sin(seconds * 0.23) * 0.07 +
            pointer.current.y * 0.35 +
            spin.current.pitch,
        };
        const point = { x: particle.ux, y: particle.uy, z: particle.uz };
        const nudge = focusNudge(point, pose.yaw, pose.pitch);
        // The disk keeps its tilt: only the yaw turns the note to the front.
        const dPitch = focusPitch(point.x, point.y, point.z) - pose.pitch;
        spin.current.yaw += nudge.dYaw * FOCUS_EASE;
        spin.current.pitch = clampPitch(spin.current.pitch + dPitch * FOCUS_EASE);
        if (Math.abs(nudge.dYaw) < 0.002 && Math.abs(dPitch) < 0.002) focusIndex.current = null;
      }
      drawFrame(seconds);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [advanceSettle, clearSettled, drawFrame, animate]);

  // A still sphere must still answer the pointer: repaint on hover/cursor changes
  // instead of waiting for a frame that will never come.
  useEffect(() => {
    if (animate) return;
    drawFrame(elapsedRef.current);
  }, [animate, drawFrame, hovered, cursor, selected, state, pulsing, view]);

  // The disk is sized to its stage rather than to a fixed drawing: a wide
  // window gets a wide galaxy instead of a small one floating in black.
  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const measure = () => {
      const w = Math.max(320, element.clientWidth);
      const h = Math.max(260, element.clientHeight);
      const r = Math.min(w * DISK_WIDTH_SHARE, h / DISK_HEIGHT);
      setView((previous) =>
        Math.abs(previous.w - w) < 1 &&
        Math.abs(previous.h - h) < 1 &&
        Math.abs(previous.r - r) < 1
          ? previous
          : { w, h, cx: w / 2, cy: h / 2, r },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The caption under the sphere is as wide as this column, and that width is
  // what a hovered title has to fit into. Watching the element covers window
  // resizes, the responsive breakpoints and the side rails changing size.
  useEffect(() => {
    const element = sectionRef.current;
    if (!element) return;
    setLabelWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      setLabelWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Canvas measures the font it can see, so a webfont that arrives after the
  // first paint would otherwise keep the fallback's fit for the whole session.
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let live = true;
    const remeasure = () => {
      if (live) setFontEpoch((epoch) => epoch + 1);
    };
    fonts.ready.then(remeasure, () => {});
    fonts.addEventListener("loadingdone", remeasure);
    return () => {
      live = false;
      fonts.removeEventListener("loadingdone", remeasure);
    };
  }, []);

  // A rebuild (a vault refresh, or a rescan) renumbers every node, so the index
  // behind a focused cluster goes stale. The note it belonged to usually survived,
  // so follow it to its new index instead of dropping the user's focus. The
  // camera is left where it is: the layout changed, and re-framing on top of that
  // would read as a jump.
  useEffect(() => {
    const path = selectedPath.current;
    const index =
      path === null ? -1 : noteParticles.findIndex((particle) => particle.path === path);
    if (index === -1) selectedPath.current = null;
    setSelected(index === -1 ? null : index);
    focusIndex.current = null;
    zoomBefore.current = null;
    settle.current = null;
    settleVelocity.current = { yaw: 0, pitch: 0 };
    clearSettled();
  }, [clearSettled, particles, noteParticles]);

  useEffect(() => () => window.cancelAnimationFrame(settleFrame.current), []);

  const nudgeZoom = useCallback(
    (factor: number) => {
      const z = zoom.current;
      z.target = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z.target * factor));
      if (!animate) {
        z.value = z.target;
        drawFrame(elapsedRef.current);
      }
    },
    [animate, drawFrame],
  );

  // Native listener: the wheel handler must be able to preventDefault, which a
  // passive React handler may not.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      nudgeZoom(Math.exp(-event.deltaY * 0.0016));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [nudgeZoom]);

  /** Pointer over the core: parallax tilt, or a drag when one is in progress. */
  const trackPointer = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;

      const d = drag.current;
      if (d.active) {
        const now = performance.now();
        const dt = Math.max(1, now - d.t);
        const dx = event.clientX - d.x;
        const dy = event.clientY - d.y;
        d.t = now;
        d.x = event.clientX;
        d.y = event.clientY;
        if (
          !d.moved &&
          Math.abs(event.clientX - d.sx) + Math.abs(event.clientY - d.sy) > DRAG_THRESHOLD
        ) {
          d.moved = true;
          // A drag, not a stale hover, decides what the label names.
          setHovered(null);
          // Capture only once the gesture is a drag. Capturing on pointerdown
          // retargets the following `click` to the SVG, so a plain press on a
          // node would never reach the node's own click handler.
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Synthetic pointers cannot be captured; dragging still works.
          }
        }
        spin.current.yaw += dx * DRAG_YAW;
        spin.current.pitch = clampPitch(spin.current.pitch + dy * DRAG_PITCH);
        // Radians per second, for the coast after release.
        d.vy = (dx * DRAG_YAW) / (dt / 1000);
        d.vp = (dy * DRAG_PITCH) / (dt / 1000);
        if (!animate) drawFrame(elapsedRef.current);
        return; // no parallax while dragging: two inputs fighting feels wrong
      }

      pointer.current.tx = ((event.clientX - box.left) / box.width) * 2 - 1;
      pointer.current.ty = ((event.clientY - box.top) / box.height) * 2 - 1;
    },
    [animate, drawFrame],
  );

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    window.cancelAnimationFrame(settleFrame.current);
    // A drag takes the camera over from any settle or click-to-focus easing.
    settle.current = null;
    settleVelocity.current = { yaw: 0, pitch: 0 };
    ambient.current = { ...ambient.current, hold: 0 };
    clearSettled();
    focusIndex.current = null;
    suppressClick.current = false;
    drag.current = {
      active: true,
      moved: false,
      x: event.clientX,
      y: event.clientY,
      sx: event.clientX,
      sy: event.clientY,
      t: performance.now(),
      vy: 0,
      vp: 0,
    };
    setDragging(true);
  }

  /**
   * Ends the gesture: a drag settles onto the nearest note, a plain press is left
   * alone for its click. The release velocity seeds the spring, so a flick still
   * carries before landing instead of stopping dead.
   */
  const endDrag = useCallback(() => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    setDragging(false);
    suppressClick.current = d.moved;
    if (!d.moved) return;

    const seconds = elapsedRef.current;
    const target = nearestPose(
      unitPoints,
      seconds * YAW_RATE + pointer.current.x * 0.55 + spin.current.yaw,
      BASE_PITCH + Math.sin(seconds * 0.23) * 0.07 + pointer.current.y * 0.35 + spin.current.pitch,
    );
    if (!target) return;
    markSettled(target.index);
    setHovered(null);
    dropSelection();
    const landed = unitPoints[target.index];
    settle.current = {
      yaw: target.yaw,
      // Released or clicked, the landing keeps enough tilt to stay a galaxy.
      pitch: landed ? focusPitch(landed.x, landed.y, landed.z) : target.pitch,
      elapsed: 0,
    };
    settleVelocity.current = {
      yaw: Math.max(-SETTLE_MAX_VELOCITY, Math.min(SETTLE_MAX_VELOCITY, d.vy)),
      pitch: Math.max(-SETTLE_MAX_VELOCITY, Math.min(SETTLE_MAX_VELOCITY, d.vp)),
    };
    if (!animate) startSettleFrames();
  }, [animate, dropSelection, markSettled, startSettleFrames, unitPoints]);

  // Releases are watched on the window so a pointerup outside the sphere still
  // ends the gesture, and alt-tabbing mid-drag abandons it instead of leaving
  // the sphere stuck in its dragging state.
  useEffect(() => {
    const abandon = () => {
      if (!drag.current.active) return;
      drag.current.active = false;
      drag.current.moved = false;
      setDragging(false);
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("blur", abandon);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("blur", abandon);
    };
  }, [endDrag]);

  /** A drag that ended over a node must rotate, not open that node. */
  function takeClick(): boolean {
    if (!suppressClick.current) return true;
    suppressClick.current = false;
    return false;
  }

  const focusParticle = focused === null ? null : (particles[focused] ?? null);
  const label = focusParticle?.title ?? (focused === null ? null : "Unlinked spark");
  const settledFocus = settled !== null && hovered === null && focused === settled;
  const caption = focusParticle?.path
    ? settledFocus
      ? `Settled · ${focusParticle.path}`
      : focusParticle.path
    : focused === null
      ? null
      : "Not in the vault index";
  const selectedParticle = selected === null ? null : (particles[selected] ?? null);
  // A long note name steps down instead of wrapping past the reserved slot.
  const focusLabel = label ?? focusTitle;
  // Fit against the heading's own font, tracking and text-transform, measured
  // once it is in the document. Before that (or without a canvas) paint at the
  // CSS cap and let the next render settle on a real size.
  const focusFit = useMemo(() => {
    const metrics = titleRef.current ? cloudTitleMetrics(titleRef.current) : null;
    if (!metrics) {
      return { fontSize: CLOUD_TITLE_MAX, lines: CLOUD_TITLE_LINES, clipped: false };
    }
    return fitCloudTitle(focusLabel, labelWidth, metrics);
  }, [focusLabel, labelWidth, fontEpoch]);

  /** Eases the camera until the clicked note faces front, and lights its cluster. */
  function focusNode(index: number) {
    const particle = particles[index];
    if (!particle) return;
    clearSettled();
    window.cancelAnimationFrame(settleFrame.current);
    settle.current = null;
    settleVelocity.current = { yaw: 0, pitch: 0 };

    // Where the node sits right now: idle spin + parallax + previous drags.
    const yaw = elapsedRef.current * YAW_RATE + pointer.current.x * 0.55 + spin.current.yaw;
    const pitch =
      BASE_PITCH +
      Math.sin(elapsedRef.current * 0.23) * 0.07 +
      pointer.current.y * 0.35 +
      spin.current.pitch;
    const framed = { x: particle.ux, y: particle.uy, z: particle.uz };

    const z = zoom.current;
    if (selected === null) zoomBefore.current = z.target;
    z.target = Math.min(ZOOM_MAX, Math.max(z.target, FOCUS_ZOOM));
    selectedPath.current = particle.path;
    setSelected(index);

    if (animate) {
      focusIndex.current = index;
      return;
    }
    // Still mode: no tween, but the camera still arrives at the focus pose.
    const nudge = focusNudge(framed, yaw, pitch);
    spin.current.yaw += nudge.dYaw;
    spin.current.pitch = clampPitch(
      spin.current.pitch + focusPitch(framed.x, framed.y, framed.z) - pitch,
    );
    z.value = z.target;
    drawFrame(elapsedRef.current);
  }

  /** Drops the focus highlight and restores the zoom it pulled in. */
  function clearSelection() {
    clearSettled();
    dropSelection();
  }

  /** First click focuses a cluster; a second click on the same note opens it. */
  function handleNodeClick(index: number, path: string | null) {
    if (!takeClick()) return;
    if (!path) return;
    if (selected === index) {
      onOpenNote(path);
      return;
    }
    focusNode(index);
  }

  /** Clicking empty space lets the cluster go. */
  function onBackdropClick() {
    if (!takeClick()) return;
    clearSelection();
  }

  function resetView() {
    window.cancelAnimationFrame(settleFrame.current);
    settle.current = null;
    settleVelocity.current = { yaw: 0, pitch: 0 };
    ambient.current = { ...ambient.current, hold: 0 };
    clearSettled();
    spin.current = { yaw: 0, pitch: 0 };
    zoom.current = { value: 1, target: 1 };
    if (!animate) drawFrame(elapsedRef.current);
  }

  function step(delta: 1 | -1) {
    if (notesCount === 0) return;
    // Arrow keys are deliberate: let the keyboard cursor win over a resting hover.
    setHovered(null);
    setCursor(stepCursor(cursor, delta, notesCount));
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    const action = cloudKeyAction(event.key);
    if (!action) return;

    if (action.type === "move") {
      event.preventDefault();
      // Walking the keyboard cursor hands the highlight back from a clicked cluster.
      clearSelection();
      step(action.delta);
    } else if (action.type === "open") {
      // A spark with no note in the index must not swallow Enter.
      const path = cursorTargetPath(selected ?? cursor, (index) => particles[index]?.path);
      if (!path) return;
      event.preventDefault();
      onOpenNote(path);
    } else if (action.type === "zoom") {
      event.preventDefault();
      nudgeZoom(action.direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP);
    } else if (action.type === "reset") {
      event.preventDefault();
      resetView();
    } else if (action.type === "clear") {
      setCursor(null);
      clearSelection();
    }
  }

  return (
    <section ref={sectionRef} className="cloud" aria-label="Vault node cloud">
      <div className="cloud-frame" ref={frameRef}>
        {/* The room first: every layer above it is allowed to move more. */}
        <CloudVoid />
        {/* The star disk lives in its own SVG so the browser can composite it:
            one CSS transform per frame instead of repainting thousands of
            circles, and the notes' attribute writes never touch it. */}
        <svg
          ref={starsRef}
          className="cloud-stars"
          viewBox={`0 0 ${view.w.toFixed(0)} ${view.h.toFixed(0)}`}
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            {/* A rare foreground star: its own soft bloom, no filter pass. */}
            <radialGradient id="star-bloom" cx="50%" cy="50%" r="50%">
              <stop offset="0%" style={{ stopColor: "var(--star)" }} stopOpacity="1" />
              <stop offset="35%" style={{ stopColor: "var(--accent-bright)" }} stopOpacity="0.45" />
              <stop offset="100%" style={{ stopColor: "var(--accent)" }} stopOpacity="0" />
            </radialGradient>
            {/* One arm of gas: a wide, almost invisible falloff that overlaps its
                neighbours into a continuous band. */}
            <radialGradient id="star-haze" cx="50%" cy="50%" r="50%">
              <stop offset="0%" style={{ stopColor: "var(--accent-bright)" }} stopOpacity="0.9" />
              <stop offset="45%" style={{ stopColor: "var(--accent)" }} stopOpacity="0.22" />
              <stop offset="100%" style={{ stopColor: "var(--accent)" }} stopOpacity="0" />
            </radialGradient>
          </defs>
          <g transform={`translate(${view.cx.toFixed(1)} ${view.cy.toFixed(1)}) scale(${view.r.toFixed(1)})`}>
            {haze.map((blob, index) => (
              <circle
                key={`haze-${index}`}
                className="is-haze"
                cx={blob.x.toFixed(3)}
                cy={blob.y.toFixed(3)}
                r={blob.r.toFixed(4)}
                opacity={blob.o.toFixed(3)}
                fill="url(#star-haze)"
              />
            ))}
            {stars.map((star, index) => (
              <circle
                key={index}
                cx={star.x.toFixed(3)}
                cy={star.y.toFixed(3)}
                r={(star.r * (star.bright ? 0.018 : 0.015)).toFixed(4)}
                opacity={(star.bright ? 0.95 : star.o).toFixed(2)}
                fill={star.bright ? "url(#star-bloom)" : undefined}
              />
            ))}
          </g>
        </svg>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${view.w.toFixed(0)} ${view.h.toFixed(0)}`}
          className={`cloud-svg${dragging ? " is-dragging" : ""}`}
          role="img"
          aria-label={
            interactive
              ? `${noteCount} notes floating in the vault core. Drag to spin, scroll to zoom; releasing settles on the nearest note. Click a node to focus its cluster, click it again to open the note. Tab in, arrow keys move, Enter opens the focused note.`
              : `${noteCount} notes floating in the vault core. Drag to spin, scroll to zoom; releasing settles on the nearest note.`
          }
          tabIndex={interactive ? 0 : -1}
          onKeyDown={onKeyDown}
          onBlur={() => setCursor(null)}
          onClick={(event) => {
            // Nodes handle their own clicks; anywhere else lets the focus go.
            if ((event.target as Element).closest?.(".cloud-node, .cloud-hit")) return;
            onBackdropClick();
          }}
          onPointerDown={onPointerDown}
          onPointerMove={trackPointer}
          onPointerLeave={() => {
            pointer.current.tx = 0;
            pointer.current.ty = 0;
            setHovered(null);
          }}
        >
          <defs>
            <radialGradient id="cloud-halo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" style={{ stopColor: "var(--accent-bright)" }} stopOpacity="0.16" />
              <stop offset="45%" style={{ stopColor: "var(--accent)" }} stopOpacity="0.06" />
              <stop offset="100%" style={{ stopColor: "var(--accent)" }} stopOpacity="0" />
            </radialGradient>
            {/* The galactic bulge: a hot middle the arms wind out of. */}
            <radialGradient id="cloud-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" style={{ stopColor: "var(--star)" }} stopOpacity="0.95" />
              <stop offset="22%" style={{ stopColor: "var(--star)" }} stopOpacity="0.42" />
              <stop offset="52%" style={{ stopColor: "var(--accent-bright)" }} stopOpacity="0.2" />
              <stop offset="100%" style={{ stopColor: "var(--accent)" }} stopOpacity="0" />
            </radialGradient>
            {/* A wide, cool wash so the arms sit in gas instead of on black. */}
            <radialGradient id="cloud-nebula" cx="50%" cy="50%" r="50%">
              <stop offset="0%" style={{ stopColor: "var(--accent-bright)" }} stopOpacity="0.1" />
              <stop offset="58%" style={{ stopColor: "var(--accent)" }} stopOpacity="0.035" />
              <stop offset="100%" style={{ stopColor: "var(--accent)" }} stopOpacity="0" />
            </radialGradient>
            {/* Notes are stars too: white core, area colour, transparent rim.
                The halo is baked into the gradient instead of a `feGaussianBlur`
                on the moving group, which had to re-blur every node every frame. */}
            {(["career", "life", "ideas", "unset"] as const).map((area) => (
              <radialGradient key={area} id={`node-core-${area}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                <stop offset="16%" stopColor="#ffffff" stopOpacity="0.55" />
                <stop offset="38%" style={{ stopColor: AREA_COLORS[area] }} stopOpacity="0.75" />
                <stop offset="70%" style={{ stopColor: AREA_COLORS[area] }} stopOpacity="0.2" />
                <stop offset="100%" style={{ stopColor: AREA_COLORS[area] }} stopOpacity="0" />
              </radialGradient>
            ))}
          </defs>

          <rect x="0" y="0" width={view.w} height={view.h} fill="url(#cloud-halo)" />

          {/* Gas first, then dust, then the hot middle: the order light has. */}
          <ellipse
            className="cloud-nebula"
            cx={view.cx}
            cy={view.cy}
            rx={view.r * 1.12}
            ry={view.r * 1.02}
            fill="url(#cloud-nebula)"
          />



          <ellipse
            ref={coreGlowRef}
            className="cloud-core-glow"
            cx={view.cx}
            cy={view.cy}
            rx={view.r * 0.3}
            ry={view.r * 0.26}
            fill="url(#cloud-core)"
          />

          {/* Busy core: one ring expands and fades each period while scanning. */}
          <circle
            ref={pulseRef}
            className="cloud-pulse"
            cx={view.cx}
            cy={view.cy}
            r={view.r}
            fill="none"
            stroke="var(--accent-bright)"
            strokeWidth={1.2}
            opacity={0}
          />

          {/* Pointer targets, drawn under the dots: a 3–8 px dot is not a
              clickable surface, so each note gets a generous invisible disc. */}
          <g aria-hidden="true">
            {particles.map((particle, index) => (
              <circle
                key={`hit-${particle.path ?? index}`}
                ref={(element) => {
                  hitRefs.current[index] = element;
                }}
                className={particle.path ? "cloud-hit is-openable" : "cloud-hit"}
                cx={view.cx}
                cy={view.cy}
                r={HIT_RADIUS}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => handleNodeClick(index, particle.path)}
              />
            ))}
          </g>

          <g aria-hidden="true">
            {edges.map((link, index) => (
              <line
                key={`${link.from}-${link.to}-${link.type}`}
                className={`cloud-edge is-${link.type}`}
                ref={(element) => {
                  edgeRefs.current[index] = element;
                }}
                opacity={0.12}
              />
            ))}
          </g>

          <g>
            {particles.map((particle, index) => (
              <circle
                key={particle.path ?? `placeholder-${index}`}
                ref={(element) => {
                  nodeRefs.current[index] = element;
                }}
                className={particle.path ? "cloud-node is-openable" : "cloud-node"}
                style={{
                  fill: AREA_FILLS[particle.area] ?? AREA_FILLS.unset,
                  stroke: "var(--accent-bright)",
                }}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => handleNodeClick(index, particle.path)}
              />
            ))}
          </g>

          {/* Arrival rings for the notes this scan just found. Their radius and
              opacity are written by the draw loop; the colour comes from the
              note's area, so the flare belongs to its arm. */}
          <g aria-hidden="true">
            {flares.map((flare, index) => (
              <circle
                key={`flare-${flare.path}-${flare.start}`}
                ref={(element) => {
                  flareRefs.current[index] = element;
                }}
                className="cloud-flare"
                style={{ stroke: AREA_COLORS[flare.area] ?? AREA_COLORS.unset }}
                opacity={0}
              />
            ))}
          </g>
        </svg>
        <div className="cloud-corners" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="cloud-focus">
        <h2
          ref={titleRef}
          className="cloud-title"
          style={{ "--cloud-title-fit": `${focusFit.fontSize}px` } as CSSProperties}
          title={focusFit.clipped ? focusLabel : undefined}
        >
          {focusLabel}
        </h2>
        <p className="cloud-caption">{caption ?? focusCaption}</p>
      </div>

      {/* Reserved whether or not a cluster is selected: the frame above is a flex
          sibling, so letting these buttons add a row would shrink the sphere on
          every selection (and again when motion is paused). */}
      <div className="cloud-actions">
        {selectedParticle?.path ? (
          <button
            type="button"
            className="cloud-open"
            title={selectedParticle.title ?? "note"}
            onClick={() => {
              const path = selectedParticle.path;
              if (path) onOpenNote(path);
            }}
          >
            Open “{selectedParticle.title ?? "note"}”
          </button>
        ) : null}

        {!animate && onEnableMotion ? (
          <button type="button" className="cloud-motion" onClick={onEnableMotion}>
            Motion paused — turn it on
          </button>
        ) : null}
      </div>

      <div className="cloud-states" role="status" aria-label="Core state">
        {CLOUD_STATES.map((value) => (
          <span
            key={value}
            className={`pill${value === state ? " is-active" : ""}`}
            aria-current={value === state ? "true" : undefined}
          >
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </span>
        ))}
      </div>

      <p className="cloud-hint">
        Drag to spin · release to settle on a note · click to focus its cluster · click again to open · R
        resets
      </p>

      <ul className="cloud-legend" aria-label="Legend">
        {Object.entries(byArea)
          .filter(([, count]) => count > 0)
          .map(([area, count]) => (
            <li key={area}>
              <span className="legend-dot" style={{ background: AREA_COLORS[area] ?? AREA_COLORS.unset }} />
              {area.toUpperCase()} {count}
            </li>
          ))}
      </ul>
    </section>
  );
}
