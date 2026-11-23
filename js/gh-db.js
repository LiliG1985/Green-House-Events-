/* Greenhouse Events: shared Supabase connection for the website and /admin.
   Reads the project address and public key from /api/config (set in Vercel). */
window.GHDB = (function () {
  var promise = null;
  function client() {
    if (promise) return promise;
    promise = (window.GH_CONFIG ? Promise.resolve(window.GH_CONFIG)
      : fetch("/api/config", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }))
      .then(function (c) {
        if (!c || !c.url || !c.anonKey || !window.supabase) return null;
        return window.supabase.createClient(c.url, c.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
      })
      .catch(function () { return null; });
    return promise;
  }

  /* Shrinks a photo in the browser (longest edge max px) and returns a JPEG Blob. */
  function shrinkImage(file, max) {
    max = max || 2000;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, r = Math.min(1, max / Math.max(w, h));
        var c = document.createElement("canvas");
        c.width = Math.round(w * r); c.height = Math.round(h * r);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error("Could not read this image")); }, "image/jpeg", 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Could not read this image")); };
      img.src = url;
    });
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (ch) {
      var r = Math.random() * 16 | 0; return (ch === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }

  return { client: client, shrinkImage: shrinkImage, uuid: uuid };
})();
