/* Builds a proposal PDF in the browser: one 1920x1080 page per slide, with
   small clickable video links and prices along the foot of the main photo. Works the same in Safari, Chrome and Edge. */
(function () {
  var W = 1920, H = 1080;

  function loadScript(src) {
    return new Promise(function (ok, bad) {
      if (window.jspdf) return ok();
      var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = bad;
      document.head.appendChild(s);
    });
  }

  // Fetch an image and return it as a JPEG data URL at slide size.
  function toJpeg(url, fade) {
    return fetch(url, { mode: "cors" }).then(function (r) {
      if (!r.ok) throw new Error("Could not load a slide image");
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (ok, bad) {
        var img = new Image(), u = URL.createObjectURL(blob);
        img.onload = function () {
          var c = document.createElement("canvas"); c.width = W; c.height = H;
          var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
          var s = Math.max(W / img.width, H / img.height), w = img.width * s, h = img.height * s;
          g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
          if (fade) {
            var gr = g.createLinearGradient(0, H - fade, 0, H);
            gr.addColorStop(0, "rgba(6,22,16,0)"); gr.addColorStop(0.35, "rgba(6,22,16,0.35)"); gr.addColorStop(1, "rgba(6,22,16,0.86)");
            g.fillStyle = gr; g.fillRect(0, H - fade, 700, fade);
          }
          URL.revokeObjectURL(u); ok(c.toDataURL("image/jpeg", 0.9));
        };
        img.onerror = function () { URL.revokeObjectURL(u); bad(new Error("Could not read a slide image")); };
        img.src = u;
      });
    });
  }

  // Stored as JSON {p: [[label, amount], ...up to 3], n: "note"}; older forms: a bare array, or plain text as one amount.
  function parsePrice(v) {
    var out = { rows: [], note: "" }, o = v;
    if (!v) return out;
    if (typeof v === "string") { try { o = JSON.parse(v); } catch (err) { o = [["", v]]; } }
    var rows = Array.isArray(o) ? o : (o && o.p) || [];
    out.rows = rows.filter(function (r) { return r && r[1]; }).slice(0, 3).map(function (r) { return [String(r[0] || "").slice(0, 30), String(r[1]).slice(0, 40)]; });
    out.note = (!Array.isArray(o) && o && o.n) ? String(o.n).slice(0, 200) : "";
    if (typeof o !== "object") out.rows = [["", String(v).slice(0, 40)]];
    return out;
  }

  // A quiet caption at the foot of the main photo: small video links, then the
  // prices (what each is for on the left, amount on the right) and a note.
  var L = 46, R = 654, GOLD = [201, 168, 76], IVORY = [246, 239, 222];
  function alpha(doc, a) { doc.setGState(new doc.GState({ opacity: a })); }
  function layout(doc, pr, videos) {
    var rows = pr.rows, lines = [];
    if (pr.note) { doc.setFont("times", "italic"); doc.setFontSize(21); lines = doc.splitTextToSize(pr.note, R - L); }
    var priceH = rows.length ? rows.length * 44 + 14 : 0, noteH = lines.length ? lines.length * 26 + (rows.length ? 8 : 0) : 0,
        vidH = videos.length ? 32 + (priceH || noteH ? 22 : 0) : 0;
    return { lines: lines, priceH: priceH, vidH: vidH, blockH: vidH + priceH + noteH };
  }
  function caption(doc, pr, videos, lay) {
    var rows = pr.rows, rowH = 44, pillH = 32, lines = lay.lines, priceH = lay.priceH, vidH = lay.vidH, blockH = lay.blockH, bottom = H - 40, y;
    y = bottom - blockH;
    // video links
    if (videos.length) {
      var px = L;
      videos.forEach(function (url, i) {
        var label = videos.length > 1 ? "VIDEO " + (i + 1) : "WATCH VIDEO";
        doc.setFont("helvetica", "bold"); doc.setFontSize(13);
        var tw = doc.getTextWidth(label) + label.length * 2.2, bw = tw + 52;
        alpha(doc, 0.5); doc.setFillColor(4, 16, 11); doc.rect(px, y, bw, pillH, "F"); alpha(doc, 1);
        doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]); doc.setLineWidth(1.4); doc.rect(px, y, bw, pillH, "S");
        doc.setFillColor(GOLD[0], GOLD[1], GOLD[2]); doc.triangle(px + 17, y + 10, px + 17, y + pillH - 10, px + 28, y + pillH / 2, "F");
        doc.setTextColor(GOLD[0], GOLD[1], GOLD[2]); doc.text(label, px + 38, y + pillH / 2 + 4.6, { charSpace: 2.2 });
        doc.link(px, y, bw, pillH, { url: url });
        px += bw + 10;
      });
      y += vidH;
    }
    // prices
    if (rows.length) {
      doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]); doc.setLineWidth(2); doc.line(L, y, L + 56, y);
      y += 14;
      rows.forEach(function (r, i) {
        var base = y + i * rowH + 29;
        if (i) { alpha(doc, 0.3); doc.setLineWidth(1); doc.line(L, y + i * rowH, R, y + i * rowH); alpha(doc, 1); }
        if (r[0]) { doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(GOLD[0], GOLD[1], GOLD[2]); doc.text(r[0].toUpperCase(), L, base - 1, { charSpace: 3 }); }
        doc.setFont("times", "normal"); doc.setFontSize(25); doc.setTextColor(IVORY[0], IVORY[1], IVORY[2]);
        if (r[0]) doc.text(r[1], R - doc.getTextWidth(r[1]), base); else doc.text(r[1], L, base);
      });
      y += priceH - 14 + 8;
    }
    if (lines.length) {
      doc.setFont("times", "italic"); doc.setFontSize(21); doc.setTextColor(226, 216, 190);
      lines.forEach(function (l, k) { doc.text(l, L, y + 20 + k * 26); });
    }
  }

  // slides: [{ url, videos: [..], price }]
  window.GHPDF = {
    parsePrice: parsePrice,
    make: function (title, slides, onProgress) {
      return loadScript("/js/jspdf.umd.min.js").then(function () {
        var doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "px", format: [W, H], hotfixes: ["px_scaling"], compress: true });
        doc.setProperties({ title: title, author: "Greenhouse Events Dubai" });
        var i = 0;
        function next() {
          if (i >= slides.length) return Promise.resolve();
          var s = slides[i];
          var pr = parsePrice(s.price), vids = (s.videos || []).slice(0, 3), lay = layout(doc, pr, vids),
              has = pr.rows.length || pr.note || vids.length;
          return toJpeg(s.url, has ? lay.blockH + 190 : 0).then(function (data) {
            if (i > 0) doc.addPage([W, H], "landscape");
            doc.addImage(data, "JPEG", 0, 0, W, H, undefined, "FAST");
            if (pr.rows.length || pr.note || vids.length) caption(doc, pr, vids, lay);
            i++; if (onProgress) onProgress(i, slides.length);
            return next();
          });
        }
        return next().then(function () {
          var name = (title || "Proposal").replace(/[\\\/:*?"<>|]+/g, "").trim() || "Proposal";
          doc.save(name + " - Greenhouse Events.pdf");
        });
      });
    }
  };
})();
