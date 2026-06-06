export type SourceMode = "caldav" | "ics";
export type ViewMode = "rolling_week" | "five_day" | "work_week" | "three_day" | "agenda";

export type CalendarSource = {
  name: string;
  url: string;
};

export type CalendarConfig = {
  sourceMode: SourceMode;
  sources: CalendarSource[];
  caldavServer: string;
  caldavUsername?: string;
  caldavPassword?: string;
  calendarInclude: string[];
  calendarExclude: string[];
  timezone: string;
  viewMode: ViewMode;
  startHour: number;
  endHour: number;
  showCalendarNames: boolean;
  freeBusyOnly: boolean;
  fetchTimeoutMs: number;
};

export type HourMarker = {
  hour: number;
  label: string;
  top_pct: number;
};

export type AllDayEvent = {
  id: string;
  title: string;
  calendar: string;
  start: string;
  end: string;
};

export type TimedEvent = {
  id: string;
  title: string;
  calendar: string;
  start: string;
  end: string;
  start_minutes: number;
  end_minutes: number;
  top_pct: number;
  height_pct: number;
  column: number;
  columns: number;
  left_pct: number;
  width_pct: number;
};

export type CalendarDay = {
  date: string;
  label: string;
  is_today: boolean;
  all_day_events: AllDayEvent[];
  timed_events: TimedEvent[];
};

export type CalendarPayload = {
  synced_at: string;
  synced_label: string;
  synced_ago_minutes: number;
  source_mode: SourceMode;
  timezone: string;
  view_mode: ViewMode;
  start_hour: number;
  end_hour: number;
  show_calendar_names: boolean;
  free_busy_only: boolean;
  day_count: number;
  range: {
    start: string;
    end: string;
  };
  hours: HourMarker[];
  days: CalendarDay[];
};
