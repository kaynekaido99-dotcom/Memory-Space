/* =========================================================
   "YOUR CLASS SECTION"
 — Group Portfolio
   Shared logic: local single-account auth, memories CRUD
   backed by Google Drive (via a Google Apps Script Web App),
   rendering, and small UI helpers.
   ========================================================= */

(function () {
  "use strict";

  /* ---------------- config ---------------- */
  var GOOGLE_CLIENT_ID = "CHANGE_ME";
  var FACEBOOK_APP_ID = "CHANGE_ME";
  var SESSION_KEY = "YOUR CLASS SECTION_session";
  var POLL_INTERVAL_MS = 60000; // cross-device sync

  var cfg = window.APP_CONFIG || {};
  var GAS_URL = cfg.GAS_URL || "CHANGE_ME";
  var APP_TOKEN = cfg.APP_TOKEN || "CHANGE_ME";

  /* ---------------- icon set (used for JS-rendered markup) ---------------- */
  var ICONS = {
    photo:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10.5" r="1.6"/><path d="M21 16l-5.5-5-4 4-2-2L3 17"/></svg>',
    edit:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    x:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    share:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></svg>',
    warn:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
  };

  var REACTION_OPTIONS = [
    { key: "like", icon: "👍", label: "Like" },
    { key: "unlike", icon: "👎", label: "Unlike" },
    { key: "heart", icon: "❤", label: "Heart" },
    { key: "haha", icon: "😄", label: "Haha" },
  ];

  /* ---------------- tiny dom helpers ---------------- */
  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (html !== undefined) node.innerHTML = html;
    return node;
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var opts = { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
    return d.toLocaleString(undefined, opts);
  }
  function uid() {
    return "m_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function getCurrentUserName() {
    var storedUserName = sessionStorage.getItem("YOUR CLASS SECTION_user_name") ||
      sessionStorage.getItem("YOUR CLASS SECTION_google_name") || "";
    return storedUserName || "Google user";
  }

  function getCurrentUserId() {
    var facebookId = sessionStorage.getItem("YOUR CLASS SECTION_facebook_id");
    var googleEmail = sessionStorage.getItem("YOUR CLASS SECTION_google_email");
    if (facebookId) return "facebook:" + facebookId;
    if (googleEmail) return "google:" + googleEmail.toLowerCase();
    return "";
  }

  function normalizeMemoryReactions(memory) {
    var reactionsSource = memory && memory.reactions && typeof memory.reactions === "object" && !Array.isArray(memory.reactions)
      ? memory.reactions
      : {};
    var normalized = {};

    REACTION_OPTIONS.forEach(function (option) {
      var names = Array.isArray(reactionsSource[option.key]) ? reactionsSource[option.key] : [];
      normalized[option.key] = names.filter(function (name) {
        return typeof name === "string" && name.trim().length > 0;
      });
    });

    return normalized;
  }

  function getReactionState(memory) {
    var normalized = normalizeMemoryReactions(memory);
    var currentUserName = getCurrentUserName();
    var state = { counts: {}, myReaction: null };

    REACTION_OPTIONS.forEach(function (option) {
      var names = normalized[option.key] || [];
      state.counts[option.key] = names.length;
      if (names.indexOf(currentUserName) !== -1) {
        state.myReaction = option.key;
      }
    });

    return state;
  }

  /* ---------------- auth ---------------- */
  function isLoggedIn() { return sessionStorage.getItem(SESSION_KEY) === "true"; }
  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem("YOUR CLASS SECTION_google_email");
    sessionStorage.removeItem("YOUR CLASS SECTION_google_name");
    sessionStorage.removeItem("YOUR CLASS SECTION_user_name");
    sessionStorage.removeItem("YOUR CLASS SECTION_facebook_id");
    sessionStorage.removeItem("YOUR CLASS SECTION_facebook_email");
    window.location.href = "login.html";
  }

  function decodeGooglePayload(credential) {
    var parts = String(credential || "").split(".");
    if (parts.length !== 3) throw new Error("Invalid Google credential");
    var base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(atob(base64).split("").map(function (char) {
      return "%" + ("00" + char.charCodeAt(0).toString(16)).slice(-2);
    }).join("")));
  }

  window.handleCredentialResponse = function (response) {
    var errorBox = document.querySelector("#loginError");
    try {
      var payload = decodeGooglePayload(response && response.credential);
      var now = Math.floor(Date.now() / 1000);
      if (payload.aud !== GOOGLE_CLIENT_ID || payload.exp <= now || payload.email_verified !== true) {
        throw new Error("Google account verification failed");
      }
      sessionStorage.setItem(SESSION_KEY, "true");
      sessionStorage.setItem("YOUR CLASS SECTION_google_email", payload.email || "");
      sessionStorage.setItem("YOUR CLASS SECTION_google_name", payload.name || payload.given_name || "Google user");
      sessionStorage.setItem("YOUR CLASS SECTION_user_name", payload.name || payload.given_name || "Google user");
      window.location.href = "portfolio.html";
    } catch (error) {
      if (errorBox) {
        errorBox.textContent = "Google sign-in could not be verified. Please try again.";
        errorBox.classList.add("is-visible");
      }
      console.error(error);
    }
  };

  window.fbAsyncInit = function () {
    window.FB.init({
      appId: FACEBOOK_APP_ID,
      cookie: true,
      xfbml: false,
      version: "v24.0"
    });
  };

  function showLoginError(message) {
    var errorBox = document.querySelector("#loginError");
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.add("is-visible");
  }

  function handleFacebookLogin() {
    var button = document.querySelector("#facebookSignIn");
    var errorBox = document.querySelector("#loginError");
    if (errorBox) {
      errorBox.textContent = "";
      errorBox.classList.remove("is-visible");
    }
    if (!window.FB || typeof window.FB.login !== "function") {
      showLoginError("Facebook sign-in is still loading. Please try again.");
      return;
    }

    button.disabled = true;
    window.FB.login(function (loginResponse) {
      if (!loginResponse || !loginResponse.authResponse) {
        button.disabled = false;
        showLoginError("Facebook sign-in was cancelled or could not be completed.");
        return;
      }

      window.FB.api("/me", { fields: "id,name,email" }, function (profile) {
        if (!profile || !profile.id || !profile.name) {
          button.disabled = false;
          showLoginError("Facebook could not provide your profile. Please try again.");
          return;
        }
        sessionStorage.setItem(SESSION_KEY, "true");
        sessionStorage.setItem("YOUR CLASS SECTION_user_name", profile.name);
        sessionStorage.setItem("YOUR CLASS SECTION_facebook_id", profile.id);
        sessionStorage.setItem("YOUR CLASS SECTION_facebook_email", profile.email || "");
        window.location.href = "portfolio.html";
      });
    }, { scope: "public_profile,email" });
  }

  /* ---------------- Google Drive backend API ---------------- */
  /**
   * All calls go to the Apps Script Web App. GET is used for the
   * read-only fetch (query string only, no preflight). POST bodies
   * are sent as text/plain (not application/json) on purpose —
   * Apps Script Web Apps don't handle the OPTIONS preflight that a
   * real JSON content-type would trigger in the browser.
   */
  var notificationRecords = [];
  /**
   * Reads the notifications array from a backend response. The server key is
   * "notifications" (older deployments used "itinianz_notifications"), so accept
   * either and never depend on the class-section name.
   */
  function extractNotifications(data) {
    var list = data && (data.notifications || data.itinianz_notifications ||
      data["YOUR CLASS SECTION_notifications"]);
    return Array.isArray(list) ? list : null;
  }

  var api = {
    configured: function () {
      return !!GAS_URL && GAS_URL.indexOf("PUT_YOUR_") !== 0;
    },
    getNotes: function () {
      var url = GAS_URL + "?action=getNotes&token=" + encodeURIComponent(APP_TOKEN);
      return fetch(url, { method: "GET" })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error || "Failed to load memories");
          var freshNotifications = extractNotifications(data);
          if (freshNotifications) notificationRecords = freshNotifications;
          return Array.isArray(data.notes) ? data.notes : [];
        });
    },
    getNotifications: function () {
      var url = GAS_URL + "?action=getNotifications&token=" + encodeURIComponent(APP_TOKEN);
      return fetch(url, { method: "GET" })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error || "Failed to load notifications");
          var list = extractNotifications(data);
          if (!list) throw new Error("Notifications missing from server response");
          return list;
        });
    },
    getEvents: function () {
      var url = GAS_URL + "?action=getEvents&token=" + encodeURIComponent(APP_TOKEN);
      return fetch(url, { method: "GET" })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error || "Failed to load calendar notes");
          return Array.isArray(data.events) ? data.events : [];
        });
    },
    saveEvents: function (events) {
      return fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "saveEvents", token: APP_TOKEN, events: events }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error || "Failed to save calendar notes");
          return data.events;
        });
    },
    saveNotes: function (notes) {
      return fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "saveNotes", token: APP_TOKEN, notes: notes }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error || "Failed to save memories");
          return data.notes;
        });
    },
    updateMemoryReaction: function (memoryId, reactions, reactionAdded, reactionKey) {
      return fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "updateMemoryReaction",
          token: APP_TOKEN,
          memoryId: memoryId,
          reactions: reactions,
          reactionAdded: reactionAdded,
          reactionKey: reactionKey,
          createdBy: getCurrentUserName(),
          createdById: getCurrentUserId(),
          notificationTitle: "New reaction on a photo",
        }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error || "Failed to update reaction");
          return data.notes || [];
        });
    },
    mutateComment: function (action, memoryId, commentId, text) {
      return fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: action,
          token: APP_TOKEN,
          memoryId: memoryId,
          commentId: commentId,
          text: text,
          userId: getCurrentUserId(),
          authorName: getCurrentUserName(),
          createdById: getCurrentUserId(),
          notificationTitle: "New comment on a photo",
        }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error || "Couldn't update comment");
          return data.notes;
        });
    },
    createAlbum: function (album) {
      return fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "createAlbum", token: APP_TOKEN, album: album }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error || "Album creation failed");
          return data.notes;
        });
    },
    renameAlbum: function (albumId, title) {
      return fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "renameAlbum", token: APP_TOKEN, albumId: albumId, title: title,
          createdBy: getCurrentUserName(),
          createdById: getCurrentUserId()
        }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error || "Album rename failed");
          return data.notes;
        });
    },
    deleteAlbum: function (albumId) {
      return fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "deleteAlbum", token: APP_TOKEN, albumId: albumId,
          createdBy: getCurrentUserName(),
          createdById: getCurrentUserId()
        }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error || "Album deletion failed");
          return data.notes;
        });
    },
    uploadImage: function (dataUrl, filename, albumId) {
      var mimeMatch = /^data:([^;]+);base64,/.exec(dataUrl || "");
      var mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
      return fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "uploadImage",
          token: APP_TOKEN,
          filename: filename || ("photo_" + Date.now() + ".jpg"),
          mimeType: mimeType,
          data: dataUrl,
          albumId: albumId || null,
        }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error || "Photo upload failed");
          return { url: data.url, fileId: data.fileId };
        });
    },
    deleteImage: function (fileId) {
      if (!fileId) return Promise.resolve();
      return fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "deleteImage", token: APP_TOKEN, fileId: fileId }),
      })
        .then(function (res) { return res.json(); })
        .catch(function () { /* non-fatal: an orphaned Drive file is a minor issue */ });
    },
  };

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* ---------------- toast ---------------- */
  function showToast(message, isError) {
    var toast = qs("#toast");
    if (!toast) return;
    toast.innerHTML = (isError ? ICONS.warn : ICONS.check) + "<span>" + escapeHtml(message) + "</span>";
    toast.classList.toggle("toast--error", !!isError);
    toast.classList.add("is-visible");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove("is-visible"); }, isError ? 3600 : 2200);
  }

  /* ---------------- confirm modal ---------------- */
  function openConfirm(opts) {
    var overlay = qs("#confirmOverlay");
    if (!overlay) { if (opts.onConfirm) opts.onConfirm(); return; }
    qs("#confirmTitle", overlay).textContent = opts.title || "Are you sure?";
    qs("#confirmBody", overlay).textContent = opts.body || "";
    overlay.classList.add("is-open");

    var confirmBtn = qs("#confirmOk", overlay);
    var cancelBtn = qs("#confirmCancel", overlay);
    var previousConfirmLabel = confirmBtn.textContent;
    confirmBtn.textContent = opts.confirmLabel || previousConfirmLabel;

    function cleanup() {
      overlay.classList.remove("is-open");
      confirmBtn.textContent = previousConfirmLabel;
      confirmBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
    }
    function onOk() { cleanup(); if (opts.onConfirm) opts.onConfirm(); }
    function onCancel() { cleanup(); }

    confirmBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  }

  /* ---------------- image preview modal ---------------- */
  function initImageModal() {
    var overlay = qs("#imageModal");
    var image = qs("#imageModalPhoto", overlay);
    var closeBtn = qs("#imageModalClose", overlay);
    if (!overlay || !image || !closeBtn) return;

    function close() {
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
    }
    function open(src, alt) {
      if (image.getAttribute("src") !== src) image.src = src;
      image.alt = alt || "Expanded memory photo";
      overlay.classList.add("is-open");
      overlay.setAttribute("aria-hidden", "false");
    }

    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && overlay.classList.contains("is-open")) close();
    });

    return open;
  }

  function initTermsModal() {
    var overlay = qs("#termsOverlay");
    var openBtn = qs("#termsOpen");
    var closeBtn = qs("#termsClose");
    var doneBtn = qs("#termsDone");
    if (!overlay || !openBtn || !closeBtn || !doneBtn) return;

    function close() {
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
    }
    function open() {
      overlay.classList.add("is-open");
      overlay.setAttribute("aria-hidden", "false");
      closeBtn.focus();
    }

    openBtn.addEventListener("click", open);
    closeBtn.addEventListener("click", close);
    doneBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && overlay.classList.contains("is-open")) close();
    });
  }

  /* ======================================================
     PAGE: login.html
     ====================================================== */
  function initLoginPage() {
    if (isLoggedIn()) { window.location.href = "portfolio.html"; return; }
    var facebookButton = qs("#facebookSignIn");
    if (facebookButton) facebookButton.addEventListener("click", handleFacebookLogin);
  }

  /* ======================================================
     PAGE: portfolio.html
     ====================================================== */
  function initPortfolioPage() {
    if (!isLoggedIn()) { window.location.href = "login.html"; return; }

    var userNameEl = qs("#userName");
    var storedUserName = sessionStorage.getItem("YOUR CLASS SECTION_user_name") ||
      sessionStorage.getItem("YOUR CLASS SECTION_google_name") || "";
    var currentUserName = storedUserName && storedUserName.indexOf("@") === -1 ? storedUserName : "Google user";
    if (userNameEl) {
      userNameEl.textContent = currentUserName;
    }

    var openImageModal = initImageModal();
    initTermsModal();

    var logoutBtn = qs("#logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", logout);

    var composerForm = qs("#composerForm");
    var titleInput = qs("#memoryTitle");
    var submitBtn = composerForm ? qs('button[type="submit"]', composerForm) : null;
    var syncStatusEl = qs("#syncStatus");
    var syncNowButton = qs("#syncNowButton");
    var notesRefreshPromise = null;
    var eventsRefreshPromise = null;
    var notificationsRefreshPromise = null;
    var lastAutoRefreshAt = 0;
    var notificationCenter = qs("#notificationCenter");
    var notificationBell = qs("#notif-bell-btn");
    var notificationBadge = qs("#notif-badge");
    var notificationPanel = qs("#notif-panel");
    var notificationList = qs("#notif-list");
    var notificationUserKey = getCurrentUserId() || getCurrentUserName();
    var notificationReadKey = "YOUR CLASS SECTION_notification_read";
    var notificationDeletedKey = "YOUR CLASS SECTION_notification_deleted";
    var notificationLastReadKey = "YOUR CLASS SECTION_last_read_notif";
    var albumRenameOverlay = qs("#albumRenameOverlay");
    var albumRenameForm = qs("#albumRenameForm");
    var albumRenameInput = qs("#albumRenameInput");
    var albumRenameSave = qs("#albumRenameSave");
    var albumBeingRenamed = null;
    var albumModal = qs("#albumModal");
    var albumModalTitle = qs("#albumModalTitle");
    var albumModalDescription = qs("#albumModalDescription");
    var albumPhotoGrid = qs("#albumPhotoGrid");
    var albumUploadForm = qs("#albumUploadForm");
    var albumUploadOverlay = qs("#albumUploadOverlay");
    var albumUploadAlbumName = qs("#albumUploadAlbumName");
    var albumAddPicture = qs("#albumAddPicture");
    var albumPhotoFiles = qs("#albumPhotoFiles");
    var albumPhotoCaption = qs("#albumPhotoCaption");
    var albumUploadButton = qs("#albumUploadButton");
    var albumUploadHint = qs("#albumUploadHint");
    var activeAlbum = null;
    var calendarForm = qs("#calendarForm");
    var eventDateInput = qs("#eventDate");
    var eventTimeInput = qs("#eventTime");
    var eventNoteInput = qs("#eventNote");
    var calendarMonthEl = qs("#calendarMonth");
    var calendarEventsEl = qs("#calendarEvents");
    var calendarMonthDate = new Date();
    var eventsCache = [];

    var notesCache = [];
    var isBusy = false; // true while a save/upload/delete round-trip is in flight

    function eventDateLabel(value) {
      var date = new Date(value);
      return isNaN(date.getTime()) ? value : date.toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    }

    function pad(number) { return String(number).padStart(2, "0"); }

    function eventDateValue(value) {
      var date = new Date(value);
      if (isNaN(date.getTime())) return "";
      return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
    }

    function eventTimeValue(value) {
      var date = new Date(value);
      if (isNaN(date.getTime())) return "";
      return pad(date.getHours()) + ":" + pad(date.getMinutes());
    }

    function combineDateAndTime(dateValue, timeValue) {
      if (!dateValue || !timeValue) return "";
      return dateValue + "T" + timeValue;
    }

    function createCalendarShareImage(dateLabel, note, creator) {
      var canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 720;
      var context = canvas.getContext("2d");
      var padding = 92;
      var lines = [
        "Date & time of the event: " + dateLabel,
        "Event Note: '" + note + "'",
        "by: " + (creator || "unknown user"),
      ];

      context.fillStyle = "#F5E8C8";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#E8D6AD";
      context.fillRect(0, 0, 18, canvas.height);
      context.strokeStyle = "#D4B77A";
      context.lineWidth = 2;
      for (var lineY = 150; lineY < canvas.height - 50; lineY += 78) {
        context.beginPath();
        context.moveTo(padding, lineY);
        context.lineTo(canvas.width - padding, lineY);
        context.stroke();
      }
      context.fillStyle = "#26384A";
      context.font = "700 42px Space Grotesk, Segoe UI, sans-serif";
      context.fillText("YOUR CLASS SECTION GROUP CALENDAR", padding, 92);
      context.font = "26px JetBrains Mono, Courier New, monospace";
      lines.forEach(function (line, index) {
        context.fillText(line, padding, 192 + index * 78);
      });
      context.fillStyle = "#8A7045";
      context.font = "20px JetBrains Mono, Courier New, monospace";
      context.fillText("shared memory note", padding, canvas.height - 42);

      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error("Could not create the share image"));
        }, "image/png");
      });
    }

    function shareCalendarNote(dateLabel, note, creator) {
      createCalendarShareImage(dateLabel, note, creator).then(function (blob) {
        var file = new File([blob], "calendar-note.png", { type: "image/png" });
        if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
          return navigator.share({ title: "Calendar note", files: [file] }).then(function () {
            showToast("Calendar note shared");
          });
        }

        var downloadUrl = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = downloadUrl;
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(downloadUrl);
        showToast("Calendar note image downloaded");
      }).catch(function (error) {
        if (error.name !== "AbortError") showToast("Couldn't share this calendar note", true);
      });
    }

    function renderCalendar() {
      var year = calendarMonthDate.getFullYear();
      var month = calendarMonthDate.getMonth();
      calendarMonthEl.textContent = calendarMonthDate.toLocaleString(undefined, { month: "long", year: "numeric" });
      var visibleEvents = eventsCache.filter(function (event) {
        var date = new Date(event.startsAt);
        return !isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month;
      }).sort(function (a, b) { return a.startsAt.localeCompare(b.startsAt); });
      calendarEventsEl.innerHTML = "";
      if (!visibleEvents.length) {
        calendarEventsEl.innerHTML = '<p class="calendar-events__empty">No notes for this month yet.</p>';
        return;
      }
      visibleEvents.forEach(function (event) {
        var item = el("article", { class: "calendar-event", "data-id": event.id });
        item.innerHTML = '<div><time class="calendar-event__date mono">' + escapeHtml(eventDateLabel(event.startsAt)) +
          '</time><p>' + escapeHtml(event.note) + '</p>' +
          '<span class="calendar-event__creator">by ' + escapeHtml(event.createdBy || "unknown user") + '</span></div>' +
          '<div class="calendar-event__actions">' +
          '<button type="button" class="btn--icon" data-share-event aria-label="Share calendar note">' + ICONS.share + '</button>' +
          '<button type="button" class="btn--icon" data-edit-event aria-label="Edit calendar note">' + ICONS.edit + '</button>' +
          '<button type="button" class="btn--icon is-danger" data-delete-event aria-label="Delete calendar note">' + ICONS.trash + '</button>' +
          '</div>';
        qs("[data-share-event]", item).addEventListener("click", function () {
          shareCalendarNote(eventDateLabel(event.startsAt), event.note, event.createdBy);
        });
        qs("[data-edit-event]", item).addEventListener("click", function () {
          if (isBusy) return;
          item.classList.add("calendar-event--editing");
          item.innerHTML = '<div class="calendar-event__edit-fields">' +
            '<input class="field__input" type="date" data-edit-date value="' + escapeHtml(eventDateValue(event.startsAt)) + '" required>' +
            '<input class="field__input" type="time" data-edit-time value="' + escapeHtml(eventTimeValue(event.startsAt)) + '" required>' +
            '<input class="field__input" type="text" data-edit-note value="' + escapeHtml(event.note) + '" required>' +
            '</div><div class="calendar-event__actions">' +
            '<button type="button" class="btn btn--ghost" data-cancel-event>Cancel</button>' +
            '<button type="button" class="btn btn--primary" data-save-event>Save</button></div>';
          qs("[data-cancel-event]", item).addEventListener("click", renderCalendar);
          qs("[data-save-event]", item).addEventListener("click", function () {
            var startsAt = combineDateAndTime(qs("[data-edit-date]", item).value, qs("[data-edit-time]", item).value);
            var note = qs("[data-edit-note]", item).value.trim();
            if (!startsAt || !note || isBusy) return;
            setCalendarBusy(true, "Saving…");
            api.getEvents().then(function (freshEvents) {
              var updated = freshEvents.map(function (entry) {
                return entry.id === event.id ? Object.assign({}, entry, { startsAt: startsAt, note: note }) : entry;
              });
              return api.saveEvents(updated);
            }).then(function (saved) {
              eventsCache = saved;
              calendarMonthDate = new Date(startsAt);
              renderCalendar();
              showToast("Calendar note updated");
            }).catch(function (err) {
              showToast(err.message || "Couldn't update that calendar note", true);
            }).then(function () { setCalendarBusy(false); });
          });
        });
        qs("[data-delete-event]", item).addEventListener("click", function () {
          if (isBusy) return;
          setCalendarBusy(true, "Deleting…");
          api.getEvents().then(function (freshEvents) {
            return api.saveEvents(freshEvents.filter(function (entry) { return entry.id !== event.id; }));
          }).then(function (saved) {
            eventsCache = saved;
            renderCalendar();
            showToast("Calendar note deleted");
          }).catch(function (err) {
            showToast(err.message || "Couldn't delete that calendar note", true);
          }).then(function () { setCalendarBusy(false); });
        });
        calendarEventsEl.appendChild(item);
      });
    }

    function setCalendarBusy(busy, label) {
      isBusy = busy;
      var button = qs("#calendarSave");
      if (button) { button.disabled = busy; button.textContent = busy ? (label || "Saving…") : "Add to calendar"; }
    }

    function refreshEvents() {
      if (!api.configured()) return Promise.resolve();
      if (eventsRefreshPromise) return eventsRefreshPromise;
      eventsRefreshPromise = api.getEvents().then(function (events) {
        if (JSON.stringify(eventsCache) !== JSON.stringify(events)) {
          eventsCache = events;
          renderCalendar();
        }
      }).catch(function (err) {
        console.error(err);
      }).then(function () {
        eventsRefreshPromise = null;
      });
      return eventsRefreshPromise;
    }

    qs("#calendarPrev").addEventListener("click", function () { calendarMonthDate.setMonth(calendarMonthDate.getMonth() - 1); renderCalendar(); });
    qs("#calendarNext").addEventListener("click", function () { calendarMonthDate.setMonth(calendarMonthDate.getMonth() + 1); renderCalendar(); });
    renderCalendar();
    refreshEvents();

    if (calendarForm) {
      calendarForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (isBusy || !api.configured()) { showToast("Connect Google Drive first — see config.js", true); return; }
        var startsAt = combineDateAndTime(eventDateInput.value, eventTimeInput.value);
        var note = eventNoteInput.value.trim();
        if (!startsAt || !note) return;
        setCalendarBusy(true);
        api.getEvents().then(function (freshEvents) {
          var event = {
            id: uid().replace("m_", "e_"),
            startsAt: startsAt,
            note: note,
            createdBy: currentUserName,
            createdById: getCurrentUserId(),
            createdAt: new Date().toISOString(),
          };
          return api.saveEvents([event].concat(freshEvents));
        }).then(function (saved) {
          eventsCache = saved;
          calendarMonthDate = new Date(startsAt);
          eventDateInput.value = "";
          eventTimeInput.value = "";
          eventNoteInput.value = "";
          renderCalendar();
          showToast("Calendar note added");
          refreshNotifications();
        }).catch(function (err) { showToast(err.message || "Couldn't save that calendar note", true); })
          .then(function () { setCalendarBusy(false); });
      });
    }

    if (!api.configured()) {
      setSyncStatus("Not connected — set GAS_URL in config.js", true);
      showToast("Backend not configured yet — see config.js", true);
    }

    function setSyncStatus(text, isError) {
      if (!syncStatusEl) return;
      syncStatusEl.textContent = text;
      syncStatusEl.classList.toggle("sync-status--error", !!isError);
    }

    function readNotificationStorage(key) {
      try {
        var stored = localStorage.getItem(key);
        var parsed = stored ? JSON.parse(stored) : {};
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch (error) {
        console.error("Could not read notification preferences", error);
        return {};
      }
    }

    function writeNotificationStorage(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        console.error("Could not save notification preferences", error);
        showToast("Notification preferences could not be saved", true);
      }
    }

    function getNotificationState() {
      var state = readNotificationStorage(notificationReadKey);
      var userState = state[notificationUserKey];
      return userState && typeof userState === "object" ? userState : {};
    }

    function saveNotificationState(state) {
      var stored = readNotificationStorage(notificationReadKey);
      stored[notificationUserKey] = state;
      writeNotificationStorage(notificationReadKey, stored);
    }

    function getNotificationLastRead() {
      var stored = readNotificationStorage(notificationLastReadKey);
      return stored[notificationUserKey] || "1970-01-01T00:00:00.000Z";
    }

    function saveNotificationLastRead(timestamp) {
      var stored = readNotificationStorage(notificationLastReadKey);
      stored[notificationUserKey] = timestamp;
      writeNotificationStorage(notificationLastReadKey, stored);
    }

    function getDeletedNotifications() {
      var stored = readNotificationStorage(notificationDeletedKey);
      var deleted = stored[notificationUserKey];
      return Array.isArray(deleted) ? deleted : [];
    }

    function isNotificationUnread(notification, readState, lastRead) {
      if (Object.prototype.hasOwnProperty.call(readState, notification.id)) {
        return readState[notification.id] === false;
      }
      var timestamp = Date.parse(notification.timestamp);
      return !isNaN(timestamp) && timestamp > Date.parse(lastRead);
    }

    function notificationIcon(type) {
      var icons = {
        calendar: "📢",
        album: "📸",
        photo: "📸",
        reaction: "💬",
        comment: "💬"
      };
      return Object.prototype.hasOwnProperty.call(icons, type) ? icons[type] : "🔔";
    }

    function renderNotifications() {
      if (!notificationList || !notificationBadge) return;
      var deletedIds = getDeletedNotifications();
      var visibleNotifications = notificationRecords.filter(function (notification) {
        if (deletedIds.indexOf(notification.id) !== -1) return false;
        if (notification.createdById) return notification.createdById !== getCurrentUserId();
        return String(notification.createdBy || "").toLowerCase() !== getCurrentUserName().toLowerCase();
      });
      var readState = getNotificationState();
      var lastRead = getNotificationLastRead();
      var unreadCount = visibleNotifications.filter(function (notification) {
        return isNotificationUnread(notification, readState, lastRead);
      }).length;
      notificationBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
      notificationBadge.hidden = unreadCount === 0;
      notificationList.innerHTML = visibleNotifications.length
        ? visibleNotifications.map(function (notification) {
          var unread = isNotificationUnread(notification, readState, lastRead);
          var title = escapeHtml(notification.title || "New activity");
          var author = escapeHtml(notification.createdBy || "YOUR CLASS SECTION member");
          var timestamp = escapeHtml(formatDate(notification.timestamp));
          var id = escapeHtml(notification.id);
          return '<li class="notification-item' + (unread ? " is-unread" : "") + '" data-notif-id="' + id + '">' +
            '<button type="button" class="notification-item__open" data-open-notification aria-label="Open notification: ' + title + '">' +
            '<span class="notification-item__icon" aria-hidden="true">' + notificationIcon(notification.type) + '</span>' +
            '<span class="notification-item__content"><span class="notification-item__title">' + title +
            '</span><time class="notification-item__meta">' + author + ' · ' + timestamp + '</time></span></button>' +
            '<div class="notification-item__menu-wrap"><button type="button" class="notification-item__more" ' +
            'aria-label="Notification options" aria-expanded="false">•••</button>' +
            '<div class="notification-item__menu" hidden>' +
            '<button type="button" data-notif-action="toggle-read">' + (unread ? "Mark as read" : "Mark as unread") + '</button>' +
            '<button type="button" data-notif-action="delete">Delete notification</button></div></div></li>';
        }).join("")
        : '<li class="notification-list__empty">You’re all caught up.</li>';
    }

    function refreshNotifications() {
      if (!api.configured()) return Promise.resolve();
      if (notificationsRefreshPromise) return notificationsRefreshPromise;
      notificationsRefreshPromise = api.getNotifications().then(function (notifications) {
        notificationRecords = notifications;
        renderNotifications();
      }).catch(function (error) {
        console.error(error);
      }).then(function () {
        notificationsRefreshPromise = null;
      });
      return notificationsRefreshPromise;
    }

    function markAllNotificationsRead() {
      saveNotificationLastRead(new Date().toISOString());
      saveNotificationState({});
      renderNotifications();
    }

    function positionNotificationPanel() {
      if (!notificationPanel || notificationPanel.hidden || !window.matchMedia("(max-width: 760px)").matches) return;
      var bellRect = notificationBell.getBoundingClientRect();
      var panelRect = notificationPanel.getBoundingClientRect();
      var viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      var belowTop = bellRect.bottom + 8;
      var top = belowTop + panelRect.height <= viewportHeight - 12
        ? belowTop
        : bellRect.top - panelRect.height - 8;
      top = Math.max(12, Math.min(top, viewportHeight - panelRect.height - 12));
      notificationPanel.style.top = top + "px";
    }

    function highlightNotificationTarget(target) {
      if (!target) return;
      target.classList.add("notification-target-highlight");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      if (typeof target.focus === "function") target.focus({ preventScroll: true });
      setTimeout(function () { target.classList.remove("notification-target-highlight"); }, 3500);
    }

    function findReactionNotificationPhoto(notification) {
      var actor = String(notification.createdBy || "").trim().toLowerCase();
      if (!actor) return null;
      var matchingPhotos = notesCache.filter(function (item) {
        if (item.kind === "album") return false;
        var reactions = normalizeMemoryReactions(item);
        if (notification.reactionKey) {
          return (reactions[notification.reactionKey] || []).some(function (name) {
            return name.trim().toLowerCase() === actor;
          });
        }
        return REACTION_OPTIONS.some(function (option) {
          return (reactions[option.key] || []).some(function (name) {
            return name.trim().toLowerCase() === actor;
          });
        });
      });
      var notificationTime = Date.parse(notification.timestamp) || 0;
      matchingPhotos.sort(function (a, b) {
        var aTime = Date.parse(a.updatedAt || a.createdAt || a.timestamp) || 0;
        var bTime = Date.parse(b.updatedAt || b.createdAt || b.timestamp) || 0;
        if (notificationTime) {
          return Math.abs(aTime - notificationTime) - Math.abs(bTime - notificationTime);
        }
        return bTime - aTime;
      });
      return matchingPhotos[0] || null;
    }

    function navigateToNotification(notification) {
      var targetType = notification.targetType || notification.type;
      if (targetType === "calendar" || notification.type === "calendar") {
        var showCalendarEvent = function () {
          var targetEvent = eventsCache.find(function (entry) { return entry.id === notification.targetId; });
          if (targetEvent) calendarMonthDate = new Date(targetEvent.startsAt);
          renderCalendar();
          var eventElement = qsa(".calendar-event", calendarEventsEl).find(function (item) {
            return item.getAttribute("data-id") === notification.targetId;
          });
          highlightNotificationTarget(eventElement || qs(".calendar-panel"));
          if (!targetEvent) showToast("That calendar event is no longer available", true);
        };
        if (notification.targetId && !eventsCache.some(function (entry) { return entry.id === notification.targetId; })) {
          api.getEvents().then(function (events) {
            eventsCache = events;
            showCalendarEvent();
          }).catch(function (error) {
            console.error(error);
            highlightNotificationTarget(qs(".calendar-panel"));
            showToast(error.message || "Couldn't load that calendar event", true);
          });
        } else {
          showCalendarEvent();
        }
        return;
      }

      if (targetType === "album" || notification.type === "album") {
        var targetAlbum = notesCache.find(function (item) {
          return item.kind === "album" && item.id === notification.targetId;
        });
        if (!targetAlbum) {
          highlightNotificationTarget(qs("#memoryGrid"));
          showToast("That album is no longer available", true);
          return;
        }
        openAlbum(targetAlbum);
        return;
      }

      if (targetType === "photo" || targetType === "comment" || targetType === "reaction" ||
        notification.type === "photo" || notification.type === "comment" || notification.type === "reaction") {
        var photo = notesCache.find(function (item) {
          return item.kind !== "album" && item.id === notification.targetId;
        });
        if (!photo && notification.type === "reaction") {
          photo = findReactionNotificationPhoto(notification);
        }
        if (photo && !notification.targetId) notification.targetId = photo.id;
        var targetAlbum = photo
          ? notesCache.find(function (item) { return item.kind === "album" && item.id === photo.albumId; })
          : null;
        if (!photo && notification.albumId) {
          targetAlbum = notesCache.find(function (item) {
            return item.kind === "album" && item.id === notification.albumId;
          });
        }
        if (!targetAlbum && !photo && !notification.albumId) {
          highlightNotificationTarget(qs("#memoryGrid"));
          showToast("This notification does not have a destination", true);
          return;
        }
        openAlbum(targetAlbum || {
          id: "__legacy__",
          title: "Unsorted memories",
          isLegacy: true
        });
        window.requestAnimationFrame(function () {
          var photoCard = qsa(".memory-card", albumPhotoGrid).find(function (card) {
            return card.getAttribute("data-id") === notification.targetId;
          });
          if (!photoCard) {
            highlightNotificationTarget(albumPhotoGrid);
            showToast("That photo is no longer available", true);
            return;
          }
          var focusTarget = photoCard;
          if (targetType === "comment" && notification.commentId) {
            focusTarget = qsa("[data-comment-id]", photoCard).find(function (comment) {
              return comment.getAttribute("data-comment-id") === notification.commentId;
            }) || photoCard;
          } else if (targetType === "reaction" && notification.reactionKey) {
            focusTarget = qsa("[data-reaction]", photoCard).find(function (button) {
              return button.getAttribute("data-reaction") === notification.reactionKey;
            }) || photoCard;
          }
          highlightNotificationTarget(focusTarget);
        });
        return;
      }

      highlightNotificationTarget(qs("#memoryGrid"));
    }

    if (notificationBell && notificationPanel && notificationCenter) {
      notificationBell.addEventListener("click", function () {
        var opening = notificationPanel.hidden;
        notificationPanel.hidden = !opening;
        notificationBell.setAttribute("aria-expanded", String(opening));
        if (opening) {
          positionNotificationPanel();
          markAllNotificationsRead();
        } else {
          notificationPanel.style.top = "";
        }
      });
      qs("#notif-mark-all-read").addEventListener("click", markAllNotificationsRead);
      notificationCenter.addEventListener("click", function (event) {
        var openButton = event.target.closest("[data-open-notification]");
        if (openButton) {
          var notificationItem = openButton.closest("[data-notif-id]");
          var selectedNotification = notificationRecords.find(function (record) {
            return notificationItem && record.id === notificationItem.getAttribute("data-notif-id");
          });
          if (selectedNotification) {
            var readState = getNotificationState();
            readState[selectedNotification.id] = true;
            saveNotificationState(readState);
            renderNotifications();
            notificationPanel.hidden = true;
            notificationBell.setAttribute("aria-expanded", "false");
            notificationPanel.style.top = "";
            navigateToNotification(selectedNotification);
          }
          return;
        }

        var moreButton = event.target.closest(".notification-item__more");
        if (moreButton) {
          var menu = qs(".notification-item__menu", moreButton.parentElement);
          var opening = menu.hidden;
          qsa(".notification-item__menu", notificationList).forEach(function (itemMenu) {
            itemMenu.hidden = true;
            itemMenu.parentElement.querySelector(".notification-item__more").setAttribute("aria-expanded", "false");
          });
          menu.hidden = !opening;
          moreButton.setAttribute("aria-expanded", String(opening));
          return;
        }

        var actionButton = event.target.closest("[data-notif-action]");
        if (!actionButton) return;
        var item = actionButton.closest("[data-notif-id]");
        var notificationId = item && item.getAttribute("data-notif-id");
        if (!notificationId) return;
        if (actionButton.getAttribute("data-notif-action") === "delete") {
          var stored = readNotificationStorage(notificationDeletedKey);
          var deleted = getDeletedNotifications();
          if (deleted.indexOf(notificationId) === -1) deleted.push(notificationId);
          stored[notificationUserKey] = deleted;
          writeNotificationStorage(notificationDeletedKey, stored);
        } else {
          var state = getNotificationState();
          var notification = notificationRecords.find(function (record) { return record.id === notificationId; });
          if (notification) state[notificationId] = isNotificationUnread(notification, state, getNotificationLastRead());
          saveNotificationState(state);
        }
        renderNotifications();
      });
      document.addEventListener("click", function (event) {
        if (!notificationCenter.contains(event.target) && !notificationPanel.hidden) {
          notificationPanel.hidden = true;
          notificationBell.setAttribute("aria-expanded", "false");
          notificationPanel.style.top = "";
        }
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !notificationPanel.hidden) {
          notificationPanel.hidden = true;
          notificationBell.setAttribute("aria-expanded", "false");
          notificationPanel.style.top = "";
          notificationBell.focus();
        }
      });
      window.addEventListener("resize", positionNotificationPanel);
      if (window.visualViewport) window.visualViewport.addEventListener("resize", positionNotificationPanel);
      window.addEventListener("storage", function (event) {
        if (event.key === notificationReadKey || event.key === notificationDeletedKey ||
          event.key === notificationLastReadKey) {
          renderNotifications();
        }
      });
    }

    /* ---- initial load + cross-device polling ---- */
    function refreshNotes(opts) {
      opts = opts || {};
      if (!api.configured()) return Promise.resolve();
      if (isBusy && !opts.force) return Promise.resolve();
      if (notesRefreshPromise) return notesRefreshPromise;
      // don't yank the grid out from under someone mid-edit
      if (!opts.silent) setSyncStatus("Loading…");
      if (syncNowButton) {
        syncNowButton.disabled = true;
        qs("i", syncNowButton).classList.add("fa-spin");
      }
      notesRefreshPromise = api
        .getNotes()
        .then(function (notes) {
          if (JSON.stringify(notesCache) !== JSON.stringify(notes)) {
            notesCache = notes;
            if (!qs(".memory-card--editing")) renderMemories();
            if (activeAlbum && albumModal.classList.contains("is-open")) {
              var refreshedAlbum = notesCache.find(function (note) {
                return note.kind === "album" && note.id === activeAlbum.id;
              });
              if (refreshedAlbum) {
                activeAlbum = refreshedAlbum;
                albumModalTitle.textContent = activeAlbum.title;
              }
              if (!qs(".memory-card--editing", albumPhotoGrid)) renderAlbumPhotos();
            }
          }
          renderNotifications();
          setSyncStatus("Load " + new Date().toLocaleTimeString());
        })
        .catch(function (err) {
          setSyncStatus("Load failed", true);
          console.error(err);
        })
        .then(function () {
          notesRefreshPromise = null;
          if (syncNowButton) {
            syncNowButton.disabled = !api.configured();
            qs("i", syncNowButton).classList.remove("fa-spin");
          }
        });
      return notesRefreshPromise;
    }

    if (syncNowButton) {
      syncNowButton.disabled = !api.configured();
      syncNowButton.addEventListener("click", function () { refreshNotes(); });
    }

    function refreshVisibleData() {
      if (document.visibilityState !== "visible") return;
      var now = Date.now();
      if (now - lastAutoRefreshAt < 10000) return;
      lastAutoRefreshAt = now;
      refreshNotes({ silent: true });
      refreshEvents();
      refreshNotifications();
    }

    refreshNotes();
    refreshEvents();
    refreshNotifications();
    lastAutoRefreshAt = Date.now();
    setInterval(refreshVisibleData, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refreshVisibleData();
    });
    window.addEventListener("focus", refreshVisibleData);

    function setComposerBusy(busy, label) {
      isBusy = busy;
      if (!submitBtn) return;
      submitBtn.disabled = busy;
      submitBtn.textContent = busy ? (label || "Saving…") : "Create album";
    }

    if (composerForm) {
      composerForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (isBusy) return;
        if (!api.configured()) {
          showToast("Connect Google Drive first — see config.js", true);
          return;
        }
        var albumTitle = titleInput.value.trim();
        if (!albumTitle) {
          titleInput.focus();
          return;
        }
        var album = {
          id: uid(),
          kind: "album",
          title: albumTitle,
          createdBy: currentUserName,
          createdById: getCurrentUserId(),
          createdAt: new Date().toISOString(),
        };
        setComposerBusy(true, "Creating album…");

        api.createAlbum(album)
          .then(function (saved) {
            notesCache = saved;
            titleInput.value = "";
            renderMemories();
            showToast("Album created");
            setSyncStatus("Synced " + new Date().toLocaleTimeString());
            refreshNotifications();
          })
          .catch(function (err) {
            console.error(err);
            showToast(err.message || "Couldn't create that album", true);
          })
          .then(function () { setComposerBusy(false); });
      });
    }

    function renderMemories() {
      var grid = qs("#memoryGrid");
      var countEl = qs("#memoryCount");
      var albums = notesCache.filter(function (item) { return item.kind === "album"; });
      var albumIds = albums.map(function (album) { return album.id; });
      var legacyPhotos = notesCache.filter(function (item) {
        return item.kind !== "album" && (!item.albumId || albumIds.indexOf(item.albumId) === -1);
      });
      if (legacyPhotos.length) albums.push({
        id: "__legacy__",
        title: "Unsorted memories",
        createdBy: "Existing photos",
        isLegacy: true,
        photoCount: legacyPhotos.length,
      });
      albums.forEach(function (album) {
        if (!album.isLegacy) {
          album.photoCount = notesCache.filter(function (item) {
            return item.kind !== "album" && item.albumId === album.id;
          }).length;
        }
      });
      if (countEl) countEl.textContent = albums.length + (albums.length === 1 ? " album" : " albums");
      grid.innerHTML = "";
      if (!albums.length) {
        grid.appendChild(el("div", { class: "empty-state" },
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 10h18"/></svg>' +
          "<strong>No albums yet</strong><p>Create an album above to start organizing photos.</p>"));
        return;
      }
      albums.forEach(function (album) {
        var card = el("article", { class: "album-card" });
        var openButton = el("button", {
          type: "button",
          class: "album-card__open",
          "aria-label": "Open " + album.title + ", " + album.photoCount + (album.photoCount === 1 ? " photo" : " photos"),
        });
        openButton.innerHTML =
          '<span class="album-card__icon"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13a4 4 0 0 1 4-4h11l5 6h16a4 4 0 0 1 4 4v17a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z"/><path d="M4 19h40"/></svg></span>' +
          '<span class="album-card__title">' + escapeHtml(album.title) + "</span>" +
          '<span class="album-card__meta">' + album.photoCount + (album.photoCount === 1 ? " photo" : " photos") + "</span>" +
          '<span class="memory-card__creator">by ' + escapeHtml(album.createdBy || "unknown user") + "</span>";
        openButton.addEventListener("click", function () { openAlbum(album); });
        card.appendChild(openButton);
        if (!album.isLegacy) {
          var actions = el("div", { class: "album-card__actions" });
          var editButton = el("button", {
            type: "button",
            class: "btn--icon",
            "aria-label": "Edit " + album.title,
            title: "Edit album name",
          }, ICONS.edit);
          var deleteButton = el("button", {
            type: "button",
            class: "btn--icon is-danger",
            "aria-label": "Delete " + album.title,
            title: "Delete album and its photos",
          }, ICONS.trash);
          editButton.addEventListener("click", function () { renameAlbum(album); });
          deleteButton.addEventListener("click", function () { confirmDeleteAlbum(album); });
          actions.appendChild(editButton);
          actions.appendChild(deleteButton);
          card.appendChild(actions);
        }
        grid.appendChild(card);
      });
    }

    function renameAlbum(album) {
      albumBeingRenamed = album;
      albumRenameInput.value = album.title;
      albumRenameOverlay.classList.add("is-open");
      albumRenameOverlay.setAttribute("aria-hidden", "false");
      albumRenameInput.focus();
      albumRenameInput.select();
    }

    function closeRenameAlbum() {
      albumRenameOverlay.classList.remove("is-open");
      albumRenameOverlay.setAttribute("aria-hidden", "true");
      albumBeingRenamed = null;
      albumRenameSave.disabled = false;
      albumRenameSave.textContent = "Save name";
    }

    qs("#albumRenameCancel").addEventListener("click", closeRenameAlbum);
    albumRenameOverlay.addEventListener("click", function (event) {
      if (event.target === albumRenameOverlay) closeRenameAlbum();
    });
    albumRenameForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!albumBeingRenamed || albumRenameSave.disabled) return;
      var album = albumBeingRenamed;
      var nextTitle = albumRenameInput.value.trim();
      if (!nextTitle) {
        albumRenameInput.focus();
        return;
      }
      if (nextTitle === album.title) {
        closeRenameAlbum();
        return;
      }
      if (nextTitle.length > 100) {
        showToast("Album names must be 100 characters or fewer", true);
        return;
      }
      albumRenameSave.disabled = true;
      albumRenameSave.textContent = "Saving…";
      setComposerBusy(true, "Renaming album…");
      api.renameAlbum(album.id, nextTitle)
        .then(function (saved) {
          notesCache = saved;
          if (activeAlbum && activeAlbum.id === album.id) {
            activeAlbum = notesCache.find(function (item) { return item.kind === "album" && item.id === album.id; });
            if (activeAlbum) {
              albumModalTitle.textContent = activeAlbum.title;
              albumUploadAlbumName.textContent = activeAlbum.title;
            }
          }
          renderMemories();
          showToast("Album renamed");
          setSyncStatus("Synced " + new Date().toLocaleTimeString());
          refreshNotifications();
          closeRenameAlbum();
        })
        .catch(function (error) {
          console.error(error);
          showToast(error.message || "Couldn't rename that album", true);
          albumRenameSave.disabled = false;
          albumRenameSave.textContent = "Save name";
        })
        .then(function () { setComposerBusy(false); });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && albumRenameOverlay.classList.contains("is-open")) closeRenameAlbum();
    });

    function confirmDeleteAlbum(album) {
      openConfirm({
        title: "Delete this album?",
        body: '"' + album.title + '" and all ' + album.photoCount +
          (album.photoCount === 1 ? " photo will be removed from this space and moved to Google Drive trash." :
            " photos will be removed from this space and moved to Google Drive trash."),
        confirmLabel: "Delete album",
        onConfirm: function () {
          setComposerBusy(true, "Deleting album…");
          api.deleteAlbum(album.id)
            .then(function (saved) {
              notesCache = saved;
              if (activeAlbum && activeAlbum.id === album.id) closeAlbum();
              renderMemories();
              showToast("Album and its photos deleted");
              setSyncStatus("Synced " + new Date().toLocaleTimeString());
              refreshNotifications();
            })
            .catch(function (error) {
              console.error(error);
              showToast(error.message || "Couldn't delete that album", true);
            })
            .then(function () { setComposerBusy(false); });
        },
      });
    }

    function openAlbum(album) {
      activeAlbum = album;
      albumModalTitle.textContent = album.title;
      albumUploadAlbumName.textContent = album.title;
      albumPhotoCaption.value = "";
      albumPhotoFiles.value = "";
      albumAddPicture.hidden = !!album.isLegacy;
      albumUploadHint.textContent = album.isLegacy
        ? "These are photos saved before albums were added. Create an album to upload more."
        : "Select one or more photos to add to this album.";
      renderAlbumPhotos();
      albumModal.classList.add("is-open");
      albumModal.setAttribute("aria-hidden", "false");
    }

    function closeAlbum() {
      closeAlbumUpload();
      albumModal.classList.remove("is-open");
      albumModal.setAttribute("aria-hidden", "true");
      activeAlbum = null;
    }

    function openAlbumUpload() {
      if (!activeAlbum || activeAlbum.isLegacy) return;
      albumUploadAlbumName.textContent = activeAlbum.title;
      albumUploadOverlay.classList.add("is-open");
      albumUploadOverlay.setAttribute("aria-hidden", "false");
      albumPhotoCaption.focus();
    }

    function closeAlbumUpload() {
      albumUploadOverlay.classList.remove("is-open");
      albumUploadOverlay.setAttribute("aria-hidden", "true");
    }

    albumAddPicture.addEventListener("click", openAlbumUpload);
    qs("#albumUploadClose").addEventListener("click", closeAlbumUpload);
    albumUploadOverlay.addEventListener("click", function (event) {
      if (event.target === albumUploadOverlay && !albumUploadButton.disabled) closeAlbumUpload();
    });

    function renderAlbumPhotos() {
      if (!activeAlbum) return;
      var albumPhotos = notesCache.filter(function (item) {
        if (item.kind === "album") return false;
        return activeAlbum.isLegacy
          ? (!item.albumId || !notesCache.some(function (album) {
            return album.kind === "album" && album.id === item.albumId;
          }))
          : item.albumId === activeAlbum.id;
      });
      albumModalDescription.textContent = albumPhotos.length + (albumPhotos.length === 1 ? " photo" : " photos");
      albumPhotoGrid.innerHTML = "";
      if (!albumPhotos.length) {
        albumPhotoGrid.appendChild(el("div", { class: "empty-state album-photo-grid__empty" },
          ICONS.photo + "<strong>No photos in this album yet</strong><p>Select photos above to add them.</p>"));
        return;
      }
      albumPhotos.forEach(function (photo) {
        albumPhotoGrid.appendChild(buildCard(photo));
      });
    }

    qs("#albumModalClose").addEventListener("click", closeAlbum);
    albumModal.addEventListener("click", function (event) {
      if (event.target === albumModal) closeAlbum();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && albumUploadOverlay.classList.contains("is-open") && !albumUploadButton.disabled) {
        closeAlbumUpload();
        return;
      }
      if (event.key === "Escape" && albumModal.classList.contains("is-open")) closeAlbum();
    });

    albumPhotoFiles.addEventListener("change", function () {
      var count = albumPhotoFiles.files ? albumPhotoFiles.files.length : 0;
      albumUploadHint.textContent = count
        ? count + (count === 1 ? " photo selected." : " photos selected.")
        : "Select one or more photos to add to this album.";
    });

    albumUploadForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!activeAlbum || activeAlbum.isLegacy || albumUploadButton.disabled) return;
      if (!api.configured()) {
        showToast("Connect Google Drive first — see config.js", true);
        return;
      }
      var files = Array.prototype.slice.call(albumPhotoFiles.files || []);
      if (!files.length) {
        albumPhotoFiles.focus();
        return;
      }
      var album = activeAlbum;
      var caption = albumPhotoCaption.value.trim();
      var uploadedFiles = [];
      var newPhotos = [];
      albumUploadButton.disabled = true;
      albumUploadButton.textContent = "Uploading…";

      files.reduce(function (promise, file) {
        return promise.then(function () {
          return fileToDataUrl(file)
            .then(function (dataUrl) {
              return api.uploadImage(dataUrl, file.name, album.id);
            })
            .then(function (uploaded) {
              uploadedFiles.push(uploaded.fileId);
              var now = new Date().toISOString();
              newPhotos.push({
                id: uid(),
                albumId: album.id,
                title: caption || file.name.replace(/\.[^.]+$/, ""),
                text: "",
                photoUrl: uploaded.url,
                photoFileId: uploaded.fileId,
                createdBy: currentUserName,
                createdById: getCurrentUserId(),
                createdAt: now,
                updatedAt: now,
              });
              albumUploadButton.textContent = "Uploaded " + newPhotos.length + " of " + files.length;
            });
        });
      }, Promise.resolve())
        .then(function () {
          return api.getNotes().then(function (freshNotes) {
            return api.saveNotes(newPhotos.concat(freshNotes));
          });
        })
        .then(function (saved) {
          notesCache = saved;
          albumPhotoCaption.value = "";
          albumPhotoFiles.value = "";
          albumUploadHint.textContent = "Select one or more photos to add to this album.";
          renderMemories();
          renderAlbumPhotos();
          setSyncStatus("Synced " + new Date().toLocaleTimeString());
          closeAlbumUpload();
          showToast("Photos added to " + album.title);
          refreshNotifications();
        })
        .catch(function (error) {
          console.error(error);
          return uploadedFiles.reduce(function (promise, fileId) {
            return promise.then(function () { return api.deleteImage(fileId); });
          }, Promise.resolve()).then(function () {
            showToast(error.message || "Couldn't upload photos to this album", true);
          });
        })
        .then(function () {
          albumUploadButton.disabled = false;
          albumUploadButton.textContent = "Upload";
        });
    });

    function buildCard(memory) {
      var card = el("article", { class: "memory-card", "data-id": memory.id });
      var photoSrc = memory.photoUrl || memory.photo || null; // "photo" kept for any old localStorage-era data URLs
      var reactionState = getReactionState(memory);
      var currentUserId = getCurrentUserId();
      var editingCommentId = null;
      var reactionMarkup = REACTION_OPTIONS.map(function (option) {
        var count = reactionState.counts[option.key] || 0;
        var activeClass = reactionState.myReaction === option.key ? " is-active" : "";
        return '<button type="button" class="memory-card__reaction' + activeClass + '" data-reaction="' + option.key + '" aria-label="' + option.label + ' reaction">' +
          '<span class="memory-card__reaction-icon">' + option.icon + '</span>' +
          '<span class="memory-card__reaction-count">' + count + '</span>' +
          '</button>';
      }).join("");

      function renderComments() {
        var comments = Array.isArray(memory.comments) ? memory.comments : [];
        var commentMarkup = comments.map(function (comment) {
          var isOwner = currentUserId && comment.authorId === currentUserId;
          var isEditing = editingCommentId === comment.id;
          return '<li class="memory-comment" data-comment-id="' + escapeHtml(comment.id) + '">' +
            '<div class="memory-comment__header"><span class="memory-comment__author">' +
            escapeHtml(comment.authorName || "Unknown user") + '</span><time class="mono">' +
            escapeHtml(formatDate(comment.updatedAt || comment.createdAt)) + '</time></div>' +
            (isEditing
              ? '<textarea class="field__input memory-comment__edit" maxlength="1000" required aria-label="Edit comment">' +
              escapeHtml(comment.text || "") + '</textarea><div class="memory-comment__actions">' +
              '<button type="button" class="memory-comment__action" data-comment-action="cancel">Cancel</button>' +
              '<button type="button" class="memory-comment__action" data-comment-action="save">Save</button></div>'
              : '<p class="memory-comment__text">' + escapeHtml(comment.text || "") + '</p>' +
              (isOwner ? '<div class="memory-comment__actions">' +
                '<button type="button" class="memory-comment__action" data-comment-action="edit">Edit</button>' +
                '<button type="button" class="memory-comment__action" data-comment-action="delete">Delete</button></div>' : "")) +
            '</li>';
        }).join("");
        return '<section class="memory-card__comments" aria-label="Photo comments">' +
          '<h4>Comments <span>' + comments.length + '</span></h4>' +
          '<ul class="memory-comments">' + (commentMarkup || '<li class="memory-comments__empty">No comments yet.</li>') + '</ul>' +
          '<form class="memory-comment-form"><label class="sr-only" for="comment-' + escapeHtml(memory.id) +
          '">Add a comment</label><textarea class="field__input" id="comment-' + escapeHtml(memory.id) +
          '" maxlength="1000" placeholder="Write a comment…" required></textarea>' +
          '<button type="submit" class="btn btn--ghost">Comment</button></form></section>';
      }

      card.innerHTML =
        '<div class="memory-card__tape"></div>' +
        '<div class="memory-card__photo' + (photoSrc ? " is-loading" : "") + '">' +
        (photoSrc
          ? '<img src="' + photoSrc + '" alt="' + escapeHtml(memory.title || "Memory photo") + '" loading="lazy" decoding="async">'
          : ICONS.photo) +
        "</div>" +
        '<div class="memory-card__body">' +
        (memory.title ? '<h3 class="memory-card__title">' + escapeHtml(memory.title) + "</h3>" : "") +
        (memory.text ? '<p class="memory-card__text">' + escapeHtml(memory.text) + "</p>" : "") +
        '<span class="memory-card__creator">by ' + escapeHtml(memory.createdBy || "unknown user") + '</span>' +
        '<div class="memory-card__meta">' +
        '<span class="memory-card__date mono">' + formatDate(memory.createdAt || memory.updatedAt || memory.timestamp) + "</span>" +
        '<div class="memory-card__actions">' +
        '<button type="button" class="btn--icon" data-action="edit" aria-label="Edit memory">' + ICONS.edit + "</button>" +
        '<button type="button" class="btn--icon is-danger" data-action="delete" aria-label="Delete memory">' + ICONS.trash + "</button>" +
        "</div></div>" +
        '<div class="memory-card__reactions">' + reactionMarkup + "</div>" +
        renderComments() +
        "</div>";

      var photoImage = qs(".memory-card__photo img", card);
      if (photoImage) {
        var photoWrap = photoImage.parentElement;
        var finishPhotoLoading = function () {
          photoWrap.classList.remove("is-loading");
        };
        if (photoImage.complete) {
          finishPhotoLoading();
        } else {
          photoImage.addEventListener("load", finishPhotoLoading, { once: true });
          photoImage.addEventListener("error", finishPhotoLoading, { once: true });
        }
      }

      var commentForm = qs(".memory-comment-form", card);
      commentForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var input = qs("textarea", commentForm);
        var text = input.value.trim();
        if (!text) {
          input.focus();
          return;
        }
        if (!currentUserId) {
          showToast("Please sign in again before commenting", true);
          return;
        }
        var submitButton = qs('button[type="submit"]', commentForm);
        submitButton.disabled = true;
        api.mutateComment("createComment", memory.id, uid().replace("m_", "c_"), text)
          .then(function (saved) {
            notesCache = saved;
            if (activeAlbum) renderAlbumPhotos();
            else renderMemories();
            refreshNotifications();
          })
          .catch(function (error) {
            console.error(error);
            showToast(error.message || "Couldn't add comment", true);
            submitButton.disabled = false;
          });
      });

      card.addEventListener("click", function (event) {
        var button = event.target.closest("[data-comment-action]");
        if (!button) return;
        var commentItem = button.closest("[data-comment-id]");
        var commentId = commentItem && commentItem.getAttribute("data-comment-id");
        var action = button.getAttribute("data-comment-action");
        var comment = (Array.isArray(memory.comments) ? memory.comments : []).find(function (entry) {
          return entry.id === commentId;
        });
        if (!comment) return;
        if (action === "edit") {
          editingCommentId = commentId;
          qs(".memory-card__comments", card).outerHTML = renderComments();
          qs(".memory-comment__edit", card).focus();
          return;
        }
        if (action === "cancel") {
          editingCommentId = null;
          qs(".memory-card__comments", card).outerHTML = renderComments();
          return;
        }
        if (action === "save") {
          var input = qs(".memory-comment__edit", commentItem);
          var text = input.value.trim();
          if (!text) {
            input.focus();
            return;
          }
          button.disabled = true;
          api.mutateComment("updateComment", memory.id, commentId, text)
            .then(function (saved) {
              notesCache = saved;
              if (activeAlbum) renderAlbumPhotos();
              else renderMemories();
            })
            .catch(function (error) {
              console.error(error);
              showToast(error.message || "Couldn't update comment", true);
              button.disabled = false;
            });
          return;
        }
        if (action === "delete") {
          openConfirm({
            title: "Delete this comment?",
            body: "This comment will be removed for everyone.",
            onConfirm: function () {
              api.mutateComment("deleteComment", memory.id, commentId)
                .then(function (saved) {
                  notesCache = saved;
                  if (activeAlbum) renderAlbumPhotos();
                  else renderMemories();
                  showToast("Comment deleted");
                })
                .catch(function (error) {
                  console.error(error);
                  showToast(error.message || "Couldn't delete comment", true);
                });
            },
          });
        }
      });

      var photo = qs(".memory-card__photo img", card);
      if (photo && openImageModal) {
        photo.parentElement.classList.add("memory-card__photo--clickable");
        photo.parentElement.addEventListener("click", function () {
          if (card.classList.contains("memory-card--editing")) return;
          openImageModal(photo.src, photo.alt);
        });
      }

      qsa("[data-reaction]", card).forEach(function (button) {
        button.addEventListener("click", function () {
          toggleMemoryReaction(memory.id, button.getAttribute("data-reaction"));
        });
      });

      qs('[data-action="delete"]', card).addEventListener("click", function () {
        openConfirm({
          title: "Delete this memory?",
          body: "This can't be undone. The photo and story will be removed for the whole group.",
          onConfirm: function () {
            setComposerBusy(true, "Deleting…");
            api
              .getNotes()
              .then(function (freshNotes) {
                var target = freshNotes.find(function (n) { return n.id === memory.id; }) || memory;
                var remaining = freshNotes.filter(function (n) { return n.id !== memory.id; });
                return api.deleteImage(target.photoFileId).then(function () {
                  return api.saveNotes(remaining);
                });
              })
              .then(function (saved) {
                notesCache = saved;
                renderMemories();
                if (activeAlbum) renderAlbumPhotos();
                showToast("Memory deleted");
                setSyncStatus("Load " + new Date().toLocaleTimeString());
              })
              .catch(function (err) {
                console.error(err);
                showToast(err.message || "Couldn't delete that memory", true);
              })
              .then(function () { setComposerBusy(false); });
          },
        });
      });

      qs('[data-action="edit"]', card).addEventListener("click", function () {
        enterEditMode(card, memory);
      });

      return card;
    }

    function toggleMemoryReaction(memoryId, reactionKey) {
      var userName = getCurrentUserName();
      if (!userName || userName === "Google user") {
        showToast("Please sign in again to react", true);
        return;
      }

      api.getNotes().then(function (freshNotes) {
        var targetNote = freshNotes.find(function (note) { return note.id === memoryId; });
        if (!targetNote) {
          throw new Error("Memory not found");
        }

        var nextReactions = normalizeMemoryReactions(targetNote);
        var currentReaction = getReactionState(targetNote).myReaction;

        REACTION_OPTIONS.forEach(function (option) {
          nextReactions[option.key] = (nextReactions[option.key] || []).filter(function (name) {
            return name !== userName;
          });
        });

        if (currentReaction !== reactionKey) {
          nextReactions[reactionKey] = (nextReactions[reactionKey] || []).concat(userName);
        }

        return api.updateMemoryReaction(memoryId, nextReactions, currentReaction !== reactionKey, reactionKey);
      }).then(function (saved) {
        notesCache = saved;
        renderMemories();
        if (activeAlbum) renderAlbumPhotos();
        showToast("Reaction updated");
        refreshNotifications();
      }).catch(function (err) {
        console.error(err);
        showToast(err.message || "Couldn't update the reaction", true);
      });
    }

    function enterEditMode(card, memory) {
      card.classList.add("memory-card--editing");
      var body = qs(".memory-card__body", card);
      var currentPhotoUrl = memory.photoUrl || memory.photo || null;
      var currentPhotoFileId = memory.photoFileId || null;
      var newPhotoDataUrl = null; // set only if the user picks a replacement photo

      body.innerHTML =
        '<div class="memory-card__edit-fields">' +
        '<input type="text" class="field__input memory-card__edit-title" value="' + escapeHtml(memory.title || "") + '" placeholder="Title" aria-label="Photo title" required>' +
        '<div class="memory-card__edit-actions">' +
        '<button type="button" class="btn btn--ghost" data-action="cancel">Cancel</button>' +
        '<button type="button" class="btn btn--primary" data-action="save">Save changes</button>' +
        "</div></div>";

      var photoWrap = qs(".memory-card__photo", card);
      photoWrap.style.cursor = "pointer";
      photoWrap.title = "Click to change photo";
      var editFileInput = el("input", { type: "file", accept: "image/*", style: "display:none" });
      photoWrap.appendChild(editFileInput);
      photoWrap.addEventListener("click", onPhotoClick);
      function onPhotoClick() { editFileInput.click(); }
      editFileInput.addEventListener("change", function () {
        var file = editFileInput.files && editFileInput.files[0];
        if (!file) return;
        fileToDataUrl(file).then(function (dataUrl) {
          newPhotoDataUrl = dataUrl;
          photoWrap.classList.add("is-loading");
          photoWrap.innerHTML = '<img src="' + dataUrl + '" alt="Updated memory photo">';
          var previewImage = qs("img", photoWrap);
          previewImage.addEventListener("load", function () {
            photoWrap.classList.remove("is-loading");
          }, { once: true });
          previewImage.addEventListener("error", function () {
            photoWrap.classList.remove("is-loading");
          }, { once: true });
          if (previewImage.complete) photoWrap.classList.remove("is-loading");
          photoWrap.appendChild(editFileInput);
        });
      });

      var saveBtn = qs('[data-action="save"]', card);

      qs('[data-action="cancel"]', card).addEventListener("click", function () {
        card.classList.remove("memory-card--editing");
        photoWrap.removeEventListener("click", onPhotoClick);
        if (activeAlbum) renderAlbumPhotos();
        else renderMemories();
      });
      saveBtn.addEventListener("click", function () {
        if (isBusy || saveBtn.disabled) return;
        var titleField = qs(".memory-card__edit-title", card);
        var newTitle = titleField.value.trim();
        if (!newTitle) {
          titleField.focus();
          showToast("Photo title cannot be empty", true);
          return;
        }
        isBusy = true;
        saveBtn.disabled = true;
        saveBtn.textContent = newPhotoDataUrl ? "Uploading photo…" : "Saving…";

        var oldFileIdToRetire = null;
        var newFileIdToRetire = null;
        (newPhotoDataUrl ? api.uploadImage(newPhotoDataUrl, null, memory.albumId) : Promise.resolve(null))
          .then(function (uploaded) {
            saveBtn.textContent = "Saving…";
            var finalPhotoUrl = uploaded ? uploaded.url : currentPhotoUrl;
            var finalPhotoFileId = uploaded ? uploaded.fileId : currentPhotoFileId;
            newFileIdToRetire = uploaded ? uploaded.fileId : null;
            if (uploaded && currentPhotoFileId) oldFileIdToRetire = currentPhotoFileId;

            return api.getNotes().then(function (freshNotes) {
              var foundMemory = false;
              var updated = freshNotes.map(function (n) {
                if (n.id !== memory.id) return n;
                foundMemory = true;
                return Object.assign({}, n, {
                  title: newTitle,
                  photoUrl: finalPhotoUrl,
                  photoFileId: finalPhotoFileId,
                  updatedBy: currentUserName,
                  updatedById: getCurrentUserId(),
                  updatedAt: new Date().toISOString(),
                });
              });
              if (!foundMemory) throw new Error("Photo not found. Refresh the album and try again.");
              return api.saveNotes(updated).then(function (saved) {
                notesCache = saved;
                newFileIdToRetire = null;
                return oldFileIdToRetire ? api.deleteImage(oldFileIdToRetire) : undefined;
              });
            });
          })
          .then(function () {
            card.classList.remove("memory-card--editing");
            photoWrap.removeEventListener("click", onPhotoClick);
            if (activeAlbum) renderAlbumPhotos();
            else renderMemories();
            showToast("Memory updated");
            setSyncStatus("Synced " + new Date().toLocaleTimeString());
            refreshNotifications();
          })
          .catch(function (err) {
            console.error(err);
            showToast(err.message || "Couldn't save those changes", true);
            saveBtn.disabled = false;
            saveBtn.textContent = "Save changes";
            return newFileIdToRetire
              ? api.deleteImage(newFileIdToRetire)
              : undefined;
          })
          .then(function () {
            isBusy = false;
          });
      });
    }
  }

  /* ======================================================
     PAGE: index.html
     ====================================================== */
  function initIndexPage() {
    var cta = qs("#enterPortfolio");
    if (cta) {
      cta.addEventListener("click", function (e) {
        e.preventDefault();
        window.location.href = isLoggedIn() ? "portfolio.html" : "login.html";
      });
    }
  }

  /* ---------------- boot ---------------- */
  document.addEventListener("DOMContentLoaded", function () {
    var page = document.body.getAttribute("data-page");
    if (page === "login") initLoginPage();
    else if (page === "portfolio") initPortfolioPage();
    else if (page === "index") initIndexPage();
  });
})();
