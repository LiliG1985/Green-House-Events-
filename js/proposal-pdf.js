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

  function priceTag(doc, price) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(30);
    var tw = doc.getTextWidth(price), bw = tw + 64, bh = 72, x = 42, y = 42;
    doc.setFillColor(0, 0, 0); doc.setGState(new doc.GState({ opacity: 0.3 })); doc.rect(x + 4, y + 5, bw, bh, "F");
    doc.setGState(new doc.GState({ opacity: 1 }));
    doc.setFillColor(8, 30, 22); doc.rect(x, y, bw, bh, "F");
    doc.setDrawColor(201, 168, 76); doc.setLineWidth(3); doc.rect(x + 1.5, y + 1.5, bw - 3, bh - 3, "S");
    doc.setTextColor(232, 205, 120); doc.text(price, x + 32, y + bh / 2 + 11);
  }

  // slides: [{ url, videos: [..], price }]
  window.GHPDF = {
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
            if (s.price) priceTag(doc, String(s.price).slice(0, 60));
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
