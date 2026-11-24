/* Builds a proposal PDF in the browser: one 1920x1080 page per slide, with
   clickable gold video buttons. Works the same in Safari, Chrome and Edge. */
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
  function toJpeg(url) {
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
          URL.revokeObjectURL(u); ok(c.toDataURL("image/jpeg", 0.9));
        };
        img.onerror = function () { URL.revokeObjectURL(u); bad(new Error("Could not read a slide image")); };
        img.src = u;
      });
    });
  }

  function videoButtons(doc, videos) {
    var bh = 62, gap = 12, x = 42, y = H - 54 - (bh * videos.length + gap * (videos.length - 1));
    videos.forEach(function (url, i) {
      var label = videos.length > 1 ? "VIDEO " + (i + 1) : "WATCH VIDEO";
      doc.setFont("helvetica", "bold"); doc.setFontSize(26);
      var tw = doc.getTextWidth(label), bw = tw + 104, by = y + i * (bh + gap);
      doc.setFillColor(0, 0, 0); doc.setGState(new doc.GState({ opacity: 0.25 })); doc.rect(x + 4, by + 5, bw, bh, "F");
      doc.setGState(new doc.GState({ opacity: 1 }));
      doc.setFillColor(201, 168, 76); doc.rect(x, by, bw, bh, "F");
      doc.setFillColor(243, 227, 166); doc.rect(x, by, bw, 6, "F");
      doc.setFillColor(26, 20, 5); doc.triangle(x + 30, by + 19, x + 30, by + bh - 19, x + 54, by + bh / 2, "F");
      doc.setTextColor(26, 20, 5); doc.text(label, x + 70, by + bh / 2 + 9);
      doc.link(x, by, bw, bh, { url: url });
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

  function priceTag(doc, pr) {
    var rows = pr.rows, x = 42, y = 42, padX = 32, rowH = 54, gap = 28, labW = 0, amtW = 0;
    rows.forEach(function (r) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(22); labW = Math.max(labW, r[0] ? doc.getTextWidth(r[0].toUpperCase()) : 0);
      doc.setFontSize(30); amtW = Math.max(amtW, doc.getTextWidth(r[1]));
    });
    var bw = padX * 2 + labW + (labW ? gap : 0) + amtW, lines = [], noteH = 0;
    if (pr.note) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(22);
      var nw = Math.min(doc.getTextWidth(pr.note), 520);
      bw = Math.max(bw, nw + padX * 2, rows.length ? 0 : 0);
      lines = doc.splitTextToSize(pr.note, bw - padX * 2);
      noteH = lines.length * 28 + (rows.length ? 18 : 10);
    }
    var bh = rows.length * rowH + noteH + 22;
    doc.setFillColor(0, 0, 0); doc.setGState(new doc.GState({ opacity: 0.3 })); doc.rect(x + 4, y + 5, bw, bh, "F");
    doc.setGState(new doc.GState({ opacity: 1 }));
    doc.setFillColor(8, 30, 22); doc.rect(x, y, bw, bh, "F");
    doc.setDrawColor(201, 168, 76); doc.setLineWidth(3); doc.rect(x + 1.5, y + 1.5, bw - 3, bh - 3, "S");
    rows.forEach(function (r, i) {
      var by = y + 11 + i * rowH + rowH / 2;
      if (i) { doc.setDrawColor(201, 168, 76); doc.setGState(new doc.GState({ opacity: 0.35 })); doc.setLineWidth(1); doc.line(x + padX, by - rowH / 2, x + bw - padX, by - rowH / 2); doc.setGState(new doc.GState({ opacity: 1 })); }
      if (r[0]) { doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(201, 168, 76); doc.text(r[0].toUpperCase(), x + padX, by + 8); }
      doc.setFont("helvetica", "bold"); doc.setFontSize(30); doc.setTextColor(245, 236, 210);
      doc.text(r[1], x + bw - padX - doc.getTextWidth(r[1]), by + 10);
    });
    if (lines.length) {
      var ny = y + 11 + rows.length * rowH;
      if (rows.length) { doc.setDrawColor(201, 168, 76); doc.setGState(new doc.GState({ opacity: 0.35 })); doc.setLineWidth(1); doc.line(x + padX, ny, x + bw - padX, ny); doc.setGState(new doc.GState({ opacity: 1 })); }
      doc.setFont("helvetica", "italic"); doc.setFontSize(22); doc.setTextColor(214, 205, 180);
      lines.forEach(function (l, k) { doc.text(l, x + padX, ny + (rows.length ? 34 : 26) + k * 28); });
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
          return toJpeg(s.url).then(function (data) {
            if (i > 0) doc.addPage([W, H], "landscape");
            doc.addImage(data, "JPEG", 0, 0, W, H, undefined, "FAST");
            if (s.videos && s.videos.length) videoButtons(doc, s.videos.slice(0, 3));
            var pr = parsePrice(s.price); if (pr.rows.length || pr.note) priceTag(doc, pr);
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
