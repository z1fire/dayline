"use client";

import {
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Category = "focus" | "health" | "admin" | "personal" | "rest";
type RepeatRule =
  | "none"
  | "daily"
  | "weekdays"
  | "weekly"
  | "custom"
  | "interval";

type Activity = {
  id: string;
  date: string;
  title: string;
  start: string;
  end: string;
  category: Category;
  note: string;
  completed: boolean;
  repeat?: RepeatRule;
  repeatDays?: number[];
  repeatInterval?: number;
  seriesId?: string;
  seriesStartDate?: string;
  isException?: boolean;
  deleted?: boolean;
};

type TemplateBlock = Pick<
  Activity,
  "title" | "start" | "end" | "category" | "note"
>;

type DayTemplate = {
  id: string;
  name: string;
  blocks: TemplateBlock[];
  createdAt: string;
};

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DEFAULT_DAY_START = 6 * 60;
const DAY_END = 23 * 60;
const HOUR_HEIGHT = 72;
const categories: { id: Category; label: string; symbol: string }[] = [
  { id: "focus", label: "Focus", symbol: "✦" },
  { id: "health", label: "Health", symbol: "●" },
  { id: "admin", label: "Admin", symbol: "□" },
  { id: "personal", label: "Personal", symbol: "◆" },
  { id: "rest", label: "Rest", symbol: "☾" },
];
const repeatDayOptions = [
  { value: 1, label: "Mon", longLabel: "Monday" },
  { value: 2, label: "Tue", longLabel: "Tuesday" },
  { value: 3, label: "Wed", longLabel: "Wednesday" },
  { value: 4, label: "Thu", longLabel: "Thursday" },
  { value: 5, label: "Fri", longLabel: "Friday" },
  { value: 6, label: "Sat", longLabel: "Saturday" },
  { value: 0, label: "Sun", longLabel: "Sunday" },
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

function repeatLabel(
  rule: RepeatRule | undefined,
  repeatDays: number[] = [],
  repeatInterval = 1,
) {
  if (rule === "daily") return "Every day";
  if (rule === "weekdays") return "Weekdays";
  if (rule === "weekly") return "Every week";
  if (rule === "custom") {
    const labels = repeatDayOptions
      .filter((day) => repeatDays.includes(day.value))
      .map((day) => day.label);
    return labels.length ? labels.join(", ") : "Selected days";
  }
  if (rule === "interval") {
    return `Every ${Math.max(2, repeatInterval)} days`;
  }
  return "Does not repeat";
}

function recurrenceMatches(activity: Activity, targetDate: string) {
  const startDate = activity.date;
  const rule = activity.repeat ?? "none";
  if (targetDate < startDate || rule === "none") return false;
  const target = fromDateKey(targetDate);
  if (rule === "daily") return true;
  if (rule === "weekdays") {
    const weekday = target.getDay();
    return weekday >= 1 && weekday <= 5;
  }
  if (rule === "custom") {
    return (activity.repeatDays ?? []).includes(target.getDay());
  }
  const elapsedDays = Math.round(
    (target.getTime() - fromDateKey(startDate).getTime()) / 86_400_000,
  );
  if (rule === "interval") {
    return elapsedDays % Math.max(2, activity.repeatInterval ?? 2) === 0;
  }
  return rule === "weekly" && elapsedDays % 7 === 0;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dayline-planner", 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("activities")) {
        const store = database.createObjectStore("activities", { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
      }
      if (!database.objectStoreNames.contains("templates")) {
        database.createObjectStore("templates", { keyPath: "id" });
      }
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
      .getAll();
    request.onsuccess = () => {
      const records = request.result as Activity[];
      const normalActivities = records.filter(
        (item) =>
          item.date === date &&
          !item.seriesId &&
          (!item.repeat || item.repeat === "none") &&
          !item.deleted,
      );
      const series = records.filter(
        (item) =>
          !item.seriesId &&
          item.repeat &&
          item.repeat !== "none" &&
          !item.deleted,
      );
      const recurringActivities = series.flatMap((base) => {
        if (!recurrenceMatches(base, date)) return [];
        const exception = records.find(
          (item) => item.seriesId === base.id && item.date === date,
        );
        if (exception?.deleted) return [];
        if (exception) return [exception];
        return [
          {
            ...base,
            id: `occurrence:${base.id}:${date}`,
            date,
            seriesId: base.id,
            seriesStartDate: base.date,
            isException: false,
            completed: false,
          },
        ];
      });
      resolve(
        [...normalActivities, ...recurringActivities].sort(
          (a, b) => minutes(a.start) - minutes(b.start),
        ),
      );
    };
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

async function removeSeries(seriesId: string) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("activities", "readwrite");
    const store = transaction.objectStore("activities");
    const request = store.getAll();
    request.onsuccess = () => {
      (request.result as Activity[])
        .filter((item) => item.id === seriesId || item.seriesId === seriesId)
        .forEach((item) => store.delete(item.id));
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function readStoredActivity(id: string) {
  const database = await openDatabase();
  return new Promise<Activity | undefined>((resolve, reject) => {
    const request = database
      .transaction("activities", "readonly")
      .objectStore("activities")
      .get(id);
    request.onsuccess = () => resolve(request.result as Activity | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function readTemplates() {
  const database = await openDatabase();
  return new Promise<DayTemplate[]>((resolve, reject) => {
    const request = database
      .transaction("templates", "readonly")
      .objectStore("templates")
      .getAll();
    request.onsuccess = () =>
      resolve(
        (request.result as DayTemplate[]).sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        ),
      );
    request.onerror = () => reject(request.error);
  });
}

async function writeTemplate(template: DayTemplate) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = database
      .transaction("templates", "readwrite")
      .objectStore("templates")
      .put(template);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function removeTemplate(id: string) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = database
      .transaction("templates", "readwrite")
      .objectStore("templates")
      .delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function occurrenceRecord(
  activity: Activity,
  changes: Partial<Activity>,
): Activity {
  if (!activity.seriesId) return { ...activity, ...changes };
  return {
    ...activity,
    ...changes,
    id: `exception:${activity.seriesId}:${activity.date}`,
    seriesId: activity.seriesId,
    seriesStartDate: activity.seriesStartDate,
    isException: true,
  };
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

function layoutOverlappingActivities(items: Activity[]) {
  const sorted = [...items].sort(
    (a, b) => minutes(a.start) - minutes(b.start),
  );
  const positioned: {
    activity: Activity;
    lane: number;
    laneCount: number;
  }[] = [];
  let group: Activity[] = [];
  let groupEnd = -1;

  const placeGroup = () => {
    if (!group.length) return;
    const laneEnds: number[] = [];
    const groupPositions = group.map((activity) => {
      const startMinute = minutes(activity.start);
      let lane = laneEnds.findIndex((endMinute) => endMinute <= startMinute);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(minutes(activity.end));
      } else {
        laneEnds[lane] = minutes(activity.end);
      }
      return { activity, lane };
    });
    const laneCount = laneEnds.length;
    positioned.push(
      ...groupPositions.map((item) => ({ ...item, laneCount })),
    );
  };

  sorted.forEach((activity) => {
    const startMinute = minutes(activity.start);
    if (group.length && startMinute >= groupEnd) {
      placeGroup();
      group = [];
      groupEnd = -1;
    }
    group.push(activity);
    groupEnd = Math.max(groupEnd, minutes(activity.end));
  });
  placeGroup();
  return positioned;
}

export default function Home() {
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [activities, setActivities] = useState<Activity[]>([]);
  const [dayStart, setDayStart] = useState(DEFAULT_DAY_START);
  const [pendingDayStart, setPendingDayStart] = useState(DEFAULT_DAY_START);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [editScope, setEditScope] = useState<"occurrence" | "series">(
    "occurrence",
  );
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [category, setCategory] = useState<Category>("focus");
  const [note, setNote] = useState("");
  const [repeat, setRepeat] = useState<RepeatRule>("none");
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [repeatInterval, setRepeatInterval] = useState(2);
  const [templates, setTemplates] = useState<DayTemplate[]>([]);
  const [copySourceDate, setCopySourceDate] = useState(() =>
    shiftDate(toDateKey(new Date()), -1),
  );
  const [templateName, setTemplateName] = useState("My day");
  const [toolsMessage, setToolsMessage] = useState("");
  const [toast, setToast] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [dragPreview, setDragPreview] = useState<{
    id: string;
    start: number;
    duration: number;
  } | null>(null);
  const [resizePreview, setResizePreview] = useState<{
    id: string;
    start: number;
    end: number;
    edge: "start" | "end";
  } | null>(null);
  const [installPrompt, setInstallPrompt] =
    useState<InstallPromptEvent | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const pressRef = useRef<{
    id: string;
    pointerId: number;
    element: HTMLDivElement;
    pointerStartY: number;
    scrollStartY: number;
    originStart: number;
    duration: number;
    currentStart: number;
    active: boolean;
    movedBeforeHold: boolean;
  } | null>(null);
  const resizeRef = useRef<{
    id: string;
    pointerId: number;
    element: HTMLSpanElement;
    edge: "start" | "end";
    pointerStartY: number;
    scrollStartY: number;
    originStart: number;
    originEnd: number;
    currentStart: number;
    currentEnd: number;
  } | null>(null);

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
    const storedDayStart = Number(localStorage.getItem("dayline-day-start"));
    if (
      Number.isInteger(storedDayStart) &&
      storedDayStart >= 0 &&
      storedDayStart <= 12 * 60
    ) {
      setDayStart(storedDayStart);
      setPendingDayStart(storedDayStart);
    }
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
      if (pressTimerRef.current !== null) {
        window.clearTimeout(pressTimerRef.current);
      }
      window.removeEventListener("beforeinstallprompt", handleInstall);
    };
  }, []);

  useEffect(() => {
    if (!sheetOpen && !settingsOpen && !toolsOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setSheetOpen(false);
        setSettingsOpen(false);
        setToolsOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sheetOpen, settingsOpen, toolsOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
  const coveredMinutes = useMemo(() => {
    const intervals = activities
      .map((item) => [
        Math.max(dayStart, minutes(item.start)),
        Math.min(DAY_END, minutes(item.end)),
      ])
      .filter(([intervalStart, intervalEnd]) => intervalEnd > intervalStart)
      .sort((a, b) => a[0] - b[0]);
    let total = 0;
    let currentStart = -1;
    let currentEnd = -1;
    intervals.forEach(([intervalStart, intervalEnd]) => {
      if (currentStart === -1 || intervalStart > currentEnd) {
        if (currentStart !== -1) total += currentEnd - currentStart;
        currentStart = intervalStart;
        currentEnd = intervalEnd;
      } else {
        currentEnd = Math.max(currentEnd, intervalEnd);
      }
    });
    if (currentStart !== -1) total += currentEnd - currentStart;
    return total;
  }, [activities, dayStart]);
  const completion = plannedMinutes
    ? Math.round((completedMinutes / plannedMinutes) * 100)
    : 0;
  const isToday = selectedDate === toDateKey(new Date());
  const isWithinDay =
    minutes(start) >= dayStart && minutes(end) <= DAY_END;
  const isRepeatValid =
    repeat !== "custom" ||
    repeatDays.length > 0;
  const isValid =
    title.trim() &&
    minutes(start) < minutes(end) &&
    isWithinDay &&
    isRepeatValid;

  function openCreate(startMinute = 9 * 60) {
    const rounded = Math.round(startMinute / 15) * 15;
    const safeStart = Math.min(DAY_END - 30, Math.max(dayStart, rounded));
    setEditingId(null);
    setEditingActivity(null);
    setEditScope("occurrence");
    setTitle("");
    setStart(minuteTime(safeStart));
    setEnd(minuteTime(Math.min(DAY_END, safeStart + 60)));
    setCategory("focus");
    setNote("");
    setRepeat("none");
    setRepeatDays([fromDateKey(selectedDate).getDay()]);
    setRepeatInterval(2);
    setSheetOpen(true);
  }

  function openEdit(activity: Activity) {
    setEditingId(activity.id);
    setEditingActivity(activity);
    setEditScope("occurrence");
    setTitle(activity.title);
    setStart(activity.start);
    setEnd(activity.end);
    setCategory(activity.category);
    setNote(activity.note);
    setRepeat(activity.repeat ?? "none");
    setRepeatDays(
      activity.repeatDays?.length
        ? activity.repeatDays
        : [fromDateKey(activity.date).getDay()],
    );
    setRepeatInterval(activity.repeatInterval ?? 2);
    setSheetOpen(true);
  }

  function chooseRepeatRule(rule: RepeatRule) {
    setRepeat(rule);
    if (rule === "custom" && repeatDays.length === 0) {
      setRepeatDays([fromDateKey(selectedDate).getDay()]);
    }
  }

  function toggleRepeatDay(day: number) {
    setRepeatDays((days) =>
      days.includes(day)
        ? days.filter((item) => item !== day)
        : [...days, day],
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!isValid) return;
    try {
      const changes: Partial<Activity> = {
        title: title.trim(),
        start,
        end,
        category,
        note: note.trim(),
      };
      if (editingActivity?.seriesId && editScope === "series") {
        const base = await readStoredActivity(editingActivity.seriesId);
        if (!base) throw new Error("Series not found");
        await writeActivity({
          ...base,
          ...changes,
          repeat,
          repeatDays: repeat === "custom" ? repeatDays : undefined,
          repeatInterval: repeat === "interval" ? repeatInterval : undefined,
        });
        setToast("Recurring series updated");
      } else if (editingActivity?.seriesId) {
        await writeActivity(occurrenceRecord(editingActivity, changes));
        setToast("This occurrence was updated");
      } else {
        const activity: Activity = {
          id: editingId ?? crypto.randomUUID(),
          date: selectedDate,
          title: title.trim(),
          start,
          end,
          category,
          note: note.trim(),
          completed: editingActivity?.completed ?? false,
          repeat,
          repeatDays: repeat === "custom" ? repeatDays : undefined,
          repeatInterval: repeat === "interval" ? repeatInterval : undefined,
        };
        await writeActivity(activity);
        setToast(
          repeat === "none"
            ? "Block saved"
            : `${repeatLabel(repeat, repeatDays, repeatInterval)} added`,
        );
      }
      await refresh();
      setSheetOpen(false);
    } catch {
      setStorageError(true);
    }
  }

  async function deleteCurrent() {
    if (!editingId || !editingActivity) return;
    try {
      if (editingActivity.seriesId && editScope === "series") {
        await removeSeries(editingActivity.seriesId);
        setToast("Recurring series deleted");
      } else if (editingActivity.seriesId) {
        await writeActivity(
          occurrenceRecord(editingActivity, { deleted: true }),
        );
        setToast("Occurrence deleted");
      } else {
        await removeActivity(editingId);
        setToast("Block deleted");
      }
      await refresh();
      setSheetOpen(false);
    } catch {
      setStorageError(true);
    }
  }

  async function toggleCompleted(activity: Activity) {
    try {
      await writeActivity(
        occurrenceRecord(activity, { completed: !activity.completed }),
      );
      await refresh();
    } catch {
      setStorageError(true);
    }
  }

  function clearPressTimer() {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }

  function beginBlockPress(
    event: ReactPointerEvent<HTMLDivElement>,
    activity: Activity,
  ) {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest(".complete-button, .resize-handle")
    ) {
      return;
    }

    clearPressTimer();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const originStart = minutes(activity.start);
    const duration = minutes(activity.end) - originStart;
    pressRef.current = {
      id: activity.id,
      pointerId: event.pointerId,
      element,
      pointerStartY: event.clientY,
      scrollStartY: window.scrollY,
      originStart,
      duration,
      currentStart: originStart,
      active: false,
      movedBeforeHold: false,
    };

    pressTimerRef.current = window.setTimeout(() => {
      const press = pressRef.current;
      if (!press || press.id !== activity.id) return;
      press.active = true;
      suppressClickRef.current = true;
      setDragPreview({
        id: activity.id,
        start: originStart,
        duration,
      });
      navigator.vibrate?.(18);
    }, 320);
  }

  function moveBlockPress(event: ReactPointerEvent<HTMLDivElement>) {
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    const pointerDelta =
      event.clientY -
      press.pointerStartY +
      (window.scrollY - press.scrollStartY);

    if (!press.active) {
      if (Math.abs(pointerDelta) > 8) {
        press.movedBeforeHold = true;
        suppressClickRef.current = true;
        clearPressTimer();
      }
      return;
    }

    event.preventDefault();
    if (event.clientY < 72) {
      window.scrollBy({ top: -12, behavior: "auto" });
    } else if (event.clientY > window.innerHeight - 72) {
      window.scrollBy({ top: 12, behavior: "auto" });
    }

    const unsnappedStart =
      press.originStart + (pointerDelta / HOUR_HEIGHT) * 60;
    const snappedStart = Math.round(unsnappedStart / 15) * 15;
    const nextStart = Math.min(
      DAY_END - press.duration,
      Math.max(dayStart, snappedStart),
    );
    press.currentStart = nextStart;
    setDragPreview({
      id: press.id,
      start: nextStart,
      duration: press.duration,
    });
  }

  async function endBlockPress(
    event: ReactPointerEvent<HTMLDivElement>,
    shouldSave: boolean,
  ) {
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    clearPressTimer();
    if (press.element.hasPointerCapture(event.pointerId)) {
      press.element.releasePointerCapture(event.pointerId);
    }
    pressRef.current = null;

    if (!press.active) {
      if (press.movedBeforeHold) {
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      return;
    }
    setDragPreview(null);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    if (!shouldSave || press.currentStart === press.originStart) return;

    const activity = activities.find((item) => item.id === press.id);
    if (!activity) return;
    const changes = {
      start: minuteTime(press.currentStart),
      end: minuteTime(press.currentStart + press.duration),
    };
    const movedActivity = {
      ...activity,
      ...changes,
    };
    setActivities((items) =>
      items.map((item) => (item.id === movedActivity.id ? movedActivity : item)),
    );
    try {
      await writeActivity(occurrenceRecord(activity, changes));
      await refresh();
    } catch {
      setStorageError(true);
      await refresh();
    }
  }

  function beginResize(
    event: ReactPointerEvent<HTMLSpanElement>,
    activity: Activity,
    edge: "start" | "end",
  ) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    clearPressTimer();
    suppressClickRef.current = true;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const originStart = minutes(activity.start);
    const originEnd = minutes(activity.end);
    resizeRef.current = {
      id: activity.id,
      pointerId: event.pointerId,
      element,
      edge,
      pointerStartY: event.clientY,
      scrollStartY: window.scrollY,
      originStart,
      originEnd,
      currentStart: originStart,
      currentEnd: originEnd,
    };
    setResizePreview({
      id: activity.id,
      start: originStart,
      end: originEnd,
      edge,
    });
  }

  function moveResize(event: ReactPointerEvent<HTMLSpanElement>) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.stopPropagation();
    event.preventDefault();
    if (event.clientY < 72) {
      window.scrollBy({ top: -12, behavior: "auto" });
    } else if (event.clientY > window.innerHeight - 72) {
      window.scrollBy({ top: 12, behavior: "auto" });
    }
    const pointerDelta =
      event.clientY -
      resize.pointerStartY +
      (window.scrollY - resize.scrollStartY);
    const minuteDelta = Math.round(((pointerDelta / HOUR_HEIGHT) * 60) / 15) * 15;
    if (resize.edge === "start") {
      resize.currentStart = Math.min(
        resize.originEnd - 15,
        Math.max(dayStart, resize.originStart + minuteDelta),
      );
    } else {
      resize.currentEnd = Math.min(
        DAY_END,
        Math.max(resize.originStart + 15, resize.originEnd + minuteDelta),
      );
    }
    setResizePreview({
      id: resize.id,
      start: resize.currentStart,
      end: resize.currentEnd,
      edge: resize.edge,
    });
  }

  async function endResize(
    event: ReactPointerEvent<HTMLSpanElement>,
    shouldSave: boolean,
  ) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (resize.element.hasPointerCapture(event.pointerId)) {
      resize.element.releasePointerCapture(event.pointerId);
    }
    resizeRef.current = null;
    setResizePreview(null);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    if (
      !shouldSave ||
      (resize.currentStart === resize.originStart &&
        resize.currentEnd === resize.originEnd)
    ) {
      return;
    }
    const activity = activities.find((item) => item.id === resize.id);
    if (!activity) return;
    const changes = {
      start: minuteTime(resize.currentStart),
      end: minuteTime(resize.currentEnd),
    };
    setActivities((items) =>
      items.map((item) =>
        item.id === activity.id ? { ...item, ...changes } : item,
      ),
    );
    try {
      await writeActivity(occurrenceRecord(activity, changes));
      await refresh();
    } catch {
      setStorageError(true);
      await refresh();
    }
  }

  function chooseTimelineTime(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".activity-block")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    openCreate(dayStart + (offset / HOUR_HEIGHT) * 60);
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

  function openDaySettings() {
    setPendingDayStart(dayStart);
    setSettingsOpen(true);
  }

  function saveDaySettings() {
    setDayStart(pendingDayStart);
    localStorage.setItem("dayline-day-start", String(pendingDayStart));
    setSettingsOpen(false);
  }

  async function openDayTools() {
    setCopySourceDate(shiftDate(selectedDate, -1));
    setToolsMessage("");
    try {
      setTemplates(await readTemplates());
      setToolsOpen(true);
    } catch {
      setStorageError(true);
    }
  }

  async function addBlocksToSelectedDate(blocks: TemplateBlock[]) {
    await Promise.all(
      blocks.map((block) =>
        writeActivity({
          ...block,
          id: crypto.randomUUID(),
          date: selectedDate,
          completed: false,
          repeat: "none",
        }),
      ),
    );
  }

  async function copyDay() {
    try {
      const sourceActivities = await readActivities(copySourceDate);
      if (!sourceActivities.length) {
        setToolsMessage("That day has no blocks to copy.");
        return;
      }
      await addBlocksToSelectedDate(
        sourceActivities.map(
          ({ title: blockTitle, start: blockStart, end: blockEnd, category: blockCategory, note: blockNote }) => ({
            title: blockTitle,
            start: blockStart,
            end: blockEnd,
            category: blockCategory,
            note: blockNote,
          }),
        ),
      );
      await refresh();
      setToolsOpen(false);
      setToast(
        `${sourceActivities.length} ${sourceActivities.length === 1 ? "block" : "blocks"} copied`,
      );
    } catch {
      setStorageError(true);
    }
  }

  async function saveCurrentDayTemplate() {
    const name = templateName.trim();
    if (!name) {
      setToolsMessage("Give this template a name first.");
      return;
    }
    if (!activities.length) {
      setToolsMessage("Add at least one block before saving a template.");
      return;
    }
    try {
      await writeTemplate({
        id: crypto.randomUUID(),
        name,
        createdAt: new Date().toISOString(),
        blocks: activities.map(
          ({ title: blockTitle, start: blockStart, end: blockEnd, category: blockCategory, note: blockNote }) => ({
            title: blockTitle,
            start: blockStart,
            end: blockEnd,
            category: blockCategory,
            note: blockNote,
          }),
        ),
      });
      setTemplates(await readTemplates());
      setTemplateName("My day");
      setToolsMessage(`Saved “${name}” for future days.`);
    } catch {
      setStorageError(true);
    }
  }

  async function applyTemplate(template: DayTemplate) {
    try {
      await addBlocksToSelectedDate(template.blocks);
      await refresh();
      setToolsOpen(false);
      setToast(`“${template.name}” added to this day`);
    } catch {
      setStorageError(true);
    }
  }

  async function deleteTemplate(templateId: string) {
    try {
      await removeTemplate(templateId);
      setTemplates(await readTemplates());
      setToolsMessage("Template removed.");
    } catch {
      setStorageError(true);
    }
  }

  const timelineHours = Array.from(
    { length: (DAY_END - dayStart) / 60 + 1 },
    (_, index) => dayStart / 60 + index,
  );
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNow =
    isToday && nowMinutes >= dayStart && nowMinutes <= DAY_END;
  const hiddenBlocks = activities.filter(
    (item) => minutes(item.start) < dayStart,
  );
  const visibleActivities = activities.filter(
    (item) => minutes(item.start) >= dayStart,
  );
  const positionedActivities = useMemo(
    () => layoutOverlappingActivities(visibleActivities),
    [visibleActivities],
  );

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
                    Math.max(0, DAY_END - dayStart - coveredMinutes),
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
          <div className="schedule-actions">
            <button
              className="day-tools-button"
              type="button"
              onClick={openDayTools}
            >
              Copy / templates
            </button>
            <button
              className="day-start-button"
              type="button"
              onClick={openDaySettings}
              aria-label={`Change day start time, currently ${friendlyTime(minuteTime(dayStart))}`}
            >
              Starts {friendlyTime(minuteTime(dayStart)).replace(":00", "")}
            </button>
            <button className="add-text-button" type="button" onClick={() => openCreate()}>
              <span aria-hidden="true">＋</span> Add block
            </button>
          </div>
        </div>

        {hiddenBlocks.length > 0 && (
          <button className="hidden-blocks-notice" type="button" onClick={openDaySettings}>
            {hiddenBlocks.length} earlier {hiddenBlocks.length === 1 ? "block is" : "blocks are"} hidden
            <span>Show earlier hours</span>
          </button>
        )}

        <div
          className={`timeline ${loading ? "is-loading" : ""}`}
          style={{ height: `${(DAY_END - dayStart) / 60 * HOUR_HEIGHT}px` }}
          onDoubleClick={chooseTimelineTime}
        >
          {timelineHours.map((hour) => (
            <div
              className="hour-line"
              style={{ top: `${(hour - dayStart / 60) * HOUR_HEIGHT}px` }}
              key={hour}
            >
              <span>{friendlyTime(`${String(hour).padStart(2, "0")}:00`).replace(":00", "")}</span>
            </div>
          ))}

          {showNow && (
            <div
              className="now-line"
              style={{ top: `${((nowMinutes - dayStart) / 60) * HOUR_HEIGHT}px` }}
            >
              <span>now</span>
            </div>
          )}

          {!loading && (
            <div className="activity-layer">
              {positionedActivities.map(({ activity: item, lane, laneCount }) => {
              const isDragging = dragPreview?.id === item.id;
              const isResizing = resizePreview?.id === item.id;
              const displayedStart = isResizing
                ? resizePreview!.start
                : isDragging
                  ? dragPreview!.start
                  : minutes(item.start);
              const displayedEnd = isResizing
                ? resizePreview!.end
                : isDragging
                  ? dragPreview!.start + dragPreview!.duration
                  : minutes(item.end);
              const top = ((displayedStart - dayStart) / 60) * HOUR_HEIGHT;
              const height =
                ((displayedEnd - displayedStart) / 60) * HOUR_HEIGHT;
              const displayedDuration = displayedEnd - displayedStart;
              const isCompact = displayedDuration <= 30;
              const isMicro = displayedDuration <= 15;
              const isRecurring =
                Boolean(item.seriesId) ||
                (item.repeat !== undefined && item.repeat !== "none");
              return (
                <div
                  className={`activity-block category-${item.category} ${
                    laneCount > 1 ? "is-stacked" : ""
                  } ${
                    item.completed ? "is-complete" : ""
                  } ${
                    isDragging ? "is-dragging" : ""
                  } ${
                    isResizing ? "is-resizing" : ""
                  } ${
                    isCompact ? "is-compact" : ""
                  } ${
                    isMicro ? "is-micro" : ""
                  }`}
                  style={{
                    top: `${top}px`,
                    height: `${Math.max(14, height - 4)}px`,
                    left: `${(lane / laneCount) * 100}%`,
                    width: `calc(${100 / laneCount}% - 4px)`,
                  }}
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(event) => beginBlockPress(event, item)}
                  onPointerMove={moveBlockPress}
                  onPointerUp={(event) => endBlockPress(event, true)}
                  onPointerCancel={(event) => endBlockPress(event, false)}
                  onContextMenu={(event) => event.preventDefault()}
                  onClick={() => {
                    if (!suppressClickRef.current) openEdit(item);
                  }}
                  onKeyDown={(event) => keyboardOpen(event, item)}
                  aria-label={`Edit ${item.title}, ${friendlyTime(item.start)} to ${friendlyTime(item.end)}. Press and hold to move, or drag an edge to resize.`}
                  aria-grabbed={isDragging}
                >
                  {(isDragging || isResizing) && (
                    <span className="drag-time-pill">
                      {friendlyTime(minuteTime(displayedStart))}
                      {" — "}
                      {friendlyTime(minuteTime(displayedEnd))}
                    </span>
                  )}
                  <span
                    className="resize-handle resize-start"
                    onPointerDown={(event) => beginResize(event, item, "start")}
                    onPointerMove={moveResize}
                    onPointerUp={(event) => endResize(event, true)}
                    onPointerCancel={(event) => endResize(event, false)}
                    onClick={(event) => event.stopPropagation()}
                    aria-hidden="true"
                  />
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
                    <strong>
                      {item.title}
                      {isRecurring && (
                        <span
                          className="repeat-badge"
                          title={repeatLabel(
                            item.repeat,
                            item.repeatDays,
                            item.repeatInterval,
                          )}
                        >
                          ↻
                        </span>
                      )}
                    </strong>
                    {height > 62 && item.note && <small>{item.note}</small>}
                  </div>
                  <span className="activity-time">
                    {friendlyTime(item.start).replace(" ", "")}
                    <b>—</b>
                    {friendlyTime(item.end).replace(" ", "")}
                  </span>
                  <span
                    className="resize-handle resize-end"
                    onPointerDown={(event) => beginResize(event, item, "end")}
                    onPointerMove={moveResize}
                    onPointerUp={(event) => endResize(event, true)}
                    onPointerCancel={(event) => endResize(event, false)}
                    onClick={(event) => event.stopPropagation()}
                    aria-hidden="true"
                  />
                </div>
              );
              })}
            </div>
          )}

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
                    min={minuteTime(dayStart)}
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
                    min={minuteTime(Math.max(dayStart, minutes(start) + 15))}
                    max="23:00"
                    step={900}
                    onChange={(event) => setEnd(event.target.value)}
                  />
                </label>
              </div>
              <p className="field-hint">
                Overlapping blocks are allowed and will appear side by side.
              </p>

              {editingActivity?.seriesId && (
                <fieldset className="repeat-field">
                  <legend>
                    Recurring block ·{" "}
                    {repeatLabel(
                      editingActivity.repeat,
                      editingActivity.repeatDays,
                      editingActivity.repeatInterval,
                    )}
                  </legend>
                  <div className="scope-options">
                    <button
                      className={editScope === "occurrence" ? "is-selected" : ""}
                      type="button"
                      onClick={() => setEditScope("occurrence")}
                    >
                      This date only
                    </button>
                    <button
                      className={editScope === "series" ? "is-selected" : ""}
                      type="button"
                      onClick={() => setEditScope("series")}
                    >
                      Entire series
                    </button>
                  </div>
                </fieldset>
              )}

              {(!editingActivity?.seriesId || editScope === "series") && (
                <fieldset className="repeat-field">
                  <legend>
                    {editingActivity?.seriesId ? "Repeat pattern" : "Repeat"}
                  </legend>
                  <div className="repeat-options">
                    {(
                      [
                        ["none", "Doesn’t repeat"],
                        ["daily", "Daily"],
                        ["weekdays", "Weekdays"],
                        ["weekly", "Weekly"],
                        ["custom", "Choose days"],
                        ["interval", "Every N days"],
                      ] as [RepeatRule, string][]
                    )
                      .filter(
                        ([rule]) => !editingActivity?.seriesId || rule !== "none",
                      )
                      .map(([rule, label]) => (
                      <label
                        className={repeat === rule ? "is-selected" : ""}
                        key={rule}
                      >
                        <input
                          type="radio"
                          name="repeat"
                          value={rule}
                          checked={repeat === rule}
                          onChange={() => chooseRepeatRule(rule)}
                        />
                        {label}
                      </label>
                      ))}
                  </div>

                  {repeat === "custom" && (
                    <div className="custom-repeat-panel">
                      <span>Repeat on</span>
                      <div
                        className="repeat-day-options"
                        aria-label="Days of the week"
                      >
                        {repeatDayOptions.map((day) => (
                          <button
                            className={
                              repeatDays.includes(day.value)
                                ? "is-selected"
                                : ""
                            }
                            type="button"
                            aria-pressed={repeatDays.includes(day.value)}
                            aria-label={day.longLabel}
                            key={day.value}
                            onClick={() => toggleRepeatDay(day.value)}
                          >
                            {day.label}
                          </button>
                        ))}
                      </div>
                      {!isRepeatValid && (
                        <p className="form-warning">
                          Choose at least one day.
                        </p>
                      )}
                    </div>
                  )}

                  {repeat === "interval" && (
                    <label className="interval-repeat">
                      <span>Repeat every</span>
                      <input
                        type="number"
                        min={2}
                        max={30}
                        inputMode="numeric"
                        value={repeatInterval}
                        onChange={(event) =>
                          setRepeatInterval(
                            Math.min(
                              30,
                              Math.max(2, Number(event.target.value) || 2),
                            ),
                          )
                        }
                        aria-label="Number of days between repeats"
                      />
                      <span>days</span>
                    </label>
                  )}
                </fieldset>
              )}

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
                  Dayline currently starts at {friendlyTime(minuteTime(dayStart))} and ends at 11:00 PM.
                </p>
              )}
              <div className="form-actions">
                {editingId && (
                  <button className="delete-button" type="button" onClick={deleteCurrent}>
                    {editingActivity?.seriesId
                      ? editScope === "series"
                        ? "Delete series"
                        : "Delete this"
                      : "Delete"}
                  </button>
                )}
                <button className="save-button" type="submit" disabled={!isValid}>
                  {editingActivity?.seriesId
                    ? editScope === "series"
                      ? "Update series"
                      : "Save this date"
                    : editingId
                      ? "Save changes"
                      : "Add to day"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="sheet-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <section
            className="activity-sheet settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="sheet-handle" />
            <div className="sheet-header">
              <div>
                <span className="eyebrow">Timeline settings</span>
                <h2 id="settings-title">When does your day start?</h2>
              </div>
              <button
                className="close-button"
                type="button"
                aria-label="Close"
                onClick={() => setSettingsOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="settings-copy">
              Choose the first hour shown on your daily timeline. This preference stays on this device.
            </p>
            <div className="hour-picker" role="radiogroup" aria-label="Day start time">
              {Array.from({ length: 13 }, (_, hour) => hour).map((hour) => (
                <button
                  className={pendingDayStart === hour * 60 ? "is-selected" : ""}
                  type="button"
                  role="radio"
                  aria-checked={pendingDayStart === hour * 60}
                  key={hour}
                  onClick={() => setPendingDayStart(hour * 60)}
                >
                  {friendlyTime(minuteTime(hour * 60)).replace(":00", "")}
                </button>
              ))}
            </div>
            <button className="save-button settings-save" type="button" onClick={saveDaySettings}>
              Start my day at {friendlyTime(minuteTime(pendingDayStart))}
            </button>
          </section>
        </div>
      )}

      {toolsOpen && (
        <div className="sheet-backdrop" onMouseDown={() => setToolsOpen(false)}>
          <section
            className="activity-sheet tools-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tools-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="sheet-handle" />
            <div className="sheet-header">
              <div>
                <span className="eyebrow">Day tools</span>
                <h2 id="tools-title">Plan faster</h2>
              </div>
              <button
                className="close-button"
                type="button"
                aria-label="Close"
                onClick={() => setToolsOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="tool-section">
              <div>
                <strong>Copy another day</strong>
                <p>Adds that day’s blocks here without replacing anything.</p>
              </div>
              <div className="tool-row">
                <input
                  type="date"
                  value={copySourceDate}
                  onChange={(event) => setCopySourceDate(event.target.value)}
                  aria-label="Day to copy"
                />
                <button type="button" onClick={copyDay}>
                  Copy to this day
                </button>
              </div>
            </div>

            <div className="tool-section">
              <div>
                <strong>Save this day as a template</strong>
                <p>Keep the current block names, times, colors, and notes.</p>
              </div>
              <div className="tool-row">
                <input
                  type="text"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="Template name"
                  maxLength={40}
                  aria-label="Template name"
                />
                <button type="button" onClick={saveCurrentDayTemplate}>
                  Save template
                </button>
              </div>
            </div>

            <div className="tool-section template-section">
              <div>
                <strong>Saved templates</strong>
                <p>Apply one to add all of its blocks to this day.</p>
              </div>
              {templates.length ? (
                <div className="template-list">
                  {templates.map((template) => (
                    <div className="template-item" key={template.id}>
                      <button
                        className="template-apply"
                        type="button"
                        onClick={() => applyTemplate(template)}
                      >
                        <span>{template.name}</span>
                        <small>
                          {template.blocks.length}{" "}
                          {template.blocks.length === 1 ? "block" : "blocks"}
                        </small>
                      </button>
                      <button
                        className="template-delete"
                        type="button"
                        onClick={() => deleteTemplate(template.id)}
                        aria-label={`Delete ${template.name} template`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="no-templates">No templates saved on this device yet.</p>
              )}
            </div>
            {toolsMessage && (
              <p className="tools-message" role="status">
                {toolsMessage}
              </p>
            )}
          </section>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
