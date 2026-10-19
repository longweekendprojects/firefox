/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Pure recursive layout model for Split View.
 *
 * A layout is an immutable binary tree of plain objects:
 *   leaf:  { id }
 *   split: { axis: "row" | "column", ratio, first, second }
 *
 * "row" places first left of second; "column" places first above second.
 * `ratio` is the share of the first child, in (0, 1).
 * Leaf ids are opaque primitives chosen by the caller.
 * Split nodes are addressed by path strings of "0" (first) and "1" (second);
 * the root split has path "".
 *
 * The module holds no state and touches no DOM. Operations return new trees
 * and reuse unchanged subtrees, so edits allocate only along one path.
 */

export const LAYOUT_VERSION = 1;

const MIN_RATIO = 0.02;
const MAX_DEPTH = 64;
const MAX_LEAVES = 256;
const EPSILON = 1e-6;

const DIRECTIONS = {
  left: { axis: "row", before: true },
  right: { axis: "row", before: false },
  up: { axis: "column", before: true },
  down: { axis: "column", before: false },
};

function isSplit(node) {
  return node.axis !== undefined;
}

function clampRatio(ratio) {
  if (!Number.isFinite(ratio)) {
    return 0.5;
  }
  return Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio));
}

export function leaf(id) {
  return { id };
}

/**
 * Builds a layout of equal-width columns, matching native two-pane Split View.
 */
export function fromIds(ids) {
  if (!ids.length) {
    return null;
  }
  let node = leaf(ids[ids.length - 1]);
  for (let i = ids.length - 2; i >= 0; i--) {
    node = {
      axis: "row",
      ratio: 1 / (ids.length - i),
      first: leaf(ids[i]),
      second: node,
    };
  }
  return node;
}

/** Leaf ids in reading order (first before second). */
export function leafIds(root, out = []) {
  if (!root) {
    return out;
  }
  if (isSplit(root)) {
    leafIds(root.first, out);
    leafIds(root.second, out);
  } else {
    out.push(root.id);
  }
  return out;
}

export function hasLeaf(root, id) {
  if (!root) {
    return false;
  }
  return isSplit(root)
    ? hasLeaf(root.first, id) || hasLeaf(root.second, id)
    : root.id === id;
}

/** Returns the path of the split that directly contains leaf `id`, or null. */
export function parentPath(root, id, path = "") {
  if (!root || !isSplit(root)) {
    return null;
  }
  if (!isSplit(root.first) && root.first.id === id) {
    return path;
  }
  if (!isSplit(root.second) && root.second.id === id) {
    return path;
  }
  return (
    parentPath(root.first, id, path + "0") ??
    parentPath(root.second, id, path + "1")
  );
}

export function nodeAt(root, path) {
  let node = root;
  for (const step of path) {
    if (!node || !isSplit(node)) {
      return null;
    }
    node = step === "0" ? node.first : node.second;
  }
  return node;
}

function mapLeaves(root, fn) {
  if (isSplit(root)) {
    const first = mapLeaves(root.first, fn);
    const second = mapLeaves(root.second, fn);
    if (first === root.first && second === root.second) {
      return root;
    }
    return { ...root, first, second };
  }
  return fn(root);
}

/**
 * A run is a chain of nested splits that share one axis, such as three
 * side-by-side panes. Its items are the subtrees laid out along that axis,
 * each with its share of the run's extent.
 */
function flatten(node, axis, share = 1, out = []) {
  if (!isSplit(node) || node.axis !== axis) {
    out.push({ node, share });
    return out;
  }
  flatten(node.first, axis, share * node.ratio, out);
  flatten(node.second, axis, share * (1 - node.ratio), out);
  return out;
}

/** Builds a run from items, scaling their shares to fill the run. */
function buildRun(axis, items) {
  if (items.length == 1) {
    return items[0].node;
  }
  const total = items.reduce((sum, item) => sum + item.share, 0);
  return {
    axis,
    ratio: clampRatio(items[0].share / total),
    first: items[0].node,
    second: buildRun(axis, items.slice(1)),
  };
}

/**
 * Path of the top split of the run along `axis` whose items include leaf
 * `id`, or null when the leaf's parent split has another axis.
 */
function runPath(root, id, axis) {
  let node = root;
  let path = "";
  let start = null;
  while (isSplit(node)) {
    if (node.axis !== axis) {
      start = null;
    } else if (start === null) {
      start = path;
    }
    const step = hasLeaf(node.first, id) ? "0" : "1";
    node = step === "0" ? node.first : node.second;
    path += step;
  }
  return start;
}

function replaceAt(root, path, node, depth = 0) {
  if (depth === path.length) {
    return node;
  }
  return path[depth] === "0"
    ? { ...root, first: replaceAt(root.first, path, node, depth + 1) }
    : { ...root, second: replaceAt(root.second, path, node, depth + 1) };
}

