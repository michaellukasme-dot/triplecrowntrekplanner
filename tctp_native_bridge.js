/* tctp_native_bridge.js — native-only geolocation shim for the Capacitor Android/iOS shell.
 *
 * GUARDED NO-OP IN THE BROWSER: if window.Capacitor isn't a native platform, this file returns
 * immediately and does nothing — the live web app (triplecrowntrekplanner.com) behaves EXACTLY
 * as before. The same file ships to the PWA and the native shell.
 *
 * In the native shell it re-points the app's existing navigator.geolocation calls at
 * @capacitor/geolocation, which owns the Android/iOS location permission + system prompt.
 * That means the inline GPS code (startGPS / initDefaultGps / watchPosition / clearWatch)
 * works UNCHANGED inside the app — no rewrite of the 749 KB index.html required.
 *
 * Phase 1 = foreground GPS (screen on / app foregrounded). Screen-off BACKGROUND GPS is Phase 2
 * (adds @transistorsoft/capacitor-background-geolocation + a paid release license).
 */
(function () {
  "use strict";

  function isNative() {
    try {
      return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch (e) { return false; }
  }
  if (!isNative()) return;   // ← browser path: do nothing, leave web geolocation intact

  var patched = false, tries = 0;

  function shape(p) {
    var c = (p && p.coords) || {};
    return {
      coords: {
        latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy,
        altitude: (c.altitude == null ? null : c.altitude),
        altitudeAccuracy: (c.altitudeAccuracy == null ? null : c.altitudeAccuracy),
        heading: (c.heading == null ? null : c.heading),
        speed: (c.speed == null ? null : c.speed)
      },
      timestamp: p.timestamp || Date.now()
    };
  }

  function patch() {
    if (patched) return true;
    var Geo = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation;
    if (!Geo) return false;   // plugin proxy not ready yet — caller will retry

    var g = navigator.geolocation || (navigator.geolocation = {});
    var watchers = {}, seq = 1;

    g.getCurrentPosition = function (ok, err, opts) {
      opts = opts || {};
      Geo.getCurrentPosition({
        enableHighAccuracy: opts.enableHighAccuracy !== false,
        timeout: opts.timeout || 30000,
        maximumAge: opts.maximumAge || 0
      }).then(function (p) { try { ok && ok(shape(p)); } catch (_) {} })
        .catch(function (e) {
          try { err && err({ code: 2, message: String(e && e.message || e), PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); } catch (_) {}
        });
    };

    g.watchPosition = function (ok, err, opts) {
      opts = opts || {};
      var id = seq++;
      Geo.watchPosition({
        enableHighAccuracy: opts.enableHighAccuracy !== false,
        timeout: opts.timeout || 30000,
        maximumAge: opts.maximumAge || 0
      }, function (p, e) {
        if (e) { try { err && err({ code: 2, message: String(e.message || e), PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); } catch (_) {} return; }
        if (p) { try { ok && ok(shape(p)); } catch (_) {} }
      }).then(function (wid) { watchers[id] = wid; })
        .catch(function () {});
      return id;
    };

    g.clearWatch = function (id) {
      var wid = watchers[id];
      if (wid != null) { try { Geo.clearWatch({ id: wid }); } catch (_) {} delete watchers[id]; }
    };

    patched = true;
    try { console.log("[TCTP] native geolocation bridge active"); } catch (_) {}
    return true;
  }

  // Patch as early as possible. Capacitor injects its runtime before page scripts, but the plugin
  // proxy can lag a tick — retry briefly and also on DOMContentLoaded, so the shim is guaranteed
  // in place before the app's initDefaultGps() auto-starts GPS.
  if (!patch()) {
    var iv = setInterval(function () { tries++; if (patch() || tries > 60) clearInterval(iv); }, 30);
    document.addEventListener("DOMContentLoaded", patch);
  }
})();
