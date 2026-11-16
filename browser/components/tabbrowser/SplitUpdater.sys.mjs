/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Offers new releases of this build from its GitHub releases page.
 *
 * Firefox's own updater is off in these builds, because it would replace the
 * app with a stock build. Once a day this asks GitHub for the latest release.
 * When it is newer than the running build, a notice offers to restart into
 * it. Restarting downloads the DMG, checks that Apple notarized it and that
 * its app carries our Developer ID, copies the app next to the running one,
 * then quits. A detached shell swaps the apps once this process exits and
 * reopens the new one, which restores the session.
 *
 * Builds are identified by the YYMMDD-HHMM stamp that make-dmg.sh writes to
 * split-build.txt and publish-release.sh puts at the end of the release tag.
 */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

const ENABLED_PREF = "browser.splitUpdate.enabled";
const URL_PREF = "browser.splitUpdate.url";
const LAST_CHECK_PREF = "browser.splitUpdate.lastCheck";
const NOTIFICATION_VALUE = "split-update";
const ASSET_NAME = "Nightly-Split-macOS-arm64.dmg";
const TEAM_ID = "3LY4F2RNVS";
const CHECK_INTERVAL_S = 24 * 60 * 60;
const FIRST_CHECK_DELAY_MS = 60 * 1000;
const RECHECK_DELAY_MS = 6 * 60 * 60 * 1000;
const STAMP = /(\d{6}-\d{4})$/;

// Mounts the DMG, checks Apple's notarization and our team's signature, and
// copies the app next to the installed one. Arguments: dmg, mount, staged.
const STAGE_SCRIPT = `
set -eu
/usr/sbin/spctl --assess --type open --context context:primary-signature "$1"
/bin/mkdir -p "$2"
/usr/bin/hdiutil attach -quiet -nobrowse -noautoopen -readonly -mountpoint "$2" "$1"
trap '/usr/bin/hdiutil detach -quiet "$2" || true' EXIT
/usr/bin/codesign --verify --deep --strict \\
  -R='anchor apple generic and certificate leaf[subject.OU] = "${TEAM_ID}"' \\
  "$2/Nightly.app"
/bin/rm -rf "$3"
/usr/bin/ditto "$2/Nightly.app" "$3"
/usr/bin/xattr -dr com.apple.quarantine "$3" 2>/dev/null || true
`;

// Waits for this process to exit, swaps in the staged app, and reopens it if
// the quit followed the update right away. Arguments: pid, app, staged, then
// any arguments to reopen with.
const SWAP_SCRIPT = `
pid=$1 app=$2 staged=$3
shift 3
start=$(/bin/date +%s)
while /bin/kill -0 "$pid" 2>/dev/null; do /bin/sleep 0.5; done
[ -d "$staged" ] || exit 1
/bin/rm -rf "$app.old"
/bin/mv "$app" "$app.old" && /bin/mv "$staged" "$app" || {
  [ -d "$app" ] || /bin/mv "$app.old" "$app"
  exit 1
}
/bin/rm -rf "$app.old"
[ $(( $(/bin/date +%s) - start )) -lt 120 ] && /usr/bin/open -n "$app" --args "$@"
exit 0
`;

let started = false;
let timer = null;
let busy = false;

