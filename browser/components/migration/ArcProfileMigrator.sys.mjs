/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Imports everything from Arc in one pass, across all Arc profiles.
 *
 * Arc keeps Chromium data (history, passwords, cards, autofill, cookies,
 * extensions) in one folder per profile, and its own sidebar (spaces,
 * favorites, pinned folders, open tabs, split views) in StorableSidebar.json
 * next to the Chromium data folder. The Chromium data is read by the shared
 * Chrome importer. The sidebar maps as follows:
 *
 * - Each Arc space becomes a space. A space of a profile other than the
 *   default one uses a container named after that profile, so its sign-ins
 *   stay separate, as in Arc.
 * - Favorites become pinned tabs in every space of their profile, since Arc
 *   shows them in every space.
 * - Pinned tabs of a space become pinned tabs of that space. Pinned folders
 *   become collapsed tab groups, with nested folders flattened into them.
 * - Open tabs and split views become regular tabs and split views.
 * - Favorites and pinned folders are also saved as bookmarks, keeping the
 *   full folder tree.
 *
 * Imported tabs are restored without loading. Only the tab selected at the
 * end loads.
 */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";
import { ChromeProfileMigrator } from "resource:///modules/ChromeProfileMigrator.sys.mjs";
import { MigrationUtils } from "resource:///modules/MigrationUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  ChromeMigrationUtils: "resource:///modules/ChromeMigrationUtils.sys.mjs",
  ContextualIdentityService:
    "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs",
  E10SUtils: "resource://gre/modules/E10SUtils.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  SessionStore:
    "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
});

function splitLayoutModel() {
  return ChromeUtils.importESModule(
    "moz-src:///browser/components/tabbrowser/splitview/SplitLayoutModel.sys.mjs"
  );
}

const SPACES_LIST_PREF = "browser.spaces.list";
const SPACES_HIDDEN_BY = "spaces";
// Arc stores times as seconds since 2001-01-01, the Apple reference date.
const APPLE_EPOCH_MS = 978307200000;
// Chromium cookie databases from version 24 prefix each decrypted value with
// a SHA-256 hash of the cookie's domain.
const COOKIE_DOMAIN_HASH_VERSION = 24;
const COOKIE_DOMAIN_HASH_LENGTH = 32;

const CONTAINER_COLORS = [
  ["red", 0],
  ["orange", 30],
  ["yellow", 55],
  ["green", 120],
  ["turquoise", 175],
  ["blue", 215],
  ["purple", 275],
  ["pink", 320],
];

const GROUP_COLOR_FOR_CONTAINER_COLOR = {
  red: "red",
  orange: "orange",
  yellow: "yellow",
  green: "green",
  turquoise: "cyan",
  blue: "blue",
  purple: "purple",
  pink: "pink",
  toolbar: "gray",
};

// Arc space icons are SF Symbols names. Unlisted names use "circle".
const ICON_FOR_SYMBOL = [
  [/briefcase|case|building/, "briefcase"],
  [/dollar|banknote|creditcard|chart/, "dollar"],
  [/cart|bag|basket/, "cart"],
  [/gift/, "gift"],
  [/airplane|beach|globe|planet|map|car/, "vacation"],
  [/fork|cup|mug|wineglass|takeoutbag/, "food"],
  [/leaf|carrot/, "fruit"],
  [/pawprint|hare|tortoise|cat|dog|bird|fish/, "pet"],
  [/tree|mountain/, "tree"],
  [/moon|sun|star|heart|sparkle|music|gamecontroller|tv|film/, "chill"],
  [/lock|shield|key|hand/, "fingerprint"],
];

function arcTimeToMs(seconds) {
  return Number.isFinite(seconds) ? APPLE_EPOCH_MS + seconds * 1000 : 0;
}

/**
 * Arc stores arrays of pairs as flat lists: [key1, value1, key2, value2].
 *
 * @param {Array} list
 * @returns {Array<[any, any]>}
 */
function pairs(list) {
  let result = [];
  for (let i = 0; i + 1 < (list?.length ?? 0); i += 2) {
    result.push([list[i], list[i + 1]]);
  }
  return result;
}

