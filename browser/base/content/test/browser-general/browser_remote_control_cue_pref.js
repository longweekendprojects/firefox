/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_cue_follows_pref() {
  let root = document.documentElement;
  let original = gRemoteControl.getRemoteControlComponent;
  gRemoteControl.getRemoteControlComponent = () => "Marionette";
  registerCleanupFunction(() => {
    gRemoteControl.getRemoteControlComponent = original;
    gRemoteControl.updateVisualCue();
  });

  gRemoteControl.updateVisualCue();
  ok(!root.hasAttribute("remotecontrol"), "The cue is hidden by default.");

  await SpecialPowers.pushPrefEnv({
    set: [["browser.remoteControl.visualCue", true]],
  });
  gRemoteControl.updateVisualCue();
  ok(root.hasAttribute("remotecontrol"), "The pref brings the cue back.");
  await SpecialPowers.popPrefEnv();

  gRemoteControl.updateVisualCue();
  ok(!root.hasAttribute("remotecontrol"), "Clearing the pref hides it again.");
});