export const SplitUpdater = {
  /** The running build's stamp, or null for builds not from make-dmg.sh. */
  installedStamp: undefined,

  async init() {
    if (started || AppConstants.platform != "macosx") {
      return;
    }
    started = true;
    if (this.installedStamp === undefined) {
      this.installedStamp = await this._readInstalledStamp();
    }
    if (this.installedStamp) {
      IOUtils.remove(this._appPaths().staged, { recursive: true }).catch(
        () => {}
      );
      this._schedule(FIRST_CHECK_DELAY_MS);
    }
  },

  _schedule(aDelay) {
    lazy.clearTimeout(timer);
    timer = lazy.setTimeout(() => {
      timer = null;
      this.maybeCheck().finally(() => this._schedule(RECHECK_DELAY_MS));
    }, aDelay);
  },

  async _readInstalledStamp() {
    try {
      let file = Services.dirsvc.get("GreD", Ci.nsIFile);
      file.append("split-build.txt");
      let text = await IOUtils.readUTF8(file.path);
      return STAMP.exec(text.trim())?.[1] ?? null;
    } catch {
      return null;
    }
  },

  /** Checks for a release if the last check was a day or more ago. */
  async maybeCheck() {
    let now = Math.floor(Date.now() / 1000);
    let last = Services.prefs.getIntPref(LAST_CHECK_PREF, 0);
    if (now - last < CHECK_INTERVAL_S) {
      return null;
    }
    return this.check();
  },

  /**
   * Asks GitHub for the latest release and shows the notice when it is newer
   * than the running build. Resolves to the release, or null.
   */
  async check() {
    if (
      !Services.prefs.getBoolPref(ENABLED_PREF, false) ||
      !this.installedStamp
    ) {
      return null;
    }
    let release;
    try {
      let response = await fetch(Services.prefs.getStringPref(URL_PREF), {
        headers: { Accept: "application/vnd.github+json" },
        cache: "no-store",
      });
      if (!response.ok) {
        return null;
      }
      release = this.parseRelease(await response.json());
    } catch (e) {
      console.error("SplitUpdater: check failed", e);
      return null;
    }
    Services.prefs.setIntPref(LAST_CHECK_PREF, Math.floor(Date.now() / 1000));
    if (!release || release.stamp <= this.installedStamp) {
      return null;
    }
    this.showAvailable(release);
    return release;
  },

  /** Picks the fields we need from a GitHub release, or null. */
  parseRelease(aJSON) {
    let stamp = STAMP.exec(aJSON?.tag_name ?? "")?.[1];
    let asset = aJSON?.assets?.find(a => a.name == ASSET_NAME);
    if (!stamp || !asset?.browser_download_url) {
      return null;
    }
    return {
      stamp,
      name: aJSON.name || aJSON.tag_name,
      dmgURL: asset.browser_download_url,
      pageURL: aJSON.html_url,
    };
  },

  _window() {
    return lazy.BrowserWindowTracker.getTopWindow({ private: false });
  },

  _show(aL10nId, aArgs, aButtons, aPriority) {
    this.hide();
    let win = this._window();
    if (!win) {
      return null;
    }
    return win.gNotificationBox.appendNotification(
      NOTIFICATION_VALUE,
      {
        label: aArgs
          ? { "l10n-id": aL10nId, "l10n-args": aArgs }
          : { "l10n-id": aL10nId },
        priority: aPriority ?? win.gNotificationBox.PRIORITY_INFO_MEDIUM,
      },
      aButtons
    );
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

  showAvailable(aRelease) {
    if (busy) {
      return null;
    }
    return this._show("split-update-available", { name: aRelease.name }, [
      {
        "l10n-id": "split-update-restart",
        callback: () => {
          this.update(aRelease);
          return true;
        },
      },
    ]);
  },

  showFailed(aRelease) {
    let win = this._window();
    return this._show(
      "split-update-failed",
      null,
      [
        {
          "l10n-id": "split-update-open-page",
          callback: () => {
            this._window()?.openTrustedLinkIn(aRelease.pageURL, "tab");
          },
        },
      ],
      win?.gNotificationBox.PRIORITY_WARNING_MEDIUM
    );
  },

  /** Paths of the running app and of the staged copy beside it. */
  _appPaths() {
    let app = Services.dirsvc.get("GreD", Ci.nsIFile).parent.parent;
    return {
      app: app.path,
      staged: PathUtils.join(app.parent.path, ".Nightly-update.app"),
      dir: app.parent.path,
    };
  },

  async _run(aScript, aArgs) {
    let proc = await lazy.Subprocess.call({
      command: "/bin/sh",
      arguments: ["-c", aScript, "sh", ...aArgs],
      stderr: "stdout",
    });
    let output = "";
    let chunk;
    while ((chunk = await proc.stdout.readString())) {
      output += chunk;
    }
    let { exitCode } = await proc.wait();
    return { exitCode, output };
  },

  /** Downloads, checks and stages the release, then restarts into it. */
  async update(aRelease) {
    if (busy) {
      return false;
    }
    busy = true;
    try {
      this._show("split-update-downloading", null, []);
      let paths = this._appPaths();
      if (!Services.dirsvc.get("GreD", Ci.nsIFile).parent.parent.isWritable()) {
        throw new Error(`${paths.app} is not writable`);
      }
      let tmp = await IOUtils.createUniqueDirectory(
        PathUtils.tempDir,
        "split-update"
      );
      let dmg = PathUtils.join(tmp, ASSET_NAME);
      await lazy.Downloads.fetch(aRelease.dmgURL, dmg);
      let stage = await this._run(STAGE_SCRIPT, [
        dmg,
        PathUtils.join(tmp, "mnt"),
        paths.staged,
      ]);
      await IOUtils.remove(tmp, { recursive: true, ignoreAbsent: true });
      if (stage.exitCode) {
        throw new Error(`staging failed: ${stage.output}`);
      }
      this.hide();
      return this._restart(paths);
    } catch (e) {
      console.error("SplitUpdater: update failed", e);
      this.showFailed(aRelease);
      return false;
    } finally {
      busy = false;
    }
  },

  async _restart(aPaths) {
    let cancel = Cc["@mozilla.org/supports-PRBool;1"].createInstance(
      Ci.nsISupportsPRBool
    );
    Services.obs.notifyObservers(
      cancel,
      "quit-application-requested",
      "restart"
    );
    if (cancel.data) {
      await IOUtils.remove(aPaths.staged, { recursive: true });
      return false;
    }
    let args = [];
    let profiles = Cc["@mozilla.org/toolkit/profile-service;1"].getService(
      Ci.nsIToolkitProfileService
    );
    if (!profiles.currentProfile) {
      args.push("-profile", PathUtils.profileDir);
    }
    let quoted = [
      Services.appinfo.processID,
      aPaths.app,
      aPaths.staged,
      ...args,
    ].map(a => `'${String(a).replaceAll("'", `'\\''`)}'`);
    let log = PathUtils.join(PathUtils.tempDir, "split-update.log");
    // The swap runs in the background so it outlives this process.
    let launcher = `/usr/bin/nohup /bin/sh -c "$1" swap ${quoted.join(" ")} > '${log}' 2>&1 < /dev/null &`;
    let { exitCode } = await this._run(launcher, [SWAP_SCRIPT]).catch(() => ({
      exitCode: 1,
    }));
    if (exitCode) {
      return false;
    }
    Services.prefs.setBoolPref(
      "browser.sessionstore.resume_session_once",
      true
    );
    this._quit();
    return true;
  },

  /** Quits the app; tests replace it. */
  _quit() {
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  },

  /** Lets tests start over. */
  _reset() {
    lazy.clearTimeout(timer);
    timer = null;
    busy = false;
    started = false;
  },
};
