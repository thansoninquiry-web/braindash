import type { GraphEdge, GraphNode, NoteArea } from "./types";

/**
 * A deterministic layout for the full-screen graph.
 *
 * The vault sphere is a Fibonacci globe because rotation hides overlap; a flat
 * map cannot hide it, so this groups notes by area into four clusters around a
 * ring and spirals each cluster outward by golden angle. Hubs sit near the
 * middle of their cluster, where their edges are shortest. No simulation, no
 * randomness: the same graph always lays out the same way, so panning and
 * zooming survive a poll.
 */

export type LayoutArea = NoteArea | "unset";

export interface GraphPoint {
  id: string;
  title: string;
  area: LayoutArea;
  tags: string[];
  x: number;
  y: number;
  /** Both directions counted, so an inbound-only note is still a hub. */
  degree: number;
}

export interface GraphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GraphLayout {
  points: GraphPoint[];
  bounds: GraphBounds;
}

/** Areas get fixed corners, so a missing area never shifts the others. */
const CLUSTERS: Record<LayoutArea, { x: number; y: number }> = {
  career: { x: 0, y: -300 },
  life: { x: 300, y: 0 },
  ideas: { x: 0, y: 300 },
  unset: { x: -300, y: 0 },
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Cluster growth: 18 at the centre, ~150 for a hundred notes in one area. */
const SPIRAL_START = 18;
const SPIRAL_STEP = 9;

function areaOf(node: GraphNode): LayoutArea {
  if (node.area === "career" || node.area === "life" || node.area === "ideas") return node.area;
  return "unset";
}

export function layoutGraph(graph: { nodes: GraphNode[]; edges: GraphEdge[] }): GraphLayout {
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const groups = new Map<LayoutArea, GraphNode[]>();
  for (const node of graph.nodes) {
    const area = areaOf(node);
    const group = groups.get(area) ?? [];
    group.push(node);
    groups.set(area, group);
  }

  const points: GraphPoint[] = [];
  for (const [area, nodes] of groups) {
    const centre = CLUSTERS[area];
    const ordered = [...nodes].sort((a, b) => {
      const difference = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
      return difference !== 0 ? difference : a.id.localeCompare(b.id);
    });
    ordered.forEach((node, index) => {
      // First point sits at the cluster centre (offset 0); later ones spiral out.
      const radius = index === 0 ? 0 : SPIRAL_START + SPIRAL_STEP * Math.sqrt(index);
      const angle = index * GOLDEN_ANGLE;
      points.push({
        id: node.id,
        title: node.title,
        area,
        tags: node.tags,
        x: centre.x + Math.cos(angle) * radius,
        y: centre.y + Math.sin(angle) * radius,
        degree: degree.get(node.id) ?? 0,
      });
    });
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const bounds: GraphBounds =
    points.length === 0
      ? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
      : {
          minX: Math.min(...xs),
          minY: Math.min(...ys),
          maxX: Math.max(...xs),
          maxY: Math.max(...ys),
        };

  return { points, bounds };
}

/** Radius in graph units: hubs read bigger without swallowing their cluster. */
export function nodeRadius(degree: number): number {
  return 4.5 + Math.min(5, Math.sqrt(Math.max(0, degree)) * 1.5);
}
