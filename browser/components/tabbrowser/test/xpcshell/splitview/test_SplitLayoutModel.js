/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

const M = ChromeUtils.importESModule(
  "moz-src:///browser/components/tabbrowser/splitview/SplitLayoutModel.sys.mjs"
);

const RECT = { x: 0, y: 0, width: 1000, height: 1000 };

// H(A, V(B, H(C, D))) from the guide.
function guideTree() {
  let t = M.fromIds(["A", "B"]);
  t = M.split(t, "B", "down", "C");
  return M.split(t, "C", "right", "D");
}

add_task(function test_split_builds_nested_tree() {
  const t = guideTree();
  Assert.deepEqual(M.leafIds(t), ["A", "B", "C", "D"]);
  Assert.equal(t.axis, "row");
  Assert.equal(t.second.axis, "column");
  Assert.equal(t.second.second.axis, "row");

  const left = M.split(M.leaf("A"), "A", "left", "Z");
  Assert.deepEqual(M.leafIds(left), ["Z", "A"], "left inserts before");
  const up = M.split(M.leaf("A"), "A", "up", "Z");
  Assert.deepEqual(M.leafIds(up), ["Z", "A"], "up inserts before");
  Assert.equal(up.axis, "column");

  Assert.equal(M.split(t, "A", "right", "B"), t, "duplicate id is a no-op");
  Assert.equal(M.split(t, "nope", "right", "E"), t, "missing target no-op");
});

add_task(function test_remove_collapses_parents() {
  Assert.deepEqual(M.remove(M.fromIds(["A", "B"]), "B"), M.leaf("A"));
  Assert.equal(M.remove(M.leaf("A"), "A"), null);

  const t = guideTree();
  const noC = M.remove(t, "C");
  Assert.deepEqual(M.leafIds(noC), ["A", "B", "D"]);
  Assert.equal(noC.second.second.id, "D", "sibling promoted into parent");
  Assert.equal(noC.first, t.first, "untouched subtree reused");

  const noB = M.remove(t, "B");
  Assert.equal(noB.second.axis, "row", "C|D subtree promoted");
  Assert.deepEqual(M.leafIds(M.remove(noB, "A")), ["C", "D"]);
});

add_task(function test_focus_after_remove_is_adjacent() {
  const t = guideTree();
  Assert.equal(M.focusAfterRemove(t, "C"), "D");
  Assert.equal(M.focusAfterRemove(t, "D"), "C");
  Assert.equal(M.focusAfterRemove(t, "A"), "B");
  Assert.equal(M.focusAfterRemove(t, "B"), "C");
});

add_task(function test_swap_replace_ratio() {
  const t = guideTree();
  Assert.deepEqual(M.leafIds(M.swap(t, "A", "D")), ["D", "B", "C", "A"]);
  Assert.deepEqual(M.leafIds(M.replace(t, "B", "X")), ["A", "X", "C", "D"]);
  Assert.equal(M.replace(t, "B", "A"), t, "replace with existing id no-op");

  const r = M.setRatio(t, "1", 0.3);
  Assert.equal(r.second.ratio, 0.3);
  Assert.equal(r.first, t.first);
  Assert.equal(M.setRatio(t, "", 5).ratio, 0.98, "ratio clamped");
  Assert.equal(M.setRatio(t, "0", 0.3), t, "leaf path is a no-op");
});

add_task(function test_layout_geometry_and_splitters() {
  const { leaves, splitters } = M.computeLayout(guideTree(), RECT, 4);
  const byId = Object.fromEntries(leaves.map(l => [l.id, l]));
  Assert.equal(splitters.length, 3, "one splitter per split node");
  // A holds one of four panes, so it takes a quarter of the width.
  Assert.deepEqual(byId.A, { id: "A", x: 0, y: 0, width: 249, height: 1000 });
  Assert.equal(byId.B.x, 253);
  Assert.equal(byId.C.y, byId.D.y);
  Assert.equal(byId.D.x + byId.D.width, 1000, "fills the container");
  Assert.equal(byId.C.y + byId.C.height, 1000);
  // No overlap and no gap beyond splitters: total area adds up.
  const area = leaves.reduce((s, l) => s + l.width * l.height, 0);
  const sArea = splitters.reduce((s, l) => s + l.width * l.height, 0);
  Assert.equal(area + sArea, 1000 * 1000);
});

