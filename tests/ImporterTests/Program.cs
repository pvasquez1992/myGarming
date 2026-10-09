using System.IO.Compression;
using System.Text.Json;
using Importer = GarminImporter.Program;

var tests = 0;
void Check(bool valid, string message)
{
    if (!valid) throw new Exception(message);
    tests++;
}

// Una actividad cerca de medianoche UTC: la fecha de filtro debe ser la local.
const string activityJson = """
{
  "activityId": 9007199254740993,
  "name": "Carrera de O'Brien",
  "activityType": "running",
  "beginTimestamp": 1707784200000,
  "startTimeLocal": 1707762600000,
  "duration": 1800000,
  "distance": 500000,
  "avgSpeed": 0.277777777,
  "elevationGain": 1234,
  "calories": 1255.2,
  "avgHr": 0,
  "startLatitude": 0,
  "startLongitude": 0,
  "endLatitude": 999,
  "steps": 5000.0
}
""";
using var activityDocument = JsonDocument.Parse(activityJson);
var normalized = Importer.NormalizeActivity(activityDocument.RootElement);
Check((string)normalized["id"]! == "9007199254740993", "IDs grandes deben conservarse exactamente.");
Check((double)normalized["distance_meters"]! == 5000, "Centímetros a metros.");
Check((double)normalized["duration_seconds"]! == 1800, "Milisegundos a segundos.");
Check((double)normalized["calories_kcal"]! == 300, "Kilojulios a kilocalorías.");
Check((double)normalized["average_speed_mps"]! == 2.778, "cm/ms a m/s.");
Check((double)normalized["elevation_gain_meters"]! == 12.34, "Desnivel a metros.");
Check((long)normalized["utc_offset_minutes"]! == -360, "Desfase horario.");
Check((string)normalized["started_at"]! == "2024-02-13T00:30:00.000Z", "Inicio UTC.");
Check((string)normalized["local_date"]! == "2024-02-12", "Fecha local al cruzar medianoche UTC.");
Check(normalized["average_heart_rate_bpm"] is null, "Pulso cero indica ausencia.");
Check(normalized["max_power_watts"] is null, "Campo ausente conserva null.");
Check((double)normalized["start_latitude"]! == 0, "Coordenada cero es válida.");
Check(normalized["end_latitude"] is null, "Coordenada fuera de rango.");
var sql = Importer.Upsert("activities", "id", normalized);
Check(sql.Contains("O''Brien"), "Comillas del nombre deben escaparse.");
Check(sql.Contains("ON CONFLICT(id) DO UPDATE"), "Importación debe ser repetible.");

using var dailyDocument = JsonDocument.Parse("""
{"calendarDate":"2024-02-12","totalKilocalories":2000,"totalDistanceMeters":5000,"totalSteps":7500,"includesWellnessData":true}
""");
var day = Importer.NormalizeDaily(dailyDocument.RootElement);
Check((double)day["total_calories_kcal"]! == 2000, "UDS ya está en kilocalorías.");
Check((double)day["distance_meters"]! == 5000, "UDS ya está en metros.");
Check((int)day["includes_wellness_data"]! == 1, "Booleanos para SQLite.");

var temporaryDirectory = Path.Combine(Path.GetTempPath(), "garmin-import-test-" + Guid.NewGuid());
Directory.CreateDirectory(temporaryDirectory);
try
{
    var archivePath = Path.Combine(temporaryDirectory, "fixture.zip");
    using (var zip = ZipFile.Open(archivePath, ZipArchiveMode.Create))
    {
        using (var writer = new StreamWriter(zip.CreateEntry("DI_CONNECT/DI-Connect-Fitness/test_summarizedActivities.json").Open()))
            writer.Write("[{\"summarizedActivitiesExport\":[" + activityJson + "]}]");
        using (var writer = new StreamWriter(zip.CreateEntry("DI_CONNECT/DI-Connect-Aggregator/UDSFile_test.json").Open()))
            writer.Write("[" + dailyDocument.RootElement.GetRawText() + "]");
    }
    var output = Path.Combine(temporaryDirectory, "import.sql");
    var first = Importer.Import(archivePath, output);
    var second = Importer.Import(archivePath, output);
    Check(first.ActivityCount == 1 && first.DailyCount == 1, "Leer ambos JSON desde ZIP.");
    Check(first.SourceSha256 == second.SourceSha256, "Identificar exportación por hash.");
    Check(File.ReadAllText(output).Contains("9007199254740993"), "SQL conserva identificador grande.");
    Check(File.Exists(Path.Combine(temporaryDirectory, "import-report.json")), "Generar reporte de importación.");
    using var invalid = JsonDocument.Parse(activityJson.Replace("\"duration\": 1800000", "\"duration\": -1"));
    var rejected = false;
    try { Importer.NormalizeActivity(invalid.RootElement); } catch (InvalidDataException) { rejected = true; }
    Check(rejected, "Rechazar duración negativa.");
}
finally
{
    // Ruta creada exclusivamente por este test dentro de Path.GetTempPath().
    Directory.Delete(temporaryDirectory, true);
}
Console.WriteLine($"Importer: {tests} comprobaciones correctas.");
