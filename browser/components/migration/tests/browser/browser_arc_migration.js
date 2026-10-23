/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Importing from Arc brings over spaces, favorites, pinned folders, open tabs,
// split views, profiles as containers, and sign-in cookies.

const { ArcProfileMigrator } = ChromeUtils.importESModule(
  "resource:///modules/ArcProfileMigrator.sys.mjs"
);
const { ChromeMacOSLoginCrypto } = ChromeUtils.importESModule(
  "resource:///modules/ChromeMacOSLoginCrypto.sys.mjs"
);
const { Sqlite } = ChromeUtils.importESModule(
  "resource://gre/modules/Sqlite.sys.mjs"
);

const PASSPHRASE = "arc-test-passphrase";
const WORK_PROFILE_NAME = "Arc Test Client";

function tabItem(id, parentID, url, title) {
  return {
    id,
    parentID,
    childrenIds: [],
    title: null,
    data: { tab: { savedURL: url, savedTitle: title, timeLastActiveAt: 800 } },
  };
}

function container(id, children) {
  return {
    id,
    parentID: null,
    childrenIds: children,
    title: null,
    data: { itemContainer: { containerType: {} } },
  };
}

function arcSidebar() {
  let items = [
    container("fav-default", ["fav1", "fav2"]),
    tabItem("fav1", "fav-default", "https://example.com/fav1", "Fav 1"),
    tabItem("fav2", "fav-default", "https://example.org/fav2", "Fav 2"),
    container("p-pinned", ["pin1", "folder1", "arcnote"]),
    tabItem("pin1", "p-pinned", "https://example.com/pin1", "Pin 1"),
    {
      id: "folder1",
      parentID: "p-pinned",
      childrenIds: ["f1tab", "subfolder"],
      title: "Reading",
      data: { list: {} },
    },
    tabItem("f1tab", "folder1", "https://example.com/read1", "Read 1"),
    {
      id: "subfolder",
      parentID: "folder1",
      childrenIds: ["f2tab"],
      title: "Later",
      data: { list: {} },
    },
    tabItem("f2tab", "subfolder", "https://example.com/read2", "Read 2"),
    {
      id: "arcnote",
      parentID: "p-pinned",
      childrenIds: [],
      data: { easel: {} },
    },
    container("p-unpinned", ["open1", "split1", "internal"]),
    tabItem("open1", "p-unpinned", "https://example.com/open1", "Open 1"),
    tabItem("internal", "p-unpinned", "arc://settings", "Settings"),
    {
      id: "split1",
      parentID: "p-unpinned",
      childrenIds: ["s1", "s2", "s3"],
      title: null,
      data: {
        splitView: {
          layoutOrientation: "horizontal",
          itemWidthFactors: ["s1", 0.5, "s2", 0.25, "s3", 0.25],
        },
      },
    },
    tabItem("s1", "split1", "https://example.com/s1", "S1"),
    tabItem("s2", "split1", "https://example.com/s2", "S2"),
    tabItem("s3", "split1", "https://example.com/s3", "S3"),
    container("w-pinned", []),
    container("w-unpinned", ["work1"]),
    tabItem("work1", "w-unpinned", "https://example.net/work1", "Work 1"),
  ];
  let flat = [];
  for (let item of items) {
    flat.push(item.id, item);
  }
  let space = (id, title, profile, pinned, unpinned, customInfo) => ({
    id,
    title,
    profile,
    containerIDs: ["pinned", pinned, "unpinned", unpinned],
    customInfo,
  });
  let spaces = [
    space("personal", "Personal", { default: true }, "p-pinned", "p-unpinned", {
      iconType: { emoji_v2: "\u{1F98B}", emoji: 129419 },
      windowTheme: {
        primaryColorPalette: {
          midTone: { red: 0.73, green: 0.5, blue: 0.87, alpha: 1 },
        },
      },
    }),
    space(
      "work",
      "Work",
      { custom: { _0: { directoryBasename: "Profile 1" } } },
      "w-pinned",
      "w-unpinned",
      { iconType: { icon: "briefcase.fill" } }
    ),
  ];
  let flatSpaces = [];
  for (let s of spaces) {
    flatSpaces.push(s.id, s);
  }
  return {
    sidebar: {
      containers: [
        { global: {} },
        {
          spaces: flatSpaces,
          topAppsContainerIDs: [{ default: true }, "fav-default"],
          items: flat,
        },
      ],
    },
    version: 1,
  };
}

