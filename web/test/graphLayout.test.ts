import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { layoutGraph, nodeRadius } from "../src/graphLayout.js";
import type { GraphEdge, GraphNode } from "../src/types.js";

function node(id: string, area: GraphNode["area"] = null, tags: string[] = []): GraphNode {
  return { id, title: id.replace(/\.md$/, ""), tags, area };
}

function edge(source: string, target: string, type: GraphEdge["type"] = "wikilink"): GraphEdge {
  return { source, target, type };
}

describe("layoutGraph", () => {
  it("returns an empty layout for an empty graph", () => {
    const layout = layoutGraph({ nodes: [], edges: [] });
    assert.deepEqual(layout.points, []);
    assert.deepEqual(layout.bounds, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it("places one point per node with stable coordinates", () => {
    const nodes = [node("a.md", "career"), node("b.md", "ideas"), node("c.md")];
    const edges = [edge("a.md", "b.md")];
    const first = layoutGraph({ nodes, edges });
    const second = layoutGraph({ nodes: [...nodes].reverse(), edges });
    assert.equal(first.points.length, 3);
    const byId = (layout: typeof first) =>
      Object.fromEntries(layout.points.map((point) => [point.id, [point.x, point.y]]));
    assert.deepEqual(byId(first), byId(second), "order of input must not move a note");
  });

  it("counts degree in both directions", () => {
    const layout = layoutGraph({
      nodes: [node("a.md"), node("b.md"), node("c.md")],
      edges: [edge("a.md", "b.md"), edge("b.md", "c.md")],
    });
    const degree = Object.fromEntries(layout.points.map((point) => [point.id, point.degree]));
    assert.deepEqual(degree, { "a.md": 1, "b.md": 2, "c.md": 1 });
  });

  it("groups by area and defaults anything unknown to unset", () => {
    const layout = layoutGraph({
      nodes: [node("a.md", "career"), node("b.md", "life"), node("c.md", "ideas"), node("d.md")],
      edges: [],
    });
    const areas = Object.fromEntries(layout.points.map((point) => [point.id, point.area]));
    assert.deepEqual(areas, { "a.md": "career", "b.md": "life", "c.md": "ideas", "d.md": "unset" });
  });

  it("keeps each area in its own corner of the map", () => {
    const nodes = Array.from({ length: 24 }, (_, index) =>
      node(`career-${index}.md`, index % 2 === 0 ? "career" : "ideas"),
    );
    const layout = layoutGraph({ nodes, edges: [] });
    const career = layout.points.filter((point) => point.area === "career");
    const ideas = layout.points.filter((point) => point.area === "ideas");
    assert.ok(career.every((point) => point.y < 0), "career sits above the centre line");
    assert.ok(ideas.every((point) => point.y > 0), "ideas sits below it");
    const nearest = (points: typeof career, other: typeof ideas) =>
      Math.min(...points.flatMap((a) => other.map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
    assert.ok(nearest(career, ideas) > 40, "clusters do not interpenetrate");
  });

  it("reports bounds that contain every point", () => {
    const nodes = Array.from({ length: 30 }, (_, index) => node(`note-${index}.md`, "life"));
    const { points, bounds } = layoutGraph({ nodes, edges: [] });
    for (const point of points) {
      assert.ok(point.x >= bounds.minX && point.x <= bounds.maxX);
      assert.ok(point.y >= bounds.minY && point.y <= bounds.maxY);
    }
    assert.ok(bounds.maxX > bounds.minX, "a cluster has width");
  });

  it("never stacks two notes on the same coordinate", () => {
    const nodes = Array.from({ length: 40 }, (_, index) => node(`note-${index}.md`, "life"));
    const { points } = layoutGraph({ nodes, edges: [] });
    const seen = new Set(points.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`));
    assert.equal(seen.size, points.length);
  });
});

describe("nodeRadius", () => {
  it("grows with degree and stops growing for hubs", () => {
    assert.ok(nodeRadius(0) < nodeRadius(4));
    assert.ok(nodeRadius(4) < nodeRadius(16));
    assert.equal(nodeRadius(400), nodeRadius(100));
    assert.ok(nodeRadius(-3) >= 0);
  });
});
