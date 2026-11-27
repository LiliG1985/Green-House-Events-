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
  // Ready-made groups offered for each category (artists already in the database add their own groups too).
  var GROUP_PRESETS = {
    djs: ["Open Format", "House & Techno", "Arabic & Middle Eastern", "Afro & Latin", "DJ & Live Instrument"],
    singers: ["Pop & Soul", "Jazz & Swing", "Opera & Classical", "Arabic Singers", "Latin Singers", "Acoustic", "Choirs"],
    bands: ["Party Bands", "Jazz Bands", "Acoustic Duos & Trios", "Swing & Vintage", "Latin Bands", "Tribute Bands"],
    instrumental: ["Saxophonists", "Violinists", "Pianists", "Guitarists", "Harpists", "Cellists", "Percussionists", "Handpan", "Flutists", "Trumpet & Brass", "Classical Ensembles"],
    specialist: ["Acrobats & Circus", "LED Performers", "Themed Roaming Characters", "Parades & Stilt Walkers", "Jugglers & Circus Skills", "Drummers", "Fire", "Laser Shows",
      "Roaming & Specialty Musicians", "Sand Artists", "Speed Painters", "Live Painters", "Caricaturists", "Live Illustrators", "Calligraphers", "Silhouette Artists",
      "Body & Face Painters", "Henna Artists", "Bubble Shows", "Comedians", "Hypnotists"],
    dancers: ["Ballet & Contemporary", "Belly Dancers", "Latin & Salsa", "Bollywood", "Hip Hop & Street", "Cabaret & Showgirls", "Carnival & Samba", "Flamenco & Tango", "Cultural & Folk"],
    mcs: ["Corporate Emcees", "Arabic & Bilingual", "Quiz Hosts", "Game Show & Bingo Hosts", "Comedians"],
    hostesses: ["Event Hostesses", "Promo Staff", "Themed Hostesses", "Brand Ambassadors"],
    magicians: ["Close-up Magic", "Stage Illusion", "Mentalists", "Hypnotists"],
    kids: ["Magic Shows", "Face Painting", "Balloon Twisting", "Science Shows", "Characters", "Puppet & Bubble Shows", "Workshops & Crafts"],
    ramadan: ["Arabic Bands & Duos", "Arabic Singers", "Oud", "Qanun", "Percussion", "Harp", "Violin", "Flute", "Live Artists", "Sand Artists", "Calligraphers", "Cultural Activations", "Cultural Dance"]
  };
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
  function showDuplicateNotice(added, names) {
    var old = document.getElementById("dupNotice"); if (old) old.remove();
    var box = document.createElement("div"); box.id = "dupNotice"; box.className = "dup-notice";
    box.innerHTML = '<button class="dup-close" aria-label="Close">&times;</button>' +
      '<strong>' + names.length + ' slide' + (names.length === 1 ? ' was' : 's were') + ' already uploaded</strong>' +
      '<p>These were skipped, so nothing has been doubled up. ' + added + ' new slide' + (added === 1 ? ' was' : 's were') + ' added.</p>' +
      '<ul>' + names.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>';
    box.querySelector(".dup-close").onclick = function () { box.remove(); };
    document.body.appendChild(box);
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
    if (h[0] === "slides" && h[1] === "edit" && h[2]) return viewSlideEdit(h[2]);
    if (h[0] === "slides" && h[1] === "new") return viewSlideCreate(h[2] || null);
    if (h[0] === "slides") return viewSlides();
    if (h[0] === "proposals" && h[1]) return viewProposal(h[1]);
    if (h[0] === "proposals") return viewProposals();
    if (h[0] === "crew" && h[1]) return viewCrewPerson(h[1] === "new" ? null : h[1]);
    if (h[0] === "crew") return viewCrew();
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
    var sgNames = function (cat) {
      var all = {}; (GROUP_PRESETS[cat] || []).forEach(function (g) { all[g] = 1; }); Object.keys(groups[cat] || {}).forEach(function (g) { all[g] = 1; });
      return Object.keys(all).sort(function (x, y) { return x.localeCompare(y); });
    };
    var sgOptions = function (cat, cur) {
      var names = sgNames(cat); if (cur && names.indexOf(cur) < 0) names.push(cur);
      return '<option value="">No group</option>' + names.map(function (g) { return '<option value="' + esc(g) + '"' + (g === cur ? " selected" : "") + ">" + esc(g) + "</option>"; }).join("") +
        '<option value="__new">+ New group&hellip;</option>';
    };
    app.innerHTML =
      '<div class="pagehead"><div><a href="#/artists" class="small">&larr; All artists</a><h1>' + (id ? esc(a.name) : "Add artist") + "</h1>" +
      (id ? '<span class="pill ' + (a.published ? "live" : "hidden") + '">' + (a.published ? "Live on website" : "Hidden") + "</span>" : "") + "</div></div>" +

      '<form id="artistForm" autocomplete="off">' +
      '<section class="panel"><h2>On the website ' + sw("aPublished", a.published, "Show on website") + "</h2>" +
      '<div class="grid2">' +
      '<label class="field">Name / act name<input type="text" id="aName" required value="' + esc(a.name) + '"></label>' +
      '<label class="field">Category<select id="aCategory">' + catOptions(a.category) + "</select></label>" +
      '<label class="field">Group within category <span class="hint">Shows as a heading on the website, e.g. Sand Artists</span><select id="aSubgroupSel">' + sgOptions(a.category, a.subgroup || "") + '</select>' +
      '<input type="text" id="aSubgroup" placeholder="Type the new group name" value="' + esc(a.subgroup || "") + '" hidden></label>' +
      '<label class="field">Order <span class="hint">Lower numbers show first</span><input type="number" id="aOrder" value="' + esc(a.sort_order || 0) + '"></label>' +
      '<label class="field span2">Short description <span class="hint">A few words shown under the name, e.g. "Saxophonist" or "Oud &amp; Vocals". The longer description goes in Bio.</span><input type="text" id="aRole" maxlength="60" value="' + esc(a.role || "") + '"></label>' +
      '<label class="field span2">Bio <span class="hint">One or two lines, shown when guests hover over the photo</span><textarea id="aBio">' + esc(a.bio || "") + "</textarea></label>" +
      "</div></section>" +

      '<section class="panel"><h2>Photos</h2><p class="note">The first photo is the one on the website. Use the arrows to reorder.</p>' +
      (id ? '<div class="photos" id="photoGrid"></div><label class="dropzone" id="dropzone">Click or drop photos here to upload<input type="file" id="photoInput" accept="image/*" multiple hidden></label>'
          : '<p class="muted">Save the artist first, then add photos.</p>') + "</section>" +

      (id ? '<section class="panel"><h2>Proposal slides <span class="muted small" id="asCount"></span></h2>' +
        '<p class="note">This act&rsquo;s slides from your proposal deck. Tick slides, then add them to a proposal. ' +
        '<a class="btn small" href="#/slides/new/' + id + '">+ Create slide</a></p>' +
        '<div id="asGrid" class="slide-grid compact"><p class="muted">Loading&hellip;</p></div>' +
        '<label class="dropzone" id="asDrop">Click or drop slide images here to add them to this act<input type="file" id="asInput" accept="image/*" multiple hidden></label></section>'
        : '<section class="panel"><h2>Proposal slide</h2><p class="note">Make their slide in the Greenhouse style straight away. The artist is saved first, then the slide maker opens with their name and bio filled in, ready for you to add photos.</p>' +
          '<button class="btn" type="button" id="saveSlideBtn">Create artist &amp; make their slide</button></section>') +

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

    var syncGroup = function () {
      var s = $("#aSubgroupSel"), t = $("#aSubgroup");
      if (s.value === "__new") { t.hidden = false; t.value = ""; t.focus(); } else { t.hidden = true; t.value = s.value; }
    };
    $("#aSubgroupSel").addEventListener("change", syncGroup);
    $("#aCategory").addEventListener("change", function (e) { $("#aSubgroupSel").innerHTML = sgOptions(e.target.value, ""); syncGroup(); });
    $("#artistForm").addEventListener("submit", function (e) { e.preventDefault(); saveArtist(id, a); });
    if (!id) $("#saveSlideBtn").addEventListener("click", function () { if ($("#artistForm").reportValidity()) saveArtist(null, a, true); });
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

  function saveArtist(id, a, thenSlide) {
    var btn = $("#saveBtn"); btn.disabled = true; btn.textContent = "Saving...";
    var pub = {
      name: val("aName"), category: $("#aCategory").value, subgroup: val("aSubgroup"), role: val("aRole"), bio: val("aBio"),
      sort_order: parseInt($("#aOrder").value, 10) || 0, published: checked("aPublished"),
      show_videos: checked("aShowVideos"), show_audio: checked("aShowAudio"),
      show_instagram: checked("aShowInstagram"), show_website: checked("aShowWebsite")
    };
    // A sentence typed into the short description belongs in the hover bio.
    if (pub.role && pub.role.length > 45 && !pub.bio) { pub.bio = pub.role; pub.role = null; $("#aBio").value = pub.bio; $("#aRole").value = ""; toast("Moved the long description into Bio so it shows on hover"); }
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
          if (thenSlide) { toast("Artist created. Now build their slide."); location.hash = "#/slides/new/" + row.id + "?back=" + encodeURIComponent("#/artists/" + row.id); return; }
          toast("Artist created. Now add photos, then use Create slide to make their proposal slide."); location.hash = "#/artists/" + row.id;
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
  var appFilter = "new", appType = "", appQ = "";
  function viewApplications() {
    var opt = function (v, l) { return '<option value="' + v + '"' + (appType === v ? " selected" : "") + ">" + l + "</option>"; };
    app.innerHTML = '<div class="pagehead"><div><h1>Applications</h1><p class="muted">Performers, freelance event crew and suppliers who applied through the Join Our Roster page. Crew and suppliers stay private and are never added to the website.</p></div>' +
      '<select id="appType" style="max-width:240px">' + opt("", "Everyone") + opt("performer", "Performers only") + opt("crew", "Event crew only") + opt("supplier", "Suppliers only") + "</select></div>" +
      '<div class="tabs" id="appTabs"></div><div class="toolbar"><input type="text" id="appQ" placeholder="Search name, company, service or area, e.g. balloons" value="' + esc(appQ) + '"></div><div id="appList"><p class="muted">Loading&hellip;</p></div>';
    sb.from("applications").select("id,created_at,status,full_name,act_name,category,based_in,photos,applicant_type,company,service_type,skills").order("created_at", { ascending: false }).range(0, 4999)
      .then(function (r) {
        if (r.error) return fail(r.error);
        var everything = r.data, all, counts;
        function draw() {
          var aq = appQ.toLowerCase();
          all = everything.filter(function (x) {
            if (appType && (x.applicant_type || "performer") !== appType) return false;
            return !aq || [x.full_name, x.act_name, x.company, x.service_type, x.category, x.skills, x.based_in].join(" ").toLowerCase().indexOf(aq) >= 0;
          });
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
              (x.applicant_type === "supplier" ? "Supplier &middot; " + esc(x.service_type || "") : x.applicant_type === "crew" ? "Event crew &middot; " + esc(x.service_type || "") : esc(x.category || "")) + (x.based_in ? " &middot; " + esc(x.based_in) : "") + "</div>" +
              '<div class="sub">' + fmtDate(x.created_at) + '</div><span class="pill ' + x.status + '">' + x.status + "</span></div></a>";
          }).join("") + "</div>";
          loadThumbs();
        }
        $("#appTabs").addEventListener("click", function (e) { var s = e.target.getAttribute("data-s"); if (s) { appFilter = s; draw(); } });
        $("#appType").addEventListener("change", function (e) { appType = e.target.value; draw(); });
        $("#appQ").addEventListener("input", function (e) { appQ = e.target.value; draw(); });
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
      var isSup = x.applicant_type === "supplier", isCrew = x.applicant_type === "crew", isPrivate = isSup || isCrew;
      var facts = isCrew ? [["Type", "Freelance event crew"], ["Full name", x.full_name], ["Role", x.service_type], ["Experience", x.experience_years],
          ["Availability", x.availability], ["UAE work status", x.visa_status], ["Email", x.email], ["Phone / WhatsApp", x.phone], ["Based in", x.based_in],
          ["Key skills", x.skills], ["Languages", x.languages], ["LinkedIn", x.linkedin], ["Instagram / social", x.social], ["Portfolio", x.portfolio_link], ["Applied", fmtDate(x.created_at)]]
        : (isSup ? [["Type", "Supplier / partner"], ["Company", x.company], ["Main service", x.service_type], ["Other services", x.skills], ["Contact name", x.full_name]]
                         : [["Full name", x.full_name], ["Act / stage name", x.act_name], ["Category", x.category]]).concat([["Email", x.email],
        ["Phone / WhatsApp", x.phone], ["Based in", x.based_in], ["Skills / genres", x.skills], ["Languages", x.languages],
        ["Instagram", x.social], ["Website", x.website], ["Portfolio", x.portfolio_link], ["Applied", fmtDate(x.created_at)]]).filter(function (f) { return !(isSup && /Skills \/ genres|Languages/.test(f[0])); });
      var linkedin = x.linkedin && !/^https?:/i.test(x.linkedin) ? "https://" + x.linkedin.replace(/^\/+/, "") : x.linkedin;
      facts = facts.map(function (f) { return f[0] === "LinkedIn" ? [f[0], linkedin] : f; });
      app.innerHTML = '<div class="pagehead"><div><a href="#/applications" class="small">&larr; All applications</a><h1>' + esc(isSup ? (x.company || x.full_name) : (x.act_name || x.full_name)) + '</h1><span class="pill ' + x.status + '">' + x.status + "</span>" + (isSup ? ' <span class="pill hidden">Supplier</span>' : isCrew ? ' <span class="pill hidden">Event crew</span>' : "") + "</div>" +
        '<div class="toolbar">' + (x.cv_path ? '<button class="btn primary" type="button" id="cvBtn">Open CV</button>' : "") + (isCrew ? '<span id="crewLinkSlot"></span>' : "") + (isPrivate ? '<span class="muted small">' + (isCrew ? "Crew" : "Suppliers") + ' stay private in the dashboard and are never added to the website.</span>'
          : x.artist_id ? '<a class="btn primary" href="#/artists/' + x.artist_id + '">Open artist profile</a>' : '<button class="btn primary" id="convertBtn" type="button">Create artist profile</button>') + "</div></div>" +
        '<section class="panel"><h2>Photos</h2><div class="photos" id="appPhotos">' + (x.photos && x.photos.length ? '<p class="muted">Loading photos&hellip;</p>' : '<p class="muted">No ' + (isCrew ? "photo" : "photos") + " sent.</p>") + "</div></section>" +
        '<section class="panel private"><h2>Details <span class="lock">Private</span></h2><dl class="facts">' +
        facts.map(function (f) { return "<dt>" + esc(f[0]) + "</dt><dd>" + (f[1] ? (f[0] === "Email" ? '<a href="mailto:' + esc(f[1]) + '">' + esc(f[1]) + "</a>" : linkify(f[1])) : '<span class="muted">-</span>') + "</dd>"; }).join("") +
        "<dt>" + (isCrew ? "Experience &amp; past events" : "About") + "</dt><dd>" + linkify(x.bio || "-") + "</dd>" + (isCrew ? "" : "<dt>" + (isSup ? "Portfolio links" : "Video links") + "</dt><dd>" + linkify(x.video_links || "-") + "</dd>") +
        (isCrew ? "<dt>CV</dt><dd>" + (x.cv_path ? '<a href="#" id="cvLink">Open CV (' + esc(x.cv_path.split(".").pop().toUpperCase()) + ")</a>" : '<span class="muted">No CV sent</span>') + "</dd>" : "") + "</dl></section>" +
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
      var openCv = function (e) {
        if (e) e.preventDefault();
        var w = window.open("", "_blank");
        sb.storage.from(APP_BUCKET).createSignedUrls([x.cv_path], 600).then(function (s) {
          var u = s.data && s.data[0] && s.data[0].signedUrl;
          if (s.error || !u) { if (w) w.close(); return fail(s.error || new Error("CV not found")); }
          if (w) w.location = u; else location.href = u;
        });
      };
      if ($("#cvBtn")) $("#cvBtn").addEventListener("click", openCv);
      if ($("#cvLink")) $("#cvLink").addEventListener("click", openCv);
      $("#apSave").addEventListener("click", function () {
        sb.from("applications").update({ status: $("#apStatus").value, admin_notes: val("apNotes") }).eq("id", id).then(must)
          .then(function () { toast("Review saved"); refreshBadge(); viewApplication(id); }).catch(fail);
      });
      $("#apDelete").addEventListener("click", function () {
        if (!confirm("Delete this application and its files? This can't be undone.")) return;
        var files = (x.photos || []).concat(x.cv_path ? [x.cv_path] : []);
        (files.length ? sb.storage.from(APP_BUCKET).remove(files) : Promise.resolve())
          .then(function () { return sb.from("applications").delete().eq("id", id).then(must); })
          .then(function () { toast("Application deleted"); refreshBadge(); location.hash = "#/applications"; }).catch(fail);
      });
      var cb = $("#convertBtn"); if (cb) cb.addEventListener("click", function () { convert(x, cb); });
      if (isCrew) sb.from("crew").select("id").eq("application_id", x.id).limit(1).then(function (c) {
        var slot = $("#crewLinkSlot"); if (!slot) return;
        if (!c.error && c.data && c.data[0]) { slot.innerHTML = '<a class="btn primary" href="#/crew/' + c.data[0].id + '">Open on crew roster</a>'; return; }
        slot.innerHTML = '<button class="btn primary" type="button" id="toCrewBtn">Add to crew roster</button>';
        $("#toCrewBtn").addEventListener("click", function () { addCrewFromApplication(x, this); });
      });
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

  // ---------- crew & staffing roster (private) ----------
  var CREW_STATUS = [["potential", "Potential"], ["active", "Active"], ["inactive", "Inactive"], ["do_not_use", "Do not use"]];
  var CREW_ROLES = ["Stage Manager", "Project Manager", "Account Manager", "Production Manager", "Event Manager / Coordinator", "Show Caller", "Artist Liaison",
    "Technical Manager", "Runner", "Hostess / Host", "Promotional Staff", "Waiter / Waitress", "Bartender", "Usher", "Security", "Driver", "Technician", "Other"];
  var crewState = { q: "", status: "active", role: "", kind: "" };
  function crewLabel(s) { var f = CREW_STATUS.filter(function (c) { return c[0] === s; })[0]; return f ? f[1] : s; }
  function noCrewTable(e) { return e && /crew/.test(e.message || "") && /exist|schema cache|relation/i.test(e.message || ""); }
  function crewSetup() { app.innerHTML = '<div class="pagehead"><div><h1>Crew &amp; Staff</h1></div></div><section class="panel"><p>Run the <strong>add-crew-roster</strong> SQL in Supabase first, then reload this page.</p></section>'; }
  function signAll(paths) {
    paths = paths.filter(Boolean);
    if (!paths.length) return Promise.resolve({});
    return sb.storage.from(APP_BUCKET).createSignedUrls(paths, 3600).then(function (r) {
      var out = {}; (r.data || []).forEach(function (s, i) { if (s.signedUrl) out[paths[i]] = s.signedUrl; }); return out;
    });
  }
  function waLink(p) { var d = String(p || "").replace(/[^\d]/g, ""); return d.length > 6 ? "https://wa.me/" + d : null; }

  function viewCrew() {
    app.innerHTML = '<div class="pagehead"><div><h1>Crew &amp; Staff</h1><p class="muted">Your private roster of freelancers and staff. Only people signed in to this dashboard can see it.</p></div>' +
      '<a class="btn primary" href="#/crew/new">+ Add person</a></div>' +
      '<div class="tabs" id="crewTabs"></div>' +
      '<div class="toolbar"><input type="text" id="cQ" placeholder="Search name, role, skills, languages or area" value="' + esc(crewState.q) + '">' +
      '<select id="cRole"><option value="">All roles</option></select>' +
      '<select id="cKind"><option value="">Freelancers and staff</option><option value="freelancer"' + (crewState.kind === "freelancer" ? " selected" : "") + '>Freelancers</option><option value="staff"' + (crewState.kind === "staff" ? " selected" : "") + ">Staff</option></select>" +
      '<span class="count" id="cCount"></span></div><div id="crewWrap"><p class="muted">Loading&hellip;</p></div>';
    sb.from("crew").select("id,full_name,kind,status,role,based_in,phone,email,availability,languages,skills,rating,photo_path,updated_at").order("full_name").range(0, 4999).then(function (r) {
      if (noCrewTable(r.error)) return crewSetup();
      if (r.error) return fail(r.error);
      var all = r.data, urls = {};
      var roles = all.map(function (p) { return p.role; }).filter(Boolean).filter(function (v, i, s) { return s.indexOf(v) === i; }).sort();
      $("#cRole").innerHTML = '<option value="">All roles</option>' + roles.map(function (x) { return "<option" + (x === crewState.role ? " selected" : "") + ">" + esc(x) + "</option>"; }).join("");
      function draw() {
        var q = crewState.q.toLowerCase();
        var base = all.filter(function (p) {
          if (crewState.role && p.role !== crewState.role) return false;
          if (crewState.kind && p.kind !== crewState.kind) return false;
          if (q && [p.full_name, p.role, p.skills, p.languages, p.based_in].join(" ").toLowerCase().indexOf(q) < 0) return false;
          return true;
        });
        $("#crewTabs").innerHTML = CREW_STATUS.concat([["all", "All"]]).map(function (s) {
          var n = s[0] === "all" ? base.length : base.filter(function (p) { return p.status === s[0]; }).length;
          return '<button type="button" data-cs="' + s[0] + '" class="' + (crewState.status === s[0] ? "on" : "") + '">' + s[1] + " (" + n + ")</button>";
        }).join("");
        var rows = base.filter(function (p) { return crewState.status === "all" || p.status === crewState.status; });
        $("#cCount").textContent = rows.length + " " + (rows.length === 1 ? "person" : "people");
        if (!rows.length) { $("#crewWrap").innerHTML = '<p class="muted center">' + (all.length ? "Nobody matches." : "No one on the roster yet. Add people here, or use Add to crew roster on an event crew application.") + "</p>"; return; }
        $("#crewWrap").innerHTML = '<table class="list"><thead><tr><th></th><th>Name</th><th>Role</th><th class="hide-m">Based in</th><th class="hide-m">Availability</th><th>Status</th><th></th></tr></thead><tbody>' +
          rows.map(function (p) {
            var wa = waLink(p.phone);
            return "<tr><td>" + (p.photo_path ? '<img class="thumb" data-cphoto="' + esc(p.photo_path) + '" alt="">' : '<div class="thumb empty">No photo</div>') + "</td>" +
              '<td class="name"><a href="#/crew/' + p.id + '">' + esc(p.full_name) + '</a><div class="sub">' + (p.kind === "staff" ? "Staff" : "Freelancer") + (p.rating ? " &middot; " + "&#9733;".repeat(p.rating) : "") + "</div></td>" +
              "<td>" + esc(p.role || "") + '</td><td class="hide-m sub">' + esc(p.based_in || "") + '</td><td class="hide-m sub">' + esc(p.availability || "") + "</td>" +
              '<td><span class="pill crew-' + p.status + '">' + crewLabel(p.status) + "</span></td>" +
              '<td class="nowrap">' + (wa ? '<a class="btn sm" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a> ' : "") + '<a class="btn sm" href="#/crew/' + p.id + '">Open</a></td></tr>';
          }).join("") + "</tbody></table>";
        $all("[data-cphoto]").forEach(function (img) { var u = urls[img.getAttribute("data-cphoto")]; if (u) img.src = u; });
      }
      draw();
      signAll(all.map(function (p) { return p.photo_path; })).then(function (u) { urls = u; draw(); });
      $("#crewTabs").addEventListener("click", function (e) { var s = e.target.getAttribute("data-cs"); if (s) { crewState.status = s; draw(); } });
      $("#cQ").addEventListener("input", function (e) { crewState.q = e.target.value; draw(); });
      $("#cRole").addEventListener("change", function (e) { crewState.role = e.target.value; draw(); });
      $("#cKind").addEventListener("change", function (e) { crewState.kind = e.target.value; draw(); });
    });
  }

  function viewCrewPerson(id) {
    app.innerHTML = '<p class="muted center">Loading&hellip;</p>';
    (id ? sb.from("crew").select("*").eq("id", id).maybeSingle() : Promise.resolve({ data: { kind: "freelancer", status: "potential" } })).then(function (r) {
      if (noCrewTable(r.error)) return crewSetup();
      if (r.error) return fail(r.error);
      var p = r.data; if (!p) { app.innerHTML = '<p class="center muted">Not found. <a href="#/crew">Back</a></p>'; return; }
      var photoBlob = null, cvFile = null, removeCv = false;
      var f = function (key, label, extra) { return '<label class="field' + (extra && extra.wide ? " span2" : "") + '">' + label + (extra && extra.hint ? ' <span class="hint">' + extra.hint + "</span>" : "") +
        (extra && extra.area ? '<textarea id="c_' + key + '" rows="' + (extra.rows || 4) + '">' + esc(p[key] || "") + "</textarea>" : '<input type="' + ((extra && extra.type) || "text") + '" id="c_' + key + '" value="' + esc(p[key] || "") + '"' + (extra && extra.list ? ' list="' + extra.list + '"' : "") + ">") + "</label>"; };
      var sel = function (key, label, opts) { return '<label class="field">' + label + '<select id="c_' + key + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(p[key] || "") === String(o[0]) ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></label>"; };
      var wa = waLink(p.phone);
      app.innerHTML = '<div class="pagehead"><div><a href="#/crew" class="small">&larr; Crew &amp; Staff</a><h1>' + esc(p.full_name || "Add person") + "</h1>" +
        (id ? '<span class="pill crew-' + p.status + '">' + crewLabel(p.status) + "</span>" : "") + "</div>" +
        '<div class="toolbar">' + (p.email ? '<a class="btn" href="mailto:' + esc(p.email) + '">Email</a>' : "") + (wa ? '<a class="btn" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : "") +
        (p.application_id ? '<a class="btn" href="#/applications/' + p.application_id + '">Their application</a>' : "") + "</div></div>" +
        '<datalist id="crewRoles">' + CREW_ROLES.map(function (x) { return "<option>" + esc(x) + "</option>"; }).join("") + "</datalist>" +
        '<div class="crew-top"><section class="panel crew-photo"><h2>Photo</h2><div id="cPhotoBox" class="crew-photo-box">' + (p.photo_path ? '<p class="muted">Loading&hellip;</p>' : '<p class="muted">No photo yet</p>') + "</div>" +
        '<label class="btn small">' + (p.photo_path ? "Replace photo" : "Add photo") + '<input type="file" id="cPhoto" accept="image/*" hidden></label></section>' +
        '<section class="panel private crew-main"><h2>Details <span class="lock">Private</span></h2><div class="grid2">' +
        f("full_name", "Full name") + f("role", "Role", { list: "crewRoles" }) +
        sel("kind", "Type", [["freelancer", "Freelancer"], ["staff", "Staff"]]) + sel("status", "Status", CREW_STATUS) +
        f("phone", "Phone / WhatsApp") + f("email", "Email", { type: "email" }) +
        f("based_in", "Based in") + f("languages", "Languages") +
        f("experience_years", "Experience") + f("availability", "Availability") +
        f("visa_status", "UAE work status") + f("day_rate", "Rate", { hint: "Private, e.g. AED 900 per day" }) +
        f("skills", "Key skills", { wide: true }) +
        f("linkedin", "LinkedIn") + f("social", "Instagram / social") + f("portfolio_link", "Portfolio / other link", { wide: true }) +
        sel("rating", "Your rating", [["", "Not rated"], ["5", "★★★★★ Excellent"], ["4", "★★★★ Very good"], ["3", "★★★ Good"], ["2", "★★ Fair"], ["1", "★ Poor"]]) + "<span></span>" +
        f("notes", "Notes", { area: true, wide: true, rows: 6, hint: "Events worked, feedback, who referred them..." }) +
        "</div></section></div>" +
        '<section class="panel"><h2>CV</h2><div id="cCvBox">' + (p.cv_path ? '<button class="btn" type="button" id="cCvOpen">Open CV (' + esc(p.cv_path.split(".").pop().toUpperCase()) + ")</button> " : '<span class="muted">No CV yet.</span> ') +
        '<label class="btn small">' + (p.cv_path ? "Replace CV" : "Add CV") + '<input type="file" id="cCv" accept=".pdf,.doc,.docx" hidden></label>' + (p.cv_path ? ' <button class="btn small danger" type="button" id="cCvRm">Remove CV</button>' : "") + '<span class="muted small" id="cCvNote"></span></div></section>' +
        '<div class="actions"><button class="btn primary" type="button" id="cSave">' + (id ? "Save" : "Add to roster") + '</button><span class="spacer"></span>' + (id ? '<button class="btn danger" type="button" id="cDelete">Delete</button>' : "") + "</div>";

      if (p.photo_path) signAll([p.photo_path]).then(function (u) { var s = u[p.photo_path]; $("#cPhotoBox").innerHTML = s ? '<img src="' + esc(s) + '" alt="">' : '<p class="muted">Photo unavailable</p>'; });
      $("#cPhoto").addEventListener("change", function (e) {
        var file = e.target.files[0]; if (!file) return;
        GHDB.shrinkImage(file, 1600).then(function (b) { photoBlob = b; $("#cPhotoBox").innerHTML = '<img src="' + URL.createObjectURL(b) + '" alt="">'; toast("Photo ready. Click Save to keep it."); }).catch(fail);
      });
      $("#cCv").addEventListener("change", function (e) {
        var file = e.target.files[0]; if (!file) return;
        if (!/\.(pdf|docx?)$/i.test(file.name)) { toast("Please choose a PDF or Word file", true); return; }
        if (file.size > 10485760) { toast("That CV is over 10 MB", true); return; }
        cvFile = file; removeCv = false; $("#cCvNote").textContent = " " + file.name + " ready. Click Save to keep it.";
      });
      if ($("#cCvRm")) $("#cCvRm").addEventListener("click", function () { removeCv = true; cvFile = null; $("#cCvNote").textContent = " CV will be removed when you save."; });
      if ($("#cCvOpen")) $("#cCvOpen").addEventListener("click", function () {
        var w = window.open("", "_blank");
        signAll([p.cv_path]).then(function (u) { var s = u[p.cv_path]; if (!s) { if (w) w.close(); return toast("CV unavailable", true); } if (w) w.location = s; else location.href = s; });
      });
      $("#cSave").addEventListener("click", function () {
        var btn = this, row = {};
        ["full_name", "role", "kind", "status", "phone", "email", "based_in", "languages", "experience_years", "availability", "visa_status", "day_rate", "skills", "linkedin", "social", "portfolio_link", "notes"].forEach(function (k) { row[k] = val("c_" + k); });
        row.rating = val("c_rating") ? parseInt(val("c_rating"), 10) : null;
        if (!row.full_name) { toast("Add their name first", true); return; }
        row.kind = row.kind || "freelancer"; row.status = row.status || "potential"; row.updated_at = new Date().toISOString();
        btn.disabled = true; btn.textContent = "Saving...";
        var save = id ? sb.from("crew").update(row).eq("id", id).select("id").single() : sb.from("crew").insert(row).select("id").single();
        var cid, old = [];
        save.then(must).then(function (res) {
          cid = res.id; var stamp = Date.now().toString(36), upd = {}, chain = Promise.resolve();
          if (photoBlob) chain = chain.then(function () { var path = "crew/" + cid + "/photo-" + stamp + ".jpg"; return uploadBlob(APP_BUCKET, path, photoBlob).then(function () { upd.photo_path = path; if (p.photo_path) old.push(p.photo_path); }); });
          if (cvFile) chain = chain.then(function () {
            var ext = cvFile.name.split(".").pop().toLowerCase(), path = "crew/" + cid + "/cv-" + stamp + "." + ext;
            var type = ext === "pdf" ? "application/pdf" : ext === "doc" ? "application/msword" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            return sb.storage.from(APP_BUCKET).upload(path, cvFile, { contentType: type, upsert: false }).then(must).then(function () { upd.cv_path = path; if (p.cv_path) old.push(p.cv_path); });
          });
          else if (removeCv && p.cv_path) { upd.cv_path = null; old.push(p.cv_path); }
          return chain.then(function () { return Object.keys(upd).length ? sb.from("crew").update(upd).eq("id", cid).then(must) : null; });
        }).then(function () {
          old = old.filter(function (x) { return /^crew\//.test(x); });
          if (old.length) sb.storage.from(APP_BUCKET).remove(old);
          toast(id ? "Saved" : "Added to the roster");
          if (id) viewCrewPerson(id); else location.hash = "#/crew/" + cid;
        }).catch(function (e) { fail(e); btn.disabled = false; btn.textContent = id ? "Save" : "Add to roster"; });
      });
      if ($("#cDelete")) $("#cDelete").addEventListener("click", function () {
        if (!confirm("Delete " + (p.full_name || "this person") + " from the roster, with their photo and CV? This can't be undone.")) return;
        var files = [p.photo_path, p.cv_path].filter(function (x) { return x && /^crew\//.test(x); });
        (files.length ? sb.storage.from(APP_BUCKET).remove(files) : Promise.resolve())
          .then(function () { return sb.from("crew").delete().eq("id", id).then(must); })
          .then(function () { toast("Deleted"); location.hash = "#/crew"; }).catch(fail);
      });
    });
  }

  // Copies an event crew application (with its headshot and CV) onto the private roster.
  function addCrewFromApplication(x, btn) {
    btn.disabled = true; btn.textContent = "Adding...";
    var cid;
    sb.from("crew").insert({ full_name: x.full_name, kind: "freelancer", status: "potential", role: x.service_type, experience_years: x.experience_years || null,
      availability: x.availability || null, visa_status: x.visa_status || null, email: x.email, phone: x.phone, based_in: x.based_in, languages: x.languages,
      skills: x.skills, linkedin: x.linkedin || null, social: x.social, portfolio_link: x.portfolio_link, application_id: x.id,
      notes: x.bio ? "From their application:\n" + x.bio : null }).select("id").single().then(function (r) {
      if (noCrewTable(r.error)) throw new Error("Run the add-crew-roster SQL in Supabase first, then try again.");
      return must(r);
    }).then(function (row) {
      cid = row.id; var upd = {}, chain = Promise.resolve();
      var copy = function (from, to, key) {
        chain = chain.then(function () {
          return sb.storage.from(APP_BUCKET).download(from).then(must).then(function (blob) {
            return sb.storage.from(APP_BUCKET).upload(to, blob, { contentType: blob.type || "application/octet-stream", upsert: false }).then(must).then(function () { upd[key] = to; });
          });
        });
      };
      if (x.photos && x.photos[0]) copy(x.photos[0], "crew/" + cid + "/photo.jpg", "photo_path");
      if (x.cv_path) copy(x.cv_path, "crew/" + cid + "/cv." + x.cv_path.split(".").pop(), "cv_path");
      return chain.then(function () { return Object.keys(upd).length ? sb.from("crew").update(upd).eq("id", cid).then(must) : null; });
    }).then(function () { return x.status === "new" ? sb.from("applications").update({ status: "shortlisted" }).eq("id", x.id).then(must) : null; })
      .then(function () { refreshBadge(); toast("Added to the crew roster as Potential"); location.hash = "#/crew/" + cid; })
      .catch(function (e) { fail(e); btn.disabled = false; btn.textContent = "Add to crew roster"; });
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
      var q = function (cols) { return sb.from("slides").select(cols).eq("artist_id", artistId).order("sort_order").order("created_at"); };
      return q("id,title,url,path,sort_order,video_url").then(function (r) { return noVideoCol(r.error) ? q("id,title,url,path,sort_order") : r; })
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
          '<a class="linkbtn" href="#/slides/edit/' + x.id + '?back=' + encodeURIComponent(location.hash) + '">Edit</a>' +
          '<button type="button" class="linkbtn" data-unlink="' + x.id + '" title="Keep in library, remove from this act">Unlink</button>' + videoField(x) + '</div></div>';
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
    $("#asGrid").addEventListener("change", function (e) { if (e.target.hasAttribute("data-video")) saveVideo(e.target, list); });
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
  var SLIDE_CATS = ["Cover & Intro", "DJs", "Singers", "Live Bands", "Instrumentalists", "Specialist Acts",
    "Acrobats & Circus", "LED & Light Shows", "Fire Shows", "Roaming Characters", "Parades & Stilt Walkers", "Drummers",
    "Live Artists", "Sand Artists", "Speed Painters", "Caricaturists", "Live Illustrators", "Calligraphers", "Henna Artists",
    "Dancers", "Emcees", "Quiz Hosts", "Comedians", "Hostesses & Promo Staff", "Magicians", "Hypnotists", "Children's",
    "Ramadan & Arabic", "Cultural Activations", "Festive", "Photo Booths", "Decor & Venue", "Packages & Pricing", "Closing", "Other"];
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
      '<div class="toolbar"><a class="btn" href="#/slides/new">+ Create slide</a><label class="btn primary" for="slideUpload">+ Upload slides<input type="file" id="slideUpload" accept="image/*" multiple hidden></label></div></div>' +
      '<div class="toolbar"><input type="text" id="sQ" placeholder="Search slides or act names" value="' + esc(slideState.q) + '">' +
      '<select id="sCat">' + slideCatOptions(slideState.cat, true) + "</select>" +
      '<span class="count" id="sCount"></span></div>' +
      '<label class="dropzone" id="slideDrop">Drag slide images here (PNG or JPG exported from Canva)</label><br>' +
      '<div id="slideGrid" class="slide-grid"><p class="muted">Loading&hellip;</p></div>' +
      '<div class="selbar" id="selBar" hidden><span id="selCount"></span><select id="selTarget"></select>' +
      '<button class="btn primary" type="button" id="selAdd">Add to proposal</button><button class="btn" type="button" id="selClear">Clear</button></div>';
    var all = [];
    function load() {
      var q = function (cols) { return sb.from("slides").select(cols).order("sort_order").order("created_at").range(0, 4999); };
      return q("id,title,category,url,path,sort_order,created_at,artist_id,video_url,artists(name,slug)")
        .then(function (r) { return noVideoCol(r.error) ? q("id,title,category,url,path,sort_order,created_at,artist_id,artists(name,slug)") : r; })
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
          '<select data-cat="' + x.id + '">' + slideCatOptions(x.category, false) + "</select>" + videoField(x) +
          (x.artists ? '<a class="small artist-tag" href="#/artists/' + x.artist_id + '">' + esc(x.artists.name) + "</a>" : '<span class="small muted">No act linked</span>') +
          '<a class="linkbtn" href="#/slides/edit/' + x.id + '">Edit</a><button type="button" class="linkbtn del" data-del="' + x.id + '" title="Delete slide">Delete</button></div></div>';
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
      var dz = $("#slideDrop"), n = 0, skipped = 0, skippedNames = [], base = all.length ? Math.max.apply(null, all.map(function (x) { return x.sort_order; })) : 0;
      files.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
      var catBySlug = {}; SLIDE_CATS.forEach(function (c) { catBySlug[slugify(c)] = c; });
      var havePath = {}; all.forEach(function (x) { if (x.path) { havePath[x.path] = 1; havePath[x.path.replace(/-e[a-z0-9]+(\.jpg)$/i, "$1")] = 1; } });
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
              if (havePath[path]) { skipped++; skippedNames.push((art ? art.name : (catBySlug[m[2]] || "Section") + " divider") + "  (" + f.name + ")"); return; }
              row.sort_order = parseInt(m[1], 10) * 10;
              row.category = catBySlug[m[2]] || null;
              row.artist_id = art ? art.id : null;
              row.title = art ? art.name : m[3] ? m[3].split("-").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ") : (row.category || "Section") + " divider";
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
        if (skipped) showDuplicateNotice(n, skippedNames);
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
      if (e.target.hasAttribute("data-video")) { saveVideo(e.target, all); return; }
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

  function viewSlideEdit(id) {
    var back = new URLSearchParams(location.hash.split("?")[1] || "").get("back") || "#/slides";
    var q = function (cols) { return sb.from("slides").select(cols).eq("id", id).maybeSingle(); };
    q("id,title,url,path,category,artist_id,design").then(function (r) { return r.error && /design/.test(r.error.message || "") ? q("id,title,url,path,category,artist_id") : r; })
      .then(function (r) {
        if (r.error) throw r.error;
        if (!r.data) { toast("Slide not found", true); location.hash = back; return; }
        GHSlideEditor.open({ sb: sb, app: app, esc: esc, slide: r.data, bucket: SLIDE_BUCKET, back: back, toast: toast, fail: fail, must: must });
      }).catch(fail);
  }

  var ART_TO_SLIDE_CAT = { djs: "DJs", singers: "Singers", bands: "Live Bands", instrumental: "Instrumentalists", specialist: "Specialist Acts", dancers: "Dancers",
    mcs: "Emcees", hostesses: "Hostesses & Promo Staff", magicians: "Magicians", kids: "Children's", ramadan: "Ramadan & Arabic" };
  function viewSlideCreate(artistId) {
    var back = new URLSearchParams(location.hash.split("?")[1] || "").get("back") || (artistId ? "#/artists/" + artistId : "#/slides");
    var open = function (cr) { cr.cats = SLIDE_CATS; GHSlideEditor.open({ sb: sb, app: app, esc: esc, slide: null, create: cr, bucket: SLIDE_BUCKET, back: back, toast: toast, fail: fail, must: must }); };
    if (!artistId) { open({ category: slideState.cat || "" }); return; }
    Promise.all([sb.from("artists").select("id,name,category,subgroup,bio").eq("id", artistId).maybeSingle(),
      sb.from("artist_photos").select("url").eq("artist_id", artistId).order("position")]).then(function (r) {
      if (r[0].error) throw r[0].error;
      var x = r[0].data; if (!x) { toast("Artist not found", true); location.hash = back; return; }
      var sub = (x.subgroup || "").toLowerCase(), cat = SLIDE_CATS.filter(function (c) { return c.toLowerCase() === sub; })[0] || ART_TO_SLIDE_CAT[x.category] || "";
      open({ artist_id: x.id, artistName: x.name, title: x.name, bio: x.bio || "", category: cat, photos: (r[1].data || []).map(function (p) { return p.url; }) });
    }).catch(fail);
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
    var hasSent = true, cols = "id,title,client,event_date,shared,updated_at,proposal_slides(count)";
    sb.from("proposals").select(cols + ",sent_at").order("updated_at", { ascending: false }).range(0, 999)
      .then(function (r) { if (r.error && /sent_at/.test(r.error.message || "")) { hasSent = false; return sb.from("proposals").select(cols).order("updated_at", { ascending: false }).range(0, 999); } return r; })
      .then(function (r) {
        if (r.error) return fail(r.error);
        if (!r.data.length) { $("#propList").innerHTML = '<p class="muted center">No proposals yet.</p>'; return; }
        $("#propList").innerHTML = '<table class="list"><thead><tr><th>Proposal</th><th class="hide-m">Client</th><th class="hide-m">Event date</th><th>Slides</th><th>Client link</th><th>Sent</th><th></th></tr></thead><tbody>' +
          r.data.map(function (p) {
            var n = (p.proposal_slides && p.proposal_slides[0] && p.proposal_slides[0].count) || 0;
            return '<tr><td class="name"><a href="#/proposals/' + p.id + '">' + esc(p.title) + '</a><div class="sub">Edited ' + fmtDate(p.updated_at) + "</div></td>" +
              '<td class="hide-m sub">' + esc(p.client || "") + '</td><td class="hide-m sub">' + (p.event_date ? fmtDate(p.event_date) : "") + "</td>" +
              "<td>" + n + '</td><td><span class="pill ' + (p.shared ? "live" : "hidden") + '">' + (p.shared ? "On" : "Off") + "</span></td>" +
              '<td><label class="sent-tick' + (p.sent_at ? " on" : "") + '"><input type="checkbox" data-sent="' + p.id + '"' + (p.sent_at ? " checked" : "") + '><span>' + (p.sent_at ? "Sent " + fmtDate(p.sent_at) : "Not sent") + "</span></label></td>" +
              '<td><a class="btn sm" href="#/proposals/' + p.id + '">Open</a></td></tr>';
          }).join("") + "</tbody></table>";
        $("#propList").addEventListener("change", function (e) {
          var cb = e.target.closest("[data-sent]"); if (!cb) return;
          if (!hasSent) { cb.checked = !cb.checked; toast("Run the add-proposal-sent SQL in Supabase first, then try again.", true); return; }
          markSent(cb.getAttribute("data-sent"), cb.checked).then(function (when) {
            var lab = cb.closest(".sent-tick"); lab.classList.toggle("on", !!when); lab.querySelector("span").textContent = when ? "Sent " + fmtDate(when) : "Not sent";
          }).catch(function (err) { cb.checked = !cb.checked; fail(err); });
        });
      });
  }
  function markSent(id, on) {
    var when = on ? new Date().toISOString() : null;
    return sb.from("proposals").update({ sent_at: when }).eq("id", id).then(must).then(function () { toast(on ? "Marked as sent" : "Marked as not sent"); return when; });
  }

  function priceFields(stored, i) {
    var pr = GHPDF.parsePrice(stored), rows = pr.rows, h = '<div class="price-fields" data-prices="' + i + '" title="Only shown in this proposal"><span class="pf-head">Prices</span>';
    for (var k = 0; k < 3; k++) {
      var r = rows[k] || [["Solo", "Duo", "Trio"][k], ""], miss = r[1] && !r[0];
      h += '<div class="price-row"><input type="text" maxlength="30" data-pl placeholder="What for? e.g. ' + ["Solo", "Duo", "Trio"][k] + '" value="' + esc(r[0]) + '" aria-label="What price ' + (k + 1) + ' is for"' + (miss ? ' class="need" title="Add what this price is for"' : "") + ">" +
        '<input type="text" maxlength="40" data-pa placeholder="' + (k ? "AED (optional)" : "e.g. AED 4,500 + VAT") + '" value="' + esc(r[1]) + '" aria-label="Price ' + (k + 1) + '"></div>';
    }
    return h + '<textarea data-pn maxlength="200" rows="2" placeholder="Note, e.g. 3 x 45 min sets, 7pm to 11pm" aria-label="Price note">' + esc(pr.note) + "</textarea></div>";
  }
  function noPriceCol(e) { return e && /price/.test(e.message || ""); }
  var propCompact = false;
  function viewProposal(id, keepY) {
    var hasPrice = true;
    app.innerHTML = '<p class="muted center">Loading&hellip;</p>';
    Promise.all([
      sb.from("proposals").select("*").eq("id", id).maybeSingle(),
      sb.from("proposal_slides").select("slide_id,position,price,slides(id,title,url,category,video_url)").eq("proposal_id", id).order("position")
        .then(function (r) { if (noPriceCol(r.error)) { hasPrice = false; return sb.from("proposal_slides").select("slide_id,position,slides(id,title,url,category,video_url)").eq("proposal_id", id).order("position"); } return r; })
        .then(function (r) { return noVideoCol(r.error) ? sb.from("proposal_slides").select("slide_id,position,slides(id,title,url,category)").eq("proposal_id", id).order("position") : r; })
    ]).then(function (res) {
      if (res[0].error) return fail(res[0].error);
      if (res[1].error) return fail(res[1].error);
      var p = res[0].data;
      if (!p) { app.innerHTML = '<p class="center muted">Proposal not found. <a href="#/proposals">Back</a></p>'; return; }
      var items = res[1].data.filter(function (x) { return x.slides; }).map(function (x) { x.slides._price = x.price || ""; return x.slides; });
      var link = location.origin + "/proposal.html?t=" + p.share_token;
      var restoreY = function () { if (keepY != null) window.scrollTo(0, keepY); };
      app.innerHTML = '<div class="pagehead"><div><a href="#/proposals" class="small">&larr; All proposals</a><h1>' + esc(p.title) + "</h1></div>" +
        '<div class="toolbar"><button class="btn" type="button" id="prStd" title="Adds your Cover & Intro slides at the start and Closing slides at the end">+ Opening &amp; thank you pages</button><a class="btn" href="#/slides?add=' + p.id + '">+ Add slides</a><button class="btn primary" type="button" id="pdfBtn">Download PDF</button></div></div>' +
        '<section class="panel"><div class="grid3">' +
        '<label class="field">Proposal name<input type="text" id="prTitle" value="' + esc(p.title) + '"></label>' +
        '<label class="field">Client<input type="text" id="prClient" value="' + esc(p.client || "") + '"></label>' +
        '<label class="field">Event date<input type="date" id="prDate" value="' + esc(p.event_date || "") + '"></label>' +
        '<label class="field" style="grid-column:1/-1">Internal notes<textarea id="prNotes">' + esc(p.notes || "") + "</textarea></label></div>" +
        '<br><button class="btn primary" type="button" id="prSave">Save details</button></section>' +
        '<section class="panel"><h2>Client link ' + sw("prShared", p.shared, "Link switched on") + ' <label class="sent-tick' + (p.sent_at ? " on" : "") + '"><input type="checkbox" id="prSent"' + (p.sent_at ? " checked" : "") + '><span>' + (p.sent_at ? "Sent " + fmtDate(p.sent_at) : "Mark as sent") + "</span></label></h2>" +
        '<p class="note">When the link is on, anyone you send it to can view and download this proposal. Switch it off at any time.</p>' +
        '<div class="linkrow"><input type="text" id="prLink" readonly value="' + esc(link) + '"><button class="btn" type="button" id="prCopy">Copy link</button></div></section>' +
        '<section class="panel"><h2>Slides <span class="muted small">' + items.length + " in this proposal</span></h2>" +
        (items.length > 1 ? '<div class="order-help"><p class="note"><strong>To reorder:</strong> drag a slide by its picture and drop it where you want it, or type a new number in its corner.</p>' +
          '<button type="button" class="btn small" id="prCompact">' + (propCompact ? "Show prices" : "Compact view for reordering") + "</button></div>" : "") +
        (items.length ? '<p class="note">Prices appear only on this proposal, its client link and its PDF. Add up to three per slide. The left box says what each price is for (Solo, Duo, Trio, Band of 5&hellip;) and shows next to the price. Add a short note underneath for set times and so on. Leave them empty to show nothing.</p>' : "") +
        (items.length ? '<div class="slide-grid order' + (propCompact ? " compact-order" : "") + '" id="prSlides">' + items.map(function (x, i) {
          return '<div class="slide" data-card="' + i + '"><label class="num" title="Type a number to move this slide there"><input type="number" min="1" max="' + items.length + '" value="' + (i + 1) + '" data-pos="' + i + '" aria-label="Position"></label>' +
            '<div class="drag-area" data-drag draggable="true" title="Drag to move"><img loading="lazy" src="' + esc(x.url) + '" alt="" draggable="false"><span class="drag-hint">&#10495; Drag</span></div><div class="slide-meta"><span class="sub">' + (x.video_url ? '<span class="vid-badge" title="Has a video link">&#9654;</span> ' : "") + esc(x.title) + "</span>" +
            priceFields(x._price, i) +
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
      $("#prSent").addEventListener("change", function (e) {
        var cb = e.target;
        if (!("sent_at" in p)) { cb.checked = !cb.checked; toast("Run the add-proposal-sent SQL in Supabase first, then try again.", true); return; }
        markSent(id, cb.checked).then(function (when) {
          p.sent_at = when; var lab = cb.closest(".sent-tick"); lab.classList.toggle("on", !!when); lab.querySelector("span").textContent = when ? "Sent " + fmtDate(when) : "Mark as sent";
        }).catch(function (err) { cb.checked = !cb.checked; fail(err); });
      });
      $("#prCopy").addEventListener("click", function () {
        var inp = $("#prLink"); inp.select();
        (navigator.clipboard ? navigator.clipboard.writeText(inp.value) : Promise.reject()).then(function () { toast("Link copied"); }, function () { document.execCommand("copy"); toast("Link copied"); });
        if (!$("#prShared").checked) toast("Copied. Switch the link on before sending it.", true);
      });
      $("#pdfBtn").addEventListener("click", function () { printSlides(p.title, items.map(function (x) { return x.url; }), items.map(function (x) { return x.video_url; }), items.map(function (x) { return x._price; })); });
      $("#prDelete").addEventListener("click", function () {
        if (!confirm("Delete this proposal? Your slides stay in the library.")) return;
        sb.from("proposals").delete().eq("id", id).then(must).then(function () { toast("Proposal deleted"); location.hash = "#/proposals"; }).catch(fail);
      });
      function saveOrder() {
        return sb.from("proposal_slides").delete().eq("proposal_id", id).then(must)
          .then(function () { return items.length ? sb.from("proposal_slides").insert(items.map(function (x, i) { var row = { proposal_id: id, slide_id: x.id, position: i }; if (hasPrice) row.price = x._price || null; return row; })).then(must) : null; })
          .then(function () { return sb.from("proposals").update({ updated_at: new Date().toISOString() }).eq("id", id); });
      }
      $("#prStd").addEventListener("click", function (e) {
        var btn = e.target; btn.disabled = true;
        sb.from("slides").select("id,title,url,category,video_url,sort_order").in("category", ["Cover & Intro", "Closing"]).order("sort_order").then(must).then(function (std) {
          var have = {}; items.forEach(function (x) { have[x.id] = 1; });
          var open = std.filter(function (s) { return s.category === "Cover & Intro" && !have[s.id]; }),
              close = std.filter(function (s) { return s.category === "Closing" && !have[s.id]; });
          if (!std.length) { toast("Upload your opening, client list and thank you slides to the Slides page first, under Cover & Intro and Closing.", true); return null; }
          if (!open.length && !close.length) { toast("Those pages are already in this proposal"); return null; }
          open.concat(close).forEach(function (s) { s._price = ""; });
          items = open.concat(items, close);
          return saveOrder().then(function () { toast((open.length + close.length) + " page" + (open.length + close.length === 1 ? "" : "s") + " added"); viewProposal(id); });
        }).catch(fail).then(function () { btn.disabled = false; });
      });
      var grid = $("#prSlides");
      if (grid) grid.addEventListener("change", function (e) {
        var box = e.target.closest("[data-prices]"); if (!box) return;
        box.querySelectorAll(".price-row").forEach(function (row) { var l = row.querySelector("[data-pl]"); l.classList.toggle("need", !l.value.trim() && !!row.querySelector("[data-pa]").value.trim()); });
        var x = items[+box.getAttribute("data-prices")], rows = [];
        box.querySelectorAll(".price-row").forEach(function (row) {
          var l = row.querySelector("[data-pl]").value.trim().slice(0, 30), v = row.querySelector("[data-pa]").value.trim().slice(0, 40);
          if (v) rows.push([l, v]);
        });
        var note = box.querySelector("[data-pn]").value.trim().slice(0, 200);
        if (!hasPrice) { toast("Run the add-proposal-prices SQL in Supabase first, then try again.", true); return; }
        var stored = rows.length || note ? JSON.stringify({ p: rows, n: note }) : null;
        sb.from("proposal_slides").update({ price: stored }).eq("proposal_id", id).eq("slide_id", x.id).then(must)
          .then(function () { x._price = stored || ""; toast(e.target.hasAttribute("data-pn") ? (note ? "Note saved" : "Note removed") : rows.length ? rows.length + " price" + (rows.length > 1 ? "s" : "") + " saved" : (e.target.hasAttribute("data-pl") ? "Add a price next to the name" : "Prices removed")); }).catch(fail);
      });
      var busy = false;
      function moveTo(from, to) {
        if (busy || from === to || to < 0 || to >= items.length) return;
        busy = true; grid.classList.add("saving");
        var m = items.splice(from, 1)[0]; items.splice(to, 0, m);
        var y = window.scrollY;
        saveOrder().then(function () { toast("Moved to " + (to + 1)); viewProposal(id, y); }).catch(function (err) { busy = false; fail(err); viewProposal(id, y); });
      }
      if (grid) grid.addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b || b.disabled || busy) return;
        if (b.hasAttribute("data-rm")) {
          busy = true; items.splice(+b.getAttribute("data-rm"), 1); var y = window.scrollY;
          saveOrder().then(function () { viewProposal(id, y); }).catch(fail);
        } else if (b.hasAttribute("data-mv")) { var from = +b.getAttribute("data-i"); moveTo(from, from + +b.getAttribute("data-mv")); }
      });
      if (grid) grid.addEventListener("change", function (e) {
        var inp = e.target.closest("[data-pos]"); if (!inp) return;
        var to = Math.max(1, Math.min(items.length, parseInt(inp.value, 10) || 1)) - 1, from = +inp.getAttribute("data-pos");
        if (to === from) { inp.value = from + 1; return; }
        moveTo(from, to);
      });
      if (grid) grid.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.hasAttribute("data-pos")) { e.preventDefault(); e.target.blur(); } });
      // drag and drop
      var dragFrom = -1, dropAt = -1, scrollTimer = null;
      function clearMarks() { grid.querySelectorAll(".drop-before,.drop-after,.dragging").forEach(function (c) { c.classList.remove("drop-before", "drop-after", "dragging"); }); }
      if (grid) {
        grid.addEventListener("dragstart", function (e) {
          var h = e.target.closest && e.target.closest("[data-drag]"), c = h && h.closest(".slide"); if (!c || busy) { e.preventDefault(); return; }
          dragFrom = +c.getAttribute("data-card"); dropAt = -1;
          e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(dragFrom)); } catch (err) {}
          setTimeout(function () { c.classList.add("dragging"); }, 0);
        });
        grid.addEventListener("dragover", function (e) {
          if (dragFrom < 0) return;
          e.preventDefault(); e.dataTransfer.dropEffect = "move";
          var edge = 90; clearInterval(scrollTimer); scrollTimer = null;
          if (e.clientY < edge) scrollTimer = setInterval(function () { window.scrollBy(0, -18); }, 16);
          else if (e.clientY > window.innerHeight - edge) scrollTimer = setInterval(function () { window.scrollBy(0, 18); }, 16);
          var c = e.target.closest(".slide"); if (!c) return;
          var r = c.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2, i = +c.getAttribute("data-card");
          grid.querySelectorAll(".drop-before,.drop-after").forEach(function (x) { x.classList.remove("drop-before", "drop-after"); });
          c.classList.add(after ? "drop-after" : "drop-before");
          dropAt = after ? i + 1 : i;
        });
        grid.addEventListener("drop", function (e) {
          e.preventDefault(); clearInterval(scrollTimer);
          var from = dragFrom, at = dropAt; dragFrom = -1; clearMarks();
          if (from < 0 || at < 0) return;
          moveTo(from, at > from ? at - 1 : at);
        });
        grid.addEventListener("dragend", function () { clearInterval(scrollTimer); dragFrom = -1; clearMarks(); });
      }
      var cb = $("#prCompact");
      if (cb) cb.addEventListener("click", function () {
        propCompact = !propCompact; grid.classList.toggle("compact-order", propCompact);
        cb.textContent = propCompact ? "Show prices" : "Compact view for reordering";
      });
      restoreY();
    }).catch(fail);
  }

  // Opens the slides as landscape pages and the browser's Save as PDF dialog.
  // Until the video_url column exists, retry slide queries without it.
  function noVideoCol(e) { return e && /video_url/.test(e.message || ""); }
  function cleanVideo(v) {
    v = (v || "").trim(); if (!v) return null;
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    v = v.replace(/^http:\/\//i, "https://");
    // Vimeo: turn editor, player and channel links into the plain watch link clients can open.
    var vm = v.match(/^https:\/\/(?:www\.|player\.)?vimeo\.com\/(?:manage\/videos\/|video\/|channels\/[^\/]+\/|groups\/[^\/]+\/videos\/)?(\d{5,})(?:\/([0-9a-f]{6,}))?(?:[^?#]*)?(?:\?[^#]*?\bh=([0-9a-f]{6,}))?/i);
    if (vm) return "https://vimeo.com/" + vm[1] + ((vm[2] || vm[3]) ? "/" + (vm[2] || vm[3]) : "");
    if (/vimeo\.com/i.test(v)) return false;
    return /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(v) ? v : false;
  }
  function videoList(v) { return String(v || "").split(/\s+/).filter(Boolean).slice(0, 3); }
  function videoField(x) {
    var v = videoList(x.video_url), h = '<div class="vid-fields" data-vids="' + x.id + '">';
    for (var i = 0; i < 3; i++) {
      h += '<label class="vid-field' + (v[i] ? " has" : "") + '"><span>&#9654;</span><input type="url" placeholder="' + (i ? "Video " + (i + 1) + " (optional)" : "Paste YouTube link") +
        '" value="' + esc(v[i] || "") + '" data-video="' + x.id + '" aria-label="YouTube link ' + (i + 1) + '"></label>';
    }
    return h + "</div>";
  }
  function saveVideo(input, list) {
    var id = input.getAttribute("data-video"), box = input.closest("[data-vids]");
    var inputs = Array.prototype.slice.call(box.querySelectorAll("[data-video]")), vals = [];
    for (var i = 0; i < inputs.length; i++) {
      var c = cleanVideo(inputs[i].value);
      if (c === false) { toast("Please paste a YouTube or Vimeo video link (on Vimeo, use Share \u2192 Copy link)", true); return; }
      if (c) vals.push(c);
    }
    var v = vals.length ? vals.join("\n") : null;
    sb.from("slides").update({ video_url: v }).eq("id", id).then(function (r) {
      if (noVideoCol(r.error)) throw new Error("Run the add-slide-videos SQL in Supabase first, then try again.");
      return must(r);
    }).then(function () {
      (list || []).forEach(function (x) { if (x.id === id) x.video_url = v; });
      inputs.forEach(function (inp, i) { inp.value = vals[i] || ""; inp.parentNode.classList.toggle("has", !!vals[i]); });
      toast(vals.length ? vals.length + " video link" + (vals.length > 1 ? "s" : "") + " saved" : "Video links removed");
    }).catch(fail);
  }
  function vidButtons(v) {
    return v.length ? '<span class="vids">' + v.map(function (u, i) { return '<a class="vid" href="' + esc(u) + '" target="_blank" rel="noopener">&#9654; ' + (v.length > 1 ? "VIDEO " + (i + 1) : "WATCH VIDEO") + "</a>"; }).join("") + "</span>" : "";
  }
  function printSlides(title, urls, videos, prices) {
    videos = videos || []; prices = prices || [];
    if (!urls.length) { toast("Add some slides first", true); return; }
    var btn = $("#pdfBtn"), label = btn ? btn.textContent : "";
    if (btn) btn.disabled = true;
    GHPDF.make(title, urls.map(function (u, i) { return { url: u, videos: videoList(videos[i]), price: prices[i] || "" }; }), function (n, total) {
      if (btn) btn.textContent = "Making PDF " + n + "/" + total + "\u2026";
    }).then(function () { toast("PDF downloaded"); })
      .catch(fail)
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = label; } });
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
