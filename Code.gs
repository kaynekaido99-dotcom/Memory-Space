/**
 * ===========================================================
 *  MEMORY SPACE — Google Drive backend (Google Apps Script)
 * ===========================================================
 *  Cloud Storage entirely.
 *  All notes live in one notes.json file inside a Drive
 *  folder; album photos are uploaded into their Drive
 *  subfolders and served back as public "view" URLs.
 *
 *  DEPLOYMENT
 *  1. Go to https://script.google.com → New project.
 *  2. Paste this whole file in as Code.gs.
 *  3. Create a Google Drive folder for this app's data,
 *     open it, copy the ID from the URL
 *     (drive.google.com/drive/folders/<THIS_PART>) and paste
 *     it into CONFIG.FOLDER_ID below.
 *  4. Change CONFIG.APP_TOKEN to your own long random string.
 *     Put the SAME string in config.js on the frontend.
 *  5. Deploy → New deployment → type "Web app".
 *       - Execute as: Me
 *       - Who has access: Anyone
 *     Deploy, authorize the requested Drive scopes, and copy
 *     the "Web app URL" it gives you (ends in /exec).
 *  6. Paste that URL into config.js as GAS_URL.
 *
 *  NOTE ON SECURITY: CONFIG.APP_TOKEN is a shared-secret
 *  check, not real authentication — anyone with the token
 *  (visible in the deployed frontend JS) can read/write the
 *  data, same as the hardcoded admin/admin1234 login. This
 *  matches the "single shared account" design requested; it
 *  is not intended to protect sensitive data from a
 *  determined attacker.
 * ===========================================================
 */

var CONFIG = {
  FOLDER_ID: 'CHANGE_ME',
  NOTES_FILENAME: 'notes.json',
  EVENTS_FILENAME: 'events.json',
  NOTIFICATIONS_FILENAME: 'notifications.json',
  APP_TOKEN: 'CHANGE_ME'
};

/* ---------------- Drive helpers ---------------- */

function getFolder_() {
  return DriveApp.getFolderById(CONFIG.FOLDER_ID);
}

function getNotesFile_() {
  var folder = getFolder_();
  var files = folder.getFilesByName(CONFIG.NOTES_FILENAME);
  if (files.hasNext()) return files.next();
  return folder.createFile(CONFIG.NOTES_FILENAME, '[]', MimeType.PLAIN_TEXT);
}

function getEventsFile_() {
  var folder = getFolder_();
  var files = folder.getFilesByName(CONFIG.EVENTS_FILENAME);
  if (files.hasNext()) return files.next();
  return folder.createFile(CONFIG.EVENTS_FILENAME, '[]', MimeType.PLAIN_TEXT);
}

function getNotificationsFile_() {
  var folder = getFolder_();
  var files = folder.getFilesByName(CONFIG.NOTIFICATIONS_FILENAME);
  if (files.hasNext()) return files.next();
  return folder.createFile(CONFIG.NOTIFICATIONS_FILENAME, '[]', MimeType.PLAIN_TEXT);
}