add_task(function test_directional_neighbor_uses_geometry() {
  const t = guideTree();
  Assert.equal(M.findNeighbor(t, "C", "up"), "B", "C up reaches B");
  Assert.equal(M.findNeighbor(t, "D", "up"), "B");
  Assert.equal(M.findNeighbor(t, "C", "left"), "A");
  Assert.equal(M.findNeighbor(t, "C", "right"), "D");
  Assert.equal(M.findNeighbor(t, "B", "down"), "C", "tie broken by order");
  // B takes a third of the height and C and D two thirds, so C is nearer.
  Assert.equal(M.findNeighbor(t, "A", "right"), "C", "closest center wins");
  Assert.equal(M.findNeighbor(t, "A", "left"), null, "edge returns null");
  Assert.equal(M.findNeighbor(t, "D", "right"), null);
});

add_task(function test_min_size_limits() {
  const t = guideTree();
  Assert.ok(M.canSplit(t, "A", "right", RECT, 140, 100));
  Assert.ok(
    !M.canSplit(t, "C", "right", RECT, 210, 100),
    "a sixth pane would leave A narrower than the minimum"
  );
  const b = M.ratioBounds(t, "", RECT, 100, 100);
  Assert.equal(b.min.toFixed(6), "0.100000");
  Assert.equal(
    b.max.toFixed(6),
    "0.800000",
    "right side needs room for C and D"
  );
});

add_task(function test_serialize_round_trip() {
  const t = M.setRatio(guideTree(), "", 0.58);
  const data = JSON.parse(JSON.stringify(M.serialize(t)));
  Assert.equal(data.version, M.LAYOUT_VERSION);
  Assert.deepEqual(M.deserialize(data, ["A", "B", "C", "D"]), t);
});

add_task(function test_deserialize_is_defensive() {
  const data = M.serialize(guideTree());
  const ids = ["A", "B", "C", "D"];

  const pruned = M.deserialize(data, ["A", "C", "D"]);
  Assert.deepEqual(M.leafIds(pruned), ["A", "C", "D"], "missing tab pruned");
  Assert.equal(M.deserialize(data, []), null);

  const dup = {
    version: 1,
    root: { axis: "row", ratio: 0.5, first: { id: "A" }, second: { id: "A" } },
  };
  Assert.deepEqual(
    M.deserialize(dup, ids),
    M.leaf("A"),
    "duplicate leaf dropped"
  );

  const bad = [
    null,
    "junk",
    { version: 999, root: { id: "A" } },
    { version: 1 },
    {
      version: 1,
      root: { axis: "diagonal", first: { id: "A" }, second: { id: "B" } },
    },
    { version: 1, root: { axis: "row", ratio: 0.5, first: { id: "A" } } },
  ];
  for (const d of bad) {
    Assert.equal(M.deserialize(d, ids), null, `rejects ${JSON.stringify(d)}`);
  }

  const nan = {
    version: 1,
    root: { axis: "row", ratio: "x", first: { id: "A" }, second: { id: "B" } },
  };
  Assert.equal(M.deserialize(nan, ids).ratio, 0.5, "bad ratio defaults");

  let deep = { id: "A" };
  for (let i = 0; i < 100; i++) {
    deep = { axis: "row", ratio: 0.5, first: deep, second: { id: "B" } };
  }
  Assert.equal(
    M.deserialize({ version: 1, root: deep }, ids),
    null,
    "depth bounded"
  );
});

add_task(function test_reconcile_with_membership() {
  const t = guideTree();
  Assert.deepEqual(M.leafIds(M.reconcile(t, ["A", "D", "E"])), ["A", "D", "E"]);
  Assert.deepEqual(M.leafIds(M.reconcile(null, ["A", "B"])), ["A", "B"]);
  Assert.equal(
    M.reconcile(t, ["A", "B", "C", "D"]),
    t,
    "no change reuses tree"
  );
});