function profileDirectory(profile) {
  if (!profile || profile.default) {
    return "Default";
  }
  return profile.custom?._0?.directoryBasename || "Default";
}

function isImportableURL(url) {
  try {
    let uri = Services.io.newURI(url);
    return uri.schemeIs("https") || uri.schemeIs("http");
  } catch {
    return false;
  }
}

function containerColor(theme) {
  let rgb = theme?.primaryColorPalette?.midTone;
  if (!rgb || !["red", "green", "blue"].every(c => Number.isFinite(rgb[c]))) {
    return null;
  }
  let { red: r, green: g, blue: b } = rgb;
  let max = Math.max(r, g, b);
  let min = Math.min(r, g, b);
  if (max - min < 0.08) {
    return "toolbar";
  }
  let hue;
  if (max == r) {
    hue = (60 * ((g - b) / (max - min)) + 360) % 360;
  } else if (max == g) {
    hue = 60 * ((b - r) / (max - min)) + 120;
  } else {
    hue = 60 * ((r - g) / (max - min)) + 240;
  }
  let best = null;
  let bestDistance = Infinity;
  for (let [color, colorHue] of CONTAINER_COLORS) {
    let distance = Math.min(
      Math.abs(hue - colorHue),
      360 - Math.abs(hue - colorHue)
    );
    if (distance < bestDistance) {
      best = color;
      bestDistance = distance;
    }
  }
  return best;
}

function spaceIcon(iconType) {
  let symbol = iconType?.icon;
  if (typeof symbol == "string") {
    for (let [pattern, icon] of ICON_FOR_SYMBOL) {
      if (pattern.test(symbol)) {
        return icon;
      }
    }
  }
  return "circle";
}

function spaceEmoji(iconType) {
  if (typeof iconType?.emoji_v2 == "string" && iconType.emoji_v2) {
    return iconType.emoji_v2;
  }
  if (Number.isInteger(iconType?.emoji)) {
    try {
      return String.fromCodePoint(iconType.emoji);
    } catch {}
  }
  return null;
}

/**
 * Reads one Arc sidebar item and its children. Returns null for items that
 * do not import, such as notes or internal pages.
 *
 * Tabs are { type: "tab", arcId, url, title, lastAccessed }, folders are
 * { type: "folder", title, children }, and split views are
 * { type: "split", axis, factors, children }, where `factors` are the panes'
 * shares of the split.
 *
 * @param {Map<string, object>} items Arc sidebar items by id.
 * @param {string} id
 * @param {number} [depth]
 * @returns {object|null}
 */
function readNode(items, id, depth = 0) {
  let item = items.get(id);
  if (!item || depth > 32) {
    return null;
  }
  let data = item.data ?? {};
  if (data.tab) {
    let url = data.tab.savedURL;
    if (!isImportableURL(url)) {
      return null;
    }
    return {
      type: "tab",
      arcId: item.id,
      url,
      title: item.title || data.tab.savedTitle || url,
      lastAccessed: arcTimeToMs(data.tab.timeLastActiveAt),
    };
  }
  let kept = [];
  for (let childId of item.childrenIds ?? []) {
    let child = readNode(items, childId, depth + 1);
    if (child) {
      kept.push([childId, child]);
    }
  }
  let children = kept.map(([, child]) => child);
  if (data.list) {
    return { type: "folder", title: item.title || "", children };
  }
  if (data.splitView) {
    if (children.length < 2) {
      return children[0] ?? null;
    }
    let factors = new Map(pairs(data.splitView.itemWidthFactors));
    return {
      type: "split",
      axis: data.splitView.layoutOrientation == "vertical" ? "column" : "row",
      factors: kept.map(([childId]) => factors.get(childId)),
      children,
    };
  }
  return null;
}

function readSpace(space, childrenOf) {
  let containers = new Map(pairs(space.containerIDs));
  let iconType = space.customInfo?.iconType;
  return {
    arcId: space.id,
    title: space.title || "",
    profile: profileDirectory(space.profile),
    emoji: spaceEmoji(iconType),
    icon: spaceIcon(iconType),
    color: containerColor(space.customInfo?.windowTheme),
    pinned: childrenOf(containers.get("pinned")),
    unpinned: childrenOf(containers.get("unpinned")),
  };
}

