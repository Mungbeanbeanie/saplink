## Status: Staged
Task: center the moisture glow on the convex hull of the real node positions, not the SVG viewBox's fixed midpoint (300,150) -- so it stays visually balanced relative to the actual nodes/links, for any node count.

- File: app/frontend/src/pages/Dashboard.jsx
  - add `convexHull(points)` -- standard Andrew's monotone chain, no library, returns hull vertices in CCW order (0-2 points returned unchanged, can't form a 2D hull)
  - add `polygonCentroid(hull)` -- true AREA centroid of the hull polygon (shoelace-formula based), not a plain average of hull vertices (which would skew toward whichever side of the hull has more/closer-together points). Falls back to a plain coordinate average for 0-2 points or a degenerate/collinear (zero-area) hull, where the area-weighted formula would divide by ~0
  - `buildSiteGraph(realNodes)` gains a third return field: `moistureCenter = nodes.length ? polygonCentroid(convexHull(nodes)) : {x:300,y:150}` (viewBox center as the empty-state fallback, same as today's fixed value)
  - the glow `<circle>`'s `cx`/`cy` switch from the hardcoded `"300"`/`"150"` to `graph.moistureCenter.x`/`graph.moistureCenter.y`
  - no change to radius logic (still driven by `wetFrac` only) or to node/link rendering
- No backend changes, no other files touched
