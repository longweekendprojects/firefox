/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This module exports a provider that lists the most recently used tabs when
 * the floating command bar opens empty, so arrow keys reach them at once.
 */

import {
  UrlbarProvider,
  UrlbarUtils,
} from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  UrlbarResult: "chrome://browser/content/urlbar/UrlbarResult.mjs",
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
});

const MAX_TABS = 3;

/**
 *
 */
export class UrlbarProviderRecentTabs extends UrlbarProvider {
  /**
   * @returns {Values<typeof lazy.UrlbarShared.PROVIDER_TYPE>}
   */
  get type() {
    return lazy.UrlbarShared.PROVIDER_TYPE.PROFILE;
  }

  async isActive(queryContext) {
    return (
      queryContext.isCommandBar &&
      !queryContext.searchString &&
      !queryContext.searchMode &&
      !queryContext.restrictSource
    );
  }

  getPriority() {
    return 1;
  }

  /**
   * @param {UrlbarQueryContext} queryContext
   * @param {(provider: UrlbarProvider, result: UrlbarResult) => void} addCallback
   */
  async startQuery(queryContext, addCallback) {
    let tabs = [];
    for (let win of lazy.BrowserWindowTracker.getOrderedWindows({
      private: queryContext.isPrivate,
    })) {
      for (let tab of win.gBrowser.tabs) {
        let url = tab.linkedBrowser.currentURI?.spec;
        if (
          !tab.selected &&
          !tab.closing &&
          url &&
          !["about:blank", "about:home", "about:newtab"].includes(url) &&
          Number.isFinite(tab.lastAccessed)
        ) {
          tabs.push({ tab, url });
        }
      }
    }
    tabs.sort((a, b) => b.tab.lastAccessed - a.tab.lastAccessed);
    tabs.length = Math.min(tabs.length, MAX_TABS);

    tabs.forEach(({ tab, url }, index) => {
      let userContextId = tab.userContextId;
      addCallback(
        this,
        new lazy.UrlbarResult({
          type: lazy.UrlbarShared.RESULT_TYPE.TAB_SWITCH,
          source: lazy.UrlbarShared.RESULT_SOURCE.TABS,
          // Recent tabs come first, above recent searches.
          suggestedIndex: index,
          payload: {
            url,
            title: tab.label,
            icon:
              tab.getAttribute("image") || lazy.UrlbarShared.getIconForUrl(url),
            userContext: UrlbarUtils.getUserContextData(userContextId),
            lastVisit: tab.lastAccessed,
          },
        })
      );
    });
  }
}
