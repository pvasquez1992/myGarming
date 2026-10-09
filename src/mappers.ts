import type { ActivityRow, DailyRow } from './types';

export function activityDto(row: ActivityRow) {
  return {
    id: row.id,
    name: row.name,
    sport: row.sport,
    startedAt: row.started_at,
    localDate: row.local_date,
    utcOffsetMinutes: row.utc_offset_minutes,
    durationSeconds: row.duration_seconds,
    elapsedSeconds: row.elapsed_seconds,
    movingSeconds: row.moving_seconds,
    distanceMeters: row.distance_meters,
    averageSpeedMps: row.average_speed_mps,
    maxSpeedMps: row.max_speed_mps,
    averagePaceSecondsPerKm: row.average_speed_mps && row.average_speed_mps > 0
      ? Math.round(1000 / row.average_speed_mps * 100) / 100 : null,
    elevationGainMeters: row.elevation_gain_meters,
    elevationLossMeters: row.elevation_loss_meters,
    caloriesKcal: row.calories_kcal,
    averageHeartRateBpm: row.average_heart_rate_bpm,
    maxHeartRateBpm: row.max_heart_rate_bpm,
    averagePowerWatts: row.average_power_watts,
    maxPowerWatts: row.max_power_watts,
    steps: row.steps,
    aerobicTrainingEffect: row.aerobic_training_effect,
    anaerobicTrainingEffect: row.anaerobic_training_effect,
    trainingLoad: row.training_load,
    vo2Max: row.vo2_max,
    startPosition: position(row.start_latitude, row.start_longitude),
    endPosition: position(row.end_latitude, row.end_longitude),
    lapCount: row.lap_count,
  };
}

function position(latitude: number | null, longitude: number | null) {
  return latitude !== null && longitude !== null ? { latitude, longitude } : null;
}

export function dailyDto(row: DailyRow) {
  return {
    date: row.date,
    steps: row.steps,
    stepGoal: row.step_goal,
    distanceMeters: row.distance_meters,
    totalCaloriesKcal: row.total_calories_kcal,
    activeCaloriesKcal: row.active_calories_kcal,
    restingCaloriesKcal: row.resting_calories_kcal,
    moderateIntensityMinutes: row.moderate_intensity_minutes,
    vigorousIntensityMinutes: row.vigorous_intensity_minutes,
    highlyActiveSeconds: row.highly_active_seconds,
    activeSeconds: row.active_seconds,
    floorsAscendedMeters: row.floors_ascended_meters,
    floorsDescendedMeters: row.floors_descended_meters,
    includesActivityData: Boolean(row.includes_activity_data),
    includesWellnessData: Boolean(row.includes_wellness_data),
  };
}