add_task(function test_move_pane() {
  const t = guideTree();
  Assert.deepEqual(M.leafIds(M.move(t, "A", "D", "swap")), [
    "D",
    "B",
    "C",
    "A",
  ]);

  const right = M.move(t, "A", "D", "right");
  Assert.deepEqual(M.leafIds(right), ["B", "C", "D", "A"], "A moved after D");
  Assert.equal(right.axis, "column", "B over (C | (D | A))");
  Assert.equal(right.second.second.axis, "row");

  const up = M.move(t, "D", "A", "up");
  Assert.deepEqual(M.leafIds(up), ["D", "A", "B", "C"], "D moved above A");
  Assert.equal(up.first.axis, "column");

  Assert.equal(M.move(t, "A", "A", "left"), t, "moving onto itself is a no-op");
  Assert.equal(M.move(t, "Z", "A", "left"), t, "missing pane is a no-op");
});

function widths(t) {
  const { leaves } = M.computeLayout(t, {
    x: 0,
    y: 0,
    width: 900,
    height: 600,
  });
  return Object.fromEntries(leaves.map(l => [l.id, l.width]));
}

add_task(function test_equal_panes_stay_equal() {
  let t = M.split(M.fromIds(["A", "B"]), "B", "right", "C");
  Assert.deepEqual(widths(t), { A: 300, B: 300, C: 300 }, "three thirds");
  t = M.split(t, "A", "left", "Z");
  Assert.deepEqual(
    widths(t),
    { Z: 225, A: 225, B: 225, C: 225 },
    "a left split joins the row too"
  );
  Assert.deepEqual(
    widths(M.remove(t, "Z")),
    { A: 300, B: 300, C: 300 },
    "closing a pane gives its space back evenly"
  );
  Assert.deepEqual(
    widths(M.remove(M.remove(t, "Z"), "B")),
    { A: 450, C: 450 },
    "two panes return to halves"
  );
  const down = M.split(t, "B", "down", "D");
  // B and D share a column, so it is twice as wide and every pane has the
  // same area.
  Assert.deepEqual(
    widths(down),
    { Z: 180, A: 180, B: 360, D: 360, C: 180 },
    "a split across rebalances to equal areas"
  );
});

add_task(function test_manual_sizes_are_kept() {
  const t = M.split(M.fromIds(["A", "B"]), "B", "right", "C");
  const dragged = M.setRatio(t, "", 0.5);
  Assert.deepEqual(
    widths(dragged),
    { A: 450, B: 150, C: 300 },
    "a divider drag moves only its two neighbors"
  );
  Assert.deepEqual(
    widths(M.remove(dragged, "C")),
    { A: 675, B: 225 },
    "closing scales the remaining panes in proportion"
  );
  Assert.deepEqual(
    widths(M.split(M.remove(dragged, "C"), "B", "right", "C")),
    { A: 540, B: 180, C: 180 },
    "a new pane copies its source's share and the row scales to fit"
  );
  const bounds = M.ratioBounds(t, "", RECT, 100, 100);
  Assert.equal(bounds.min.toFixed(4), (0.1).toFixed(4), "A keeps its minimum");
  Assert.equal(
    bounds.max.toFixed(4),
    (2 / 3 - 0.1).toFixed(4),
    "B keeps its minimum; C is untouched"
  );
});

add_task(function test_nested_panes_get_equal_areas() {
  const R = { x: 0, y: 0, width: 1600, height: 1000 };
  let t = M.leaf("A");
  t = M.split(t, "A", "right", "B");
  t = M.split(t, "B", "right", "C");
  t = M.split(t, "A", "down", "D");
  t = M.split(t, "B", "down", "E");
  t = M.split(t, "B", "right", "F");
  t = M.split(t, "D", "down", "G");
  t = M.split(t, "E", "down", "H");
  const areas = M.computeLayout(t, R).leaves.map(l => l.width * l.height);
  const ideal = (R.width * R.height) / areas.length;
  for (const area of areas) {
    Assert.less(Math.abs(area - ideal) / ideal, 0.02, "every pane is equal");
  }
  const dragged = M.setRatio(t, "", 0.6);
  const before = M.computeLayout(dragged, R).leaves[0].width;
  const after = M.computeLayout(M.split(dragged, "C", "down", "Z"), R).leaves[0]
    .width;
  Assert.equal(before, after, "a hand-set split keeps its size");
  const restored = M.deserialize(M.serialize(dragged), M.leafIds(dragged));
  Assert.ok(restored.manual, "hand-set sizes survive a restart");
});
