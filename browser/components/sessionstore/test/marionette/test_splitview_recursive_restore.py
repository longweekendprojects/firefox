# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import os
import sys
from urllib.parse import quote

sys.path.append(os.path.dirname(__file__))

from session_store_test_case import SessionStoreTestCase


def inline(doc):
    return f"data:text/html;charset=utf-8,{quote(doc)}"


DEFAULT_WINDOWS = set([
    (
        inline("<div>one</div>"),
        inline("<div>two</div>"),
        inline("<div>three</div>"),
        inline("<div>four</div>"),
        inline("<div>five</div>"),
    ),
])

# Builds 0 | (1 over 2) from the first three tabs, sets ratios, selects
# `selected`, then writes the session to disk.
CREATE_SPLIT = """
let [selected, resolve] = arguments;
let tabs = gBrowser.tabs.slice(0, 3);
gBrowser.selectedTab = tabs[0];
let sv = gBrowser.addTabSplitView(tabs.slice(0, 2), { insertBefore: tabs[0] });
sv.splitPane(tabs[1], "down", tabs[2]);
sv.setLayoutRatio("", 0.3);
sv.setLayoutRatio("1", 0.7);
gBrowser.selectedTab = gBrowser.tabs[selected];
let { TabStateFlusher } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs"
);
let { SessionSaver } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sessionstore/SessionSaver.sys.mjs"
);
TabStateFlusher.flushWindow(window)
  .then(() => SessionSaver.run())
  .then(resolve);
"""

WAIT_RESTORED = """
let [resolve] = arguments;
let { SessionStore } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs"
);
SessionStore.promiseAllWindowsRestored.then(resolve);
"""

READ_SPLIT = """
let sv = gBrowser.tabs[0].splitview;
if (!sv) {
  return null;
}
return {
  count: sv.tabs.length,
  layout: sv.state.layout,
  active: gBrowser.activeSplitView == sv,
  headers: document.querySelectorAll(".split-pane-header").length,
  lazy: sv.tabs.filter(t => !t.linkedPanel || t.hasAttribute("pending")).length,
  tabCount: gBrowser.tabs.length,
};
"""

EXPECTED_LAYOUT = {
    "version": 1,
    "root": {
        "axis": "row",
        "ratio": 0.3,
        "first": {"id": 0},
        "second": {
            "axis": "column",
            "ratio": 0.7,
            "first": {"id": 1},
            "second": {"id": 2},
        },
    },
}


class TestRecursiveSplitViewRestore(SessionStoreTestCase):
    def setUp(self):
        super().setUp(
            startup_page=3,
            include_private=False,
            restore_on_demand=True,
            test_windows=DEFAULT_WINDOWS,
        )
        self.marionette.set_context("chrome")
        self.wait_for_windows(
            self.all_windows, "Not all requested windows have been opened"
        )

    def restart_and_read(self, in_app):
        if in_app:
            self.marionette.quit()
        else:
            # Kill the process without a clean shutdown, as a crash would.
            self.marionette.quit(in_app=False)
        self.marionette.start_session()
        self.marionette.set_context("chrome")
        self.marionette.execute_async_script(WAIT_RESTORED)
        return self.marionette.execute_script(READ_SPLIT)

    def test_inactive_split_restored_after_quit(self):
        self.marionette.execute_async_script(CREATE_SPLIT, script_args=[4])
        split = self.restart_and_read(in_app=True)
        self.assertIsNotNone(split, "split restored")
        self.assertEqual(split["count"], 3)
        self.assertEqual(split["layout"], EXPECTED_LAYOUT)
        self.assertFalse(split["active"], "split stays inactive")
        self.assertEqual(split["headers"], 0, "no pane chrome while inactive")
        self.assertEqual(split["lazy"], 3, "inactive panes stay unloaded")
        self.assertEqual(split["tabCount"], 5)

    def test_active_split_restored_after_quit(self):
        self.marionette.execute_async_script(CREATE_SPLIT, script_args=[1])
        split = self.restart_and_read(in_app=True)
        self.assertIsNotNone(split, "split restored")
        self.assertEqual(split["layout"], EXPECTED_LAYOUT)
        self.assertTrue(split["active"], "selected split is shown")
        self.assertEqual(split["headers"], 3, "every pane has a header")
        self.assertEqual(split["tabCount"], 5)

    def test_split_restored_after_crash(self):
        self.marionette.set_pref("browser.sessionstore.resume_from_crash", True)
        self.marionette.execute_async_script(
            """
            let [resolve] = arguments;
            Services.prefs.savePrefFile(null);
            resolve();
            """
        )
        self.marionette.execute_async_script(CREATE_SPLIT, script_args=[1])
        split = self.restart_and_read(in_app=False)
        self.assertIsNotNone(split, "split restored after a crash")
        self.assertEqual(split["count"], 3)
        self.assertEqual(split["layout"], EXPECTED_LAYOUT)
        self.assertTrue(split["active"], "selected split is shown")
        self.assertEqual(split["headers"], 3)
        self.assertEqual(split["tabCount"], 5)
