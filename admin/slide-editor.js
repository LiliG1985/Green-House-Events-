/* Greenhouse slide editor: rebuilds a slide in the house template (background,
   three photos, title band, logo, bio) so photos and text can be changed later. */
(function () {
  "use strict";
  var W = 1920, H = 1080, LW = 700, G = 10, TOP = 595, RX = LW + G, HALF = Math.floor((W - RX - G) / 2);
  var KIT = "/admin/slide-kit/";
  var kit = null, texts = null;

  function loadImg(src, cors) {
    return new Promise(function (ok, bad) {
      var im = new Image(); if (cors) im.crossOrigin = "anonymous";
      im.onload = function () { ok(im); }; im.onerror = function () { bad(new Error("Could not load an image")); };
      im.src = src;
    });
  }
  function loadKit() {
    if (kit) return kit;
    var fonts = [new FontFace("GHPlayfair", "url(" + KIT + "playfair.ttf)"), new FontFace("GHPlex", "url(" + KIT + "plex.ttf)")];
    kit = Promise.all([
      loadImg(KIT + "bg.jpg"), loadImg(KIT + "logo.png"),
      Promise.all(fonts.map(function (f) { return f.load().then(function (x) { document.fonts.add(x); }); })),
      fetch(KIT + "slide-text.json").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
    ]).then(function (r) { texts = r[3]; return { bg: r[0], logo: r[1] }; });
    kit.catch(function () { kit = null; });
    return kit;
  }

  // Draw an image to fill a box, cropping around a focus point (fx, fy: 0..1).
  function fit(g, img, x0, y0, x1, y1, fx, fy) {
    var w = x1 - x0, h = y1 - y0, iw = img.width, ih = img.height;
    var s = Math.max(w / iw, h / ih), cw = w / s, ch = h / s;
    g.drawImage(img, (iw - cw) * fx, (ih - ch) * fy, cw, ch, x0, y0, w, h);
  }
  function wrapWords(g, text, maxW) {
    var words = String(text || "").split(/\s+/).filter(Boolean), lines = [], line = "";
    words.forEach(function (w) {
      var t = line ? line + " " + w : w;
      if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }
  function wrapChars(text, n) {
    var words = String(text || "").toUpperCase().split(/\s+/).filter(Boolean), lines = [], line = "";
    words.forEach(function (w) { var t = line ? line + " " + w : w; if (t.length > n && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line);
    return lines;
  }

  function render(canvas, st, k) {
    var g = canvas.getContext("2d");
    g.clearRect(0, 0, W, H);
    fit(g, k.bg, 0, 0, W, H, 0.5, 0.5);
    if (st.type === "divider") {
      var lw = Math.min(520, k.logo.width), lh = lw * k.logo.height / k.logo.width;
      if (lh > 420) { lh = 420; lw = lh * k.logo.width / k.logo.height; }
      g.drawImage(k.logo, (W - lw) / 2, 150, lw, lh);
      g.font = "84px GHPlayfair"; g.fillStyle = "rgb(30,30,30)"; g.textAlign = "center"; g.textBaseline = "top";
      var t = String(st.title || "").toUpperCase(), y = 150 + lh + 70;
      g.fillText(t, W / 2, y);
      var tw = g.measureText(t).width; g.strokeStyle = "rgb(184,150,80)"; g.lineWidth = 3;
      g.beginPath(); g.moveTo((W - tw) / 2, y + 121); g.lineTo((W + tw) / 2, y + 121); g.stroke();
      return;
    }
    var ph = st.photos.filter(function (p) { return p && p.img; });
    if (ph[0]) fit(g, ph[0].img, 0, 0, LW, H, ph[0].fx, ph[0].fy);
    g.fillStyle = "rgb(250,248,244)"; g.fillRect(RX - 4, 0, W - RX + 4, TOP + 5);
    if (ph.length >= 3) {
      fit(g, ph[1].img, RX, 0, RX + HALF, TOP, ph[1].fx, ph[1].fy);
      fit(g, ph[2].img, RX + HALF + G, 0, W, TOP, ph[2].fx, ph[2].fy);
    } else if (ph[1]) fit(g, ph[1].img, RX, 0, W, TOP, ph[1].fx, ph[1].fy);
    // title band, white fading to clear
    var band = g.createLinearGradient(RX, 0, RX + 800, 0);
    band.addColorStop(0, "rgba(255,255,255,0.92)"); band.addColorStop(380 / 800, "rgba(255,255,255,0.92)"); band.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = band; g.fillRect(RX, TOP + 28, W - RX, 150);
    g.font = "54px GHPlayfair"; g.fillStyle = "rgb(20,20,20)"; g.textAlign = "left"; g.textBaseline = "top";
    var tl = wrapChars(st.title, 20), ty = TOP + 28 + 75 - tl.length * 31 + 4;
    tl.forEach(function (l) { g.fillText(l, RX + 90, ty); ty += 62; });
    var lw2 = 185, lh2 = lw2 * k.logo.height / k.logo.width; if (lh2 > 140) { lh2 = 140; lw2 = lh2 * k.logo.width / k.logo.height; }
    g.drawImage(k.logo, W - lw2 - 45, TOP + 30, lw2, lh2);
    // bio: biggest size that fits
    var bx0 = RX + 40, bx1 = W - 40, lines = [], size, lhgt;
    for (size = 29; size >= 20; size--) {
      g.font = size + "px GHPlex"; lhgt = Math.round(size * 1.32);
      lines = wrapWords(g, st.bio, bx1 - bx0);
      if (TOP + 205 + lines.length * lhgt <= H - 25) break;
    }
    var y2 = TOP + 205 + Math.max(0, Math.floor((H - 25 - (TOP + 205) - lines.length * lhgt) / 2)) + 3;
    g.fillStyle = "rgb(25,25,25)"; g.textAlign = "center";
    lines.forEach(function (l) { g.fillText(l, (bx0 + bx1) / 2, y2); y2 += lhgt; });
    return { fits: TOP + 205 + lines.length * lhgt <= H - 25 };
  }

  // Crop a region of the current slide image so existing slides open with their photos in place.
  function cropOf(img, x0, y0, x1, y1) {
    var c = document.createElement("canvas"); c.width = x1 - x0; c.height = y1 - y0;
    c.getContext("2d").drawImage(img, x0 * img.width / W, y0 * img.height / H, (x1 - x0) * img.width / W, (y1 - y0) * img.height / H, 0, 0, c.width, c.height);
    return c;
  }
  function fileToCanvas(file, max) {
    return loadImg(URL.createObjectURL(file)).then(function (im) {
      var s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement("canvas");
      c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); return c;
    });
  }
  function toBlob(canvas, q) { return new Promise(function (ok) { canvas.toBlob(ok, "image/jpeg", q || 0.9); }); }

  window.GHSlideEditor = {
    open: function (o) {
      var sb = o.sb, app = o.app, esc = o.esc, slide = o.slide, bucket = o.bucket;
      app.innerHTML = '<div class="pagehead"><div><a href="' + esc(o.back) + '" class="small">&larr; Back</a><h1>Edit slide</h1></div></div><p class="muted">Loading the slide&hellip;</p>';
      var st = null, canvas, timer;
      Promise.all([loadKit(), loadImg(slide.url + (slide.url.indexOf("?") < 0 ? "?" : "&") + "e=" + Date.now(), true)]).then(function (r) {
        var k = r[0], cur = r[1], d = slide.design || null, txt = (texts && texts[(d && d.origin) || slide.path]) || null;
        st = { type: (d && d.type) || (txt && txt.type) || "artist", title: (d && d.title) || (txt && txt.title) || slide.title || "", bio: (d && d.bio != null ? d.bio : (txt && txt.bio) || ""), photos: [] };
        var photoLoads = d && d.photos ? d.photos.map(function (p) { return p ? loadImg(p.url, true).then(function (im) { return { img: im, url: p.url, fx: p.fx, fy: p.fy, cut: !!p.cut }; }) : null; })
          : [{ img: cropOf(cur, 0, 0, LW, H), fx: 0.5, fy: 0.5, fresh: true, cut: true }, { img: cropOf(cur, RX, 0, RX + HALF, TOP), fx: 0.5, fy: 0.5, fresh: true, cut: true }, { img: cropOf(cur, RX + HALF + G, 0, W, TOP), fx: 0.5, fy: 0.5, fresh: true, cut: true }];
        return Promise.all(photoLoads).then(function (ps) { st.photos = ps.concat([null, null, null]).slice(0, 3); draw(k); });
      }).catch(function (e) { o.fail(e); location.hash = o.back; });

      function slot(i) {
        var p = st.photos[i], label = ["Main photo (left)", "Top photo 1", "Top photo 2"][i];
        return '<div class="se-slot" data-slot="' + i + '"><div class="se-slot-head"><strong>' + label + "</strong>" +
          '<label class="btn small">' + (p ? "Replace" : "Add photo") + '<input type="file" accept="image/*" hidden data-file="' + i + '"></label>' +
          (p && i > 0 ? '<button type="button" class="linkbtn del" data-remove="' + i + '">Remove</button>' : "") + "</div>" +
          (p && p.cut ? '<p class="note">Already cut to fit. Replace it to use a new photo and adjust the framing.</p>' : "") +
          (p && !p.cut ? '<label class="se-range">Left &harr; Right<input type="range" min="0" max="100" value="' + Math.round(p.fx * 100) + '" data-fx="' + i + '"></label>' +
            '<label class="se-range">Up &harr; Down<input type="range" min="0" max="100" value="' + Math.round(p.fy * 100) + '" data-fy="' + i + '"></label>' : "") + "</div>";
      }
      function draw(k) {
        var isDiv = st.type === "divider";
        app.innerHTML = '<div class="pagehead"><div><a href="' + esc(o.back) + '" class="small">&larr; Back</a><h1>Edit slide</h1></div>' +
          '<div class="toolbar"><a class="btn" href="' + esc(o.back) + '">Cancel</a><button class="btn primary" type="button" id="seSave">Save slide</button></div></div>' +
          '<div class="se-wrap"><div class="se-preview"><canvas id="seCanvas" width="' + W + '" height="' + H + '"></canvas><p class="note" id="seFit"></p></div>' +
          '<div class="se-form panel">' +
          '<label class="field">Slide type<select id="seType"><option value="artist"' + (isDiv ? "" : " selected") + '>Act slide (photos, name and bio)</option><option value="divider"' + (isDiv ? " selected" : "") + ">Section title (logo and heading)</option></select></label>" +
          '<label class="field">' + (isDiv ? "Heading" : "Name") + '<input type="text" id="seTitle" value="' + esc(st.title) + '"></label>' +
          (isDiv ? "" : '<label class="field">Bio <span class="hint">About 60 to 90 words fits best</span><textarea id="seBio" rows="8">' + esc(st.bio) + "</textarea></label>" +
            slot(0) + slot(1) + slot(2)) + "</div></div>";
        canvas = document.getElementById("seCanvas");
        var paint = function () { var res = render(canvas, st, k); var f = document.getElementById("seFit"); if (f) f.textContent = res && !res.fits ? "The bio is a little long, so some text may sit close to the bottom. Try shortening it." : ""; };
        paint();
        var later = function () { clearTimeout(timer); timer = setTimeout(paint, 60); };
        document.getElementById("seType").addEventListener("change", function (e) { st.type = e.target.value; draw(k); });
        document.getElementById("seTitle").addEventListener("input", function (e) { st.title = e.target.value; later(); });
        var bio = document.getElementById("seBio"); if (bio) bio.addEventListener("input", function (e) { st.bio = e.target.value; later(); });
        app.querySelectorAll("[data-fx],[data-fy]").forEach(function (r) {
          r.addEventListener("input", function () {
            var i = +(r.getAttribute("data-fx") || r.getAttribute("data-fy")), p = st.photos[i];
            if (r.hasAttribute("data-fx")) p.fx = r.value / 100; else p.fy = r.value / 100; later();
          });
        });
        app.querySelectorAll("[data-file]").forEach(function (inp) {
          inp.addEventListener("change", function () {
            var f = inp.files && inp.files[0], i = +inp.getAttribute("data-file"); if (!f) return;
            fileToCanvas(f, 2000).then(function (c) { st.photos[i] = { img: c, fx: 0.5, fy: 0.35, fresh: true }; draw(k); }).catch(o.fail);
          });
        });
        app.querySelectorAll("[data-remove]").forEach(function (b) {
          b.addEventListener("click", function () { var i = +b.getAttribute("data-remove"); st.photos[i] = null; st.photos = st.photos.filter(Boolean).concat([null, null, null]).slice(0, 3); draw(k); });
        });
        document.getElementById("seSave").addEventListener("click", function () { save(this); });
      }

      function save(btn) {
        btn.disabled = true; btn.textContent = "Saving...";
        var stamp = Date.now().toString(36), origin = (slide.design && slide.design.origin) || slide.path || null;
        var uploads = st.type === "divider" ? [] : st.photos.map(function (p, i) {
          if (!p) return Promise.resolve(null);
          if (!p.fresh && p.url) return Promise.resolve({ url: p.url, fx: p.fx, fy: p.fy, cut: !!p.cut });
          var c = p.img;
          return toBlob(c, 0.9).then(function (blob) {
            var path = "src/" + slide.id + "-" + stamp + "-" + i + ".jpg";
            return sb.storage.from(bucket).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: true }).then(o.must).then(function () {
              return { url: sb.storage.from(bucket).getPublicUrl(path).data.publicUrl, fx: p.fx, fy: p.fy, cut: !!p.cut };
            });
          });
        });
        var newPath = (origin ? origin.replace(/\.jpg$/i, "") : slide.id) + "-e" + stamp + ".jpg";
        Promise.all(uploads).then(function (photos) {
          return toBlob(canvas, 0.92).then(function (blob) {
            return sb.storage.from(bucket).upload(newPath, blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: true }).then(o.must);
          }).then(function () {
            var design = { v: 1, type: st.type, title: st.title, bio: st.bio, photos: st.type === "divider" ? [] : photos, origin: origin };
            var row = { url: sb.storage.from(bucket).getPublicUrl(newPath).data.publicUrl, path: newPath, design: design };
            if (st.title.trim()) row.title = st.title.trim();
            return sb.from("slides").update(row).eq("id", slide.id).then(function (r) {
              if (r.error && /design/.test(r.error.message || "")) throw new Error("Run the slide-editor SQL in Supabase first, then save again.");
              return o.must(r);
            });
          }).then(function () {
            var old = [];
            if (slide.path && slide.path !== newPath) old.push(slide.path);
            (slide.design && slide.design.photos || []).forEach(function (p) {
              if (!p) return; var keep = photos.some(function (q) { return q && q.url === p.url; });
              var m = !keep && String(p.url).match(/\/slides\/(src\/[^?]+)/); if (m) old.push(m[1]);
            });
            return old.length ? sb.storage.from(bucket).remove(old) : null;
          });
        }).then(function () { o.toast("Slide saved"); location.hash = o.back; })
          .catch(function (e) { o.fail(e); btn.disabled = false; btn.textContent = "Save slide"; });
      }
    },
    render: render
  };
})();