/**
 * Reads Arc's sidebar into spaces, favorites per profile and the space Arc
 * last showed.
 *
 * @param {object} sidebar Contents of StorableSidebar.json.
 * @param {object} [windows] Contents of StorableWindows.json.
 */
export function parseArcSidebar(sidebar, windows) {
  let main = sidebar?.sidebar?.containers?.find(c => c.spaces && c.items);
  if (!main) {
    return null;
  }
  let items = new Map();
  for (let item of main.items) {
    if (item && typeof item == "object" && typeof item.id == "string") {
      items.set(item.id, item);
    }
  }

  let childrenOf = containerId =>
    (items.get(containerId)?.childrenIds ?? [])
      .map(id => readNode(items, id))
      .filter(Boolean);

  let favorites = new Map();
  for (let [profile, containerId] of pairs(main.topAppsContainerIDs)) {
    favorites.set(profileDirectory(profile), childrenOf(containerId));
  }

  let spaces = [];
  for (let space of main.spaces) {
    if (!space || typeof space != "object" || typeof space.id != "string") {
      continue;
    }
    spaces.push(readSpace(space, childrenOf));
  }
  let order = sidebar.sidebarSyncState?.container?.value?.orderedSpaceIDs;
  if (Array.isArray(order)) {
    spaces.sort((a, b) => {
      let ia = order.indexOf(a.arcId);
      let ib = order.indexOf(b.arcId);
      return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
    });
  }

  return {
    spaces,
    favorites,
    focusedSpaceId: windows?.lastFocusedSpaceID ?? null,
  };
}

function* tabsIn(nodes) {
  for (let node of nodes) {
    if (node.type == "tab") {
      yield node;
    } else {
      yield* tabsIn(node.children);
    }
  }
}

function countTabs(parsed) {
  let count = 0;
  for (let space of parsed.spaces) {
    count += [...tabsIn(space.pinned), ...tabsIn(space.unpinned)].length;
  }
  for (let nodes of parsed.favorites.values()) {
    count += [...tabsIn(nodes)].length;
  }
  return count;
}

/**
 * Builds a split layout whose leaf ids are positions in `ids`, from an Arc
 * split. Arc splits are one row or one column; nested splits nest.
 *
 * @param {ArcNode} split
 * @param {Function} nextId returns the leaf id of the next tab.
 */
function splitLayout(split, nextId) {
  let M = splitLayoutModel();
  let nodes = split.children.map(child =>
    child.type == "split" ? splitLayout(child, nextId) : M.leaf(nextId())
  );
  let factors = split.factors.map(f => (Number.isFinite(f) && f > 0 ? f : 0));
  let even =
    factors.every(f => f > 0) &&
    factors.every(f => Math.abs(f - factors[0]) < 0.02 * factors[0]);
  let node = nodes.at(-1);
  for (let i = nodes.length - 2; i >= 0; i--) {
    let rest = factors.slice(i).reduce((a, b) => a + b, 0);
    let ratio = rest > 0 && factors[i] > 0 ? factors[i] / rest : 0.5;
    node = {
      axis: split.axis,
      ratio,
      ...(even ? {} : { manual: true }),
      first: nodes[i],
      second: node,
    };
  }
  return node;
}

/**
 *
 */
export class ArcProfileMigrator extends ChromeProfileMigrator {
  static get key() {
    return "arc";
  }

  static get displayNameL10nID() {
    return "migration-wizard-migrator-display-name-arc";
  }

  static get brandImage() {
    return "moz-icon://file:///Applications/Arc.app?size=32";
  }

  _chromeUserDataPathSuffix = "Arc";
  _keychainServiceName = "Arc Safe Storage";
  _keychainAccountName = "Arc";

  /** The Keychain key is read once per import and dropped afterward. */
  #loginCrypto = null;

  _createLoginCrypto() {
    this.#loginCrypto ??= super._createLoginCrypto();
    return this.#loginCrypto;
  }

  async migrate(...args) {
    try {
      return await super.migrate(...args);
    } finally {
      this.#loginCrypto = null;
    }
  }

  /** Arc imports all of its profiles together, so it lists no profiles. */
  async getSourceProfiles() {
    return null;
  }

