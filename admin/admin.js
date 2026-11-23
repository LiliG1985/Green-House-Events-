/* Greenhouse Events dashboard: artists, photos, links and applications.
   Talks to Supabase directly; the database's security rules make sure only
   people listed in public.admins can read private details or change anything. */
(function () {
  "use strict";

  var CATEGORIES = [
    ["djs", "DJs"], ["singers", "Singers"], ["bands", "Live Bands"], ["instrumental", "Instrumentalists"],
    ["specialist", "Specialist Acts"], ["dancers", "Dancers"], ["mcs", "Emcees"], ["hostesses", "Hostesses & Promo Staff"],
    ["magicians", "Magicians & Mentalists"], ["kids", "Children's Entertainment"], ["ramadan", "Ramadan & Arabic"]
  ];
  var CAT_LABEL = {}; CATEGORIES.forEach(function (c) { CAT_LABEL[c[0]] = c[1]; });
  // Join Our Roster form category -> talent page section
  var APP_CAT = {
    "DJ": "djs", "Singer / Vocalist": "singers", "Live Band / Duo": "bands", "Instrumentalist": "instrumental",
    "Arabic Musician": "ramadan", "Specialist / Circus Act": "specialist", "Roaming Performer": "specialist",
    "Dancer / Dance Crew": "dancers", "MC / Emcee": "mcs", "Hostess / Promotional Staff": "hostesses", "Magician / Mentalist": "magicians",
    "Children's Entertainer": "kids", "Live Artist": "specialist"
  };
  var STATUSES = ["new", "shortlisted", "approved", "declined"];
  var PHOTO_BUCKET = "artists", APP_BUCKET = "applications";

  var sb = null, session = null;
  var app = document.getElementById("app");

  // ---------- helpers ----------
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function val(id) { var el = document.getElementById(id); if (!el) return null; var v = el.value.trim(); return v === "" ? null : v; }
  function checked(id) { var el = document.getElementById(id); return !!(el && el.checked); }
  var toastTimer;
  function toast(msg, isErr) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = "toast"; }, isErr ? 6000 : 2600);
  }
  function fail(err) { console.error(err); toast((err && err.message) || "Something went wrong", true); }
  function must(res) { if (res.error) throw res.error; return res.data; }
  function slugify(t) { return String(t || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "artist"; }
  function fmtDate(d) { try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return d; } }
  function sw(id, on, label) {
    return '<label class="switch"><input type="checkbox" id="' + id + '"' + (on ? " checked" : "") + '><span class="track"></span>' + esc(label) + "</label>";
  }
  function catOptions(sel) {
    return CATEGORIES.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === sel ? " selected" : "") + ">" + esc(c[1]) + "</option>"; }).join("");
  }
  function linkify(text) {
    return esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }

  // ---------- auth ----------
  function showChrome(on) {
    document.getElementById("topbar").hidden = !on;
    if (on && session) document.getElementById("userEmail").textContent = session.user.email;
  }
  function renderSetup() {
    showChrome(false);
    app.innerHTML = '<div class="setup panel"><h2>Dashboard not connected yet</h2>' +
      '<p class="muted">The website can\'t reach the database. Connect Supabase to this Vercel project ' +
      '(Vercel &rsaquo; Storage &rsaquo; Supabase), run <code>supabase/schema.sql</code>, then redeploy.</p></div>';
  }
  function renderLogin(message, isErr) {
    showChrome(false);
    app.innerHTML =
      '<div class="auth"><span class="brand">GREENHOUSE EVENTS</span><h1>Dashboard</h1>' +
      (message ? '<p class="msg' + (isErr ? " err" : "") + '">' + esc(message) + "</p><br>" : "") +
      '<form id="loginForm"><label class="field">Email<input type="email" id="lgEmail" required autocomplete="username"></label>' +
      '<label class="field">Password<input type="password" id="lgPass" required autocomplete="current-password"></label>' +
      '<button class="btn primary" type="submit">Sign in</button>' +
      '<button class="linkbtn small" type="button" id="forgotBtn">Forgot password?</button></form></div>';
    $("#loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Signing in...";
      sb.auth.signInWithPassword({ email: val("lgEmail"), password: document.getElementById("lgPass").value })
        .then(function (r) {
          if (r.error) { renderLogin("That email and password don't match.", true); return; }
          session = r.data.session; afterLogin();
        });
    });
    $("#forgotBtn").addEventListener("click", function () {
      var email = val("lgEmail");
      if (!email) { toast("Type your email above first", true); return; }
      sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/admin/#/password" })
        .then(function () { renderLogin("If that email has dashboard access, a reset link is on its way."); });
    });
  }
  function afterLogin() {
    sb.from("admins").select("email").limit(1).then(function (r) {
      if (r.error || !r.data || !r.data.length) {
        sb.auth.signOut().then(function () { session = null; renderLogin("This account doesn't have dashboard access.", true); });
        return;
      }
      showChrome(true); refreshBadge();
      if (!location.hash || location.hash === "#/" || location.hash === "#/login") location.hash = "#/artists"; else route();
    });
  }
  document.getElementById("signOutBtn").addEventListener("click", function () {
    sb.auth.signOut().then(function () { session = null; location.hash = "#/login"; renderLogin("You're signed out."); });
  });

  function refreshBadge() {
    sb.from("applications").select("id", { count: "exact", head: true }).eq("status", "new").then(function (r) {
      var b = document.getElementById("newBadge");
      if (!r.error && r.count) { b.textContent = r.count; b.hidden = false; } else b.hidden = true;
    });
  }

  // ---------- router ----------
  function route() {
    if (!session) { renderLogin(); return; }
    var h = location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
    $all(".topnav a[data-nav]").forEach(function (a) { a.classList.toggle("active", a.dataset.nav === h[0]); });
    window.scrollTo(0, 0);
    if (h[0] === "applications" && h[1]) return viewApplication(h[1]);
    if (h[0] === "applications") return viewApplications();
    if (h[0] === "artists" && h[1] === "new") return viewArtist(null);
    if (h[0] === "artists" && h[1]) return viewArtist(h[1]);
    if (h[0] === "slides") return viewSlides();
    if (h[0] === "proposals" && h[1]) return viewProposal(h[1]);
    if (h[0] === "proposals") return viewProposals();
    if (h[0] === "password") return viewPassword();
    return viewArtists();
  }
  window.addEventListener("hashchange", route);

  // ---------- artists list ----------
  var listState = { q: "", cat: "", live: "" };
  function viewArtists() {
    app.innerHTML = '<div class="pagehead"><div><h1>Artists</h1><p class="muted">Everything on your talent page. Switch an artist off to hide them from the website.</p></div>' +
      '<a class="btn primary" href="#/artists/new">+ Add artist</a></div>' +
      '<div class="toolbar"><input type="text" id="fQ" placeholder="Search name, role or group" value="' + esc(listState.q) + '">' +
      '<select id="fCat"><option value="">All categories</option>' + catOptions(listState.cat) + "</select>" +
      '<select id="fLive"><option value="">Live and hidden</option><option value="live"' + (listState.live === "live" ? " selected" : "") + '>Live on website</option><option value="hidden"' + (listState.live === "hidden" ? " selected" : "") + ">Hidden</option></select>" +
      '<span class="count" id="fCount"></span></div><div id="listWrap"><p class="muted">Loading&hellip;</p></div>';
    sb.from("artists").select("id,name,category,subgroup,role,cover_url,published,sort_order")
      .order("category").order("sort_order").order("name").range(0, 4999)
      .then(function (r) {
        if (r.error) return fail(r.error);
        var all = r.data;
        function draw() {
          var q = listState.q.toLowerCase();
          var rows = all.filter(function (a) {
            if (listState.cat && a.category !== listState.cat) return false;
            if (listState.live === "live" && !a.published) return false;
            if (listState.live === "hidden" && a.published) return false;
            if (q && (a.name + " " + (a.role || "") + " " + (a.subgroup || "")).toLowerCase().indexOf(q) < 0) return false;
            return true;
          });
          document.getElementById("fCount").textContent = rows.length + " of " + all.length + " artists";
          if (!rows.length) { document.getElementById("listWrap").innerHTML = '<p class="muted center">No artists match.</p>'; return; }
          var html = '<table class="list"><thead><tr><th></th><th>Name</th><th class="hide-m">Group</th><th class="hide-m">Order</th><th>On website</th><th></th></tr></thead><tbody>';
          var lastCat = null;
          CATEGORIES.forEach(function (c) {
            rows.filter(function (a) { return a.category === c[0]; }).forEach(function (a) {
              if (lastCat !== a.category) { html += '<tr class="group"><td colspan="6">' + esc(c[1].toUpperCase()) + "</td></tr>"; lastCat = a.category; }
              html += "<tr><td>" + (a.cover_url ? '<img class="thumb" loading="lazy" src="' + esc(photoSrc(a.cover_url)) + '" alt="">' : '<div class="thumb empty">No photo</div>') + "</td>" +
                '<td class="name"><a href="#/artists/' + a.id + '">' + esc(a.name) + '</a><div class="sub">' + esc(a.role || "") + "</div></td>" +
                '<td class="hide-m sub">' + esc(a.subgroup || "") + "</td>" +
                '<td class="hide-m sub">' + esc(a.sort_order) + "</td>" +
                '<td><label class="switch"><input type="checkbox" data-live="' + a.id + '"' + (a.published ? " checked" : "") + '><span class="track"></span></label></td>' +
                '<td><a class="btn sm" href="#/artists/' + a.id + '">Edit</a></td></tr>';
            });
          });
          document.getElementById("listWrap").innerHTML = html + "</tbody></table>";
        }
        draw();
        $("#fQ").addEventListener("input", function (e) { listState.q = e.target.value; draw(); });
        $("#fCat").addEventListener("change", function (e) { listState.cat = e.target.value; draw(); });
        $("#fLive").addEventListener("change", function (e) { listState.live = e.target.value; draw(); });
        document.getElementById("listWrap").addEventListener("change", function (e) {
          var id = e.target.getAttribute("data-live"); if (!id) return;
          var on = e.target.checked;
          sb.from("artists").update({ published: on }).eq("id", id).then(function (r) {
            if (r.error) { e.target.checked = !on; return fail(r.error); }
            all.forEach(function (a) { if (a.id === id) a.published = on; });
            toast(on ? "Now live on the website" : "Hidden from the website");
          });
        });
      });
  }
  // Seeded photos use paths relative to the website, uploaded ones are full URLs.
  function photoSrc(u) { return /^https?:\/\//.test(u) || u.charAt(0) === "/" ? u : "/" + u; }

  // ---------- artist editor ----------
  function viewArtist(id) {
    app.innerHTML = '<p class="muted center">Loading&hellip;</p>';
    var load = id ? Promise.all([
      sb.from("artists").select("*").eq("id", id).maybeSingle(),
      sb.from("artist_private").select("*").eq("artist_id", id).maybeSingle(),
      sb.from("artist_photos").select("*").eq("artist_id", id).order("position"),
      sb.from("artists").select("category,subgroup").not("subgroup", "is", null).range(0, 4999)
    ]) : Promise.all([Promise.resolve({ data: null }), Promise.resolve({ data: null }), Promise.resolve({ data: [] }),
      sb.from("artists").select("category,subgroup").not("subgroup", "is", null).range(0, 4999)]);
    load.then(function (res) {
      for (var i = 0; i < res.length; i++) if (res[i].error) return fail(res[i].error);
      if (id && !res[0].data) { app.innerHTML = '<p class="center muted">Artist not found. <a href="#/artists">Back to artists</a></p>'; return; }
      var a = res[0].data || { name: "", category: listState.cat || "singers", published: false, sort_order: 0, show_videos: true };
      var p = res[1].data || {};
      var photos = res[2].data || [];
      var groups = {};
      (res[3].data || []).forEach(function (g) { (groups[g.category] = groups[g.category] || {})[g.subgroup] = 1; });
      drawArtist(id, a, p, photos, groups);
    }).catch(fail);
  }

  function drawArtist(id, a, p, photos, groups) {
    var sgList = function (cat) { return Object.keys(groups[cat] || {}).sort().map(function (g) { return '<option value="' + esc(g) + '">'; }).join(""); };
    app.innerHTML =
      '<div class="pagehead"><div><a href="#/artists" class="small">&larr; All artists</a><h1>' + (id ? esc(a.name) : "Add artist") + "</h1>" +
      (id ? '<span class="pill ' + (a.published ? "live" : "hidden") + '">' + (a.published ? "Live on website" : "Hidden") + "</span>" : "") + "</div></div>" +

      '<form id="artistForm" autocomplete="off">' +
      '<section class="panel"><h2>On the website ' + sw("aPublished", a.published, "Show on website") + "</h2>" +
      '<div class="grid2">' +
      '<label class="field">Name / act name<input type="text" id="aName" required value="' + esc(a.name) + '"></label>' +
      '<label class="field">Category<select id="aCategory">' + catOptions(a.category) + "</select></label>" +
      '<label class="field">Group within category <span class="hint">Optional, e.g. Saxophonists, Oud, Laser Shows</span><input type="text" id="aSubgroup" list="sgList" value="' + esc(a.subgroup || "") + '"><datalist id="sgList">' + sgList(a.category) + "</datalist></label>" +
      '<label class="field">Order <span class="hint">Lower numbers show first</span><input type="number" id="aOrder" value="' + esc(a.sort_order || 0) + '"></label>' +
      '<label class="field span2">Short description <span class="hint">Shown under the name, e.g. "Oud &amp; Vocals"</span><input type="text" id="aRole" value="' + esc(a.role || "") + '"></label>' +
      '<label class="field span2">Bio <span class="hint">One or two lines, shown when guests hover over the photo</span><textarea id="aBio">' + esc(a.bio || "") + "</textarea></label>" +
      "</div></section>" +

      '<section class="panel"><h2>Photos</h2><p class="note">The first photo is the one on the website. Use the arrows to reorder.</p>' +
      (id ? '<div class="photos" id="photoGrid"></div><label class="dropzone" id="dropzone">Click or drop photos here to upload<input type="file" id="photoInput" accept="image/*" multiple hidden></label>'
          : '<p class="muted">Save the artist first, then add photos.</p>') + "</section>" +

      (id ? '<section class="panel"><h2>Proposal slides <span class="muted small" id="asCount"></span></h2>' +
        '<p class="note">This act&rsquo;s slides from your proposal deck. Tick slides, then add them to a proposal.</p>' +
        '<div id="asGrid" class="slide-grid compact"><p class="muted">Loading&hellip;</p></div>' +
        '<label class="dropzone" id="asDrop">Click or drop slide images here to add them to this act<input type="file" id="asInput" accept="image/*" multiple hidden></label></section>' : "") +

      '<section class="panel"><h2>Videos &amp; links</h2><p class="note">Every link is saved privately. Switch one on to show it on the website too.</p>' +
      '<div class="linkrow"><label class="field">YouTube / video links <span class="hint">One per line. The first one plays on the website.</span><textarea id="pVideos">' + esc(p.video_links || "") + "</textarea></label>" + sw("aShowVideos", a.show_videos, "Show on website") + "</div>" +
      '<div class="linkrow"><label class="field">SoundCloud / Mixcloud / Spotify<input type="url" id="pAudio" value="' + esc(p.audio_link || "") + '"></label>' + sw("aShowAudio", a.show_audio, "Show on website") + "</div>" +
      '<div class="linkrow"><label class="field">Instagram<input type="text" id="pInstagram" placeholder="@handle or link" value="' + esc(p.instagram || "") + '"></label>' + sw("aShowInstagram", a.show_instagram, "Show on website") + "</div>" +
      '<div class="linkrow"><label class="field">Website<input type="url" id="pWebsite" value="' + esc(p.website || "") + '"></label>' + sw("aShowWebsite", a.show_website, "Show on website") + "</div>" +
      '<div class="linkrow"><label class="field">Portfolio / EPK link <span class="hint">Private, for your team only</span><input type="url" id="pPortfolio" value="' + esc(p.portfolio_link || "") + '"></label><span></span></div>' +
      "</section>" +

      '<section class="panel private"><h2>Private details <span class="lock">Never shown on the website</span></h2>' +
      '<div class="grid2">' +
      '<label class="field">Full legal name<input type="text" id="pLegal" value="' + esc(p.legal_name || "") + '"></label>' +
      '<label class="field">Email<input type="email" id="pEmail" value="' + esc(p.email || "") + '"></label>' +
      '<label class="field">Phone / WhatsApp<input type="text" id="pPhone" value="' + esc(p.phone || "") + '"></label>' +
      '<label class="field">Based in<input type="text" id="pBased" value="' + esc(p.based_in || "") + '"></label>' +
      '<label class="field">Languages<input type="text" id="pLang" value="' + esc(p.languages || "") + '"></label>' +
      '<label class="field">Rates<input type="text" id="pRates" value="' + esc(p.rates || "") + '"></label>' +
      '<label class="field span2">Notes<textarea id="pNotes">' + esc(p.notes || "") + "</textarea></label>" +
      "</div></section>" +

      '<div class="actions"><button class="btn primary" type="submit" id="saveBtn">' + (id ? "Save changes" : "Create artist") + "</button>" +
      '<a class="btn" href="#/artists">Cancel</a><span class="spacer"></span>' +
      (id ? '<button class="btn danger" type="button" id="deleteBtn">Delete artist</button>' : "") + "</div></form>";

    $("#aCategory").addEventListener("change", function (e) { $("#sgList").innerHTML = sgList(e.target.value); });
    $("#artistForm").addEventListener("submit", function (e) { e.preventDefault(); saveArtist(id, a); });
    if (id) {
      $("#deleteBtn").addEventListener("click", function () { deleteArtist(id, a.name, photos); });
      drawPhotos(id, photos);
      artistSlides(id, a);
      var input = $("#photoInput"), dz = $("#dropzone");
      input.addEventListener("change", function () { uploadPhotos(id, photos, input.files); input.value = ""; });
      dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("over"); });
      dz.addEventListener("dragleave", function () { dz.classList.remove("over"); });
      dz.addEventListener("drop", function (e) { e.preventDefault(); dz.classList.remove("over"); uploadPhotos(id, photos, e.dataTransfer.files); });
    }
  }

  function saveArtist(id, a) {
    var btn = $("#saveBtn"); btn.disabled = true; btn.textContent = "Saving...";
    var pub = {
      name: val("aName"), category: $("#aCategory").value, subgroup: val("aSubgroup"), role: val("aRole"), bio: val("aBio"),
      sort_order: parseInt($("#aOrder").value, 10) || 0, published: checked("aPublished"),
      show_videos: checked("aShowVideos"), show_audio: checked("aShowAudio"),
      show_instagram: checked("aShowInstagram"), show_website: checked("aShowWebsite")
    };
    var priv = {
      legal_name: val("pLegal"), email: val("pEmail"), phone: val("pPhone"), based_in: val("pBased"), languages: val("pLang"),
      rates: val("pRates"), notes: val("pNotes"), video_links: val("pVideos"), audio_link: val("pAudio"),
      instagram: val("pInstagram"), website: val("pWebsite"), portfolio_link: val("pPortfolio")
    };
    var done = function () { btn.disabled = false; btn.textContent = id ? "Save changes" : "Create artist"; };
    var step;
    if (id) {
      step = sb.from("artists").update(pub).eq("id", id).then(must).then(function () {
        priv.artist_id = id; return sb.from("artist_private").upsert(priv).then(must);
      }).then(function () { toast("Saved"); viewArtist(id); });
    } else {
      pub.slug = slugify(pub.name) + "-" + GHDB.uuid().slice(0, 6);
      step = sb.from("artists").insert(pub).select("id").single().then(must).then(function (row) {
        priv.artist_id = row.id;
        return sb.from("artist_private").upsert(priv).then(must).then(function () {
          toast("Artist created. Now add photos."); location.hash = "#/artists/" + row.id;
        });
      });
    }
    step.catch(fail).then(done);
  }

  function deleteArtist(id, name, photos) {
    if (!confirm("Delete " + name + " and all their photos? This can't be undone.")) return;
    var paths = photos.filter(function (ph) { return ph.path; }).map(function (ph) { return ph.path; });
    (paths.length ? sb.storage.from(PHOTO_BUCKET).remove(paths) : Promise.resolve())
      .then(function () { return sb.from("artists").delete().eq("id", id).then(must); })
      .then(function () { toast("Deleted " + name); location.hash = "#/artists"; })
      .catch(fail);
  }

  function drawPhotos(id, photos) {
    var grid = document.getElementById("photoGrid"); if (!grid) return;
    if (!photos.length) { grid.innerHTML = '<p class="muted">No photos yet.</p>'; return; }
    grid.innerHTML = photos.map(function (ph, i) {
      return '<div class="photo">' + (i === 0 ? '<span class="cover-tag">On website</span>' : "") +
        '<img src="' + esc(photoSrc(ph.url)) + '" alt="">' +
        '<div class="tools"><button type="button" data-mv="-1" data-i="' + i + '" title="Move left"' + (i === 0 ? " disabled" : "") + '>&larr;</button>' +
        '<button type="button" data-cover="' + i + '" title="Use on website"' + (i === 0 ? " disabled" : "") + '>&#9733;</button>' +
        '<button type="button" data-mv="1" data-i="' + i + '" title="Move right"' + (i === photos.length - 1 ? " disabled" : "") + '>&rarr;</button>' +
        '<button type="button" class="del" data-del="' + i + '" title="Delete">&#10005;</button></div></div>';
    }).join("");
    grid.onclick = function (e) {
      var b = e.target.closest("button"); if (!b || b.disabled) return;
      if (b.hasAttribute("data-del")) return removePhoto(id, photos, +b.getAttribute("data-del"));
      var from, to;
      if (b.hasAttribute("data-cover")) { from = +b.getAttribute("data-cover"); to = 0; }
      else { from = +b.getAttribute("data-i"); to = from + +b.getAttribute("data-mv"); }
      var moved = photos.splice(from, 1)[0]; photos.splice(to, 0, moved);
      savePhotoOrder(id, photos);
    };
  }

  function savePhotoOrder(id, photos) {
    drawPhotos(id, photos);
    Promise.all(photos.map(function (ph, i) { return sb.from("artist_photos").update({ position: i }).eq("id", ph.id).then(must); }))
      .then(function () { return sb.from("artists").update({ cover_url: photos.length ? photos[0].url : null }).eq("id", id).then(must); })
      .then(function () { toast("Photo order saved"); }).catch(fail);
  }

  function removePhoto(id, photos, i) {
    if (!confirm("Delete this photo?")) return;
    var ph = photos[i];
    (ph.path ? sb.storage.from(PHOTO_BUCKET).remove([ph.path]) : Promise.resolve())
      .then(function () { return sb.from("artist_photos").delete().eq("id", ph.id).then(must); })
      .then(function () { photos.splice(i, 1); savePhotoOrder(id, photos); })
      .catch(fail);
  }

  function uploadBlob(bucket, path, blob) {
    return sb.storage.from(bucket).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false }).then(must);
  }

  function uploadPhotos(id, photos, fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(function (f) { return /^image\//.test(f.type); });
    if (!files.length) return;
    var dz = $("#dropzone"); dz.firstChild.textContent = "Uploading " + files.length + " photo" + (files.length > 1 ? "s" : "") + "...";
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        return GHDB.shrinkImage(f, 2000).then(function (blob) {
          var path = id + "/" + GHDB.uuid() + ".jpg";
          return uploadBlob(PHOTO_BUCKET, path, blob).then(function () {
            var url = sb.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
            return sb.from("artist_photos").insert({ artist_id: id, url: url, path: path, position: photos.length }).select("*").single().then(must);
          }).then(function (row) { photos.push(row); });
        });
      });
    });
    chain.then(function () { savePhotoOrder(id, photos); })
      .catch(fail)
      .then(function () { dz.firstChild.textContent = "Click or drop photos here to upload"; drawPhotos(id, photos); });
  }

  // ---------- applications ----------
  var appFilter = "new", appType = "";
  function viewApplications() {
    app.innerHTML = '<div class="pagehead"><div><h1>Applications</h1><p class="muted">Performers and suppliers who applied through the Join Our Roster page. Suppliers stay private and are never added to the website.</p></div>' +
      '<select id="appType" style="max-width:220px"><option value="">Performers and suppliers</option><option value="performer"' + (appType === "performer" ? " selected" : "") + '>Performers only</option><option value="supplier"' + (appType === "supplier" ? " selected" : "") + '>Suppliers only</option></select></div>' +
      '<div class="tabs" id="appTabs"></div><div id="appList"><p class="muted">Loading&hellip;</p></div>';
    sb.from("applications").select("id,created_at,status,full_name,act_name,category,based_in,photos,applicant_type,company,service_type").order("created_at", { ascending: false }).range(0, 4999)
      .then(function (r) {
        if (r.error) return fail(r.error);
        var everything = r.data, all, counts;
        function draw() {
          all = everything.filter(function (x) { return !appType || (x.applicant_type || "performer") === appType; });
          counts = { all: all.length };
          STATUSES.forEach(function (s) { counts[s] = all.filter(function (x) { return x.status === s; }).length; });
          $("#appTabs").innerHTML = STATUSES.concat(["all"]).map(function (s) {
            return '<button type="button" data-s="' + s + '" class="' + (appFilter === s ? "on" : "") + '">' + s.charAt(0).toUpperCase() + s.slice(1) + " (" + counts[s] + ")</button>";
          }).join("");
          var rows = all.filter(function (x) { return appFilter === "all" || x.status === appFilter; });
          if (!rows.length) { $("#appList").innerHTML = '<p class="muted center">Nothing here.</p>'; return; }
          $("#appList").innerHTML = '<div class="cards">' + rows.map(function (x) {
            return '<a class="card" href="#/applications/' + x.id + '"><div class="noimg" data-thumb="' + esc((x.photos && x.photos[0]) || "") + '">' + (x.photos && x.photos.length ? "" : "No photo") + "</div>" +
              "<div><h3>" + esc(x.applicant_type === "supplier" ? (x.company || x.full_name) : (x.act_name || x.full_name)) + '</h3><div class="sub">' +
              (x.applicant_type === "supplier" ? "Supplier &middot; " + esc(x.service_type || "") : esc(x.category || "")) + (x.based_in ? " &middot; " + esc(x.based_in) : "") + "</div>" +
              '<div class="sub">' + fmtDate(x.created_at) + '</div><span class="pill ' + x.status + '">' + x.status + "</span></div></a>";
          }).join("") + "</div>";
          loadThumbs();
        }
        $("#appTabs").addEventListener("click", function (e) { var s = e.target.getAttribute("data-s"); if (s) { appFilter = s; draw(); } });
        $("#appType").addEventListener("change", function (e) { appType = e.target.value; draw(); });
        draw();
      });
  }
  // Application photos are private; show them through short-lived signed links.
  function loadThumbs() {
    var els = $all("[data-thumb]").filter(function (el) { return el.getAttribute("data-thumb"); });
    if (!els.length) return;
    var paths = els.map(function (el) { return el.getAttribute("data-thumb"); });
    sb.storage.from(APP_BUCKET).createSignedUrls(paths, 3600).then(function (r) {
      if (r.error || !r.data) return;
      r.data.forEach(function (s, i) {
        if (!s.signedUrl) return;
        var img = document.createElement("img"); img.src = s.signedUrl; img.alt = "";
        els[i].replaceWith(img);
      });
    });
  }

  function viewApplication(id) {
    app.innerHTML = '<p class="muted center">Loading&hellip;</p>';
    sb.from("applications").select("*").eq("id", id).maybeSingle().then(function (r) {
      if (r.error) return fail(r.error);
      var x = r.data;
      if (!x) { app.innerHTML = '<p class="center muted">Application not found. <a href="#/applications">Back</a></p>'; return; }
      var isSup = x.applicant_type === "supplier";
      var facts = (isSup ? [["Type", "Supplier / partner"], ["Company", x.company], ["Services", x.service_type], ["Contact name", x.full_name]]
                         : [["Full name", x.full_name], ["Act / stage name", x.act_name], ["Category", x.category]]).concat([["Email", x.email],
        ["Phone / WhatsApp", x.phone], ["Based in", x.based_in], ["Skills / genres", x.skills], ["Languages", x.languages],
        ["Instagram", x.social], ["Website", x.website], ["Portfolio", x.portfolio_link], ["Applied", fmtDate(x.created_at)]]).filter(function (f) { return !(isSup && /Skills|Languages/.test(f[0])); });
      app.innerHTML = '<div class="pagehead"><div><a href="#/applications" class="small">&larr; All applications</a><h1>' + esc(isSup ? (x.company || x.full_name) : (x.act_name || x.full_name)) + '</h1><span class="pill ' + x.status + '">' + x.status + "</span>" + (isSup ? ' <span class="pill hidden">Supplier</span>' : "") + "</div>" +
        '<div class="toolbar">' + (isSup ? '<span class="muted small">Suppliers stay private in the dashboard and are never added to the website.</span>'
          : x.artist_id ? '<a class="btn primary" href="#/artists/' + x.artist_id + '">Open artist profile</a>' : '<button class="btn primary" id="convertBtn" type="button">Create artist profile</button>') + "</div></div>" +
        '<section class="panel"><h2>Photos</h2><div class="photos" id="appPhotos">' + (x.photos && x.photos.length ? '<p class="muted">Loading photos&hellip;</p>' : '<p class="muted">No photos sent.</p>') + "</div></section>" +
        '<section class="panel private"><h2>Details <span class="lock">Private</span></h2><dl class="facts">' +
        facts.map(function (f) { return "<dt>" + esc(f[0]) + "</dt><dd>" + (f[1] ? (f[0] === "Email" ? '<a href="mailto:' + esc(f[1]) + '">' + esc(f[1]) + "</a>" : linkify(f[1])) : '<span class="muted">-</span>') + "</dd>"; }).join("") +
        "<dt>About</dt><dd>" + linkify(x.bio || "-") + "</dd><dt>" + (isSup ? "Portfolio links" : "Video links") + "</dt><dd>" + linkify(x.video_links || "-") + "</dd></dl></section>" +
        '<section class="panel"><h2>Review</h2><div class="grid2"><label class="field">Status<select id="apStatus">' +
        STATUSES.map(function (s) { return '<option value="' + s + '"' + (s === x.status ? " selected" : "") + ">" + s.charAt(0).toUpperCase() + s.slice(1) + "</option>"; }).join("") +
        '</select></label><span></span><label class="field span2">Internal notes<textarea id="apNotes">' + esc(x.admin_notes || "") + "</textarea></label></div></section>" +
        '<div class="actions"><button class="btn primary" type="button" id="apSave">Save review</button><span class="spacer"></span><button class="btn danger" type="button" id="apDelete">Delete application</button></div>';

      if (x.photos && x.photos.length) {
        sb.storage.from(APP_BUCKET).createSignedUrls(x.photos, 3600).then(function (s) {
          if (s.error) return fail(s.error);
          $("#appPhotos").innerHTML = s.data.map(function (u) {
            return u.signedUrl ? '<div class="photo"><a href="' + esc(u.signedUrl) + '" target="_blank" rel="noopener"><img src="' + esc(u.signedUrl) + '" alt=""></a></div>' : "";
          }).join("");
        });
      }
      $("#apSave").addEventListener("click", function () {
        sb.from("applications").update({ status: $("#apStatus").value, admin_notes: val("apNotes") }).eq("id", id).then(must)
          .then(function () { toast("Review saved"); refreshBadge(); viewApplication(id); }).catch(fail);
      });
      $("#apDelete").addEventListener("click", function () {
        if (!confirm("Delete this application and its photos? This can't be undone.")) return;
        (x.photos && x.photos.length ? sb.storage.from(APP_BUCKET).remove(x.photos) : Promise.resolve())
          .then(function () { return sb.from("applications").delete().eq("id", id).then(must); })
          .then(function () { toast("Application deleted"); refreshBadge(); location.hash = "#/applications"; }).catch(fail);
      });
      var cb = $("#convertBtn"); if (cb) cb.addEventListener("click", function () { convert(x, cb); });
    });
  }

  // Turns an application into a hidden artist profile, copying its photos across.
  function convert(x, btn) {
    btn.disabled = true; btn.textContent = "Creating profile...";
    var name = x.act_name || x.full_name;
    var social = x.social || "", insta = null, site = x.website || null;
    social.split(/[\s,]+/).forEach(function (s) {
      if (!s) return;
      if (/instagram\.com|^@/i.test(s)) insta = insta || s; else if (/\./.test(s)) site = site || s;
    });
    var artistId;
    sb.from("artists").insert({ name: name, slug: slugify(name) + "-" + GHDB.uuid().slice(0, 6), category: APP_CAT[x.category] || "specialist",
      role: x.skills || null, bio: null, published: false, sort_order: 999 }).select("id").single().then(must)
      .then(function (row) {
        artistId = row.id;
        return sb.from("artist_private").upsert({ artist_id: artistId, legal_name: x.full_name, email: x.email, phone: x.phone,
          based_in: x.based_in, languages: x.languages, video_links: x.video_links, instagram: insta, website: site,
          portfolio_link: x.portfolio_link || null,
          notes: (x.bio ? "From application:\n" + x.bio : null) }).then(must);
      })
      .then(function () {
        var chain = Promise.resolve(), n = 0, first = null;
        (x.photos || []).forEach(function (path) {
          chain = chain.then(function () {
            return sb.storage.from(APP_BUCKET).download(path).then(must).then(function (blob) {
              var dest = artistId + "/" + GHDB.uuid() + ".jpg";
              return uploadBlob(PHOTO_BUCKET, dest, blob).then(function () {
                var url = sb.storage.from(PHOTO_BUCKET).getPublicUrl(dest).data.publicUrl;
                if (!first) first = url;
                return sb.from("artist_photos").insert({ artist_id: artistId, url: url, path: dest, position: n++ }).then(must);
              });
            });
          });
        });
        return chain.then(function () { return first ? sb.from("artists").update({ cover_url: first }).eq("id", artistId).then(must) : null; });
      })
      .then(function () { return sb.from("applications").update({ status: "approved", artist_id: artistId }).eq("id", x.id).then(must); })
      .then(function () { refreshBadge(); toast("Profile created. It stays hidden until you switch it on."); location.hash = "#/artists/" + artistId; })
      .catch(function (e) { fail(e); btn.disabled = false; btn.textContent = "Create artist profile"; });
  }

  // ---------- shared: add slides to a proposal ----------
  var CAT_TO_SLIDECAT = { djs: "DJs", singers: "Singers", bands: "Live Bands", instrumental: "Instrumentalists", specialist: "Specialist Acts",
    dancers: "Dancers", mcs: "Emcees", hostesses: "Hostesses & Promo Staff", magicians: "Magicians", kids: "Children's", ramadan: "Ramadan & Arabic" };
  function fillProposalSelect(sel, current) {
    return sb.from("proposals").select("id,title,client").order("updated_at", { ascending: false }).range(0, 499).then(function (r) {
      sel.innerHTML = '<option value="__new">+ New proposal&hellip;</option>' + (r.data || []).map(function (p) {
        return '<option value="' + p.id + '">' + esc(p.title + (p.client ? " (" + p.client + ")" : "")) + "</option>";
      }).join("");
      if (current && (r.data || []).some(function (p) { return p.id === current; })) sel.value = current;
    });
  }
  function addSlidesToProposal(ids, target) {
    var getId = target === "__new" ? (function () {
      var title = prompt("Name for the new proposal (e.g. Grand Hyatt NYE 2026):");
      if (!title) return Promise.reject(null);
      return sb.from("proposals").insert({ title: title.trim() }).select("id").single().then(must).then(function (r) { return r.id; });
    })() : Promise.resolve(target);
    return getId.then(function (pid) {
      return sb.from("proposal_slides").select("slide_id,position").eq("proposal_id", pid).then(must).then(function (existing) {
        var have = {}, max = -1;
        existing.forEach(function (e) { have[e.slide_id] = 1; if (e.position > max) max = e.position; });
        var rows = ids.filter(function (id) { return !have[id]; }).map(function (id, i) { return { proposal_id: pid, slide_id: id, position: max + 1 + i }; });
        return (rows.length ? sb.from("proposal_slides").insert(rows).then(must) : Promise.resolve()).then(function () {
          return sb.from("proposals").update({ updated_at: new Date().toISOString() }).eq("id", pid);
        }).then(function () {
          slideState.target = pid;
          toast(rows.length + " slide" + (rows.length === 1 ? "" : "s") + " added" + (ids.length > rows.length ? " (some were already in it)" : ""));
          return pid;
        });
      });
    });
  }

  // ---------- slides on an artist's page ----------
  function artistSlides(artistId, a) {
    var list = [], picked = {};
    var bar = document.createElement("div");
    bar.className = "selbar"; bar.hidden = true;
    bar.innerHTML = '<span class="asSelCount"></span><select class="asTarget"></select>' +
      '<button class="btn primary" type="button" data-act="add">Add to proposal</button><button class="btn" type="button" data-act="clear">Clear</button>';
    app.appendChild(bar);
    fillProposalSelect($(".asTarget", bar), slideState.target);
    function load() {
      return sb.from("slides").select("id,title,url,path,sort_order").eq("artist_id", artistId).order("sort_order").order("created_at")
        .then(function (r) { if (r.error) throw r.error; list = r.data; draw(); });
    }
    function draw() {
      var g = $("#asGrid"); if (!g) return;
      $("#asCount").textContent = list.length ? list.length + " slide" + (list.length > 1 ? "s" : "") : "";
      g.innerHTML = list.length ? list.map(function (x) {
        var on = !!picked[x.id];
        return '<div class="slide' + (on ? " on" : "") + '"><button type="button" class="slide-pick" data-pick="' + x.id + '" aria-label="Select slide">' +
          '<img loading="lazy" src="' + esc(x.url) + '" alt=""><span class="tick">' + (on ? "&#10003;" : "") + "</span></button>" +
          '<div class="slide-meta"><a class="small" href="' + esc(x.url) + '" target="_blank" rel="noopener">View full size</a><span class="spacer"></span>' +
          '<button type="button" class="linkbtn" data-unlink="' + x.id + '" title="Keep in library, remove from this act">Unlink</button></div></div>';
      }).join("") : '<p class="muted">No slides for this act yet. Upload one below, or import your master deck from the Slides page.</p>';
      var n = Object.keys(picked).length;
      bar.hidden = !n; $(".asSelCount", bar).textContent = n + " selected";
    }
    function upload(files) {
      files = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); });
      if (!files.length) return;
      var dz = $("#asDrop"), base = list.length ? Math.max.apply(null, list.map(function (x) { return x.sort_order; })) : 0, chain = Promise.resolve();
      files.forEach(function (f, i) {
        chain = chain.then(function () {
          dz.firstChild.textContent = "Uploading " + (i + 1) + " of " + files.length + "...";
          return GHDB.shrinkImage(f, 2400).then(function (blob) {
            var path = GHDB.uuid() + ".jpg";
            return uploadBlob(SLIDE_BUCKET, path, blob).then(function () {
              var url = sb.storage.from(SLIDE_BUCKET).getPublicUrl(path).data.publicUrl;
              return sb.from("slides").insert({ title: a.name, category: CAT_TO_SLIDECAT[a.category] || null, artist_id: artistId, url: url, path: path, sort_order: base + (i + 1) * 10 }).then(must);
            });
          });
        });
      });
      chain.catch(fail).then(function () { dz.firstChild.textContent = "Click or drop slide images here to add them to this act"; return load(); });
    }
    $("#asGrid").addEventListener("click", function (e) {
      var pk = e.target.closest("[data-pick]");
      if (pk) { var id = pk.getAttribute("data-pick"); if (picked[id]) delete picked[id]; else picked[id] = 1; draw(); return; }
      var ul = e.target.closest("[data-unlink]");
      if (ul) {
        var sid = ul.getAttribute("data-unlink");
        sb.from("slides").update({ artist_id: null }).eq("id", sid).then(must).then(function () { delete picked[sid]; toast("Slide unlinked (still in your library)"); return load(); }).catch(fail);
      }
    });
    var input = $("#asInput"), dz = $("#asDrop");
    input.addEventListener("change", function () { upload(input.files); input.value = ""; });
    dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("over"); });
    dz.addEventListener("drop", function (e) { e.preventDefault(); dz.classList.remove("over"); upload(e.dataTransfer.files); });
    bar.addEventListener("click", function (e) {
      var act = e.target.getAttribute("data-act");
      if (act === "clear") { picked = {}; draw(); }
      if (act === "add") {
        var ids = list.filter(function (x) { return picked[x.id]; }).map(function (x) { return x.id; });
        addSlidesToProposal(ids, $(".asTarget", bar).value).then(function (pid) {
          picked = {}; draw(); fillProposalSelect($(".asTarget", bar), pid);
        }).catch(function (err) { if (err) fail(err); });
      }
    });
    window.addEventListener("hashchange", function rm() { bar.remove(); window.removeEventListener("hashchange", rm); });
    load().catch(fail);
  }

  // ---------- slides library ----------
  var SLIDE_BUCKET = "slides";
  var SLIDE_CATS = ["Cover & Intro", "DJs", "Singers", "Live Bands", "Instrumentalists", "Specialist Acts", "Dancers",
    "Emcees", "Hostesses & Promo Staff", "Magicians", "Children's", "Ramadan & Arabic", "Festive", "Decor & Venue",
    "Packages & Pricing", "Closing", "Other"];
  var slideState = { q: "", cat: "", selected: {}, target: "" };

  function slideCatOptions(sel, withAll) {
    return (withAll ? '<option value="">All categories</option>' : '<option value="">No category</option>') +
      SLIDE_CATS.map(function (c) { return '<option' + (c === sel ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("");
  }
  function titleFromFile(name) {
    return String(name).replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Slide";
  }

  function viewSlides() {
    var q = new URLSearchParams(location.hash.split("?")[1] || "");
    if (q.get("add")) slideState.target = q.get("add");
    app.innerHTML = '<div class="pagehead"><div><h1>Slides</h1><p class="muted">Your proposal slide library. Tick slides, then add them to a proposal.</p></div>' +
      '<label class="btn primary" for="slideUpload">+ Upload slides<input type="file" id="slideUpload" accept="image/*" multiple hidden></label></div>' +
      '<div class="toolbar"><input type="text" id="sQ" placeholder="Search slides or act names" value="' + esc(slideState.q) + '">' +
      '<select id="sCat">' + slideCatOptions(slideState.cat, true) + "</select>" +
      '<span class="count" id="sCount"></span></div>' +
      '<label class="dropzone" id="slideDrop">Drag slide images here (PNG or JPG exported from Canva)</label><br>' +
      '<div id="slideGrid" class="slide-grid"><p class="muted">Loading&hellip;</p></div>' +
      '<div class="selbar" id="selBar" hidden><span id="selCount"></span><select id="selTarget"></select>' +
      '<button class="btn primary" type="button" id="selAdd">Add to proposal</button><button class="btn" type="button" id="selClear">Clear</button></div>';
    var all = [];
    function load() {
      return sb.from("slides").select("id,title,category,url,path,sort_order,created_at,artist_id,artists(name,slug)").order("sort_order").order("created_at").range(0, 4999)
        .then(function (r) { if (r.error) throw r.error; all = r.data; draw(); });
    }
    function draw() {
      var ql = slideState.q.toLowerCase();
      var rows = all.filter(function (x) {
        var hay = ((x.title || "") + " " + (x.artists ? x.artists.name : "")).toLowerCase();
        return (!slideState.cat || x.category === slideState.cat) && (!ql || hay.indexOf(ql) >= 0);
      });
      $("#sCount").textContent = rows.length + " of " + all.length + " slides";
      $("#slideGrid").innerHTML = rows.length ? rows.map(function (x) {
        var on = !!slideState.selected[x.id];
        return '<div class="slide' + (on ? " on" : "") + '" data-id="' + x.id + '"><button type="button" class="slide-pick" data-pick="' + x.id + '" aria-label="Select slide">' +
          '<img loading="lazy" src="' + esc(x.url) + '" alt=""><span class="tick">' + (on ? "&#10003;" : "") + "</span></button>" +
          '<div class="slide-meta"><input type="text" value="' + esc(x.title) + '" data-title="' + x.id + '" aria-label="Slide title">' +
          '<select data-cat="' + x.id + '">' + slideCatOptions(x.category, false) + "</select>" +
          (x.artists ? '<a class="small artist-tag" href="#/artists/' + x.artist_id + '">' + esc(x.artists.name) + "</a>" : '<span class="small muted">No act linked</span>') +
          '<button type="button" class="linkbtn del" data-del="' + x.id + '" title="Delete slide">Delete</button></div></div>';
      }).join("") : '<p class="muted center">No slides yet. Upload your proposal slides to get started.</p>';
      drawSel();
    }
    function drawSel() {
      var ids = Object.keys(slideState.selected);
      $("#selBar").hidden = !ids.length;
      $("#selCount").textContent = ids.length + " selected";
    }
    function loadTargets() {
      sb.from("proposals").select("id,title,client").order("updated_at", { ascending: false }).range(0, 499).then(function (r) {
        var opts = '<option value="__new">+ New proposal&hellip;</option>' + (r.data || []).map(function (p) {
          return '<option value="' + p.id + '"' + (p.id === slideState.target ? " selected" : "") + ">" + esc(p.title + (p.client ? " (" + p.client + ")" : "")) + "</option>";
        }).join("");
        $("#selTarget").innerHTML = opts;
        if (slideState.target && (r.data || []).some(function (p) { return p.id === slideState.target; })) $("#selTarget").value = slideState.target;
      });
    }
    // Files named like "0003--singers--layla.jpg" (the prepared master deck) are matched to their act and category automatically.
    var DECK_RE = /^(\d+)--([a-z0-9-]+)--([a-z0-9-]*)\.(jpe?g|png)$/i;
    function upload(files) {
      files = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); });
      if (!files.length) return;
      var dz = $("#slideDrop"), n = 0, skipped = 0, base = all.length ? Math.max.apply(null, all.map(function (x) { return x.sort_order; })) : 0;
      files.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
      var catBySlug = {}; SLIDE_CATS.forEach(function (c) { catBySlug[slugify(c)] = c; });
      var havePath = {}; all.forEach(function (x) { if (x.path) havePath[x.path] = 1; });
      var needArtists = files.some(function (f) { return DECK_RE.test(f.name); });
      var artistsReady = needArtists ? sb.from("artists").select("id,slug,name").range(0, 4999).then(must) : Promise.resolve([]);
      artistsReady.then(function (arts) {
        var bySlug = {}; arts.forEach(function (x) { bySlug[x.slug] = x; });
        var chain = Promise.resolve();
        files.forEach(function (f, i) {
          chain = chain.then(function () {
            dz.textContent = "Uploading " + (i + 1) + " of " + files.length + "... (keep this page open)";
            var m = DECK_RE.exec(f.name), row = { title: titleFromFile(f.name), category: slideState.cat || null, sort_order: base + (i + 1) * 10 }, path = GHDB.uuid() + ".jpg";
            if (m) {
              var art = bySlug[m[3]];
              path = "deck-" + m[1] + ".jpg";
              if (havePath[path]) { skipped++; return; }
              row.sort_order = parseInt(m[1], 10) * 10;
              row.category = catBySlug[m[2]] || null;
              row.artist_id = art ? art.id : null;
              row.title = art ? art.name : (row.category || "Section") + " divider";
            }
            return GHDB.shrinkImage(f, 2400).then(function (blob) {
              return uploadBlob(SLIDE_BUCKET, path, blob).then(function () {
                row.url = sb.storage.from(SLIDE_BUCKET).getPublicUrl(path).data.publicUrl; row.path = path;
                return sb.from("slides").insert(row).then(must);
              }).then(function () { n++; havePath[path] = 1; });
            });
          });
        });
        return chain;
      }).catch(fail).then(function () {
        dz.textContent = "Drag slide images here (PNG or JPG exported from Canva)";
        if (n || skipped) toast(n + " slide" + (n === 1 ? "" : "s") + " uploaded" + (skipped ? ", " + skipped + " already in the library" : ""));
        return load();
      });
    }

    load().catch(fail); loadTargets();
    $("#sQ").addEventListener("input", function (e) { slideState.q = e.target.value; draw(); });
    $("#sCat").addEventListener("change", function (e) { slideState.cat = e.target.value; draw(); });
    $("#slideUpload").addEventListener("change", function (e) { upload(e.target.files); e.target.value = ""; });
    var dz = $("#slideDrop");
    dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("over"); });
    dz.addEventListener("drop", function (e) { e.preventDefault(); dz.classList.remove("over"); upload(e.dataTransfer.files); });
    dz.addEventListener("click", function () { $("#slideUpload").click(); });

    var grid = $("#slideGrid");
    grid.addEventListener("click", function (e) {
      var pick = e.target.closest("[data-pick]");
      if (pick) { var id = pick.getAttribute("data-pick"); if (slideState.selected[id]) delete slideState.selected[id]; else slideState.selected[id] = 1; draw(); return; }
      var del = e.target.closest("[data-del]");
      if (del) {
        var sid = del.getAttribute("data-del"), x = all.filter(function (y) { return y.id === sid; })[0];
        if (!confirm("Delete this slide? It will also be removed from any proposals.")) return;
        (x.path ? sb.storage.from(SLIDE_BUCKET).remove([x.path]) : Promise.resolve())
          .then(function () { return sb.from("slides").delete().eq("id", sid).then(must); })
          .then(function () { delete slideState.selected[sid]; toast("Slide deleted"); return load(); }).catch(fail);
      }
    });
    grid.addEventListener("change", function (e) {
      var t = e.target, id = t.getAttribute("data-title") || t.getAttribute("data-cat");
      if (!id) return;
      var patch = t.hasAttribute("data-title") ? { title: t.value.trim() || "Slide" } : { category: t.value || null };
      sb.from("slides").update(patch).eq("id", id).then(must).then(function () {
        all.forEach(function (x) { if (x.id === id) { for (var k in patch) x[k] = patch[k]; } }); toast("Saved");
      }).catch(fail);
    });
    $("#selClear").addEventListener("click", function () { slideState.selected = {}; draw(); });
    $("#selAdd").addEventListener("click", function () {
      var ids = all.filter(function (x) { return slideState.selected[x.id]; }).map(function (x) { return x.id; });
      addSlidesToProposal(ids, $("#selTarget").value).then(function (pid) {
        slideState.selected = {}; location.hash = "#/proposals/" + pid;
      }).catch(function (e) { if (e) fail(e); });
    });
  }

  // ---------- proposals ----------
  function viewProposals() {
    app.innerHTML = '<div class="pagehead"><div><h1>Proposals</h1><p class="muted">Build a proposal from your slide library, download it as a PDF or send the client a private link.</p></div>' +
      '<button class="btn primary" type="button" id="newProp">+ New proposal</button></div><div id="propList"><p class="muted">Loading&hellip;</p></div>';
    $("#newProp").addEventListener("click", function () {
      var title = prompt("Name for the new proposal (e.g. Grand Hyatt NYE 2026):");
      if (!title) return;
      sb.from("proposals").insert({ title: title.trim() }).select("id").single().then(must)
        .then(function (r) { location.hash = "#/proposals/" + r.id; }).catch(fail);
    });
    sb.from("proposals").select("id,title,client,event_date,shared,updated_at,proposal_slides(count)").order("updated_at", { ascending: false }).range(0, 999)
      .then(function (r) {
        if (r.error) return fail(r.error);
        if (!r.data.length) { $("#propList").innerHTML = '<p class="muted center">No proposals yet.</p>'; return; }
        $("#propList").innerHTML = '<table class="list"><thead><tr><th>Proposal</th><th class="hide-m">Client</th><th class="hide-m">Event date</th><th>Slides</th><th>Client link</th><th></th></tr></thead><tbody>' +
          r.data.map(function (p) {
            var n = (p.proposal_slides && p.proposal_slides[0] && p.proposal_slides[0].count) || 0;
            return '<tr><td class="name"><a href="#/proposals/' + p.id + '">' + esc(p.title) + '</a><div class="sub">Edited ' + fmtDate(p.updated_at) + "</div></td>" +
              '<td class="hide-m sub">' + esc(p.client || "") + '</td><td class="hide-m sub">' + (p.event_date ? fmtDate(p.event_date) : "") + "</td>" +
              "<td>" + n + '</td><td><span class="pill ' + (p.shared ? "live" : "hidden") + '">' + (p.shared ? "On" : "Off") + "</span></td>" +
              '<td><a class="btn sm" href="#/proposals/' + p.id + '">Open</a></td></tr>';
          }).join("") + "</tbody></table>";
      });
  }

  function viewProposal(id) {
    app.innerHTML = '<p class="muted center">Loading&hellip;</p>';
    Promise.all([
      sb.from("proposals").select("*").eq("id", id).maybeSingle(),
      sb.from("proposal_slides").select("slide_id,position,slides(id,title,url,category)").eq("proposal_id", id).order("position")
    ]).then(function (res) {
      if (res[0].error) return fail(res[0].error);
      if (res[1].error) return fail(res[1].error);
      var p = res[0].data;
      if (!p) { app.innerHTML = '<p class="center muted">Proposal not found. <a href="#/proposals">Back</a></p>'; return; }
      var items = res[1].data.filter(function (x) { return x.slides; }).map(function (x) { return x.slides; });
      var link = location.origin + "/proposal.html?t=" + p.share_token;
      app.innerHTML = '<div class="pagehead"><div><a href="#/proposals" class="small">&larr; All proposals</a><h1>' + esc(p.title) + "</h1></div>" +
        '<div class="toolbar"><a class="btn" href="#/slides?add=' + p.id + '">+ Add slides</a><button class="btn primary" type="button" id="pdfBtn">Download PDF</button></div></div>' +
        '<section class="panel"><div class="grid3">' +
        '<label class="field">Proposal name<input type="text" id="prTitle" value="' + esc(p.title) + '"></label>' +
        '<label class="field">Client<input type="text" id="prClient" value="' + esc(p.client || "") + '"></label>' +
        '<label class="field">Event date<input type="date" id="prDate" value="' + esc(p.event_date || "") + '"></label>' +
        '<label class="field" style="grid-column:1/-1">Internal notes<textarea id="prNotes">' + esc(p.notes || "") + "</textarea></label></div>" +
        '<br><button class="btn primary" type="button" id="prSave">Save details</button></section>' +
        '<section class="panel"><h2>Client link ' + sw("prShared", p.shared, "Link switched on") + "</h2>" +
        '<p class="note">When the link is on, anyone you send it to can view and download this proposal. Switch it off at any time.</p>' +
        '<div class="linkrow"><input type="text" id="prLink" readonly value="' + esc(link) + '"><button class="btn" type="button" id="prCopy">Copy link</button></div></section>' +
        '<section class="panel"><h2>Slides <span class="muted small">' + items.length + " in this proposal</span></h2>" +
        (items.length ? '<div class="slide-grid order" id="prSlides">' + items.map(function (x, i) {
          return '<div class="slide"><span class="num">' + (i + 1) + '</span><img loading="lazy" src="' + esc(x.url) + '" alt=""><div class="slide-meta"><span class="sub">' + esc(x.title) + "</span>" +
            '<span class="tools"><button type="button" data-mv="-1" data-i="' + i + '"' + (i === 0 ? " disabled" : "") + ' title="Move earlier">&larr;</button>' +
            '<button type="button" data-mv="1" data-i="' + i + '"' + (i === items.length - 1 ? " disabled" : "") + ' title="Move later">&rarr;</button>' +
            '<button type="button" class="del" data-rm="' + i + '" title="Remove from proposal">&#10005;</button></span></div></div>';
        }).join("") + "</div>" : '<p class="muted">No slides yet. <a href="#/slides?add=' + p.id + '">Choose slides from your library</a>.</p>') +
        '</section><div class="actions"><span class="spacer"></span><button class="btn danger" type="button" id="prDelete">Delete proposal</button></div>';

      $("#prSave").addEventListener("click", function () {
        sb.from("proposals").update({ title: val("prTitle") || "Untitled proposal", client: val("prClient"), event_date: val("prDate"), notes: val("prNotes") }).eq("id", id).then(must)
          .then(function () { toast("Saved"); viewProposal(id); }).catch(fail);
      });
      $("#prShared").addEventListener("change", function (e) {
        sb.from("proposals").update({ shared: e.target.checked }).eq("id", id).then(must)
          .then(function () { toast(e.target.checked ? "Client link is on" : "Client link is off"); }).catch(fail);
      });
      $("#prCopy").addEventListener("click", function () {
        var inp = $("#prLink"); inp.select();
        (navigator.clipboard ? navigator.clipboard.writeText(inp.value) : Promise.reject()).then(function () { toast("Link copied"); }, function () { document.execCommand("copy"); toast("Link copied"); });
        if (!$("#prShared").checked) toast("Copied. Switch the link on before sending it.", true);
      });
      $("#pdfBtn").addEventListener("click", function () { printSlides(p.title, items.map(function (x) { return x.url; })); });
      $("#prDelete").addEventListener("click", function () {
        if (!confirm("Delete this proposal? Your slides stay in the library.")) return;
        sb.from("proposals").delete().eq("id", id).then(must).then(function () { toast("Proposal deleted"); location.hash = "#/proposals"; }).catch(fail);
      });
      var grid = $("#prSlides");
      if (grid) grid.addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b || b.disabled) return;
        if (b.hasAttribute("data-rm")) items.splice(+b.getAttribute("data-rm"), 1);
        else { var from = +b.getAttribute("data-i"), to = from + +b.getAttribute("data-mv"); var m = items.splice(from, 1)[0]; items.splice(to, 0, m); }
        sb.from("proposal_slides").delete().eq("proposal_id", id).then(must)
          .then(function () { return items.length ? sb.from("proposal_slides").insert(items.map(function (x, i) { return { proposal_id: id, slide_id: x.id, position: i }; })).then(must) : null; })
          .then(function () { return sb.from("proposals").update({ updated_at: new Date().toISOString() }).eq("id", id); })
          .then(function () { viewProposal(id); }).catch(fail);
      });
    }).catch(fail);
  }

  // Opens the slides as landscape pages and the browser's Save as PDF dialog.
  function printSlides(title, urls) {
    if (!urls.length) { toast("Add some slides first", true); return; }
    var w = window.open("", "_blank");
    if (!w) { toast("Allow pop-ups for this site to download the PDF", true); return; }
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + "</title><style>" +
      "@page{size:1920px 1080px;margin:0}html,body{margin:0;background:#111}img{display:block;width:100vw;height:auto;page-break-after:always;break-after:page}" +
      "@media screen{img{max-width:1200px;margin:16px auto;width:90vw}}</style></head><body>" +
      urls.map(function (u) { return '<img src="' + esc(u) + '" alt="">'; }).join("") + "</body></html>");
    w.document.close();
    var imgs = w.document.images, left = imgs.length;
    function done() { if (--left <= 0) setTimeout(function () { w.focus(); w.print(); }, 300); }
    Array.prototype.forEach.call(imgs, function (im) { if (im.complete) done(); else { im.onload = done; im.onerror = done; } });
  }

  // ---------- password ----------
  function viewPassword() {
    app.innerHTML = '<div class="auth"><h1>Set a new password</h1><form id="pwForm">' +
      '<label class="field">New password<input type="password" id="pw1" minlength="8" required autocomplete="new-password"></label>' +
      '<label class="field">Type it again<input type="password" id="pw2" minlength="8" required autocomplete="new-password"></label>' +
      '<button class="btn primary" type="submit">Save password</button></form></div>';
    $("#pwForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var a = $("#pw1").value, b = $("#pw2").value;
      if (a !== b) { toast("The passwords don't match", true); return; }
      sb.auth.updateUser({ password: a }).then(function (r) {
        if (r.error) return fail(r.error);
        toast("Password saved"); location.hash = "#/artists";
      });
    });
  }

  // ---------- start ----------
  GHDB.client().then(function (client) {
    if (!client) return renderSetup();
    sb = client;
    sb.auth.onAuthStateChange(function (event, s) {
      if (event === "PASSWORD_RECOVERY") { session = s; showChrome(true); location.hash = "#/password"; viewPassword(); }
    });
    sb.auth.getSession().then(function (r) {
      session = r.data && r.data.session;
      if (session) afterLogin(); else renderLogin();
    });
  });
})();