async function writeCookies(path, cookies) {
  let db = await Sqlite.openConnection({ path });
  await db.execute("CREATE TABLE meta (key TEXT, value TEXT)");
  await db.execute("INSERT INTO meta VALUES ('version', '24')");
  await db.execute(`CREATE TABLE cookies (creation_utc INTEGER, host_key TEXT,
    top_frame_site_key TEXT, name TEXT, value TEXT, encrypted_value BLOB,
    path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER,
    last_access_utc INTEGER, has_expires INTEGER, is_persistent INTEGER,
    priority INTEGER, samesite INTEGER, source_scheme INTEGER)`);
  let crypto = new ChromeMacOSLoginCrypto(
    "Arc Safe Storage",
    "Arc",
    PASSPHRASE
  );
  // Microseconds since 1601, one year from now.
  let expires = (Date.now() + 365 * 24 * 3600 * 1000 + 11644473600000) * 1000;
  for (let cookie of cookies) {
    let encrypted = await crypto.encryptData("h".repeat(32) + cookie.value);
    await db.execute(
      `INSERT INTO cookies VALUES (0, :host, '', :name, '', :blob, '/',
        :expires, 1, 1, 0, 1, 1, 1, 1, 2)`,
      {
        host: cookie.host,
        name: cookie.name,
        blob: Uint8Array.from(encrypted, c => c.charCodeAt(0)),
        expires,
      }
    );
  }
  await db.close();
}

add_setup(async () => {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.revamp", true],
      ["sidebar.verticalTabs", true],
    ],
  });
});

add_task(async function test_arc_is_offered_by_default() {
  Assert.ok(
    Services.prefs
      .getDefaultBranch("")
      .getBoolPref("browser.migrate.arc.enabled", false),
    "The import wizard lists Arc by default"
  );
});

