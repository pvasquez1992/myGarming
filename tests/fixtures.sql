INSERT INTO activities (id,name,sport,started_at,local_date,utc_offset_minutes,duration_seconds,distance_meters,average_speed_mps,calories_kcal,start_latitude,start_longitude)
VALUES ('101','Carrera de prueba','running','2024-02-13T01:50:00.000Z','2024-02-12',-360,1800,5000,2.777777,300,0,0);
INSERT INTO activities (id,name,sport,started_at,local_date,utc_offset_minutes,duration_seconds,distance_meters)
VALUES ('102','Caminata de prueba','walking','2024-02-14T12:00:00.000Z','2024-02-14',0,1200,1500);
INSERT INTO daily_stats (date,steps,distance_meters,total_calories_kcal,includes_activity_data,includes_wellness_data)
VALUES ('2024-02-12',7500,5000,2000,1,1), ('2024-02-14',3000,1500,1800,1,0);
