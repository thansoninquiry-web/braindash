import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { GRAPH_PULSE_PERIOD } from "../cloudMotion";
import { layoutGraph, nodeRadius, type GraphBounds } from "../graphLayout";
import { pulseDelay, pulseGeometry } from "../graphPulse";
import type { VaultGraph } from "../types";
import { useDialog } from "../useDialog";

const VIEW = { w: 1200, h: 760 };
const PAD = 72;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;
/** How far one wheel notch or button press moves the scale. */
const ZOOM_STEP = 1.18;

const AREAS: { id: string; label: string; color: string }[] = [
  { id: "career", label: "Career", color: "var(--node-career)" },
  { id: "life", label: "Life", color: "var(--node-life)" },
  { id: "ideas", label: "Ideas", color: "var(--node-ideas)" },
  { id: "unset", label: "Untagged", color: "var(--node-unset)" },
];

interface ViewState {
  zoom: number;
  x: number;
  y: number;
}

type Focus = { kind: "edge"; index: number } | { kind: "node"; id: string } | null;

interface FullGraphProps {
  open: boolean;
  graph: VaultGraph | null;
  onClose: () => void;
  onOpenNote: (path: string) => void;
  /** The app's motion setting; an explicit On overrides the OS preference. */
  animate: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Fits the whole layout in the canvas, leaving a margin for the labels. */
function fitView(bounds: GraphBounds): ViewState {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = clamp(Math.min((VIEW.w - PAD * 2) / width, (VIEW.h - PAD * 2) / height), ZOOM_MIN, 1.9);
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  return { zoom, x: VIEW.w / 2 - centreX * zoom, y: VIEW.h / 2 - centreY * zoom };
}

/** Zooms around a point in canvas units, so the spot under the cursor stays put. */
function zoomAround(view: ViewState, point: { x: number; y: number }, factor: number): ViewState {
  const zoom = clamp(view.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (zoom === view.zoom) return view;
  const worldX = (point.x - view.x) / view.zoom;
  const worldY = (point.y - view.y) / view.zoom;
  return { zoom, x: point.x - worldX * zoom, y: point.y - worldY * zoom };
}

export default function FullGraph({ open, graph, onClose, onOpenNote, animate }: FullGraphProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: ViewState } | null>(
    null,
  );
  const fitted = useRef(false);

  const [view, setView] = useState<ViewState>({ zoom: 1, x: 0, y: 0 });
  const [focus, setFocus] = useState<Focus>(null);
  const [dragging, setDragging] = useState(false);

  useDialog({ open, onClose, panelRef, initialFocusRef: closeRef });

  const layout = useMemo(() => (graph ? layoutGraph(graph) : null), [graph]);
  const positions = useMemo(
    () => new Map((layout?.points ?? []).map((point) => [point.id, point])),
    [layout],
  );
  /** Centre and reach of the expanding wave; delays are measured from here. */
  const pulse = useMemo(
    () => (layout ? pulseGeometry(layout.points, layout.bounds) : null),
    [layout],
  );

  /** Edges keep their server index so focus state and keys stay stable. */
  const edgeViews = useMemo(() => {
    if (!graph) return [];
    return graph.edges.flatMap((edge, index) => {
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      if (!from || !to) return [];
      return [{ index, ...edge, from, to }];
    });
  }, [graph, positions]);

  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const point of layout?.points ?? []) {
      tally.set(point.area, (tally.get(point.area) ?? 0) + 1);
    }
    return tally;
  }, [layout]);

  // A fresh open re-fits, but a 5-second poll that reshapes nothing must not
  // yank the view the user just panned somewhere.
  useEffect(() => {
    if (!open) {
      fitted.current = false;
      setFocus(null);
      setDragging(false);
      dragRef.current = null;
    }
  }, [open]);

  // The dashboard behind is taller than the viewport; freezing it keeps the
  // overlay from sitting on a scrollbar that can move under the graph.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !layout || fitted.current) return;
    setView(fitView(layout.bounds));
    fitted.current = true;
  }, [open, layout]);

  const toUser = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const mapped = point.matrixTransform(matrix.inverse());
    return { x: mapped.x, y: mapped.y };
  }, []);

  // React attaches wheel listeners passively, so zoom needs its own non-passive
  // listener to be able to preventDefault and stop the page scrolling.
  useEffect(() => {
    if (!open) return;
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      const point = toUser(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      setView((current) => zoomAround(current, point, Math.exp(-event.deltaY * 0.0016)));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [open, toUser]);

  const highlight = useMemo(() => {
    if (!focus) return null;
    const nodeIds = new Set<string>();
    const edgeIds = new Set<number>();
    if (focus.kind === "edge") {
      const edge = graph?.edges[focus.index];
      if (!edge) return null;
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
      edgeIds.add(focus.index);
    } else {
      nodeIds.add(focus.id);
      for (const edge of edgeViews) {
        if (edge.source === focus.id || edge.target === focus.id) {
          edgeIds.add(edge.index);
          nodeIds.add(edge.source);
          nodeIds.add(edge.target);
        }
      }
    }
    return { nodeIds, edgeIds };
  }, [focus, graph, edgeViews]);

  const focusLabel = useMemo(() => {
    if (!focus || !graph) return null;
    if (focus.kind === "edge") {
      const edge = graph.edges[focus.index];
      if (!edge) return null;
      const from = positions.get(edge.source)?.title ?? edge.source;
      const to = positions.get(edge.target)?.title ?? edge.target;
      return edge.type === "wikilink" ? `${from} → ${to} · wikilink` : `${from} — ${to} · shared tag`;
    }
    const point = positions.get(focus.id);
    if (!point) return null;
    return `${point.title} · ${point.degree} connection${point.degree === 1 ? "" : "s"}`;
  }, [focus, graph, positions]);

  /** Cycles edge focus from the keyboard; SVG focus events are unreliable,
   *  so `E` is the guaranteed path to an edge for a keyboard user. */
  const stepEdge = useCallback(
    (direction: 1 | -1) => {
      setFocus((current) => {
        const indices = edgeViews.map((edge) => edge.index);
        if (indices.length === 0) return null;
        const at = current?.kind === "edge" ? indices.indexOf(current.index) : -1;
        const next = (at + direction + indices.length) % indices.length;
        const index = indices[next];
        return index === undefined ? null : { kind: "edge", index };
      });
    },
    [edgeViews],
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "e" && event.key !== "E") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      stepEdge(event.shiftKey ? -1 : 1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, stepEdge]);

  const zoomTo = useCallback((factor: number) => {
    setView((current) => zoomAround(current, { x: VIEW.w / 2, y: VIEW.h / 2 }, factor));
  }, []);

  const reset = useCallback(() => {
    if (layout) setView(fitView(layout.bounds));
  }, [layout]);

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (!(target instanceof SVGSVGElement) && !target.classList.contains("fg-bg")) return;
    const point = toUser(event.clientX, event.clientY);
    const svg = svgRef.current;
    if (!point || !svg) return;
    setFocus(null);
    dragRef.current = { pointerId: event.pointerId, startX: point.x, startY: point.y, origin: view };
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that already left (or a synthetic event) cannot be captured;
      // the drag still works from the move handler.
    }
    setDragging(true);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = toUser(event.clientX, event.clientY);
    if (!point) return;
    setView({
      zoom: drag.origin.zoom,
      x: drag.origin.x + (point.x - drag.startX),
      y: drag.origin.y + (point.y - drag.startY),
    });
  }

  function endDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    const svg = svgRef.current;
    if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  }

  function onCanvasKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomTo(ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomTo(1 / ZOOM_STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      reset();
    }
  }

  if (!open) return null;

  const canDraw = Boolean(graph && layout && layout.points.length > 0);
  const edgeCount = graph?.edges.length ?? 0;
  const isolated = graph?.isolated.length ?? 0;

  return (
    <div className="fg-scrim">
      <div
        ref={panelRef}
        className={`fg-panel${animate ? " is-animated" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fg-title"
      >
        <header className="fg-head">
          <div className="fg-heading">
            <p className="fg-kicker">Vault · graph</p>
            <h2 id="fg-title" className="fg-title">
              Full graph
            </h2>
            <p className="fg-meta">
              {graph
                ? `${graph.nodes.length} notes · ${edgeCount} edges · ${isolated} isolated${
                    graph.truncated ? " · tag edges truncated" : ""
                  }`
                : "Reading the vault graph…"}
            </p>
          </div>

          <ul className="fg-legend" aria-label="Areas">
            {AREAS.map((area) => (
              <li key={area.id}>
                <span className="fg-swatch" style={{ background: area.color }} aria-hidden="true" />
                {area.label}
                <span className="fg-legend-count">{counts.get(area.id) ?? 0}</span>
              </li>
            ))}
          </ul>

          <button
            ref={closeRef}
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label="Close full graph"
          >
            ✕
          </button>
        </header>

        <div className="fg-stage">
          {!canDraw ? (
            <p className="fg-empty">
              {graph
                ? "The vault graph is empty — no notes to draw yet."
                : "Reading the vault graph…"}
            </p>
          ) : null}

          {canDraw && layout ? (
            <svg
              ref={svgRef}
              className={`fg-canvas${dragging ? " is-dragging" : ""}`}
              viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
              role="group"
              aria-label="Vault graph: notes as points, links and shared tags as lines"
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={onCanvasKeyDown}
            >
              <rect className="fg-bg" x={0} y={0} width={VIEW.w} height={VIEW.h} />

              <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
                {/* One wave leaves the middle every heartbeat; the node rings
                    below answer it as it passes. */}
                {pulse ? (
                  <circle
                    className="fg-wave"
                    cx={pulse.cx}
                    cy={pulse.cy}
                    r={pulse.radius}
                    vectorEffect="non-scaling-stroke"
                    style={{ animationDuration: `${GRAPH_PULSE_PERIOD}s` }}
                  />
                ) : null}

                <g className="fg-edges" aria-label="Edges">
                  {edgeViews.map((edge) => {
                    const active = !highlight || highlight.edgeIds.has(edge.index);
                    const focused = focus?.kind === "edge" && focus.index === edge.index;
                    const lit = focus?.kind === "node" && highlight?.edgeIds.has(edge.index);
                    const from = positions.get(edge.source)?.title ?? edge.source;
                    const to = positions.get(edge.target)?.title ?? edge.target;
                    return (
                      <g key={`${edge.source}-${edge.target}-${edge.index}`}>
                        <line
                          className={`fg-edge is-${edge.type}${focused ? " is-focused" : ""}${
                            lit ? " is-lit" : ""
                          }${active ? "" : " is-dim"}`}
                          x1={edge.from.x}
                          y1={edge.from.y}
                          x2={edge.to.x}
                          y2={edge.to.y}
                          vectorEffect="non-scaling-stroke"
                        />
                        <line
                          className="fg-edge-hit"
                          x1={edge.from.x}
                          y1={edge.from.y}
                          x2={edge.to.x}
                          y2={edge.to.y}
                          vectorEffect="non-scaling-stroke"
                          tabIndex={0}
                          role="button"
                          aria-label={`${edge.type === "wikilink" ? "Wikilink" : "Shared tag"} between ${from} and ${to}`}
                          onMouseEnter={() => setFocus({ kind: "edge", index: edge.index })}
                          onMouseLeave={() => setFocus(null)}
                          onFocus={() => setFocus({ kind: "edge", index: edge.index })}
                          onBlur={() => setFocus(null)}
                        />
                      </g>
                    );
                  })}
                </g>

                <g className="fg-nodes">
                  {layout.points.map((point, index) => {
                    const area = AREAS.find((entry) => entry.id === point.area) ?? AREAS[3];
                    const active = !highlight || highlight.nodeIds.has(point.id);
                    const selected = focus?.kind === "node" && focus.id === point.id;
                    const showLabel = Boolean(
                      highlight && focus?.kind === "node" && highlight.nodeIds.has(point.id),
                    );
                    // The same delay drives the ring and the dot's lift, so the
                    // crest reads as one event passing through the note.
                    const delay = pulse ? pulseDelay(point, pulse) : 0;
                    return (
                      <g
                        key={point.id}
                        className={`fg-node${active ? "" : " is-dim"}${selected ? " is-focused" : ""}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${point.title} · ${point.degree} connection${point.degree === 1 ? "" : "s"}`}
                        onMouseEnter={() => setFocus({ kind: "node", id: point.id })}
                        onMouseLeave={() => setFocus(null)}
                        onFocus={() => setFocus({ kind: "node", id: point.id })}
                        onBlur={() => setFocus(null)}
                        onClick={() => {
                          onOpenNote(point.id);
                          onClose();
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          onOpenNote(point.id);
                          onClose();
                        }}
                      >
                        <circle
                          className="fg-node-halo"
                          cx={point.x}
                          cy={point.y}
                          r={nodeRadius(point.degree) + 5}
                          fill={area.color}
                          style={{ animationDelay: `${((index * 0.45) % 5.6).toFixed(2)}s` }}
                        />
                        {pulse ? (
                          <circle
                            className="fg-node-wave"
                            cx={point.x}
                            cy={point.y}
                            r={nodeRadius(point.degree) + 4}
                            fill="none"
                            stroke={area.color}
                            vectorEffect="non-scaling-stroke"
                            style={{
                              animationDuration: `${GRAPH_PULSE_PERIOD}s`,
                              animationDelay: `${delay.toFixed(3)}s`,
                            }}
                          />
                        ) : null}
                        <circle
                          className="fg-node-dot"
                          cx={point.x}
                          cy={point.y}
                          r={nodeRadius(point.degree)}
                          fill={area.color}
                          style={
                            pulse
                              ? {
                                  animationDuration: `${GRAPH_PULSE_PERIOD}s`,
                                  animationDelay: `${delay.toFixed(3)}s`,
                                }
                              : undefined
                          }
                        />
                        <title>{point.title}</title>
                        {showLabel ? (
                          <text
                            className="fg-node-label"
                            x={point.x}
                            y={point.y + nodeRadius(point.degree) + 12}
                          >
                            {point.title}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                </g>
              </g>
            </svg>
          ) : null}

          {focusLabel ? (
            <p className="fg-focus" role="status">
              {focusLabel}
            </p>
          ) : null}

          <div className="fg-controls">
            <button type="button" onClick={() => zoomTo(ZOOM_STEP)} aria-label="Zoom in">
              +
            </button>
            <span className="fg-zoom">{Math.round(view.zoom * 100)}%</span>
            <button type="button" onClick={() => zoomTo(1 / ZOOM_STEP)} aria-label="Zoom out">
              −
            </button>
            <button type="button" onClick={reset} aria-label="Reset view" title="Reset view (0)">
              ⤢
            </button>
          </div>
        </div>

        <footer className="fg-foot">
          <span>Drag to pan · scroll or +/− to zoom · hover an edge (or press E) to focus it · click a note to open</span>
          <span className="fg-foot-mono">Map of the vault · click a note to open it</span>
        </footer>
      </div>
    </div>
  );
}