  async #arcDataPath() {
    let userDataPath = await this._getChromeUserDataPathIfExists();
    return userDataPath ? PathUtils.parent(userDataPath) : null;
  }

  async getLastUsedDate() {
    let arcPath = await this.#arcDataPath();
    if (!arcPath) {
      return new Date(0);
    }
    let info = await IOUtils.stat(
      PathUtils.join(arcPath, "StorableSidebar.json")
    ).catch(() => null);
    return new Date(info?.lastModified ?? 0);
  }

  /**
   * @param {string} userDataPath
   * @returns {Promise<Array<{id: string, name: string}>>}
   *   Arc's Chromium profiles, the default profile first.
   */
  async #chromiumProfiles(userDataPath) {
    let profiles = [];
    try {
      let localState = await lazy.ChromeMigrationUtils.getLocalState(
        this._chromeUserDataPathSuffix,
        userDataPath
      );
      for (let [id, info] of Object.entries(
        localState.profile?.info_cache ?? {}
      )) {
        profiles.push({ id, name: info?.name || id });
      }
    } catch (e) {
      if (e.name != "NotFoundError") {
        console.error(e);
      }
    }
    if (!profiles.some(p => p.id == "Default")) {
      if (await IOUtils.exists(PathUtils.join(userDataPath, "Default"))) {
        profiles.push({ id: "Default", name: "Default" });
      }
    }
    profiles.sort((a, b) => (a.id == "Default" ? -1 : b.id == "Default"));
    return profiles;
  }

  async #readSidebar() {
    let arcPath = await this.#arcDataPath();
    try {
      let sidebar = await IOUtils.readJSON(
        PathUtils.join(arcPath, "StorableSidebar.json")
      );
      let windows = await IOUtils.readJSON(
        PathUtils.join(arcPath, "StorableWindows.json")
      ).catch(() => null);
      return parseArcSidebar(sidebar, windows);
    } catch (e) {
      if (e.name != "NotFoundError") {
        console.error(e);
      }
      return null;
    }
  }

  async getResources() {
    if (!(await this.hasPermissions())) {
      return [];
    }
    let userDataPath = await this._getChromeUserDataPathIfExists();
    if (!userDataPath) {
      return [];
    }
    let profiles = await this.#chromiumProfiles(userDataPath);
    let names = new Map(profiles.map(p => [p.id, p.name]));
    let parsed = await this.#readSidebar();

    let chromiumResources = [];
    for (let profile of profiles) {
      chromiumResources.push(
        ...(await ChromeProfileMigrator.prototype.getResources.call(
          this,
          profile
        ))
      );
    }

    let resources = [];
    let take = type => {
      resources.push(...chromiumResources.filter(r => r.type == type));
    };
    take(MigrationUtils.resourceTypes.HISTORY);
    if (parsed && countTabs(parsed)) {
      resources.push(this.#bookmarksResource(parsed));
    }
    take(MigrationUtils.resourceTypes.BOOKMARKS);
    take(MigrationUtils.resourceTypes.PASSWORDS);
    take(MigrationUtils.resourceTypes.FORMDATA);
    take(MigrationUtils.resourceTypes.PAYMENT_METHODS);

    let extensions = await this.#extensionsResource(userDataPath, profiles);
    if (extensions) {
      resources.push(extensions);
    }

    let containers = new ContainerMapper(names);
    if (AppConstants.platform == "macosx") {
      for (let profile of profiles) {
        let cookies = await this.#cookiesResource(
          PathUtils.join(userDataPath, profile.id),
          profile.id,
          containers
        );
        if (cookies) {
          resources.push(cookies);
        }
      }
    }
    if (parsed && countTabs(parsed)) {
      resources.push(
        this.#sessionResource(
          parsed,
          containers,
          PathUtils.parent(userDataPath),
          userDataPath,
          profiles
        )
      );
    }
    return resources;
  }

  #bookmarksResource(parsed) {
    return {
      type: MigrationUtils.resourceTypes.BOOKMARKS,
      async migrate(aCallback) {
        try {
          let convert = nodes => {
            let result = [];
            for (let node of nodes) {
              if (node.type == "tab") {
                result.push({ url: node.url, title: node.title });
              } else if (node.type == "split") {
                result.push(...convert(node.children));
              } else {
                result.push({
                  type: lazy.PlacesUtils.bookmarks.TYPE_FOLDER,
                  title: node.title,
                  children: convert(node.children),
                });
              }
            }
            return result;
          };
          let folders = [];
          for (let [profile, nodes] of parsed.favorites) {
            if (nodes.length) {
              folders.push({
                type: lazy.PlacesUtils.bookmarks.TYPE_FOLDER,
                title:
                  parsed.favorites.size > 1
                    ? `Favorites (${profile})`
                    : "Favorites",
                children: convert(nodes),
              });
            }
          }
          for (let space of parsed.spaces) {
            if (space.pinned.length) {
              folders.push({
                type: lazy.PlacesUtils.bookmarks.TYPE_FOLDER,
                title: space.title || "Space",
                children: convert(space.pinned),
              });
            }
          }
          if (folders.length) {
            await MigrationUtils.insertManyBookmarksWrapper(
              [
                {
                  type: lazy.PlacesUtils.bookmarks.TYPE_FOLDER,
                  title: "From Arc",
                  children: folders,
                },
              ],
              lazy.PlacesUtils.bookmarks.unfiledGuid
            );
          }
          aCallback(true);
        } catch (e) {
          console.error(e);
          aCallback(false);
        }
      },
    };
  }

  async #extensionsResource(userDataPath, profiles) {
    if (
      !Services.prefs.getBoolPref(
        "browser.migrate.chrome.extensions.enabled",
        false
      )
    ) {
      return null;
    }
    let ids = new Set();
    for (let profile of profiles) {
      let path = PathUtils.join(userDataPath, profile.id, "Extensions");
      let children = await IOUtils.getChildren(path).catch(() => []);
      for (let child of children) {
        let name = PathUtils.filename(child);
        if (/^[a-p]{32}$/.test(name)) {
          ids.add(name);
        }
      }
    }
    if (!ids.size) {
      return null;
    }
    return {
      type: MigrationUtils.resourceTypes.EXTENSIONS,
      async migrate(callback) {
        // Arc installs extensions from the Chrome Web Store, so they match
        // Firefox add-ons the same way Chrome's do.
        let totalExtensions = [...ids].map(id => ({ id }));
        let [progressValue, importedExtensions] =
          await MigrationUtils.installExtensionsWrapper("chrome", [...ids]);
        if (importedExtensions?.length) {
          callback(true, {
            progressValue,
            totalExtensions,
            importedExtensions,
          });
        } else {
          callback(false);
        }
      },
    };
  }

  async #cookiesResource(profileFolder, profileId, containers) {
    let path = PathUtils.join(profileFolder, "Cookies");
    if (!(await IOUtils.exists(path))) {
      return null;
    }
    let createLoginCrypto = () => this._createLoginCrypto();
    return {
      type: MigrationUtils.resourceTypes.COOKIES,
      async migrate(aCallback) {
        try {
          let version = 0;
          let meta = await MigrationUtils.getRowsFromDBWithoutLocks(
            path,
            "Arc cookies",
            "SELECT value FROM meta WHERE key = 'version'"
          ).catch(() => []);
          if (meta.length) {
            version = parseInt(meta[0].getResultByName("value"), 10) || 0;
          }
          let now = Date.now();
          let rows = await MigrationUtils.getRowsFromDBWithoutLocks(
            path,
            "Arc cookies",
            `SELECT host_key, name, value, encrypted_value, path, expires_utc,
              is_secure, is_httponly, has_expires, is_persistent, samesite,
              source_scheme, top_frame_site_key FROM cookies`
          );
          if (!rows.length) {
            aCallback(true);
            return;
          }
          let userContextId = await containers.forProfile(profileId);
          let decrypt = async encrypted => {
            let bytes = await createLoginCrypto().decryptBytes(encrypted);
            return version >= COOKIE_DOMAIN_HASH_VERSION
              ? bytes.subarray(COOKIE_DOMAIN_HASH_LENGTH)
              : bytes;
          };
          let added = 0;
          for (let row of rows) {
            try {
              if (await addCookie(row, userContextId, decrypt, now)) {
                added++;
              }
            } catch (e) {
              // One bad cookie should not stop the others.
            }
          }
          aCallback(added > 0);
        } catch (e) {
          console.error(e);
          aCallback(false);
        }
      },
    };
  }

  #sessionResource(parsed, containers, arcPath, userDataPath, profiles) {
    return {
      type: MigrationUtils.resourceTypes.SESSION,
      async migrate(aCallback) {
        try {
          let win = lazy.BrowserWindowTracker.getTopWindow({
            private: false,
          });
          if (!win?.gSpaces) {
            aCallback(false);
            return;
          }
          let icons = await readFavicons(
            parsed,
            arcPath,
            userDataPath,
            profiles
          );
          await restoreSidebar(win, parsed, containers, icons);
          aCallback(true);
        } catch (e) {
          console.error(e);
          aCallback(false);
        }
      },
    };
  }
}

