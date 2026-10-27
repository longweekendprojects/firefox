/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A notice that guides the user through trusting this browser in the
 * 1Password app. 1Password unlocks with Touch ID only in browsers it trusts
 * by their signature, and a build that is not on its built-in list must be
 * added under Settings > Browser > Add Browser.
 *
 * Every message from 1Password's native helper reports whether it trusts the
 * browser: "Known" when trusted, "Untrusted" for a signed browser it does not
 * trust yet. The notice shows while the helper reports "Untrusted" and closes
 * once it reports "Known".
 */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
});

export const HELPER_NAME = "com.1password.1password";
export const APP_PATH = "/Applications/1Password.app";
const ENABLED_PREF = "browser.onepassword.trustPrompt.enabled";
const NOTIFICATION_VALUE = "onepassword-trust";
const MESSAGE_TOPIC = "native-app-message";

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
    Services.obs.addObserver(this, MESSAGE_TOPIC);
  },

  observe(aSubject, aTopic, aData) {
    if (aTopic != MESSAGE_TOPIC || aData != HELPER_NAME) {
      return;
    }
    let msg = aSubject.wrappedJSObject;
    let state = (msg?.browser_state ?? msg?.content?.browser_state)?.type;
    if (state == "Known") {
      this.hide();
    } else if (state == "Untrusted") {
      this.maybeShow();
    }
  },

  hide() {
    for (let win of lazy.BrowserWindowTracker.orderedWindows) {
      let notification =
        win.gNotificationBox?.getNotificationWithValue(NOTIFICATION_VALUE);
      if (notification) {
        win.gNotificationBox.removeNotification(notification);
      }
    }
  },

  async maybeShow() {
    if (
      dismissed ||
      !Services.prefs.getBoolPref(ENABLED_PREF, false) ||
      !this._appFile().exists()
    ) {
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
            this._appFile().launch();
            return true;
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