/**
 * Splits leaf `targetId`, placing a new leaf `newId` in `direction`
 * ("left" | "right" | "up" | "down"). Returns the same tree when the target
 * is missing or `newId` already exists.
 *
 * When the target already sits in a run along the split's axis, the new leaf
 * joins that run with the target's share and every item shrinks in
 * proportion. Equal panes therefore stay equal: two halves become three
 * thirds. Otherwise the target is halved.
 */
export function split(root, targetId, direction, newId) {
  const dir = DIRECTIONS[direction];
  if (!dir) {
    throw new Error(`Unknown split direction: ${direction}`);
  }
  if (!root || hasLeaf(root, newId) || !hasLeaf(root, targetId)) {
    return root;
  }
  const added = leaf(newId);
  const path = runPath(root, targetId, dir.axis);
  if (path === null) {
    return mapLeaves(root, node =>
      node.id === targetId
        ? {
            axis: dir.axis,
            ratio: 0.5,
            first: dir.before ? added : node,
            second: dir.before ? node : added,
          }
        : node
    );
  }
  const items = flatten(nodeAt(root, path), dir.axis);
  const index = items.findIndex(item => item.node.id === targetId);
  items.splice(dir.before ? index : index + 1, 0, {
    node: added,
    share: items[index].share,
  });
  return replaceAt(root, path, buildRun(dir.axis, items));
}

/**
 * Removes leaf `id`. The other items of its run grow in proportion to fill
 * the space, so a split followed by a close restores the earlier sizes.
 * Returns null when the last leaf is removed.
 */
export function remove(root, id) {
  if (!root) {
    return null;
  }
  if (!isSplit(root)) {
    return root.id === id ? null : root;
  }
  const parent = parentPath(root, id);
  if (parent === null) {
    return root;
  }
  const axis = nodeAt(root, parent).axis;
  const path = runPath(root, id, axis);
  const items = flatten(nodeAt(root, path), axis).filter(
    item => item.node.id !== id || isSplit(item.node)
  );
  return replaceAt(root, path, buildRun(axis, items));
}

/** Replaces leaf `oldId` with `newId`, keeping its position. */
export function replace(root, oldId, newId) {
  if (!root || oldId === newId || hasLeaf(root, newId)) {
    return root;
  }
  return mapLeaves(root, node => (node.id === oldId ? leaf(newId) : node));
}

/** Returns the tree with every leaf id passed through `fn`. */
export function mapIds(root, fn) {
  return root ? mapLeaves(root, node => leaf(fn(node.id))) : null;
}

/** Mirrors the layout: every split swaps its children. */
export function mirror(root) {
  if (!root || !isSplit(root)) {
    return root;
  }
  return {
    axis: root.axis,
    ratio: clampRatio(1 - root.ratio),
    first: mirror(root.second),
    second: mirror(root.first),
  };
}

/** Exchanges the positions of two leaves. */
export function swap(root, a, b) {
  if (!root || a === b || !hasLeaf(root, a) || !hasLeaf(root, b)) {
    return root;
  }
  return mapLeaves(root, node => {
    if (node.id === a) {
      return leaf(b);
    }
    if (node.id === b) {
      return leaf(a);
    }
    return node;
  });
}

/**
 * Moves leaf `id` next to leaf `targetId`: "swap" exchanges the two leaves,
 * and a direction splits `targetId` with `id` on that side.
 */
export function move(root, id, targetId, zone) {
  if (!root || id === targetId || !hasLeaf(root, id)) {
    return root;
  }
  if (zone === "swap") {
    return swap(root, id, targetId);
  }
  const rest = remove(root, id);
  if (!hasLeaf(rest, targetId)) {
    return root;
  }
  return split(rest, targetId, zone, id);
}

/** Writes new item sizes into an existing run, keeping its shape. */
function reweight(node, axis, sizes) {
  if (!isSplit(node) || node.axis !== axis) {
    return { node, size: sizes.shift() };
  }
  const first = reweight(node.first, axis, sizes);
  const second = reweight(node.second, axis, sizes);
  return {
    node: {
      ...node,
      ratio: clampRatio(first.size / (first.size + second.size)),
      first: first.node,
      second: second.node,
    },
    size: first.size + second.size,
  };
}

/**
 * Moves the splitter of the split at `path` so its first child takes `ratio`.
 * Only the two panes touching the splitter change size; the other items of
 * a run keep theirs.
 */