/**
 * Adds one Chromium cookie row to the cookie store.
 *
 * @param {mozIStorageRow} row
 * @param {number} userContextId
 * @param {Function} decrypt Resolves to the plaintext bytes of a value.
 * @param {number} now
 * @returns {Promise<boolean>} Whether the cookie was added.
 */
async function addCookie(row, userContextId, decrypt, now) {
  if (row.getResultByName("top_frame_site_key")) {
    // Partitioned cookies are keyed to a top-level site, which does not
    // carry over. Sites set them again on the next visit.
    return false;
  }
  let persistent =
    !!row.getResultByName("has_expires") &&
    !!row.getResultByName("is_persistent");
  let expiry = lazy.ChromeMigrationUtils.chromeTimeToDate(
    row.getResultByName("expires_utc"),
    new Date(0)
  ).getTime();
  if (persistent && expiry <= now) {
    return false;
  }
  let value = row.getResultByName("value");
  let encrypted = row.getResultByName("encrypted_value");
  if (!value && encrypted?.length) {
    value = new TextDecoder().decode(await decrypt(encrypted));
  }
  let secure = !!row.getResultByName("is_secure");
  let sameSite =
    {
      0: Ci.nsICookie.SAMESITE_NONE,
      1: Ci.nsICookie.SAMESITE_LAX,
      2: Ci.nsICookie.SAMESITE_STRICT,
    }[row.getResultByName("samesite")] ?? Ci.nsICookie.SAMESITE_UNSET;
  let scheme =
    secure || row.getResultByName("source_scheme") == 2
      ? Ci.nsICookie.SCHEME_HTTPS
      : Ci.nsICookie.SCHEME_HTTP;
  let validation = Services.cookies.add(
    row.getResultByName("host_key"),
    row.getResultByName("path") || "/",
    row.getResultByName("name"),
    value || "",
    secure,
    !!row.getResultByName("is_httponly"),
    !persistent,
    persistent ? expiry : now + 24 * 60 * 60 * 1000,
    { userContextId },
    sameSite,
    scheme
  );
  return validation?.result == Ci.nsICookieValidation.eOK;
}

