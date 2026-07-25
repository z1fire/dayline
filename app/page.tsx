"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";

type Category = "focus" | "health" | "admin" | "personal" | "rest";

type Activity = {
  id: string;
  date: string;
  title: string;
  start: string;
  end: string;
  category: Category;
  note: string;
  completed: boolean;
};

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DAY_START = 6 * 60;
const DAY_END = 23 * 60;
const HOUR_HEIGHT = 72;
const categories: { id: Category; label: string; symbol: string }[] = [
  { id: "focus", label: "Focus", symbol: "✦" },
  { id: "health", label: "Health", symbol: "●" },
  { id: "admin", label: "Admin", symbol: "□" },
  { id: "personal", label: "Personal", symbol: "◆" },
  { id: "rest", label: "Rest", symbol: "☾" },
];

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function shiftDate(key: string, amount: number) {
  const next = fromDateKey(key);
  next.setDate(next.getDate() + amount);
  return toDateKey(next);
}

function minutes(time: string) {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
}

function minuteTime(value: number) {
  const safe = Math.min(23 * 60 + 59, Math.max(0, value));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(
    safe % 60,
  ).padStart(2, "0")}`;
}

function friendlyTime(time: string) {
  const total = minutes(time);
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatDuration(total: number) {
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins}m`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function dayHeading(key: string) {
  return fromDateKey(key).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dayline-planner", 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.createObjectStore("activities", { keyPath: "id" });
      store.createIndex("date", "date", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readActivities(date: string) {
  const database = await openDatabase();
  return new Promise<Activity[]>((resolve, reject) => {
    const request = database
      .transaction("activities", "readonly")
      .objectStore("activities")
      .index("date")
      .getAll(date);
    request.onsuccess = () =>
      resolve(
        (request.result as Activity[]).sort(
          (a, b) => minutes(a.start) - minutes(b.start),
        ),
      );
    request.onerror = () => reject(request.error);
  });
}

async function writeActivity(activity: Activity) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = database
      .transaction("activities", "readwrite")
      .objectStore("activities")
      .put(activity);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function removeActivity(id: string) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = database
      .transaction("activities", "readwrite")
      .objectStore("activities")
      .delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function starterActivities(date: string): Activity[] {
  return [
    {
      id: crypto.randomUUID(),
      date,
      title: "Morning reset",
      start: "07:00",
      end: "07:45",
      category: "health",
      note: "Water, stretch, and breakfast",
      completed: true,
    },
    {
      id: crypto.randomUUID(),
      date,
      title: "Deep work",
      start: "09:00",
      end: "11:00",
      category: "focus",
      note: "One important thing. Phone away.",
      completed: false,
    },
    {
      id: crypto.randomUUID(),
      date,
      title: "Lunch + walk",
      start: "12:30",
      end: "13:30",
      category: "rest",
      note: "",
      completed: false,
    },
    {
      id: crypto.randomUUID(),
      date,
      title: "Life admin",
      start: "16:00",
      end: "17:00",
      category: "admin",
      note: "Messages and small tasks",
      completed: false,
    },
  ];
}

export default function Home() {
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [category, setCategory] = useState<Category>("focus");
  const [note, setNote] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [installPrompt, setInstallPrompt] =
    useState<InstallPromptEvent | null>(null);

  async function refresh(date = selectedDate) {
    try {
      const items = await readActivities(date);
      setActivities(items);
      setStorageError(false);
    } catch {
      setStorageError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        let items = await readActivities(selectedDate);
        const today = toDateKey(new Date());
        const seeded = localStorage.getItem("dayline-seeded");
        if (!seeded && selectedDate === today && items.length === 0) {
          const starters = starterActivities(today);
          await Promise.all(starters.map(writeActivity));
          localStorage.setItem("dayline-seeded", "true");
          items = starters;
        }
        if (active) {
          setActivities(items);
          setStorageError(false);
        }
      } catch {
        if (active) setStorageError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedDate]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    const base = new URL("./", document.baseURI);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(new URL("sw.js", base).pathname, {
        scope: base.pathname,
      });
    }
    const handleInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleInstall);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("beforeinstallprompt", handleInstall);
    };
  }, []);

  useEffect(() => {
    if (!sheetOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sheetOpen]);

  const plannedMinutes = useMemo(
    () =>
      activities.reduce(
        (total, item) => total + minutes(item.end) - minutes(item.start),
        0,
      ),
    [activities],
  );
  const completedMinutes = useMemo(
    () =>
      activities
        .filter((item) => item.completed)
        .reduce(
          (total, item) => total + minutes(item.end) - minutes(item.start),
          0,
        ),
    [activities],
  );
  const completion = plannedMinutes
    ? Math.round((completedMinutes / plannedMinutes) * 100)
    : 0;
  const isToday = selectedDate === toDateKey(new Date());
  const hasConflict =
    minutes(start) < minutes(end) &&
    activities.some(
      (item) =>
        item.id !== editingId &&
        minutes(start) < minutes(item.end) &&
        minutes(end) > minutes(item.start),
    );
  const isWithinDay =
    minutes(start) >= DAY_START && minutes(end) <= DAY_END;
  const isValid =
    title.trim() &&
    minutes(start) < minutes(end) &&
    isWithinDay &&
    !hasConflict;

  function openCreate(startMinute = 9 * 60) {
    const rounded = Math.round(startMinute / 15) * 15;
    const safeStart = Math.min(DAY_END - 30, Math.max(DAY_START, rounded));
    setEditingId(null);
    setTitle("");
    setStart(minuteTime(safeStart));
    setEnd(minuteTime(Math.min(DAY_END, safeStart + 60)));
    setCategory("focus");
    setNote("");
    setSheetOpen(true);
  }

  function openEdit(activity: Activity) {
    setEditingId(activity.id);
    setTitle(activity.title);
    setStart(activity.start);
    setEnd(activity.end);
    setCategory(activity.category);
    setNote(activity.note);
    setSheetOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!isValid) return;
    const previous = activities.find((item) => item.id === editingId);
    const activity: Activity = {
      id: editingId ?? crypto.randomUUID(),
      date: selectedDate,
      title: title.trim(),
      start,
      end,
      category,
      note: note.trim(),
      completed: previous?.completed ?? false,
    };
    try {
      await writeActivity(activity);
      await refresh();
      setSheetOpen(false);
    } catch {
      setStorageError(true);
    }
  }

  async function deleteCurrent() {
    if (!editingId) return;
    try {
      await removeActivity(editingId);
      await refresh();
      setSheetOpen(false);
    } catch {
      setStorageError(true);
    }
  }

  async function toggleCompleted(activity: Activity) {
    try {
      await writeActivity({ ...activity, completed: !activity.completed });
      await refresh();
    } catch {
      setStorageError(true);
    }
  }

  function chooseTimelineTime(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".activity-block")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    openCreate(DAY_START + (offset / HOUR_HEIGHT) * 60);
  }

  function keyboardOpen(event: KeyboardEvent<HTMLDivElement>, item: Activity) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openEdit(item);
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  const timelineHours = Array.from(
    { length: (DAY_END - DAY_START) / 60 + 1 },
    (_, index) => DAY_START / 60 + index,
  );
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNow =
    isToday && nowMinutes >= DAY_START && nowMinutes <= DAY_END;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Dayline">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Dayline</span>
        </div>
        <div className="header-actions">
          {installPrompt && (
            <button className="install-button" type="button" onClick={installApp}>
              Install app
            </button>
          )}
          <span className="avatar" aria-hidden="true">
            D
          </span>
        </div>
      </header>

      <section className="day-overview" aria-labelledby="day-heading">
        <div className="date-row">
          <button
            className="date-arrow"
            type="button"
            aria-label="Previous day"
            onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
          >
            ←
          </button>
          <label className="date-picker">
            <span className="eyebrow">{isToday ? "Today" : "Your day"}</span>
            <span id="day-heading">{dayHeading(selectedDate)}</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => event.target.value && setSelectedDate(event.target.value)}
              aria-label="Choose date"
            />
          </label>
          <button
            className="date-arrow"
            type="button"
            aria-label="Next day"
            onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
          >
            →
          </button>
        </div>

        <div className="plan-summary">
          <div
            className="progress-ring"
            style={{ "--progress": `${completion * 3.6}deg` } as React.CSSProperties}
            aria-label={`${completion}% of planned time complete`}
          >
            <span>{completion}%</span>
          </div>
          <div>
            <strong>{formatDuration(plannedMinutes)} planned</strong>
            <p>
              {activities.length
                ? `${activities.length} ${activities.length === 1 ? "block" : "blocks"} · ${formatDuration(
                    Math.max(0, DAY_END - DAY_START - plannedMinutes),
                  )} open`
                : "A clear day, ready to shape"}
            </p>
          </div>
          {!isToday && (
            <button
              className="today-button"
              type="button"
              onClick={() => setSelectedDate(toDateKey(new Date()))}
            >
              Today
            </button>
          )}
        </div>
      </section>

      {storageError && (
        <div className="notice" role="status">
          Dayline could not access offline storage. Your changes may not persist.
        </div>
      )}

      <section className="schedule-section" aria-label="Daily schedule">
        <div className="schedule-heading">
          <div>
            <span className="eyebrow">Schedule</span>
            <h1>Make room for what matters.</h1>
          </div>
          <button className="add-text-button" type="button" onClick={() => openCreate()}>
            <span aria-hidden="true">＋</span> Add block
          </button>
        </div>

        <div
          className={`timeline ${loading ? "is-loading" : ""}`}
          style={{ height: `${(DAY_END - DAY_START) / 60 * HOUR_HEIGHT}px` }}
          onDoubleClick={chooseTimelineTime}
        >
          {timelineHours.map((hour) => (
            <div
              className="hour-line"
              style={{ top: `${(hour - DAY_START / 60) * HOUR_HEIGHT}px` }}
              key={hour}
            >
              <span>{friendlyTime(`${String(hour).padStart(2, "0")}:00`).replace(":00", "")}</span>
            </div>
          ))}

          {showNow && (
            <div
              className="now-line"
              style={{ top: `${((nowMinutes - DAY_START) / 60) * HOUR_HEIGHT}px` }}
            >
              <span>now</span>
            </div>
          )}

          {!loading &&
            activities.map((item) => {
              const top = ((minutes(item.start) - DAY_START) / 60) * HOUR_HEIGHT;
              const height =
                ((minutes(item.end) - minutes(item.start)) / 60) * HOUR_HEIGHT;
              return (
                <div
                  className={`activity-block category-${item.category} ${
                    item.completed ? "is-complete" : ""
                  }`}
                  style={{
                    top: `${top}px`,
                    height: `${Math.max(48, height - 6)}px`,
                  }}
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openEdit(item)}
                  onKeyDown={(event) => keyboardOpen(event, item)}
                  aria-label={`Edit ${item.title}, ${friendlyTime(item.start)} to ${friendlyTime(item.end)}`}
                >
                  <button
                    className="complete-button"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleCompleted(item);
                    }}
                    aria-label={item.completed ? `Mark ${item.title} incomplete` : `Complete ${item.title}`}
                  >
                    {item.completed ? "✓" : ""}
                  </button>
                  <div className="activity-copy">
                    <strong>{item.title}</strong>
                    {height > 62 && item.note && <small>{item.note}</small>}
                  </div>
                  <span className="activity-time">
                    {friendlyTime(item.start).replace(" ", "")}
                    <b>—</b>
                    {friendlyTime(item.end).replace(" ", "")}
                  </span>
                </div>
              );
            })}

          {!loading && activities.length === 0 && (
            <button className="empty-day" type="button" onClick={() => openCreate()}>
              <span>＋</span>
              <strong>Plan your first block</strong>
              <small>Tap here to give this day some shape.</small>
            </button>
          )}
        </div>
      </section>

      <button
        className="floating-add"
        type="button"
        onClick={() => openCreate()}
        aria-label="Add activity block"
      >
        ＋
      </button>

      {sheetOpen && (
        <div className="sheet-backdrop" onMouseDown={() => setSheetOpen(false)}>
          <section
            className="activity-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="sheet-handle" />
            <div className="sheet-header">
              <div>
                <span className="eyebrow">{editingId ? "Edit block" : "New block"}</span>
                <h2 id="sheet-title">
                  {editingId ? "Adjust your plan" : "What are you making time for?"}
                </h2>
              </div>
              <button
                className="close-button"
                type="button"
                aria-label="Close"
                onClick={() => setSheetOpen(false)}
              >
                ×
              </button>
            </div>

            <form onSubmit={save}>
              <label className="field">
                <span>Activity</span>
                <input
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Read, train, deep work"
                  maxLength={80}
                />
              </label>

              <div className="time-fields">
                <label className="field">
                  <span>Starts</span>
                  <input
                    type="time"
                    value={start}
                    min="06:00"
                    max="22:30"
                    step={900}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </label>
                <span className="time-connector">→</span>
                <label className="field">
                  <span>Ends</span>
                  <input
                    type="time"
                    value={end}
                    min="06:30"
                    max="23:00"
                    step={900}
                    onChange={(event) => setEnd(event.target.value)}
                  />
                </label>
              </div>

              <fieldset className="category-field">
                <legend>Color</legend>
                <div className="category-options">
                  {categories.map((option) => (
                    <label
                      className={`category-choice category-${option.id} ${
                        category === option.id ? "is-selected" : ""
                      }`}
                      key={option.id}
                    >
                      <input
                        type="radio"
                        name="category"
                        value={option.id}
                        checked={category === option.id}
                        onChange={() => setCategory(option.id)}
                      />
                      <span aria-hidden="true">{option.symbol}</span>
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="field">
                <span>Note <em>optional</em></span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="A cue, intention, or small detail"
                  rows={2}
                  maxLength={160}
                />
              </label>

              {minutes(start) >= minutes(end) && (
                <p className="form-warning">The end time needs to be after the start.</p>
              )}
              {!isWithinDay && (
                <p className="form-warning">
                  Dayline schedules blocks between 6:00 AM and 11:00 PM.
                </p>
              )}
              {hasConflict && (
                <p className="form-warning">
                  This overlaps another block. Choose an open time to continue.
                </p>
              )}

              <div className="form-actions">
                {editingId && (
                  <button className="delete-button" type="button" onClick={deleteCurrent}>
                    Delete
                  </button>
                )}
                <button className="save-button" type="submit" disabled={!isValid}>
                  {editingId ? "Save changes" : "Add to day"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