export function setRatio(root, path, ratio) {
  const target = nodeAt(root, path);
  if (!target || !isSplit(target)) {
    return root;
  }
  const value = clampRatio(ratio);
  if (Math.abs(value - target.ratio) < EPSILON) {
    return root;
  }
  const a = flatten(target.first, target.axis, target.ratio);
  const b = flatten(target.second, target.axis, 1 - target.ratio);
  const last = a[a.length - 1];
  const delta = Math.min(
    b[0].share - MIN_RATIO,
    Math.max(MIN_RATIO - last.share, value - target.ratio)
  );
  last.share += delta;
  b[0].share -= delta;
  const sizes = [...a, ...b].map(item => item.share);
  return replaceAt(root, path, reweight(target, target.axis, sizes).node);
}

/**
 * Leaf that should take focus after `id` is removed: the nearest leaf of its
 * sibling subtree, on the side that touched the removed leaf.
 */
export function focusAfterRemove(root, id) {
  const path = parentPath(root, id);
  if (path === null) {
    return null;
  }
  const parent = nodeAt(root, path);
  const removedFirst = !isSplit(parent.first) && parent.first.id === id;
  const ids = leafIds(removedFirst ? parent.second : parent.first);
  return removedFirst ? ids[0] : ids[ids.length - 1];
}

/**
 * Smallest size a subtree can take when every leaf needs at least
 * `minWidth` x `minHeight`.
 */
export function minSize(node, minWidth, minHeight) {
  if (!isSplit(node)) {
    return { width: minWidth, height: minHeight };
  }
  const a = minSize(node.first, minWidth, minHeight);
  const b = minSize(node.second, minWidth, minHeight);
  return node.axis === "row"
    ? { width: a.width + b.width, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height };
}

/**
 * Computes leaf rectangles and splitter positions inside `rect`
 * ({ x, y, width, height }). Splitters carry the path of their split node.
 * `splitterSize` space is reserved between siblings.
 */
export function computeLayout(root, rect, splitterSize = 0) {
  const leaves = [];
  const splitters = [];
  const visit = (node, x, y, width, height, path) => {
    if (!isSplit(node)) {
      leaves.push({ id: node.id, x, y, width, height });
      return;
    }
    // Every splitter in a run takes the same space, so panes with equal
    // shares get equal sizes however the run is nested.
    const row = node.axis === "row";
    const before = flatten(node.first, node.axis).length - 1;
    const count = before + flatten(node.second, node.axis).length + 1;
    const extent = row ? width : height;
    const usable = Math.max(0, extent - (count - 1) * splitterSize);
    const offset = before * splitterSize;
    const firstSize = Math.round(usable * node.ratio) + offset;
    const rest = Math.max(0, extent - firstSize - splitterSize);
    const box = { x, y, width, height };
    if (row) {
      visit(node.first, x, y, firstSize, height, path + "0");
      splitters.push({
        path,
        axis: "row",
        x: x + firstSize,
        y,
        width: splitterSize,
        height,
        rect: box,
        usable,
        offset,
      });
      visit(
        node.second,
        x + firstSize + splitterSize,
        y,
        rest,
        height,
        path + "1"
      );
    } else {
      visit(node.first, x, y, width, firstSize, path + "0");
      splitters.push({
        path,
        axis: "column",
        x,
        y: y + firstSize,
        width,
        height: splitterSize,
        rect: box,
        usable,
        offset,
      });
      visit(
        node.second,
        x,
        y + firstSize + splitterSize,
        width,
        rest,
        path + "1"
      );
    }
  };
  if (root) {
    visit(root, rect.x, rect.y, rect.width, rect.height, "");
  }
  return { leaves, splitters };
}

/**
 * Valid ratio range for the split at `path` so that every leaf keeps at least
 * `minWidth` x `minHeight` inside `rect`. Returns null for an unknown path.
 */
export function ratioBounds(root, path, rect, minWidth, minHeight) {
  const target = nodeAt(root, path);
  if (!target || !isSplit(target)) {
    return null;
  }
  const { rect: box } = computeLayout(root, rect).splitters.find(
    sp => sp.path === path
  );
  const extent = target.axis === "row" ? box.width : box.height;
  const a = flatten(target.first, target.axis, target.ratio);
  const b = flatten(target.second, target.axis, 1 - target.ratio);
  const last = a[a.length - 1];
  const along = node => {
    const size = minSize(node, minWidth, minHeight);
    return (target.axis === "row" ? size.width : size.height) / extent;
  };
  const shrinkFirst = last.share - along(last.node);
  const shrinkSecond = b[0].share - along(b[0].node);
  if (extent <= 0 || shrinkFirst < 0 || shrinkSecond < 0) {
    return { min: target.ratio, max: target.ratio };
  }
  return {
    min: Math.max(MIN_RATIO, target.ratio - shrinkFirst),
    max: Math.min(1 - MIN_RATIO, target.ratio + shrinkSecond),
  };
}

