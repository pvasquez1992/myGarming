CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sport TEXT NOT NULL,
  started_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  utc_offset_minutes INTEGER,
  duration_seconds REAL NOT NULL CHECK (duration_seconds >= 0),
  elapsed_seconds REAL,
  moving_seconds REAL,
  distance_meters REAL NOT NULL CHECK (distance_meters >= 0),
  average_speed_mps REAL,
  max_speed_mps REAL,
  elevation_gain_meters REAL,
  elevation_loss_meters REAL,
  calories_kcal REAL,
  average_heart_rate_bpm REAL,
  max_heart_rate_bpm REAL,
  average_power_watts REAL,
  max_power_watts REAL,
  steps INTEGER,
  aerobic_training_effect REAL,
  anaerobic_training_effect REAL,
  training_load REAL,
  vo2_max REAL,
  start_latitude REAL,
  start_longitude REAL,
  end_latitude REAL,
  end_longitude REAL,
  lap_count INTEGER
);
CREATE INDEX activities_date_idx ON activities(local_date, started_at DESC, id);
CREATE INDEX activities_sport_date_idx ON activities(sport, local_date, started_at DESC, id);
CREATE INDEX activities_started_idx ON activities(started_at DESC, id);

CREATE TABLE daily_stats (
  date TEXT PRIMARY KEY,
  steps INTEGER,
  step_goal INTEGER,
  distance_meters REAL,
  total_calories_kcal REAL,
  active_calories_kcal REAL,
  resting_calories_kcal REAL,
  moderate_intensity_minutes INTEGER,
  vigorous_intensity_minutes INTEGER,
  highly_active_seconds INTEGER,
  active_seconds INTEGER,
  floors_ascended_meters REAL,
  floors_descended_meters REAL,
  includes_activity_data INTEGER NOT NULL,
  includes_wellness_data INTEGER NOT NULL
);

CREATE TABLE import_runs (
  source_sha256 TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL,
  activity_count INTEGER NOT NULL,
  daily_count INTEGER NOT NULL
);