/**
 * Finds or creates the container of each Arc profile. The default profile
 * uses no container.
 */
class ContainerMapper {
  #names;
  #ids = new Map();

  constructor(names) {
    this.#names = names;
  }

  async forProfile(profileId) {
    if (profileId == "Default") {
      return 0;
    }
    if (this.#ids.has(profileId)) {
      return this.#ids.get(profileId);
    }
    let name = this.#names.get(profileId) || profileId;
    let identity = lazy.ContextualIdentityService.getPublicIdentities().find(
      i => i.name == name
    );
    identity ??= lazy.ContextualIdentityService.create(
      name,
      "fingerprint",
      CONTAINER_COLORS[this.#ids.size % CONTAINER_COLORS.length][0]
    );
    this.#ids.set(profileId, identity.userContextId);
    return identity.userContextId;
  }
}

function md5Hex(text) {
  let hash = Cc["@mozilla.org/security/hash;1"].createInstance(
    Ci.nsICryptoHash
  );
  hash.init(Ci.nsICryptoHash.MD5);
  let bytes = new TextEncoder().encode(text);
  hash.update(bytes, bytes.length);
  return Array.from(hash.finish(false), c =>
    c.charCodeAt(0).toString(16).padStart(2, "0")
  ).join("");
}

function pngDataURL(bytes) {
  let binary = "";
  for (let byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// Icons larger than this are skipped, to keep the saved session small.
const MAX_ICON_BYTES = 16384;

/**
 * Finds a small icon for each imported tab. Arc keeps one for each sidebar
 * item, in a file named after the MD5 hash of the item's id. Tabs without
 * one use Arc's favicon database, matched by page and then by site.
 *
 * @param {object} parsed
 * @param {string} arcPath
 * @param {string} userDataPath
 * @param {Array<{id: string}>} profiles
 * @returns {Promise<Map<string, string>>} data: URLs keyed by Arc item id.
 */
async function readFavicons(parsed, arcPath, userDataPath, profiles) {
  let tabs = [];
  for (let space of parsed.spaces) {
    tabs.push(...tabsIn(space.pinned), ...tabsIn(space.unpinned));
  }
  for (let nodes of parsed.favorites.values()) {
    tabs.push(...tabsIn(nodes));
  }
  let icons = new Map();
  let cache = PathUtils.join(arcPath, "SidebarItemsFaviconCache");
  for (let tab of tabs) {
    let bytes = await IOUtils.read(PathUtils.join(cache, md5Hex(tab.arcId)), {
      maxBytes: MAX_ICON_BYTES + 1,
    }).catch(() => null);
    if (bytes?.length && bytes.length <= MAX_ICON_BYTES) {
      icons.set(tab.arcId, pngDataURL(bytes));
    }
  }
  let missing = tabs.filter(tab => !icons.has(tab.arcId));
  if (!missing.length) {
    return icons;
  }
  let byPage = new Map();
  let bySite = new Map();
  for (let profile of profiles) {
    let path = PathUtils.join(userDataPath, profile.id, "Favicons");
    if (!(await IOUtils.exists(path))) {
      continue;
    }
    // The bitmap closest to 32 pixels comes first.
    let rows = await MigrationUtils.getRowsFromDBWithoutLocks(
      path,
      "Arc favicons",
      `SELECT map.page_url, bit.image_data FROM icon_mapping map
        INNER JOIN favicon_bitmaps bit ON bit.icon_id = map.icon_id
        ORDER BY abs(bit.width - 32), bit.width DESC`
    ).catch(() => []);
    for (let row of rows) {
      let bytes = row.getResultByName("image_data");
      if (!bytes?.length || bytes.length > MAX_ICON_BYTES) {
        continue;
      }
      let pageURL = row.getResultByName("page_url");
      let host = hostOf(pageURL);
      if (!byPage.has(pageURL)) {
        byPage.set(pageURL, bytes);
      }
      if (host && !bySite.has(host)) {
        bySite.set(host, bytes);
      }
    }
  }
  for (let tab of missing) {
    let bytes = byPage.get(tab.url) ?? bySite.get(hostOf(tab.url));
    if (bytes) {
      icons.set(tab.arcId, pngDataURL(bytes));
    }
  }
  return icons;
}

function readSpaceList() {
  try {
    let list = JSON.parse(Services.prefs.getStringPref(SPACES_LIST_PREF, "[]"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Builds the session data of one Arc space's tabs: favorites as pinned tiles,
 * then the space's pinned tabs and pinned folders, as tab groups, in the
 * pinned list, then open tabs and split views.
 *
 * @param {object} arcSpace A space from parseArcSidebar.
 * @param {object[]} favorites The favorites of the space's profile.
 * @param {object} space The space it imports into.
 * @param {Map<string, string>} icons Icons by Arc item id.
 * @param {{tabs: object[], groups: object[], splitViews: object[]}} out
 */
function addSpaceTabs(arcSpace, favorites, space, icons, out) {
  let userContextId = space.userContextId ?? 0;
  let tabData = (node, extra = {}) => ({
    entries: [
      {
        url: node.url,
        title: node.title,
        triggeringPrincipal_base64: lazy.E10SUtils.serializePrincipal(
          Services.scriptSecurityManager.createContentPrincipal(
            Services.io.newURI(node.url),
            { userContextId }
          )
        ),
      },
    ],
    index: 1,
    ...(icons.has(node.arcId) ? { image: icons.get(node.arcId) } : {}),
    lastAccessed: node.lastAccessed || 0,
    hidden: true,
    extData: { hiddenBy: SPACES_HIDDEN_BY },
    attributes: { space: space.id },
    userContextId,
    ...extra,
  });
  let pinnedTab = node => {
    let data = tabData(node, { pinned: true });
    data.attributes["pinned-url"] = node.url;
    return data;
  };

  let listTab = (node, extra) => {
    let data = tabData(node, extra);
    data.attributes["pinned-list"] = "true";
    data.attributes["pinned-url"] = node.url;
    return data;
  };

  for (let node of tabsIn(favorites)) {
    out.tabs.push(pinnedTab(node));
  }
  let loosePinned = arcSpace.pinned.filter(node => node.type != "folder");
  for (let node of tabsIn(loosePinned)) {
    out.tabs.push(listTab(node));
  }
  for (let folder of arcSpace.pinned.filter(node => node.type == "folder")) {
    let folderTabs = [...tabsIn(folder.children)];
    if (!folderTabs.length) {
      continue;
    }
    let groupId = `arc-${Services.uuid.generateUUID().toString().slice(1, -1)}`;
    out.groups.push({
      id: groupId,
      name: folder.title,
      color: GROUP_COLOR_FOR_CONTAINER_COLOR[space.color] ?? "gray",
      collapsed: true,
    });
    out.tabs.push(...folderTabs.map(tab => listTab(tab, { groupId })));
  }
  for (let node of arcSpace.unpinned) {
    let nodeTabs = [...tabsIn([node])];
    if (node.type != "split" || nodeTabs.length < 2) {
      // Folders among open tabs flatten into open tabs.
      out.tabs.push(...nodeTabs.map(tab => tabData(tab)));
      continue;
    }
    let splitViewId = lazy.SessionStore.getNextSplitViewId();
    let next = 0;
    out.splitViews.push({
      id: splitViewId,
      numberOfTabs: nodeTabs.length,
      layout: splitLayoutModel().serialize(splitLayout(node, () => next++)),
    });
    out.tabs.push(...nodeTabs.map(tab => tabData(tab, { splitViewId })));
  }
}

/**
 * Adds Arc's spaces to the space list and restores their tabs, unloaded, into
 * `win`. Spaces imported before are skipped, so importing twice adds nothing.
 *
 * @param {Window} win
 * @param {object} parsed The result of parseArcSidebar.
 * @param {ContainerMapper} containers
 * @param {Map<string, string>} icons Icons by Arc item id.
 */
async function restoreSidebar(win, parsed, containers, icons) {
  let current = readSpaceList();
  // A list that only holds the unnamed starting space is replaced, so its
  // tabs join the first Arc space.
  let replaceStart =
    !current.length || (current.length == 1 && !current[0].name);
  let existing = new Set(current.map(s => s.id));

  let newSpaces = [];
  let out = { tabs: [], groups: [], splitViews: [] };
  for (let arcSpace of parsed.spaces) {
    let id = `arc-${arcSpace.arcId}`;
    if (existing.has(id)) {
      continue;
    }
    let userContextId = await containers.forProfile(arcSpace.profile);
    let space = {
      id,
      name: arcSpace.title,
      icon: arcSpace.icon,
      color: arcSpace.color || "blue",
      ...(arcSpace.emoji ? { emoji: arcSpace.emoji } : {}),
      ...(userContextId ? { userContextId } : {}),
    };
    newSpaces.push(space);
    addSpaceTabs(
      arcSpace,
      parsed.favorites.get(arcSpace.profile) ?? [],
      space,
      icons,
      out
    );
  }

  if (!newSpaces.length) {
    return;
  }
  Services.prefs.setStringPref(
    SPACES_LIST_PREF,
    JSON.stringify(replaceStart ? newSpaces : [...current, ...newSpaces])
  );
  if (out.tabs.length) {
    lazy.SessionStore.setWindowState(win, { windows: [out] }, false);
  }
  let focused = `arc-${parsed.focusedSpaceId}`;
  let target = newSpaces.find(s => s.id == focused) ?? newSpaces[0];
  win.gSpaces.switchTo(target.id);
}