add_task(async function test_import_everything_from_arc() {
  let root = await IOUtils.createUniqueDirectory(PathUtils.tempDir, "arc");
  let userData = PathUtils.join(root, "User Data");
  await IOUtils.makeDirectory(PathUtils.join(userData, "Default"));
  await IOUtils.makeDirectory(PathUtils.join(userData, "Profile 1"));
  await IOUtils.writeJSON(PathUtils.join(userData, "Local State"), {
    profile: {
      info_cache: {
        Default: { name: "Your Arc" },
        "Profile 1": { name: WORK_PROFILE_NAME },
      },
    },
  });
  await IOUtils.writeJSON(
    PathUtils.join(root, "StorableSidebar.json"),
    arcSidebar()
  );
  await IOUtils.writeJSON(PathUtils.join(root, "StorableWindows.json"), {
    lastFocusedSpaceID: "personal",
  });
  await writeCookies(PathUtils.join(userData, "Default", "Cookies"), [
    { host: ".arc-import.example", name: "session", value: "personal-secret" },
  ]);
  await writeCookies(PathUtils.join(userData, "Profile 1", "Cookies"), [
    { host: ".arc-import.example", name: "session", value: "work-secret" },
  ]);

  let spacesBefore = Services.prefs.getStringPref("browser.spaces.list", "");
  let tabsBefore = new Set(gBrowser.tabs);

  let migrator = new ArcProfileMigrator();
  migrator._chromeUserDataPath = userData;
  migrator._keychainMockPassphrase = PASSPHRASE;

  Assert.equal(await migrator.getSourceProfiles(), null, "One entry for Arc");
  let types = await migrator.getMigrateData(null);
  let { BOOKMARKS, COOKIES, SESSION } = MigrationUtils.resourceTypes;
  Assert.ok(types & SESSION, "Spaces and tabs are offered");
  Assert.ok(types & COOKIES, "Sign-ins are offered");
  Assert.ok(types & BOOKMARKS, "Bookmarks are offered");

  let ended = TestUtils.topicObserved("Migration:Ended");
  await migrator.migrate(BOOKMARKS | COOKIES | SESSION, false, null);
  await ended;

  let spaces = JSON.parse(Services.prefs.getStringPref("browser.spaces.list"));
  let personal = spaces.find(s => s.id == "arc-personal");
  let work = spaces.find(s => s.id == "arc-work");
  Assert.ok(personal && work, "Both Arc spaces were added");
  Assert.equal(personal.emoji, "\u{1F98B}", "The emoji carries over");
  Assert.equal(personal.color, "purple", "The theme color maps to purple");
  Assert.ok(!personal.userContextId, "The default profile uses no container");
  Assert.equal(work.icon, "briefcase", "The symbol maps to an icon");
  let identity = ContextualIdentityService.getPublicIdentityFromId(
    work.userContextId
  );
  Assert.equal(identity?.name, WORK_PROFILE_NAME, "The profile is a container");

  let imported = gBrowser.tabs.filter(t => !tabsBefore.has(t));
  let inSpace = id => imported.filter(t => t.getAttribute("space") == id);
  let personalTabs = inSpace("arc-personal");
  let pinned = personalTabs.filter(t => t.pinned);
  Assert.deepEqual(
    pinned.map(t => t.getAttribute("pinned-url")),
    [
      "https://example.com/fav1",
      "https://example.org/fav2",
      "https://example.com/pin1",
    ],
    "Favorites, then pinned tabs, are pinned with their addresses"
  );

  let group = gBrowser.tabGroups.find(g => g.label == "Reading");
  Assert.ok(group?.collapsed, "A pinned folder is a collapsed tab group");
  Assert.equal(group.tabs.length, 2, "Nested folders flatten into the group");

  let split = personalTabs.find(t => t.splitview)?.splitview;
  Assert.ok(split, "The split view carries over");
  Assert.equal(split.tabs.length, 3, "With all three panes");
  let layout = split.layout;
  Assert.equal(layout.axis, "row", "Side by side");
  Assert.less(Math.abs(layout.ratio - 0.5), 0.01, "The first pane keeps half");

  Assert.ok(
    !imported.some(t => t.linkedBrowser.currentURI.spec.startsWith("arc:")),
    "Arc internal pages are skipped"
  );
  Assert.equal(inSpace("arc-work").length, 1, "The other space has its tab");
  Assert.ok(
    inSpace("arc-work").every(t => t.hidden),
    "Tabs of the other space are hidden"
  );
  Assert.equal(
    inSpace("arc-work")[0].userContextId,
    work.userContextId,
    "Tabs of a profile's space open in its container"
  );
  Assert.equal(
    gBrowser.selectedTab.getAttribute("space"),
    "arc-personal",
    "Arc's last space is shown"
  );
  let loaded = imported.filter(
    t => t.linkedPanel && t != gBrowser.selectedTab && !t.pinned
  );
  Assert.equal(loaded.length, 0, "Imported tabs stay unloaded");

  let cookieValue = userContextId =>
    Services.cookies
      .getCookiesFromHost("arc-import.example", { userContextId })
      .find(c => c.name == "session")?.value;
  Assert.equal(cookieValue(0), "personal-secret", "Cookies are decrypted");
  Assert.equal(
    cookieValue(work.userContextId),
    "work-secret",
    "Another profile's cookies go to its container"
  );

  let tree = await PlacesUtils.promiseBookmarksTree(
    PlacesUtils.bookmarks.unfiledGuid
  );
  let fromArc = tree.children?.find(c => c.title == "From Arc");
  Assert.ok(fromArc, "Favorites and pinned folders are saved as bookmarks");
  let personalFolder = fromArc.children.find(c => c.title == "Personal");
  let reading = personalFolder.children.find(c => c.title == "Reading");
  Assert.ok(
    reading.children.some(c => c.title == "Later"),
    "Bookmarks keep nested folders"
  );

  for (let tab of imported) {
    BrowserTestUtils.removeTab(tab);
  }
  for (let tab of gBrowser.tabs) {
    tab.removeAttribute("space");
  }
  if (spacesBefore) {
    Services.prefs.setStringPref("browser.spaces.list", spacesBefore);
  } else {
    Services.prefs.clearUserPref("browser.spaces.list");
  }
  Services.prefs.clearUserPref("browser.spaces.active");
  ContextualIdentityService.remove(work.userContextId);
  Services.cookies.removeAll();
  await PlacesUtils.bookmarks.remove(fromArc.guid);
  await IOUtils.remove(root, { recursive: true });
});