/** True when splitting `targetId` in `direction` keeps all leaves usable. */
export function canSplit(root, targetId, direction, rect, minWidth, minHeight) {
  if (!hasLeaf(root, targetId)) {
    return false;
  }
  const next = split(root, targetId, direction, Symbol("probe"));
  return computeLayout(next, rect).leaves.every(
    r => r.width >= minWidth && r.height >= minHeight
  );
}

/**
 * Geometric directional neighbor of leaf `id`.
 * Candidates must lie beyond the source center in `direction`. Candidates that
 * overlap the source on the perpendicular axis win; among them the closest
 * edge, then the closest center, then reading order. Returns null at an edge.
 */
export function findNeighbor(root, id, direction) {
  if (!DIRECTIONS[direction]) {
    throw new Error(`Unknown direction: ${direction}`);
  }
  const { leaves } = computeLayout(root, {
    x: 0,
    y: 0,
    width: 10000,
    height: 10000,
  });
  const source = leaves.find(r => r.id === id);
  if (!source) {
    return null;
  }
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  const lo = r => (horizontal ? r.x : r.y);
  const len = r => (horizontal ? r.width : r.height);
  const pLo = r => (horizontal ? r.y : r.x);
  const pLen = r => (horizontal ? r.height : r.width);
  const center = r => lo(r) + len(r) / 2;
  const pCenter = r => pLo(r) + pLen(r) / 2;

  let best = null;
  let bestKey = null;
  for (const r of leaves) {
    if (r.id === id || (center(r) - center(source)) * sign <= EPSILON) {
      continue;
    }
    const gap = Math.max(
      0,
      sign > 0
        ? lo(r) - (lo(source) + len(source))
        : lo(source) - (lo(r) + len(r))
    );
    const overlap =
      Math.min(pLo(r) + pLen(r), pLo(source) + pLen(source)) -
      Math.max(pLo(r), pLo(source));
    const pGap = Math.max(0, -overlap);
    const key = [
      overlap > EPSILON ? 0 : 1,
      overlap > EPSILON ? gap : gap * gap + pGap * pGap,
      Math.abs(pCenter(r) - pCenter(source)),
    ];
    if (!bestKey || compareKeys(key, bestKey) < 0) {
      best = r;
      bestKey = key;
    }
  }
  return best ? best.id : null;
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > EPSILON) {
      return a[i] - b[i];
    }
  }
  return 0;
}

/** Plain, versioned representation for session storage. */
export function serialize(root) {
  if (!root) {
    return null;
  }
  const encode = node =>
    isSplit(node)
      ? {
          axis: node.axis,
          ratio: Math.round(node.ratio * 10000) / 10000,
          first: encode(node.first),
          second: encode(node.second),
        }
      : { id: node.id };
  return { version: LAYOUT_VERSION, root: encode(root) };
}

/**
 * Rebuilds a layout from untrusted data. Leaves whose id is not in `validIds`
 * or that repeat an earlier id are dropped and their parents collapse.
 * Returns null for unknown versions, malformed data, or fewer than one leaf.
 * Never throws.
 */
export function deserialize(data, validIds) {
  try {
    if (!data || data.version !== LAYOUT_VERSION || !data.root) {
      return null;
    }
    const allowed = new Set(validIds);
    const seen = new Set();
    let count = 0;
    const decode = (node, depth) => {
      if (!node || typeof node !== "object" || depth > MAX_DEPTH) {
        throw new Error("Invalid layout node");
      }
      if (++count > 2 * MAX_LEAVES) {
        throw new Error("Layout too large");
      }
      if (node.axis === undefined) {
        if (!allowed.has(node.id) || seen.has(node.id)) {
          return null;
        }
        seen.add(node.id);
        return leaf(node.id);
      }
      if (node.axis !== "row" && node.axis !== "column") {
        throw new Error("Invalid layout axis");
      }
      const first = decode(node.first, depth + 1);
      const second = decode(node.second, depth + 1);
      if (!first || !second) {
        return first || second;
      }
      return { axis: node.axis, ratio: clampRatio(node.ratio), first, second };
    };
    return decode(data.root, 0);
  } catch (e) {
    return null;
  }
}

/**
 * Makes `root` contain exactly `ids`: drops unknown leaves and appends missing
 * ids to the right of the last leaf. Used to reconcile a stored layout with
 * actual split membership.
 */
export function reconcile(root, ids) {
  const wanted = new Set(ids);
  let next = root;
  for (const id of leafIds(root)) {
    if (!wanted.has(id)) {
      next = remove(next, id);
    }
  }
  for (const id of ids) {
    if (!next) {
      next = leaf(id);
    } else if (!hasLeaf(next, id)) {
      const ordered = leafIds(next);
      next = split(next, ordered[ordered.length - 1], "right", id);
    }
  }
  return next;
}
