/* ===========================================================
   巡查簽到系統 — 共用資料層
   本機儲存 / Google 試算表 / 離線暫存補送 / 重複簽到判斷 / 班別
   =========================================================== */
(function (global) {
  "use strict";

  var CFG = global.CHECKIN_CONFIG || {};
  var LS_RECORDS = "qc_records_v1";
  var LS_QUEUE   = "qc_queue_v1";
  var LS_NAME    = "qc_lastname_v1";

  /* ---------------- 小工具 ---------------- */
  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function fmtDate(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function fmtTime(d) {
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  function fmtStamp(d) { return fmtDate(d) + " " + fmtTime(d); }

  function uid() {
    return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  /* ---------------- 巡查點 ---------------- */
  function getPoints() { return (CFG.points || []).slice(); }

  function getPoint(code) {
    var pts = getPoints();
    for (var i = 0; i < pts.length; i++) {
      if (String(pts[i].code).toUpperCase() === String(code || "").toUpperCase()) return pts[i];
    }
    return null;
  }

  function pointName(code) {
    var p = getPoint(code);
    return p ? p.name : (code || "未指定");
  }

  /* ---------------- 班別 ---------------- */
  var SHIFT = CFG.shift || {};
  var DAY_START   = Number(SHIFT.dayStart   != null ? SHIFT.dayStart   : 8);
  var NIGHT_START = Number(SHIFT.nightStart != null ? SHIFT.nightStart : 20);
  var DAY_LABEL   = SHIFT.dayLabel   || "早班";
  var NIGHT_LABEL = SHIFT.nightLabel || "晚班";

  function shiftLabels() { return [DAY_LABEL, NIGHT_LABEL]; }

  /* 依「小時」判斷班別：dayStart <= h < nightStart → 早班，其餘晚班 */
  function shiftForHour(h) {
    h = Number(h);
    if (isNaN(h)) h = 0;
    if (DAY_START <= NIGHT_START) {
      return (h >= DAY_START && h < NIGHT_START) ? DAY_LABEL : NIGHT_LABEL;
    }
    // 跨午夜設定（例如 dayStart 20、nightStart 8）
    return (h >= DAY_START || h < NIGHT_START) ? DAY_LABEL : NIGHT_LABEL;
  }

  function shiftForDate(d) {
    return shiftForHour((d || new Date()).getHours());
  }

  /* 某班別在指定日期是否「已經開始」。
     早班：當天 dayStart 之後
     晚班：當天 nightStart 之後
     若 nightStart < dayStart（跨午夜），晚班視為當天 00:00 起就開始。 */
  function shiftStarted(shiftLabel, dateStr, now) {
    now = now || new Date();
    var today = fmtDate(now);
    if (dateStr && dateStr !== today) {
      // 過去的日期 → 一定已開始；未來日期 → 尚未開始
      return dateStr < today;
    }
    var h = now.getHours() + now.getMinutes() / 60;
    if (shiftLabel === DAY_LABEL) return h >= DAY_START;
    if (shiftLabel === NIGHT_LABEL) {
      if (NIGHT_START < DAY_START) return true; // 跨午夜，當天一開始就算
      return h >= NIGHT_START;
    }
    return true;
  }

  /* 目前「應該在進行中」的班別（用於警示頁預設篩選） */
  function currentShift(now) {
    return shiftForDate(now || new Date());
  }

  /* ---------------- 記錄 ---------------- */
  function getRecords() {
    var arr = readJSON(LS_RECORDS, []);
    if (!Array.isArray(arr)) return [];
    return arr;
  }

  function saveRecords(arr) { return writeJSON(LS_RECORDS, arr); }

  function addRecord(rec) {
    var arr = getRecords();
    arr.push(rec);
    saveRecords(arr);
    return rec;
  }

  function replaceRecords(arr) { return saveRecords(arr); }

  /* 同一人 + 同一巡查點 + 同一天 + 同一班別 是否已簽到
     shift 省略時 → 只比對人/點/日期（舊行為，向下相容） */
  function findDuplicate(name, pointCode, dateStr, shift) {
    var arr = getRecords();
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      if (r.name !== name) continue;
      if (r.point !== pointCode) continue;
      if (r.date !== dateStr) continue;
      if (shift != null && shift !== "") {
        if ((r.shift || "") !== shift) continue;
      }
      return r;
    }
    return null;
  }

  /* ---------------- 離線佇列 ---------------- */
  function getQueue() {
    var q = readJSON(LS_QUEUE, []);
    return Array.isArray(q) ? q : [];
  }
  function saveQueue(q) { return writeJSON(LS_QUEUE, q); }

  function enqueue(rec) {
    var q = getQueue();
    q.push(rec);
    saveQueue(q);
    return q.length;
  }

  function queueSize() { return getQueue().length; }

  /* ---------------- 送出 ---------------- */
  function deviceInfo() {
    var ua = navigator.userAgent || "";
    var os = "其他";
    if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
    else if (/Android/i.test(ua)) os = "Android";
    else if (/Windows/i.test(ua)) os = "Windows";
    else if (/Mac OS X/i.test(ua)) os = "macOS";
    var br = "其他";
    if (/Edg\//.test(ua)) br = "Edge";
    else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) br = "Chrome";
    else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) br = "Safari";
    else if (/Firefox\//.test(ua)) br = "Firefox";
    return os + " / " + br;
  }

  function sheetUrl() {
    var u = (CFG.appsScriptUrl || "").trim();
    return u;
  }

  function useSheet() {
    return String(CFG.storageMode || "local").toLowerCase() === "sheet" && !!sheetUrl();
  }

  /* 送一筆到 Apps Script。成功回 true。
     用 text/plain 避免 CORS preflight（Apps Script 不支援 OPTIONS）。 */
  function postToSheet(rec) {
    var url = sheetUrl();
    if (!url) return Promise.resolve(false);
    var payload = {
      id: rec.id,
      ts: rec.ts,
      date: rec.date,
      time: rec.time,
      point: rec.point,
      pointName: rec.pointName,
      shift: rec.shift || "",
      name: rec.name,
      remark: rec.remark || "",
      device: rec.device || ""
    };
    return fetch(url, {
      method: "POST",
      mode: "cors",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) return false;
      return res.text().then(function (t) {
        try {
          var j = JSON.parse(t);
          return j && (j.ok === true || j.result === "ok");
        } catch (e) {
          return /ok/i.test(t);
        }
      });
    }).catch(function () { return false; });
  }

  /* 補送佇列。回傳 {sent, left} */
  function flushQueue() {
    var q = getQueue();
    if (!q.length) return Promise.resolve({ sent: 0, left: 0 });
    if (!useSheet()) return Promise.resolve({ sent: 0, left: q.length });
    if (!navigator.onLine) return Promise.resolve({ sent: 0, left: q.length });

    var sent = 0;
    var chain = Promise.resolve();
    q.forEach(function (rec) {
      chain = chain.then(function () {
        return postToSheet(rec).then(function (ok) {
          if (ok) {
            sent++;
            var cur = getQueue().filter(function (x) { return x.id !== rec.id; });
            saveQueue(cur);
            // 標記本機記錄為已同步
            var arr = getRecords();
            for (var i = 0; i < arr.length; i++) {
              if (arr[i].id === rec.id) { arr[i].synced = true; break; }
            }
            saveRecords(arr);
          }
        });
      });
    });
    return chain.then(function () {
      return { sent: sent, left: getQueue().length };
    });
  }

  /* 主要送出流程：
     1. 寫本機記錄（一定寫，當作本機備份）
     2. 若用 sheet 且連線正常 → 直接送；失敗 → 進佇列
     3. 若用 local → 直接完成
     回傳 Promise<{ok, queued, error}> */
  function submit(rec) {
    addRecord(rec);

    if (!useSheet()) {
      return Promise.resolve({ ok: true, queued: false, mode: "local" });
    }
    if (!navigator.onLine) {
      enqueue(rec);
      return Promise.resolve({ ok: true, queued: true, mode: "sheet", reason: "offline" });
    }
    return postToSheet(rec).then(function (ok) {
      if (ok) {
        var arr = getRecords();
        for (var i = 0; i < arr.length; i++) {
          if (arr[i].id === rec.id) { arr[i].synced = true; break; }
        }
        saveRecords(arr);
        return { ok: true, queued: false, mode: "sheet" };
      }
      enqueue(rec);
      return { ok: true, queued: true, mode: "sheet", reason: "failed" };
    });
  }

  /* ---------------- 姓名記憶 ---------------- */
  function getLastName() {
    try { return localStorage.getItem(LS_NAME) || ""; } catch (e) { return ""; }
  }
  function setLastName(n) {
    try { localStorage.setItem(LS_NAME, n || ""); } catch (e) {}
  }

  /* ---------------- CSV ---------------- */
  function csvEscape(v) {
    var s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(rows) {
    var head = ["時間", "日期", "時刻", "巡查點代碼", "巡查點", "班別", "姓名", "備註", "裝置", "同步"];
    var lines = [head.map(csvEscape).join(",")];
    rows.forEach(function (r) {
      lines.push([
        r.ts, r.date, r.time, r.point, r.pointName || pointName(r.point),
        r.shift || "", r.name, r.remark || "", r.device || "",
        r.synced ? "已同步" : (useSheet() ? "待補送" : "本機")
      ].map(csvEscape).join(","));
    });
    return lines.join("\r\n");
  }

  function downloadCSV(filename, rows) {
    var csv = "\uFEFF" + toCSV(rows); // BOM 讓 Excel 正確辨識 UTF-8
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 400);
  }

  /* ---------------- 今日進度（依班別） ---------------- */
  function todayProgress(dateStr, shift) {
    var arr = getRecords().filter(function (r) {
      if (r.date !== dateStr) return false;
      if (shift && (r.shift || "") !== shift) return false;
      return true;
    });
    var pts = getPoints();
    var byName = {};
    arr.forEach(function (r) {
      if (!byName[r.name]) byName[r.name] = {};
      byName[r.name][r.point] = true;
    });
    var out = [];
    Object.keys(byName).forEach(function (nm) {
      var done = pts.filter(function (p) { return byName[nm][p.code]; }).length;
      out.push({ name: nm, done: done, total: pts.length, points: byName[nm] });
    });
    out.sort(function (a, b) {
      if (b.done !== a.done) return b.done - a.done;
      return a.name.localeCompare(b.name, "zh-Hant");
    });
    return out;
  }

  /* ---------------- 警示頁：每人 × 每點 × 每班別 矩陣 ----------------
     回傳 {
       date, shifts:[{label, started, rows:[{name, cells:{P1:{done,time}|null}, done, total}], done, total}],
       totals:{expected, done, missing, rate}
     }
     opts: { date, shiftFilter, members, countNotStarted } */
  function buildMatrix(opts) {
    opts = opts || {};
    var dateStr = opts.date || fmtDate(new Date());
    var pts = getPoints();
    var members = (opts.members && opts.members.length ? opts.members : (CFG.members || [])).slice();
    var countNotStarted = opts.countNotStarted != null
      ? !!opts.countNotStarted
      : !!(CFG.alert && CFG.alert.countNotStarted);

    var recs = getRecords().filter(function (r) { return r.date === dateStr; });

    // 記錄中出現但不在名單的人也要列出來
    recs.forEach(function (r) {
      if (members.indexOf(r.name) < 0) members.push(r.name);
    });

    var labels = shiftLabels();
    if (opts.shiftFilter && opts.shiftFilter !== "all") {
      labels = labels.filter(function (l) { return l === opts.shiftFilter; });
    }

    var now = new Date();
    var shifts = [];
    var totalExpected = 0, totalDone = 0, totalMissing = 0;

    labels.forEach(function (label) {
      var started = shiftStarted(label, dateStr, now);
      var rows = [];
      var sDone = 0, sExpected = 0, sMissing = 0;

      members.forEach(function (nm) {
        var cells = {};
        var done = 0;
        pts.forEach(function (p) {
          var hit = null;
          for (var i = 0; i < recs.length; i++) {
            var r = recs[i];
            if (r.name === nm && r.point === p.code && (r.shift || "") === label) { hit = r; break; }
          }
          if (hit) { cells[p.code] = { done: true, time: hit.time, remark: hit.remark || "" }; done++; }
          else { cells[p.code] = { done: false }; }
        });
        var counted = started || countNotStarted;
        if (counted) {
          sExpected += pts.length;
          sDone += done;
          sMissing += (pts.length - done);
        }
        rows.push({ name: nm, cells: cells, done: done, total: pts.length, started: started });
      });

      totalExpected += sExpected;
      totalDone += sDone;
      totalMissing += sMissing;

      shifts.push({
        label: label, started: started, rows: rows,
        done: sDone, expected: sExpected, missing: sMissing
      });
    });

    var rate = totalExpected ? Math.round(totalDone / totalExpected * 100) : 0;

    return {
      date: dateStr,
      points: pts,
      shifts: shifts,
      totals: {
        expected: totalExpected,
        done: totalDone,
        missing: totalMissing,
        rate: rate
      }
    };
  }

  /* 未完成清單（逐條） */
  function buildMissingList(matrix) {
    var out = [];
    matrix.shifts.forEach(function (s) {
      if (!s.started) return;
      s.rows.forEach(function (row) {
        matrix.points.forEach(function (p) {
          var c = row.cells[p.code];
          if (!c || !c.done) {
            out.push({ name: row.name, shift: s.label, point: p.code, pointName: p.name });
          }
        });
      });
    });
    return out;
  }

  /* ---------------- 匯出 ---------------- */
  global.QC = {
    pad: pad,
    fmtDate: fmtDate,
    fmtTime: fmtTime,
    fmtStamp: fmtStamp,
    uid: uid,
    getPoints: getPoints,
    getPoint: getPoint,
    pointName: pointName,
    shiftLabels: shiftLabels,
    shiftForHour: shiftForHour,
    shiftForDate: shiftForDate,
    shiftStarted: shiftStarted,
    currentShift: currentShift,
    getRecords: getRecords,
    saveRecords: saveRecords,
    addRecord: addRecord,
    replaceRecords: replaceRecords,
    findDuplicate: findDuplicate,
    getQueue: getQueue,
    saveQueue: saveQueue,
    enqueue: enqueue,
    queueSize: queueSize,
    deviceInfo: deviceInfo,
    useSheet: useSheet,
    sheetUrl: sheetUrl,
    postToSheet: postToSheet,
    flushQueue: flushQueue,
    submit: submit,
    getLastName: getLastName,
    setLastName: setLastName,
    toCSV: toCSV,
    downloadCSV: downloadCSV,
    todayProgress: todayProgress,
    buildMatrix: buildMatrix,
    buildMissingList: buildMissingList,
    config: CFG
  };
})(window);
