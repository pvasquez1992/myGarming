export type Bindings = {
  DB: D1Database;
  CORS_ORIGINS?: string;
  API_KEY?: string;
};

export type ActivityRow = {
  id: string;
  name: string;
  sport: string;
  started_at: string;
  local_date: string;
  utc_offset_minutes: number | null;
  duration_seconds: number;
  elapsed_seconds: number | null;
  moving_seconds: number | null;
  distance_meters: number;
  average_speed_mps: number | null;
  max_speed_mps: number | null;
  elevation_gain_meters: number | null;
  elevation_loss_meters: number | null;
  calories_kcal: number | null;
  average_heart_rate_bpm: number | null;
  max_heart_rate_bpm: number | null;
  average_power_watts: number | null;
  max_power_watts: number | null;
  steps: number | null;
  aerobic_training_effect: number | null;
  anaerobic_training_effect: number | null;
  training_load: number | null;
  vo2_max: number | null;
  start_latitude: number | null;
  start_longitude: number | null;
  end_latitude: number | null;
  end_longitude: number | null;
  lap_count: number | null;
};

export type DailyRow = {
  date: string;
  steps: number | null;
  step_goal: number | null;
  distance_meters: number | null;
  total_calories_kcal: number | null;
  active_calories_kcal: number | null;
  resting_calories_kcal: number | null;
  moderate_intensity_minutes: number | null;
  vigorous_intensity_minutes: number | null;
  highly_active_seconds: number | null;
  active_seconds: number | null;
  floors_ascended_meters: number | null;
  floors_descended_meters: number | null;
  includes_activity_data: number;
  includes_wellness_data: number;
};
