// Mobile nav toggle
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");

  if (toggle && links) {
    toggle.addEventListener("click", () => {
      links.classList.toggle("open");
      toggle.classList.toggle("active");
    });

    // Close menu when a link is clicked
    links.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        links.classList.remove("open");
        toggle.classList.remove("active");
      });
    });
  }

  // Contact form (client-side demo)
  const form = document.querySelector("#contact-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const success = document.querySelector("#form-success");
      if (success) {
        success.classList.add("show");
        form.reset();
        setTimeout(() => success.classList.remove("show"), 5000);
      }
    });
  }

  // Highlight active nav based on filename
  const path = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a").forEach((a) => {
    const href = a.getAttribute("href");
    if (href === path || (path === "" && href === "index.html")) {
      a.classList.add("active");
    }
  });

  // Dark / light theme toggle
  const themeToggle = document.querySelector(".theme-toggle");
  if (themeToggle) {
    const storage = {
      get(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
      },
      set(key, val) {
        try { localStorage.setItem(key, val); } catch (e) { /* ignore */ }
      }
    };

    const syncLabel = () => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      const label = isDark ? "Switch to light mode" : "Switch to dark mode";
      themeToggle.setAttribute("aria-label", label);
      themeToggle.setAttribute("title", label);
    };

    syncLabel();
    themeToggle.addEventListener("click", () => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      if (isDark) {
        document.documentElement.removeAttribute("data-theme");
        storage.set("theme", "light");
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
        storage.set("theme", "dark");
      }
      syncLabel();
    });
  }

  // ===== To-do app (Projects page) =====
  const todoApp = document.querySelector("#todo-app");
  if (todoApp) {
    const STORAGE_KEY = "shuyang.todo.v1";
    const MIGRATED_KEY = "shuyang.todo.migrated";
    const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    // Supabase PostgREST config (publishable = anon key; writes need RLS policies)
    const SUPABASE_REST = "https://yqhrhkqcoyblqokrxijl.supabase.co/rest/v1";
    const SUPABASE_KEY = "sb_publishable_SqF1EfJ-9K3c1MbEJJx4BQ_rbWuLGRY";
    const REST_HEADERS = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json"
    };

    const grid = todoApp.querySelector("#cal-grid");
    const titleEl = todoApp.querySelector("#cal-title");
    const prevBtn = todoApp.querySelector("#cal-prev");
    const nextBtn = todoApp.querySelector("#cal-next");
    const form = todoApp.querySelector("#todo-form");
    const input = todoApp.querySelector("#todo-input");
    const list = todoApp.querySelector("#todo-list");
    const empty = todoApp.querySelector("#todo-empty");
    const selectedEl = todoApp.querySelector("#todo-selected-date");
    const progressEl = todoApp.querySelector("#todo-progress");
    const weekdaysEl = todoApp.querySelector(".cal-weekdays");
    const emojiRow = todoApp.querySelector("#emoji-row");
    const priRow = todoApp.querySelector("#pri-row");
    const syncEl = todoApp.querySelector("#todo-sync");

    let selectedEmoji = "📝";
    let selectedPriority = "medium";

    // Cloud state: 'loading' → 'online' | 'offline' | 'denied'
    let cloudState = "loading";
    let tasks = [];
    let loaded = false;
    // Discovered real column names once the API has returned a row
    let colMap = null;

    const pad = (n) => String(n).padStart(2, "0");
    const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const fromKey = (k) => {
      const [y, m, d] = k.split("-").map(Number);
      return new Date(y, m - 1, d);
    };

    const now = new Date();
    let selectedKey = keyOf(now);
    let viewYear = now.getFullYear();
    let viewMonth = now.getMonth();

    WEEKDAYS.forEach((w) => {
      const s = document.createElement("span");
      s.textContent = w;
      weekdaysEl.appendChild(s);
    });

    // ---- Local cache (used offline / as a snapshot of cloud data) ----
    function readCache() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter((t) => t && typeof t.text === "string" && typeof t.date === "string")
          .map((t, i) => ({
            id: t.id || `legacy-${i}`,
            text: t.text,
            date: t.date,
            done: !!t.done,
            created: t.created || 0,
            emoji: t.emoji || "📝",
            priority: ["low", "medium", "high"].includes(t.priority) ? t.priority : "medium"
          }));
      } catch (e) {
        return [];
      }
    }

    function saveCache() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
      } catch (e) {
        /* storage unavailable — app still works for this session */
      }
    }

    // ---- Supabase (PostgREST over fetch; no SDK needed) ----
    const SYNC_COPY = {
      loading: "Connecting…",
      online: "Synced with cloud",
      offline: "Cloud unreachable — showing tasks saved on this device",
      denied: "Cloud saving blocked by permissions — change saved on this device"
    };

    function setSync(state, message) {
      cloudState = state;
      syncEl.dataset.state = state;
      syncEl.textContent = message || SYNC_COPY[state] || "";
    }

    // Map a database row (whatever its columns are called) to the app shape
    function normalizeRow(row) {
      const ts = row.created_at ?? row.created ?? row.inserted_at;
      const created = ts ? Date.parse(ts) || 0 : 0;
      let date = row.date;
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        date = keyOf(created ? new Date(created) : new Date());
      }
      return {
        id: String(row.id),
        text: row.text ?? row.task ?? row.title ?? row.name ?? "",
        date,
        done: !!(row.done ?? row.is_complete ?? row.completed ?? false),
        created,
        emoji: typeof row.emoji === "string" && row.emoji ? row.emoji : "📝",
        priority: ["low", "medium", "high"].includes(row.priority) ? row.priority : "medium"
      };
    }

    function learnCols(keys) {
      const pick = (names) => names.find((n) => keys.includes(n)) || null;
      colMap = {
        text: pick(["text", "task", "title", "name"]),
        done: pick(["done", "is_complete", "completed"]),
        date: pick(["date", "due_date"]),
        emoji: pick(["emoji", "icon"]),
        priority: pick(["priority", "level"]),
        createdAt: pick(["created_at", "created", "inserted_at"])
      };
    }

    async function api(path, options) {
      const res = await fetch(SUPABASE_REST + path, options);
      const txt = await res.text();
      let body = null;
      if (txt) {
        try { body = JSON.parse(txt); } catch (e) { body = txt; }
      }
      if (!res.ok) {
        const err = new Error((body && body.message) || res.statusText || "Request failed");
        err.status = res.status;
        err.code = body && body.code; // e.g. PGRST204 / 42703 = unknown column
        throw err;
      }
      return body;
    }

    // Logical field → real column names, in preference order
    const FIELD_ALIASES = {
      text: ["text", "task", "title", "name"],
      done: ["done", "is_complete", "completed"],
      date: ["date", "due_date"],
      emoji: ["emoji", "icon"],
      priority: ["priority", "level"],
      createdAt: ["created_at", "created", "inserted_at"]
    };
    // Fields that must not be silently dropped if no matching column exists
    const REQUIRED_FIELDS = new Set(["text"]);

    function fieldForColumn(col) {
      return Object.keys(FIELD_ALIASES).find((f) => FIELD_ALIASES[f].includes(col)) || null;
    }

    // Extract the missing column name from either PostgREST error wording:
    // PGRST204: "Could not find the 'done' column of 'todos' in the schema cache"
    // 42703:   "column todos.done does not exist"
    function missingColumnName(message) {
      const m = /find the '([A-Za-z0-9_]+)' column|column (?:[A-Za-z0-9_]+\.)?"?([A-Za-z0-9_]+)"? does not exist/.exec(message || "");
      return m ? m[1] || m[2] : null;
    }

    // INSERT/PATCH over logical fields. On "unknown column" errors it remaps the
    // field to its next alias (text→task, done→is_complete …); fields with no
    // alias left are dropped unless required.
    async function writeRow(method, path, logicalPayload) {
      const queues = {};
      const data = {};
      for (const [field, value] of Object.entries(logicalPayload)) {
        let aliases = FIELD_ALIASES[field] ? FIELD_ALIASES[field].slice() : [field];
        if (colMap && colMap[field] && aliases.includes(colMap[field])) {
          aliases = [colMap[field], ...aliases.filter((c) => c !== colMap[field])];
        }
        data[aliases[0]] = value;
        queues[field] = aliases.slice(1);
      }

      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const rows = await api(path, {
            method,
            headers: { ...REST_HEADERS, Prefer: "return=representation" },
            body: JSON.stringify(data)
          });
          if (Array.isArray(rows) && rows[0]) learnCols(Object.keys(rows[0]));
          return Array.isArray(rows) ? rows[0] : null;
        } catch (err) {
          const badCol = (err.status === 400 && (err.code === "PGRST204" || err.code === "42703"))
            ? missingColumnName(err.message)
            : null;
          const field = badCol ? fieldForColumn(badCol) : null;
          if (badCol && field && queues[field].length) {
            delete data[badCol];
            data[queues[field].shift()] = logicalPayload[field];
            continue;
          }
          if (badCol && field && REQUIRED_FIELDS.has(field)) {
            throw new Error("The todos table has no text/task/title column");
          }
          if (badCol && Object.prototype.hasOwnProperty.call(data, badCol)) {
            delete data[badCol]; // optional field (emoji/priority/…)
            continue;
          }
          throw err;
        }
      }
      throw new Error("Could not match the todos table columns");
    }

    function toDbPayload(task) {
      return {
        text: task.text,
        done: task.done,
        date: task.date,
        emoji: task.emoji,
        priority: task.priority,
        createdAt: new Date(task.created || Date.now()).toISOString()
      };
    }

    async function cloudList() {
      const tryOrder = async (orderCol) => {
        const qs = orderCol ? `/todos?select=*&order=${orderCol}.asc` : "/todos?select=*";
        return api(qs, { headers: REST_HEADERS });
      };
      let rows;
      try {
        rows = await tryOrder("created_at");
      } catch (e1) {
        try {
          rows = await tryOrder("created");
        } catch (e2) {
          rows = await tryOrder(null);
        }
      }
      if (rows.length) learnCols(Object.keys(rows[0]));
      return rows.map(normalizeRow);
    }

    async function cloudInsert(task) {
      const row = await writeRow("POST", "/todos", toDbPayload(task));
      return row ? normalizeRow(row) : null;
    }

    async function cloudUpdate(id, patch) {
      const logical = {};
      if (patch.text !== undefined) logical.text = patch.text;
      if (patch.done !== undefined) logical.done = patch.done;
      await writeRow("PATCH", `/todos?id=eq.${encodeURIComponent(id)}`, logical);
    }

    async function cloudDelete(id) {
      await api(`/todos?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: REST_HEADERS });
    }

    // One-time move of any pre-cloud localStorage tasks into an empty table
    async function migrateLocalCache(cloudRows) {
      if (localStorage.getItem(MIGRATED_KEY)) return;
      const cached = readCache();
      if (cached.length && cloudRows.length === 0) {
        for (const t of cached) {
          try {
            const saved = await cloudInsert(t);
            if (saved) tasks.push(saved);
          } catch (e) {
            /* keep local copy if a row can't be inserted */
          }
        }
      }
      try { localStorage.setItem(MIGRATED_KEY, "1"); } catch (e) { /* noop */ }
    }

    async function initCloud() {
      setSync("loading");
      try {
        const cloudRows = await cloudList();
        tasks = cloudRows;
        await migrateLocalCache(cloudRows);
        saveCache();
        setSync("online");
      } catch (err) {
        tasks = readCache();
        setSync(err.status === 401 || err.status === 403 ? "denied" : "offline");
      }
      loaded = true;
      render();
    }

    // Report a failed mutation without pretending it reached the cloud
    function handleCloudError(err) {
      saveCache();
      if (err && (err.status === 401 || err.status === 403)) {
        setSync("denied");
      } else {
        setSync("offline");
      }
    }

    function diffFromToday(key) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = fromKey(key);
      return Math.round((target - today) / 86400000);
    }

    function formatDate(key, prefix) {
      const d = fromKey(key);
      const opts = { weekday: "short", month: "short", day: "numeric" };
      if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
      const base = d.toLocaleDateString(undefined, opts);
      return prefix ? `${prefix} · ${base}` : base;
    }

    function describeSelected(key) {
      const diff = diffFromToday(key);
      if (diff === 0) return formatDate(key, "Today");
      if (diff === 1) return formatDate(key, "Tomorrow");
      if (diff === -1) return formatDate(key, "Yesterday");
      return formatDate(key);
    }

    function groupLabel(key) {
      const diff = diffFromToday(key);
      if (diff === 0) return formatDate(key, "Today");
      if (diff === 1) return formatDate(key, "Tomorrow");
      if (diff === -1) return formatDate(key, "Yesterday");
      return formatDate(key);
    }

    function renderCalendar() {
      titleEl.textContent = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric"
      });
      grid.innerHTML = "";

      const first = new Date(viewYear, viewMonth, 1);
      const start = new Date(viewYear, viewMonth, 1 - first.getDay());
      const todayKey = keyOf(new Date());

      for (let i = 0; i < 42; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const key = keyOf(d);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cal-day";
        btn.dataset.date = key;
        if (d.getMonth() !== viewMonth) btn.classList.add("is-other");
        if (key === todayKey) btn.classList.add("is-today");
        if (key === selectedKey) btn.classList.add("is-selected");

        const num = document.createElement("span");
        num.className = "cal-num";
        num.textContent = d.getDate();
        btn.appendChild(num);

        if (tasks.some((t) => t.date === key)) {
          btn.classList.add("has-tasks");
          const dot = document.createElement("span");
          dot.className = "cal-dot";
          dot.setAttribute("aria-hidden", "true");
          btn.appendChild(dot);
        }

        grid.appendChild(btn);
      }
    }

    function renderList() {
      list.innerHTML = "";
      const sorted = [...tasks].sort((a, b) =>
        a.date === b.date ? a.created - b.created : a.date < b.date ? -1 : 1
      );

      let lastKey = "";
      for (const t of sorted) {
        if (t.date !== lastKey) {
          const head = document.createElement("li");
          head.className = "todo-group-head";
          head.textContent = groupLabel(t.date);
          list.appendChild(head);
          lastKey = t.date;
        }

        const item = document.createElement("li");
        item.className = `todo-item${t.done ? " done" : ""}`;
        item.dataset.id = t.id;

        const main = document.createElement("label");
        main.className = "todo-main";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "todo-check";
        cb.checked = t.done;
        cb.setAttribute("aria-label", t.done ? "Mark task as not done" : "Mark task as done");

        const emoji = document.createElement("span");
        emoji.className = "todo-emoji";
        emoji.textContent = t.emoji;
        emoji.setAttribute("aria-hidden", "true");

        const text = document.createElement("span");
        text.className = "todo-text";
        text.textContent = t.text;
        text.title = "Click to edit";

        const badge = document.createElement("span");
        badge.className = `todo-badge pri-${t.priority}`;
        badge.textContent = t.priority;

        main.appendChild(cb);
        main.appendChild(emoji);
        main.appendChild(text);
        main.appendChild(badge);

        const del = document.createElement("button");
        del.type = "button";
        del.className = "todo-del";
        del.setAttribute("aria-label", "Delete task");
        del.textContent = "✕";

        item.appendChild(main);
        item.appendChild(del);
        list.appendChild(item);
      }

      empty.style.display = tasks.length ? "none" : "block";
      empty.textContent = loaded
        ? "No tasks yet — pick a date and add your first one."
        : "Loading your tasks…";
      selectedEl.textContent = describeSelected(selectedKey);
      updateCounter();
    }

    function updateCounter() {
      const total = tasks.length;
      const done = tasks.filter((t) => t.done).length;
      const noun = total === 1 ? "task" : "tasks";
      progressEl.innerHTML = `<strong>${done}</strong> of <strong>${total}</strong> ${noun} completed`;
      progressEl.classList.toggle("is-all-done", total > 0 && done === total);
    }

    function render() {
      renderCalendar();
      renderList();
    }

    // Select a day (clicking a faded adjacent-month day jumps to that month)
    grid.addEventListener("click", (e) => {
      const cell = e.target.closest(".cal-day");
      if (!cell) return;
      selectedKey = cell.dataset.date;
      const d = fromKey(selectedKey);
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();
      render();
    });

    prevBtn.addEventListener("click", () => {
      const d = new Date(viewYear, viewMonth - 1, 1);
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();
      renderCalendar();
    });

    nextBtn.addEventListener("click", () => {
      const d = new Date(viewYear, viewMonth + 1, 1);
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();
      renderCalendar();
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) {
        input.focus();
        return;
      }
      const temp = {
        id: `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        text,
        date: selectedKey,
        done: false,
        created: Date.now(),
        emoji: selectedEmoji,
        priority: selectedPriority
      };
      tasks.push(temp);
      saveCache();
      render();
      input.value = "";
      // Reset pickers to defaults after adding
      selectedEmoji = "📝";
      selectedPriority = "medium";
      emojiRow.querySelectorAll(".emoji-btn").forEach((b) =>
        b.classList.toggle("is-active", b.dataset.emoji === selectedEmoji)
      );
      priRow.querySelectorAll(".pri-btn").forEach((b) =>
        b.classList.toggle("is-active", b.dataset.priority === selectedPriority)
      );
      input.focus();

      if (cloudState === "online") {
        cloudInsert(temp)
          .then((saved) => {
            if (saved) {
              const i = tasks.findIndex((t) => t.id === temp.id);
              if (i >= 0) tasks[i] = saved;
            }
            saveCache();
            render();
          })
          .catch(handleCloudError);
      }
    });

    // Emoji picker
    emojiRow.addEventListener("click", (e) => {
      const btn = e.target.closest(".emoji-btn");
      if (!btn) return;
      selectedEmoji = btn.dataset.emoji;
      emojiRow.querySelectorAll(".emoji-btn").forEach((b) =>
        b.classList.toggle("is-active", b === btn)
      );
    });

    // Priority picker
    priRow.addEventListener("click", (e) => {
      const btn = e.target.closest(".pri-btn");
      if (!btn) return;
      selectedPriority = btn.dataset.priority;
      priRow.querySelectorAll(".pri-btn").forEach((b) =>
        b.classList.toggle("is-active", b === btn)
      );
    });

    list.addEventListener("change", (e) => {
      if (!e.target.classList.contains("todo-check")) return;
      const item = e.target.closest(".todo-item");
      const task = tasks.find((t) => t.id === item.dataset.id);
      if (!task) return;
      const previous = task.done;
      task.done = e.target.checked;
      item.classList.toggle("done", task.done);
      saveCache();
      updateCounter();

      if (cloudState === "online" && !task.id.startsWith("local-")) {
        cloudUpdate(task.id, { done: task.done }).catch((err) => {
          task.done = previous; // roll back if the database rejected it
          saveCache();
          handleCloudError(err);
          render();
        });
      }
    });

    // Inline edit: click task text → input, Enter/blur saves, Escape cancels
    function startEdit(textEl) {
      const item = textEl.closest(".todo-item");
      const task = tasks.find((t) => t.id === item.dataset.id);
      if (!task) return;

      const edit = document.createElement("input");
      edit.type = "text";
      edit.className = "todo-edit-input";
      edit.maxLength = 140;
      edit.value = task.text;
      edit.setAttribute("aria-label", "Edit task");
      textEl.replaceWith(edit);
      edit.focus();
      edit.select();

      let finished = false;
      const finish = (save) => {
        if (finished) return;
        finished = true;
        const val = edit.value.trim();
        if (save && val && val !== task.text) {
          const previous = task.text;
          task.text = val;
          saveCache();
          render();
          if (cloudState === "online" && !task.id.startsWith("local-")) {
            cloudUpdate(task.id, { text: val }).catch((err) => {
              task.text = previous; // roll back if the database rejected it
              saveCache();
              handleCloudError(err);
              render();
            });
          }
        } else {
          render();
        }
      };

      edit.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          finish(true);
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          finish(false);
        }
      });
      edit.addEventListener("blur", () => finish(true));
    }

    list.addEventListener("click", (e) => {
      const textEl = e.target.closest(".todo-text");
      if (textEl && list.contains(textEl)) {
        // Prevent the wrapping <label> from toggling the checkbox
        e.preventDefault();
        startEdit(textEl);
      }
    });

    list.addEventListener("click", (e) => {
      if (!e.target.classList.contains("todo-del")) return;
      const item = e.target.closest(".todo-item");
      const victim = tasks.find((t) => t.id === item.dataset.id);
      tasks = tasks.filter((t) => t.id !== item.dataset.id);
      saveCache();
      render();

      if (victim && cloudState === "online" && !victim.id.startsWith("local-")) {
        cloudDelete(victim.id).catch((err) => {
          tasks.push(victim); // restore if the database delete failed
          saveCache();
          handleCloudError(err);
          render();
        });
      }
    });

    initCloud();
  }
});
