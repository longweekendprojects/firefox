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
  Assert.deepEqual(byId.A, { id: "A", x: 0, y: 0, width: 498, height: 1000 });
  Assert.equal(byId.B.x, 502);
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
  Assert.equal(M.findNeighbor(t, "A", "right"), "B", "tie broken by order");
  Assert.equal(M.findNeighbor(t, "A", "left"), null, "edge returns null");
  Assert.equal(M.findNeighbor(t, "D", "right"), null);
});

add_task(function test_min_size_limits() {
  const t = guideTree();
  Assert.ok(M.canSplit(t, "A", "right", RECT, 140, 100));
  Assert.ok(!M.canSplit(t, "C", "right", RECT, 140, 100), "C is too narrow");
  const b = M.ratioBounds(t, "", RECT, 100, 100);
  Assert.equal(b.min, 0.1);
  Assert.equal(b.max, 0.8, "right side needs room for C and D");
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

  const dup = { version: 1, root: { axis: "row", ratio: 0.5, first: { id: "A" }, second: { id: "A" } } };
  Assert.deepEqual(M.deserialize(dup, ids), M.leaf("A"), "duplicate leaf dropped");

  const bad = [
    null,
    "junk",
    { version: 999, root: { id: "A" } },
    { version: 1 },
    { version: 1, root: { axis: "diagonal", first: { id: "A" }, second: { id: "B" } } },
    { version: 1, root: { axis: "row", ratio: 0.5, first: { id: "A" } } },
  ];
  for (const d of bad) {
    Assert.equal(M.deserialize(d, ids), null, `rejects ${JSON.stringify(d)}`);
  }

  const nan = { version: 1, root: { axis: "row", ratio: "x", first: { id: "A" }, second: { id: "B" } } };
  Assert.equal(M.deserialize(nan, ids).ratio, 0.5, "bad ratio defaults");

  let deep = { id: "A" };
  for (let i = 0; i < 100; i++) {
    deep = { axis: "row", ratio: 0.5, first: deep, second: { id: "B" } };
  }
  Assert.equal(M.deserialize({ version: 1, root: deep }, ids), null, "depth bounded");
});

add_task(function test_reconcile_with_membership() {
  const t = guideTree();
  Assert.deepEqual(M.leafIds(M.reconcile(t, ["A", "D", "E"])), ["A", "D", "E"]);
  Assert.deepEqual(M.leafIds(M.reconcile(null, ["A", "B"])), ["A", "B"]);
  Assert.equal(M.reconcile(t, ["A", "B", "C", "D"]), t, "no change reuses tree");
});
