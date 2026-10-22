/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gBrowser, gURLBar, isBlankPageURL */

/**
 * A little window: a small popup window for a quick look at a page or a
 * quick search, with its own navigation controls. Links and new tabs from it
 * open in a full browser window, like from any popup window. Its page moves
 * to a full browser window with "Open in Window" or Accel+O. A little window
 * left in the background closes after browser.littlewindow.closeAfterIdleSeconds.
 *
 * Loaded into a window opened with the littleWindow load parameter.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

const IDLE_PREF = "browser.littlewindow.closeAfterIdleSeconds";
const MAX_WIDTH = 1100;
const MAX_HEIGHT = 800;

/** Size of a little window showing a page, for the current screen. */
export function pageSize(aScreen) {
  return {
    width: Math.round(Math.min(MAX_WIDTH, aScreen.availWidth * 0.7)),
    height: Math.round(Math.min(MAX_HEIGHT, aScreen.availHeight * 0.8)),
  };
}

/** Size of a little window opened empty, for a search. */
export const LAUNCHER_SIZE = { width: 600, height: 420 };

let growListener = null;
let idleTimer = 0;

export function init() {
  window.gLittleWindow = { moveToWindow };

  const button = document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button"
  );
  button.id = "little-window-open";
  document.l10n.setAttributes(button, "little-window-open");
  button.addEventListener("click", moveToWindow);
  document.getElementById("nav-bar").append(button);

  window.addEventListener("deactivate", startIdleTimer);
  window.addEventListener("activate", stopIdleTimer);

  if (isBlankPageURL(gBrowser.currentURI.spec)) {
    gURLBar.select();
    gURLBar.view.autoOpen({ event: new window.FocusEvent("focus") });
    growListener = {
      onLocationChange(webProgress, request, uri) {
        if (webProgress.isTopLevel && !isBlankPageURL(uri.spec)) {
          gBrowser.removeProgressListener(growListener);
          growListener = null;
          grow();
        }
      },
    };
    gBrowser.addProgressListener(growListener);
  }
}

function startIdleTimer() {
  stopIdleTimer();
  const seconds = Services.prefs.getIntPref(IDLE_PREF, 0);
  if (seconds > 0) {
    idleTimer = window.setTimeout(() => window.close(), seconds * 1000);
  }
}

function stopIdleTimer() {
  window.clearTimeout(idleTimer);
  idleTimer = 0;
}

/** Grows a window opened for a search to the size of a page window. */
function grow() {
  const { width, height } = pageSize(window.screen);
  if (window.outerWidth >= width && window.outerHeight >= height) {
    return;
  }
  const left = window.screenX - Math.round((width - window.outerWidth) / 2);
  window.resizeTo(width, height);
  window.moveTo(
    Math.max(window.screen.availLeft, left),
    Math.max(window.screen.availTop, window.screenY)
  );
}

/** Moves the page to the frontmost full browser window, or a new one. */
export function moveToWindow() {
  const tab = gBrowser.selectedTab;
  const target = lazy.BrowserWindowTracker.getTopWindow({
    private: lazy.PrivateBrowsingUtils.isWindowPrivate(window),
  });
  if (!target) {
    const args = Cc["@mozilla.org/array;1"].createInstance(Ci.nsIMutableArray);
    args.appendElement(tab);
    lazy.BrowserWindowTracker.openWindow({
      private: lazy.PrivateBrowsingUtils.isWindowPrivate(window),
      openerWindow: window,
      args,
    });
    return;
  }
  if (target.gBrowser.adoptTab(tab, { selectTab: true })) {
    target.focus();
  }
}
