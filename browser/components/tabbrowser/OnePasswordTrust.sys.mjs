/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A one-time notice that guides the user through trusting this browser in
 * the 1Password app. 1Password unlocks with Touch ID only in browsers it
 * trusts by their signature, and a build that is not on its built-in list
 * must be added under Settings > Browser > Add Browser.
 *
 * The notice shows on macOS while the 1Password extension is enabled and the
 * 1Password app is installed, until the user opens 1Password from it.
 */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
});

export const EXTENSION_ID = "{d634138d-c276-4fc8-924b-40a0ea21d284}";
export const APP_PATH = "/Applications/1Password.app";
const ENABLED_PREF = "browser.onepassword.trustPrompt.enabled";
const DONE_PREF = "browser.onepassword.trustPrompt.done";
const NOTIFICATION_VALUE = "onepassword-trust";

let started = false;
let dismissed = false;

export const OnePasswordTrust = {
  /** Path to the 1Password app; tests replace it. */
  appPath: APP_PATH,

  init() {
    if (started || AppConstants.platform != "macosx") {
      return;
    }
    started = true;
    lazy.AddonManager.addAddonListener(this);
    this.maybeShow();
  },

  onEnabled(aAddon) {
    if (aAddon.id == EXTENSION_ID) {
      this.maybeShow();
    }
  },

  onInstalled(aAddon) {
    this.onEnabled(aAddon);
  },

  async maybeShow() {
    if (
      dismissed ||
      !Services.prefs.getBoolPref(ENABLED_PREF, false) ||
      Services.prefs.getBoolPref(DONE_PREF, false)
    ) {
      return false;
    }
    let addon = await lazy.AddonManager.getAddonByID(EXTENSION_ID);
    if (!addon?.isActive || !this._appFile().exists()) {
      return false;
    }
    let win = lazy.BrowserWindowTracker.getTopWindow({ private: false });
    if (
      !win ||
      win.gNotificationBox.getNotificationWithValue(NOTIFICATION_VALUE)
    ) {
      return false;
    }
    await win.gNotificationBox.appendNotification(
      NOTIFICATION_VALUE,
      {
        label: { "l10n-id": "onepassword-trust-message" },
        priority: win.gNotificationBox.PRIORITY_INFO_MEDIUM,
        eventCallback: aEvent => {
          if (aEvent == "dismissed") {
            dismissed = true;
          }
        },
      },
      [
        {
          "l10n-id": "onepassword-trust-open",
          callback: () => {
            Services.prefs.setBoolPref(DONE_PREF, true);
            this._appFile().launch();
          },
        },
      ]
    );
    return true;
  },

  _appFile() {
    let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(this.appPath);
    return file;
  },

  /** Lets tests start over. */
  _reset() {
    dismissed = false;
  },
};
