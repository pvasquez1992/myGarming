using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GarminImporter;

public static class Program
{
    public static int Main(string[] args)
    {
        try
        {
            if (args.Contains("--help"))
            {
                Console.WriteLine("GarminImporter [--zip archivo.zip] [--out data/import.sql]");
                return 0;
            }
            string? zip = null;
            string output = Path.Combine("data", "import.sql");
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] is not ("--zip" or "--out") || i + 1 >= args.Length)
                    throw new ArgumentException("Usa --zip archivo.zip y/o --out archivo.sql.");
                var option = args[i];
                var value = args[++i];
                if (option == "--zip") zip = value; else output = value;
            }
            if (zip is null)
            {
                var candidates = Directory.GetFiles(Directory.GetCurrentDirectory(), "*.zip");
                if (candidates.Length != 1)
                    throw new ArgumentException("Debe haber un único ZIP en la carpeta o debes indicar --zip.");
                zip = candidates[0];
            }
            var report = Import(zip, output);
            Console.WriteLine($"Importación preparada: {report.ActivityCount} actividades y {report.DailyCount} días.");
            Console.WriteLine($"Rango de actividades: {report.FirstActivityDate} a {report.LastActivityDate}.");
            Console.WriteLine($"SQL: {Path.GetFullPath(output)}");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Error de importación: {error.Message}");
            return 1;
        }
    }

    public static ImportReport Import(string zipPath, string outputPath)
    {
        var activities = new SortedDictionary<string, Dictionary<string, object?>>(StringComparer.Ordinal);
        var daily = new SortedDictionary<string, Dictionary<string, object?>>(StringComparer.Ordinal);
        string hash;
        using (var source = File.OpenRead(zipPath))
            hash = Convert.ToHexString(SHA256.HashData(source)).ToLowerInvariant();
        using (var archive = ZipFile.OpenRead(zipPath))
        {
            foreach (var entry in archive.Entries)
            {
                var isActivity = entry.FullName.EndsWith("summarizedActivities.json", StringComparison.OrdinalIgnoreCase);
                var isDaily = entry.FullName.Contains("/UDSFile_", StringComparison.OrdinalIgnoreCase)
                    && entry.FullName.EndsWith(".json", StringComparison.OrdinalIgnoreCase);
                if (!isActivity && !isDaily) continue;
                if (entry.Length > 128 * 1024 * 1024)
                    throw new InvalidDataException("Un JSON supera el límite de 128 MB del importador.");
                using var stream = entry.Open();
                using var document = JsonDocument.Parse(stream);
                var root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Array)
                    throw new InvalidDataException("Se esperaba un array JSON en la exportación.");
                if (isActivity)
                {
                    foreach (var wrapper in root.EnumerateArray())
                    {
                        var list = wrapper.GetProperty("summarizedActivitiesExport");
                        foreach (var source in list.EnumerateArray())
                        {
                            var normalized = NormalizeActivity(source);
                            AddUnique(activities, (string)normalized["id"]!, normalized);
                        }
                    }
                }
                else
                {
                    foreach (var source in root.EnumerateArray())
                    {
                        var normalized = NormalizeDaily(source);
                        AddUnique(daily, (string)normalized["date"]!, normalized);
                    }
                }
            }
        }
        if (activities.Count == 0) throw new InvalidDataException("El ZIP no contiene actividades resumidas compatibles.");
        var report = new ImportReport(hash, DateTimeOffset.UtcNow.ToString("O"), activities.Count, daily.Count,
            activities.Values.Select(row => (string)row["local_date"]!).Min()!,
            activities.Values.Select(row => (string)row["local_date"]!).Max()!);
        var fullOutput = Path.GetFullPath(outputPath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullOutput)!);
        var temporaryOutput = fullOutput + ".tmp";
        using (var writer = new StreamWriter(temporaryOutput, false, new UTF8Encoding(false)))
        {
            writer.WriteLine("-- Datos personales. Archivo generado localmente; no subir a Git.");
            writer.WriteLine("-- UPSERT: reimportar no duplica registros ni borra el historial previo.");
            foreach (var row in activities.Values) writer.WriteLine(Upsert("activities", "id", row));
            foreach (var row in daily.Values) writer.WriteLine(Upsert("daily_stats", "date", row));
            writer.WriteLine(Upsert("import_runs", "source_sha256", new Dictionary<string, object?> {
                ["source_sha256"] = report.SourceSha256, ["imported_at"] = report.GeneratedAt,
                ["activity_count"] = report.ActivityCount, ["daily_count"] = report.DailyCount,
            }));
        }
        File.Move(temporaryOutput, fullOutput, true);
        File.WriteAllText(Path.Combine(Path.GetDirectoryName(fullOutput)!, "import-report.json"),
            JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));
        return report;
    }

    public static Dictionary<string, object?> NormalizeActivity(JsonElement source)
    {
        var id = source.GetProperty("activityId").GetInt64();
        if (id <= 0) throw new InvalidDataException("activityId debe ser positivo.");
        var timestamp = RequiredInteger(source, "beginTimestamp");
        var started = DateTimeOffset.FromUnixTimeMilliseconds(timestamp);
        var localTimestamp = Integer(source, "startTimeLocal");
        var local = localTimestamp.HasValue ? DateTimeOffset.FromUnixTimeMilliseconds(localTimestamp.Value) : started;
        long? offset = localTimestamp.HasValue ? (localTimestamp.Value - timestamp) / 60_000 : null;
        if (offset is < -840 or > 840) throw new InvalidDataException("Desfase horario fuera de rango.");
        var sport = Text(source, "activityType");
        if (string.IsNullOrWhiteSpace(sport)) throw new InvalidDataException("Falta activityType.");
        return new Dictionary<string, object?> {
            ["id"] = id.ToString(CultureInfo.InvariantCulture),
            ["name"] = Text(source, "name") ?? "",
            ["sport"] = sport,
            ["started_at"] = started.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
            ["local_date"] = local.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            ["utc_offset_minutes"] = offset,
            ["duration_seconds"] = RequiredNonnegative(source, "duration", 0.001),
            ["elapsed_seconds"] = Number(source, "elapsedDuration", 0.001),
            ["moving_seconds"] = Number(source, "movingDuration", 0.001),
            ["distance_meters"] = RequiredNonnegative(source, "distance", 0.01),
            ["average_speed_mps"] = Number(source, "avgSpeed", 10),
            ["max_speed_mps"] = Number(source, "maxSpeed", 10),
            ["elevation_gain_meters"] = Number(source, "elevationGain", 0.01),
            ["elevation_loss_meters"] = Number(source, "elevationLoss", 0.01),
            // SUM_ENERGY en splits usa KILOJOULE; el resumen usa la misma escala.
            ["calories_kcal"] = Number(source, "calories", 1 / 4.184),
            ["average_heart_rate_bpm"] = PositiveNumber(source, "avgHr"),
            ["max_heart_rate_bpm"] = PositiveNumber(source, "maxHr"),
            ["average_power_watts"] = Number(source, "avgPower"),
            ["max_power_watts"] = Number(source, "maxPower"),
            ["steps"] = Integer(source, "steps"),
            ["aerobic_training_effect"] = Number(source, "aerobicTrainingEffect"),
            ["anaerobic_training_effect"] = Number(source, "anaerobicTrainingEffect"),
            ["training_load"] = Number(source, "activityTrainingLoad"),
            ["vo2_max"] = PositiveNumber(source, "vO2MaxValue"),
            ["start_latitude"] = Coordinate(source, "startLatitude", 90),
            ["start_longitude"] = Coordinate(source, "startLongitude", 180),
            ["end_latitude"] = Coordinate(source, "endLatitude", 90),
            ["end_longitude"] = Coordinate(source, "endLongitude", 180),
            ["lap_count"] = Integer(source, "lapCount"),
        };
    }

    public static Dictionary<string, object?> NormalizeDaily(JsonElement source)
    {
        var date = Text(source, "calendarDate");
        if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
            throw new InvalidDataException("calendarDate no es una fecha válida.");
        // UDS ya exporta metros y kilocalorías: no aplicar las escalas de actividades.
        return new Dictionary<string, object?> {
            ["date"] = date,
            ["steps"] = Integer(source, "totalSteps"), ["step_goal"] = Integer(source, "dailyStepGoal"),
            ["distance_meters"] = Number(source, "totalDistanceMeters"),
            ["total_calories_kcal"] = Number(source, "totalKilocalories"),
            ["active_calories_kcal"] = Number(source, "activeKilocalories"),
            ["resting_calories_kcal"] = Number(source, "bmrKilocalories"),
            ["moderate_intensity_minutes"] = Integer(source, "moderateIntensityMinutes"),
            ["vigorous_intensity_minutes"] = Integer(source, "vigorousIntensityMinutes"),
            ["highly_active_seconds"] = Integer(source, "highlyActiveSeconds"),
            ["active_seconds"] = Integer(source, "activeSeconds"),
            ["floors_ascended_meters"] = Number(source, "floorsAscendedInMeters"),
            ["floors_descended_meters"] = Number(source, "floorsDescendedInMeters"),
            ["includes_activity_data"] = Flag(source, "includesActivityData"),
            ["includes_wellness_data"] = Flag(source, "includesWellnessData"),
        };
    }

    public static string Upsert(string table, string key, Dictionary<string, object?> values)
    {
        var columns = string.Join(",", values.Keys);
        var literals = string.Join(",", values.Values.Select(SqlLiteral));
        var updates = string.Join(",", values.Keys.Where(column => column != key).Select(column => $"{column}=excluded.{column}"));
        return $"INSERT INTO {table} ({columns}) VALUES ({literals}) ON CONFLICT({key}) DO UPDATE SET {updates};";
    }

    private static string SqlLiteral(object? value) => value switch {
        null => "NULL",
        string text => "'" + text.Replace("'", "''") + "'",
        IFormattable number => number.ToString(null, CultureInfo.InvariantCulture),
        _ => throw new InvalidDataException("Tipo SQL no compatible."),
    };

    private static void AddUnique(SortedDictionary<string, Dictionary<string, object?>> rows, string key, Dictionary<string, object?> value)
    {
        if (rows.TryGetValue(key, out var previous) && JsonSerializer.Serialize(previous) != JsonSerializer.Serialize(value))
            throw new InvalidDataException("El ZIP contiene registros duplicados con valores distintos.");
        rows[key] = value;
    }

    private static string? Text(JsonElement value, string key) =>
        value.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.String ? field.GetString() : null;

    private static double? Number(JsonElement value, string key, double scale = 1)
    {
        if (!value.TryGetProperty(key, out var field) || field.ValueKind == JsonValueKind.Null) return null;
        if (field.ValueKind != JsonValueKind.Number || !field.TryGetDouble(out var number) || !double.IsFinite(number))
            throw new InvalidDataException($"{key} debe ser un número finito.");
        return Math.Round(number * scale, 3, MidpointRounding.AwayFromZero);
    }

    private static double? PositiveNumber(JsonElement value, string key)
    {
        var number = Number(value, key);
        return number > 0 ? number : null;
    }

    private static double? Coordinate(JsonElement value, string key, int maximum)
    {
        if (!value.TryGetProperty(key, out var field) || field.ValueKind == JsonValueKind.Null) return null;
        if (!field.TryGetDouble(out var number) || !double.IsFinite(number) || Math.Abs(number) > maximum) return null;
        return Math.Round(number, 7);
    }

    private static long? Integer(JsonElement value, string key)
    {
        if (!value.TryGetProperty(key, out var field) || field.ValueKind == JsonValueKind.Null) return null;
        if (field.ValueKind != JsonValueKind.Number || !field.TryGetDecimal(out var number) || number != decimal.Truncate(number))
            throw new InvalidDataException($"{key} debe ser un número entero.");
        return checked((long)number);
    }

    private static long RequiredInteger(JsonElement value, string key) => Integer(value, key)
        ?? throw new InvalidDataException($"Falta {key}.");

    private static double RequiredNonnegative(JsonElement value, string key, double scale)
    {
        var number = Number(value, key, scale) ?? throw new InvalidDataException($"Falta {key}.");
        if (number < 0) throw new InvalidDataException($"{key} no puede ser negativo.");
        return number;
    }

    private static int Flag(JsonElement value, string key) =>
        value.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.True ? 1 : 0;
}

public record ImportReport(string SourceSha256, string GeneratedAt, int ActivityCount, int DailyCount,
    string FirstActivityDate, string LastActivityDate);
