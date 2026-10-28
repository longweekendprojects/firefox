/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// With browser.urlbar.autoFill.anyVisitedOrigin, any recently visited site
// autofills, the most visited first, even when other sites are visited far
// more often and raise the average rank above it.

ChromeUtils.defineLazyGetter(this, "PlacesFrecencyRecalculator", () => {
  return Cc["@mozilla.org/places/frecency-recalculator;1"].getService(
    Ci.nsIObserver
  ).wrappedJSObject;
});

testEngine_setup();

async function visit(url, count, transition) {
  await PlacesTestUtils.addVisits(
    new Array(count).fill(url).map(u => ({ url: u, transition }))
  );
}

add_task(async function test_rarely_visited_site_autofills() {
  const { TRANSITION_LINK, TRANSITION_TYPED } = PlacesUtils.history;
  await visit("https://busy.example.org/", 40, TRANSITION_TYPED);
  await visit("https://www.namecheap.com/", 1, TRANSITION_LINK);
  await visit("https://nameless.example.net/", 1, TRANSITION_LINK);
  await visit("https://nameless.example.net/", 1, TRANSITION_LINK);
  await PlacesFrecencyRecalculator.recalculateAnyOutdatedFrecencies();

  let rows = await (
    await PlacesUtils.promiseDBConnection()
  ).execute(
    "SELECT alt_frecency FROM moz_origins WHERE host = 'www.namecheap.com'"
  );
  Assert.less(
    rows[0].getResultByName("alt_frecency"),
    await PlacesUtils.metadata.get("origin_alt_frecency_threshold", 0),
    "The site ranks below the average"
  );

  let context = createContext("namec", { isPrivate: false });
  await check_results({
    context,
    autofilled: "namecheap.com/",
    completed: "https://www.namecheap.com/",
    matches: [
      makeVisitResult(context, {
        uri: "https://www.namecheap.com/",
        title: "test visit for https://www.namecheap.com/",
        heuristic: true,
      }),
    ],
  });

  context = createContext("name", { isPrivate: false });
  await check_results({
    context,
    autofilled: "nameless.example.net/",
    completed: "https://nameless.example.net/",
    matches: [
      makeVisitResult(context, {
        uri: "https://nameless.example.net/",
        title: "test visit for https://nameless.example.net/",
        heuristic: true,
      }),
      makeVisitResult(context, {
        uri: "https://www.namecheap.com/",
        title: "test visit for https://www.namecheap.com/",
      }),
    ],
  });
  await PlacesUtils.history.clear();
});