function readNotes_() {
  var file = getNotesFile_();
  var text = file.getBlob().getDataAsString() || '[]';
  try {
    var data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function readEvents_() {
  var file = getEventsFile_();
  var text = file.getBlob().getDataAsString() || '[]';
  try {
    var data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function readNotifications_() {
  var file = getNotificationsFile_();
  var text = file.getBlob().getDataAsString() || '[]';
  try {
    var data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function writeNotes_(notes) {
  var file = getNotesFile_();
  file.setContent(JSON.stringify(notes));
}

function writeEvents_(events) {
  var file = getEventsFile_();
  file.setContent(JSON.stringify(events));
}

function writeNotifications_(notifications) {
  getNotificationsFile_().setContent(JSON.stringify(notifications));
}

function addNotification_(rec, type, title, createdBy, createdById, target) {
  var notification = {
    id: 'n_' + Utilities.getUuid(),
    type: type,
    title: title,
    createdBy: createdBy || 'unknown user',
    createdById: createdById || '',
    timestamp: new Date().toISOString()
  };
  if (target) {
    notification.targetType = target.type || '';
    notification.targetId = target.id || '';
    notification.albumId = target.albumId || '';
    notification.commentId = target.commentId || '';
    notification.reactionKey = target.reactionKey || '';
  }
  rec.unshift(notification);
  if (rec.length > 100) rec.length = 100;
  writeNotifications_(rec);
  return notification;
}

function getAlbumFolder_(albumId) {
  var album = readNotes_().filter(function (item) {
    return item.kind === 'album' && item.id === albumId;
  })[0];
  if (!album || !album.driveFolderId) {
    throw new Error('Album folder not found');
  }
  var folder = DriveApp.getFolderById(album.driveFolderId);
  var parents = folder.getParents();
  var belongsToAppFolder = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === CONFIG.FOLDER_ID) {
      belongsToAppFolder = true;
      break;
    }
  }
  if (!belongsToAppFolder) {
    throw new Error('Album folder is outside the configured app folder');
  }
  return folder;
}

function uploadImage_(filename, mimeType, base64Data, albumId) {
  if (base64Data && base64Data.indexOf(',') !== -1) {
    // strip a "data:image/png;base64," prefix if the caller sent a full data URL
    base64Data = base64Data.split(',')[1];
  }
  var folder = albumId ? getAlbumFolder_(albumId) : getFolder_();
  var bytes = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', filename || ('photo_' + Date.now() + '.jpg'));
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var fileId = file.getId();
  // Direct, hotlink-friendly image URL (works in <img> tags without a download prompt).
  var url = 'https://lh3.googleusercontent.com/d/' + fileId;
  return { fileId: fileId, url: url };
}

function deleteImage_(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e) {
    // file may already be gone — not fatal
  }
}

/* ---------------- request plumbing ---------------- */

function checkToken_(token) {
  return typeof token === 'string' && token.length > 0 && token === CONFIG.APP_TOKEN;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * GET is used for read-only calls: ?action=getNotes&token=...
 * Kept as a simple query-string request so it never triggers
 * a CORS preflight from the browser.
 */
function doGet(e) {
  var params = (e && e.parameter) || {};
  var action = params.action;

  if (!checkToken_(params.token)) {
    return jsonOut_({ ok: false, error: 'Unauthorized' });
  }

  if (action === 'getNotes') {
    return jsonOut_({
      ok: true,
      notes: readNotes_(),
      notifications: readNotifications_(),
      itinianz_notifications: readNotifications_() // legacy key, kept for old clients
    });
  }

  if (action === 'getNotifications') {
    var allNotifications = readNotifications_();
    return jsonOut_({ ok: true, notifications: allNotifications, itinianz_notifications: allNotifications });
  }

  if (action === 'getEvents') {
    return jsonOut_({ ok: true, events: readEvents_() });
  }

  return jsonOut_({ ok: false, error: 'Unknown action: ' + action });
}

/**
 * POST is used for every write: createAlbum, saveNotes, uploadImage,
 * deleteImage.
 * The frontend must send the body as plain text (Content-Type:
 * text/plain) even though the payload is JSON — Apps Script Web
 * Apps do not handle the OPTIONS preflight that a real
 * "application/json" request would trigger.
 */
function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Invalid JSON body' });
  }

  if (!checkToken_(body.token)) {
    return jsonOut_({ ok: false, error: 'Unauthorized' });
  }

  var action = body.action;

  if (action === 'saveNotes') {
    if (!Array.isArray(body.notes)) {
      return jsonOut_({ ok: false, error: 'notes must be an array' });
    }
    var notesLock = LockService.getScriptLock();
    try {
      notesLock.waitLock(10000);
      var currentNotes = readNotes_();
      var savedNotes = body.notes.map(function (note) {
        var existing = currentNotes.filter(function (item) { return item.id === note.id; })[0];
        if (existing) {
          if (note.kind !== 'album' && note.title !== existing.title) {
            addNotification_(readNotifications_(), 'photo', 'Photo caption updated: ' + (note.title || 'Photo'), note.updatedBy || note.createdBy, note.updatedById || note.createdById, {
              type: 'photo', id: note.id, albumId: note.albumId
            });
          } else if (note.kind !== 'album' && note.photoFileId && note.photoFileId !== existing.photoFileId) {
            addNotification_(readNotifications_(), 'photo', 'Photo updated: ' + (note.title || 'Photo'), note.updatedBy || note.createdBy, note.updatedById || note.createdById, {
              type: 'photo', id: note.id, albumId: note.albumId
            });
          }
          return Object.assign({}, note, {
            comments: Array.isArray(existing.comments) ? existing.comments : []
          });
        }
        if (note.kind !== 'album' && (note.photoFileId || note.photoUrl)) {
          addNotification_(readNotifications_(), 'photo', 'New picture uploaded: ' + (note.title || 'Photo'), note.createdBy, note.createdById, {
            type: 'photo', id: note.id, albumId: note.albumId
          });
        }
        if (note.comments) {
          var newNote = Object.assign({}, note);
          delete newNote.comments;
          return newNote;
        }
        return note;
      });
      writeNotes_(savedNotes);
      return jsonOut_({ ok: true, notes: savedNotes });
    } catch (err) {
      return jsonOut_({ ok: false, error: 'Notes save failed: ' + err.message });
    } finally {
      if (notesLock.hasLock()) notesLock.releaseLock();
    }
  }

  if (action === 'createAlbum') {
    var album = body.album;
    if (!album || typeof album.id !== 'string' || !album.id ||
        typeof album.title !== 'string' || !album.title.trim() ||
        album.title.trim().length > 100) {
      return jsonOut_({ ok: false, error: 'A valid album id and name are required' });
    }
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      var notes = readNotes_();
      if (notes.some(function (item) { return item.id === album.id; })) {
        return jsonOut_({ ok: false, error: 'Album already exists' });
      }
      var driveFolder = getFolder_().createFolder(album.title.trim());
      var savedAlbum = {
        id: album.id,
        kind: 'album',
        title: album.title.trim(),
        driveFolderId: driveFolder.getId(),
        createdBy: typeof album.createdBy === 'string' ? album.createdBy : 'unknown user',
        createdById: typeof album.createdById === 'string' ? album.createdById : '',
        createdAt: typeof album.createdAt === 'string' ? album.createdAt : new Date().toISOString()
      };
      notes.unshift(savedAlbum);
      writeNotes_(notes);
      addNotification_(readNotifications_(), 'album', 'New album: ' + savedAlbum.title, savedAlbum.createdBy, savedAlbum.createdById, {
        type: 'album', id: savedAlbum.id
      });
      return jsonOut_({ ok: true, album: savedAlbum, notes: notes });
    } catch (err) {
      return jsonOut_({ ok: false, error: 'Album creation failed: ' + err.message });
    } finally {
      if (lock.hasLock()) lock.releaseLock();
    }
  }

  if (action === 'renameAlbum') {
    var albumIdToRename = body.albumId;
    var newAlbumTitle = typeof body.title === 'string' ? body.title.trim() : '';
    if (typeof albumIdToRename !== 'string' || !albumIdToRename ||
        !newAlbumTitle || newAlbumTitle.length > 100) {
      return jsonOut_({ ok: false, error: 'A valid album id and name are required' });
    }
    var renameLock = LockService.getScriptLock();
    try {
      renameLock.waitLock(10000);
      var notesToRename = readNotes_();
      var albumToRename = notesToRename.filter(function (item) {
        return item.kind === 'album' && item.id === albumIdToRename;
      })[0];
      if (!albumToRename) {
        return jsonOut_({ ok: false, error: 'Album not found' });
      }
      getAlbumFolder_(albumIdToRename).setName(newAlbumTitle);
      var renamedNotes = notesToRename.map(function (item) {
        return item.id === albumIdToRename
          ? Object.assign({}, item, { title: newAlbumTitle })
          : item;
      });
      writeNotes_(renamedNotes);
      addNotification_(readNotifications_(), 'album', 'Album updated: ' + newAlbumTitle, body.createdBy, body.createdById, {
        type: 'album', id: albumIdToRename
      });
      return jsonOut_({ ok: true, notes: renamedNotes });
    } catch (err) {
      return jsonOut_({ ok: false, error: 'Album rename failed: ' + err.message });
    } finally {
      if (renameLock.hasLock()) renameLock.releaseLock();
    }
  }

  if (action === 'deleteAlbum') {
    var albumIdToDelete = body.albumId;
    if (typeof albumIdToDelete !== 'string' || !albumIdToDelete) {
      return jsonOut_({ ok: false, error: 'albumId is required' });
    }
    var deleteLock = LockService.getScriptLock();
    try {
      deleteLock.waitLock(10000);
      var notesToDelete = readNotes_();
      var albumToDelete = notesToDelete.filter(function (item) {
        return item.kind === 'album' && item.id === albumIdToDelete;
      })[0];
      if (!albumToDelete) {
        return jsonOut_({ ok: false, error: 'Album not found' });
      }
      var albumFolderToDelete = getAlbumFolder_(albumIdToDelete);
      var childFiles = albumFolderToDelete.getFiles();
      var childFileIds = [];
      while (childFiles.hasNext()) childFileIds.push(childFiles.next().getId());
      childFileIds.forEach(function (fileId) { DriveApp.getFileById(fileId).setTrashed(true); });
      albumFolderToDelete.setTrashed(true);
      var remainingNotes = notesToDelete.filter(function (item) {
        return item.id !== albumIdToDelete && item.albumId !== albumIdToDelete;
      });
      writeNotes_(remainingNotes);
      addNotification_(readNotifications_(), 'album', 'Album deleted: ' + albumToDelete.title, body.createdBy, body.createdById, {
        type: 'album', id: albumIdToDelete
      });
      return jsonOut_({ ok: true, notes: remainingNotes });
    } catch (err) {
      return jsonOut_({ ok: false, error: 'Album deletion failed: ' + err.message });
    } finally {
      if (deleteLock.hasLock()) deleteLock.releaseLock();
    }
  }

  if (action === 'updateMemoryReaction') {
    if (typeof body.memoryId !== 'string' || !body.memoryId) {
      return jsonOut_({ ok: false, error: 'memoryId is required' });
    }
    if (!body.reactions || typeof body.reactions !== 'object') {
      return jsonOut_({ ok: false, error: 'reactions object is required' });
    }

    var reactionLock = LockService.getScriptLock();
    try {
      reactionLock.waitLock(10000);
      var notes = readNotes_();
      var reactionUpdatedAt = new Date().toISOString();
      var updatedNotes = notes.map(function (note) {
        return note.id === body.memoryId
          ? Object.assign({}, note, { reactions: body.reactions, updatedAt: reactionUpdatedAt })
          : note;
      });
      writeNotes_(updatedNotes);
      if (body.reactionAdded === true) {
        var reactionPhoto = notes.filter(function (note) { return note.id === body.memoryId; })[0];
        addNotification_(readNotifications_(), 'reaction', body.notificationTitle || 'New reaction on a photo', body.createdBy, body.createdById, {
          type: 'reaction',
          id: body.memoryId,
          albumId: reactionPhoto ? reactionPhoto.albumId : '',
          reactionKey: body.reactionKey
        });
      }
      return jsonOut_({ ok: true, notes: updatedNotes });
    } catch (err) {
      return jsonOut_({ ok: false, error: 'Reaction update failed: ' + err.message });
    } finally {
      if (reactionLock.hasLock()) reactionLock.releaseLock();
    }
  }

  if (action === 'createComment' || action === 'updateComment' || action === 'deleteComment') {
    var memoryId = body.memoryId;
    var commentId = body.commentId;
    var userId = body.userId;
    var authorName = typeof body.authorName === 'string' ? body.authorName.trim() : '';
    var commentText = typeof body.text === 'string' ? body.text.trim() : '';
    if (typeof memoryId !== 'string' || !memoryId ||
        typeof commentId !== 'string' || !commentId ||
        typeof userId !== 'string' || !userId || userId.length > 200) {
      return jsonOut_({ ok: false, error: 'A valid photo, comment, and user are required' });
    }
    if (action !== 'deleteComment' && (!commentText || commentText.length > 1000)) {
      return jsonOut_({ ok: false, error: 'Comments must be between 1 and 1000 characters' });
    }
    if (action === 'createComment' && (!authorName || authorName.length > 100)) {
      return jsonOut_({ ok: false, error: 'A comment author name is required' });
    }

    var commentLock = LockService.getScriptLock();
    try {
      commentLock.waitLock(10000);
      var notesForComment = readNotes_();
      var memoryFound = false;
      var commentFound = false;
      var now = new Date().toISOString();
      var updatedCommentNotes = notesForComment.map(function (note) {
        if (note.id !== memoryId || note.kind === 'album') return note;
        memoryFound = true;
        var comments = Array.isArray(note.comments) ? note.comments.slice() : [];
        var index = comments.findIndex(function (comment) { return comment.id === commentId; });

        if (action === 'createComment') {
          if (index !== -1) throw new Error('Comment already exists');
          comments.push({
            id: commentId,
            text: commentText,
            authorId: userId,
            authorName: authorName,
            createdAt: now,
            updatedAt: now
          });
        } else {
          if (index === -1) return note;
          commentFound = true;
          if (comments[index].authorId !== userId) throw new Error('You can only manage your own comments');
          if (action === 'updateComment') {
            comments[index] = Object.assign({}, comments[index], {
              text: commentText,
              updatedAt: now
            });
          } else {
            comments.splice(index, 1);
          }
        }
        return Object.assign({}, note, { comments: comments });
      });
      if (!memoryFound) {
        return jsonOut_({ ok: false, error: 'Photo not found' });
      }
      if (action !== 'createComment' && !commentFound) {
        return jsonOut_({ ok: false, error: 'Comment not found' });
      }
      writeNotes_(updatedCommentNotes);
      if (action === 'createComment') {
        var commentPhoto = notesForComment.filter(function (note) { return note.id === memoryId; })[0];
        addNotification_(readNotifications_(), 'comment', body.notificationTitle || 'New comment on a photo', authorName, userId, {
          type: 'comment',
          id: memoryId,
          albumId: commentPhoto ? commentPhoto.albumId : '',
          commentId: commentId
        });
      }
      return jsonOut_({ ok: true, notes: updatedCommentNotes });
    } catch (err) {
      return jsonOut_({ ok: false, error: err.message || 'Comment update failed' });
    } finally {
      if (commentLock.hasLock()) commentLock.releaseLock();
    }
  }

  if (action === 'saveEvents') {
    if (!Array.isArray(body.events)) {
      return jsonOut_({ ok: false, error: 'events must be an array' });
    }
    var eventsLock = LockService.getScriptLock();
    try {
      eventsLock.waitLock(10000);
      var previousEvents = readEvents_();
      var previousEventIds = previousEvents.map(function (event) { return event.id; });
      writeEvents_(body.events);
      body.events.forEach(function (event) {
        if (previousEventIds.indexOf(event.id) === -1) {
          addNotification_(readNotifications_(), 'calendar', 'New calendar event: ' + (event.note || 'Event'), event.createdBy, event.createdById, {
            type: 'calendar', id: event.id
          });
        }
      });
      return jsonOut_({ ok: true, events: body.events });
    } catch (err) {
      return jsonOut_({ ok: false, error: 'Calendar save failed: ' + err.message });
    } finally {
      if (eventsLock.hasLock()) eventsLock.releaseLock();
    }
  }

  if (action === 'uploadImage') {
    try {
      var uploaded = uploadImage_(body.filename, body.mimeType, body.data, body.albumId);
      return jsonOut_({ ok: true, fileId: uploaded.fileId, url: uploaded.url });
    } catch (err) {
      return jsonOut_({ ok: false, error: 'Upload failed: ' + err.message });
    }
  }

  if (action === 'deleteImage') {
    try {
      deleteImage_(body.fileId);
      return jsonOut_({ ok: true });
    } catch (err) {
      return jsonOut_({ ok: false, error: 'Delete failed: ' + err.message });
    }
  }

  return jsonOut_({ ok: false, error: 'Unknown action: ' + action });
}
