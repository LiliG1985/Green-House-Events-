/* Greenhouse Events: fills the talent page from the dashboard.
   If the database isn't connected (or can't be reached) the page simply keeps
   the roster that's written into talent.html, so it never shows up empty. */
(function () {
  "use strict";
  if (!window.GHDB) return;

  var GROUP_IDS = {
    "singers|Choirs": "choirs",
    "specialist|Acrobats & Circus": "spec-aerial", "specialist|Roaming & Specialty Musicians": "spec-roaming",
    "specialist|Laser Shows": "spec-laser", "specialist|Fire": "spec-fire",
    "ramadan|Arabic Bands & Duos": "ram-bands", "ramadan|Oud": "ram-oud", "ramadan|Qanun": "ram-qanun",
    "ramadan|Percussion": "ram-percussion", "ramadan|Harp": "ram-harp", "ramadan|Violin": "ram-violin",
    "ramadan|Flute": "ram-flute", "ramadan|Live Artists": "ram-artists",
    "ramadan|Cultural Activations": "ram-activations", "ramadan|Cultural Dance": "ram-dance"
  };
  var PAGE_SIZE = 12;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function slug(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function src(u) { return /^https?:\/\//.test(u) || u.charAt(0) === "/" ? u : u; }
  function safeUrl(u) {
    u = String(u || "").trim();
    if (!u) return null;
    if (/^@/.test(u)) return "https://instagram.com/" + u.slice(1);
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    return /^https?:\/\/[^\s"<>]+$/i.test(u) ? u : null;
  }
  function youTubeId(u) {
    var m = String(u).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
    return m ? m[1] : null;
  }

  function card(a) {
    var links = [];
    var firstVideo = a.pub_videos ? a.pub_videos.split(/\s+/).filter(Boolean)[0] : null;
    var audio = safeUrl(a.pub_audio), insta = safeUrl(a.pub_instagram), web = safeUrl(a.pub_website);
    if (audio) links.push('<a href="' + esc(audio) + '" target="_blank" rel="noopener">Listen</a>');
    if (insta) links.push('<a href="' + esc(insta) + '" target="_blank" rel="noopener">Instagram</a>');
    if (web) links.push('<a href="' + esc(web) + '" target="_blank" rel="noopener">Website</a>');
    var videoBtn = "";
    if (firstVideo && safeUrl(firstVideo)) {
      videoBtn = '<button type="button" class="ram-watch" data-video="' + esc(safeUrl(firstVideo)) + '" aria-label="Watch ' + esc(a.name) + '">&#9658; Watch</button>';
    }
    return '<div class="ram-card">' +
      '<div class="act-photo">' + (a.cover_url ? '<img src="' + esc(src(a.cover_url)) + '" alt="' + esc(a.name + (a.role ? " - " + a.role : "")) + '" loading="lazy">' : "") +
      (a.bio ? '<div class="act-bio-overlay"><p>' + esc(a.bio) + "</p></div>" : "") + videoBtn + "</div>" +
      "<h3>" + esc(a.name) + "</h3>" + (a.role ? '<span class="ram-role">' + esc(a.role) + "</span>" : "") +
      (links.length ? '<div class="ram-links">' + links.join("") + "</div>" : "") +
      '<a href="contact.html?service=Entertainment&amp;act=' + encodeURIComponent(a.name) + '" class="ram-enquire">Enquire About This Act &rarr;</a></div>';
  }

  function grid(items, key) {
    var html = '<div class="band-grid ram-grid" data-grid="' + esc(key) + '">' +
      items.map(function (a, i) { return i < PAGE_SIZE ? card(a) : card(a).replace('<div class="ram-card">', '<div class="ram-card ram-card--more" hidden>'); }).join("") + "</div>";
    if (items.length > PAGE_SIZE) {
      html += '<div class="band-load-more-wrap"><button class="band-load-more-btn" type="button" data-more="' + esc(key) + '">Show all ' + items.length + "</button></div>";
    }
    return html;
  }

  function renderSection(section, items) {
    var cat = section.id;
    // Keep the heading, intro and any jump links; replace the roster below them.
    var keep = [];
    Array.prototype.forEach.call(section.children, function (el) {
      if (el.tagName === "H2" || el.tagName === "P" || el.classList.contains("ram-chips") || el.classList.contains("ram-anchor")) keep.push(el);
    });
    section.innerHTML = "";
    keep.forEach(function (el) { section.appendChild(el); });
    var order = [], groups = {};
    items.forEach(function (a) {
      var g = a.subgroup || "";
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(a);
    });
    // Artists without a group first, then groups in the order they first appear.
    order.sort(function (x, y) { return (x === "" ? -1 : 0) - (y === "" ? -1 : 0); });
    var html = "";
    order.forEach(function (g) {
      if (g) {
        var id = GROUP_IDS[cat + "|" + g] || (cat + "-" + slug(g));
        html += '<div class="instrumental-subhead ram-subhead" id="' + esc(id) + '">' + esc(g) + "</div>";
      }
      html += grid(groups[g], cat + "|" + g);
    });
    section.insertAdjacentHTML("beforeend", html);
  }

  function openVideo(url) {
    var id = youTubeId(url);
    if (!id) { window.open(url, "_blank", "noopener"); return; }
    var m = document.createElement("div");
    m.className = "ram-video-modal";
    m.innerHTML = '<div class="ram-video-box"><button type="button" class="ram-video-close" aria-label="Close">&times;</button>' +
      '<iframe src="https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0" title="Video" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>';
    function close() { m.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    m.addEventListener("click", function (e) { if (e.target === m || e.target.classList.contains("ram-video-close")) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(m);
  }

  var css = '.ram-links{display:flex;gap:.9rem;flex-wrap:wrap;margin:-.2rem 0 .6rem;font-size:.72rem;letter-spacing:.5px}' +
    '.ram-links a{color:var(--white-off);opacity:.7;border-bottom:.5px solid rgba(255,255,255,.3)}.ram-links a:hover{opacity:1;color:var(--gold-solid)}' +
    '.act-photo{position:relative}.ram-watch{position:absolute;left:.7rem;bottom:.7rem;z-index:3;background:rgba(4,16,12,.82);color:var(--gold-solid);border:.5px solid var(--gold-solid);' +
    'font:600 .68rem/1 var(--sans);letter-spacing:1.5px;text-transform:uppercase;padding:.55rem .8rem;cursor:pointer}.ram-watch:hover{background:var(--gold-solid);color:#04100c}' +
    '.ram-video-modal{position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:4vw}' +
    '.ram-video-box{position:relative;width:min(960px,100%);aspect-ratio:16/9;background:#000}.ram-video-box iframe{width:100%;height:100%;border:0}' +
    '.ram-video-close{position:absolute;top:-2.6rem;right:0;background:none;border:0;color:#fff;font-size:2.2rem;cursor:pointer;line-height:1}';

  GHDB.client().then(function (sb) {
    if (!sb) return;
    return sb.from("artists")
      .select("id,name,category,subgroup,role,bio,cover_url,sort_order,pub_videos,pub_audio,pub_instagram,pub_website")
      .eq("published", true).order("sort_order").order("name").range(0, 4999)
      .then(function (r) {
        if (r.error || !r.data || !r.data.length) return;
        var byCat = {};
        r.data.forEach(function (a) { (byCat[a.category] = byCat[a.category] || []).push(a); });
        var style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
        Array.prototype.forEach.call(document.querySelectorAll(".roster-list > .cat-section[id]"), function (section) {
          var items = byCat[section.id] || [];
          renderSection(section, items);
          section.hidden = !items.length;
        });
        document.addEventListener("click", function (e) {
          var more = e.target.closest("[data-more]");
          if (more) {
            var g = document.querySelector('[data-grid="' + more.getAttribute("data-more").replace(/"/g, '\\"') + '"]');
            if (g) Array.prototype.forEach.call(g.querySelectorAll(".ram-card--more"), function (c) { c.hidden = false; });
            more.parentNode.remove();
            return;
          }
          var w = e.target.closest(".ram-watch");
          if (w) { e.preventDefault(); openVideo(w.getAttribute("data-video")); }
        });
        // Re-run a hash jump now that the roster is in place.
        if (location.hash) { var t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
      });
  });
})();
