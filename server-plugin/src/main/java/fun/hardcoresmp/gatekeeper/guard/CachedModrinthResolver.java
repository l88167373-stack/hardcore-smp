package fun.hardcoresmp.gatekeeper.guard;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import fun.hardcoresmp.gatekeeper.storage.Database;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Identification via l'API Modrinth (POST /v2/version_files, algorithme sha512), avec cache :
 * - fichiers reconnus : enregistrés dans SQLite (une version publiée ne change jamais) ;
 * - fichiers inconnus : retenus 10 minutes en mémoire (une nouvelle version peut apparaître ensuite).
 */
public final class CachedModrinthResolver implements ModrinthResolver {

    static final String API = "https://api.modrinth.com/v2/version_files";
    private static final Duration UNKNOWN_TTL = Duration.ofMinutes(10);

    private final Database database;
    private final String userAgent;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();
    private final Map<String, Identified> memory = new ConcurrentHashMap<>();
    private final Map<String, Long> unknownUntil = new ConcurrentHashMap<>();

    public CachedModrinthResolver(Database database, String userAgent) {
        this.database = database;
        this.userAgent = userAgent;
    }

    @Override
    public CompletableFuture<Map<String, Identified>> identify(Collection<String> sha512s) {
        Set<String> wanted = new HashSet<>();
        for (String hash : sha512s) if (hash != null && hash.matches("[0-9a-f]{128}")) wanted.add(hash);
        return fromDatabase(wanted).thenCompose(found -> {
            long now = System.currentTimeMillis();
            List<String> missing = new ArrayList<>();
            for (String hash : wanted) {
                if (found.containsKey(hash)) continue;
                Long until = unknownUntil.get(hash);
                if (until == null || until < now) missing.add(hash);
            }
            if (missing.isEmpty()) return CompletableFuture.completedFuture(found);
            return fetch(missing).thenCompose(fetched -> {
                for (String hash : missing) {
                    if (!fetched.containsKey(hash)) unknownUntil.put(hash, now + UNKNOWN_TTL.toMillis());
                }
                found.putAll(fetched);
                return save(fetched).thenApply(ignored -> found);
            });
        });
    }

    private CompletableFuture<Map<String, Identified>> fetch(List<String> hashes) {
        JsonObject body = new JsonObject();
        JsonArray array = new JsonArray();
        hashes.forEach(array::add);
        body.add("hashes", array);
        body.addProperty("algorithm", "sha512");
        HttpRequest request = HttpRequest.newBuilder(URI.create(API))
                .timeout(Duration.ofSeconds(10))
                .header("User-Agent", userAgent)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8))
                .build();
        return http.sendAsync(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).thenApply(response -> {
            if (response.statusCode() != 200) throw new IllegalStateException("Modrinth : HTTP " + response.statusCode());
            return parse(response.body());
        });
    }

    /** Réponse de /v2/version_files : { "&lt;sha512&gt;": { "project_id": …, "dependencies": [ … ] } }. */
    static Map<String, Identified> parse(String json) {
        Map<String, Identified> result = new HashMap<>();
        JsonObject root = JsonParser.parseString(json).getAsJsonObject();
        for (Map.Entry<String, JsonElement> entry : root.entrySet()) {
            JsonObject version = entry.getValue().getAsJsonObject();
            Set<String> required = new HashSet<>();
            JsonArray dependencies = version.has("dependencies") ? version.getAsJsonArray("dependencies") : new JsonArray();
            for (JsonElement element : dependencies) {
                JsonObject dependency = element.getAsJsonObject();
                if (dependency.has("project_id") && !dependency.get("project_id").isJsonNull()
                        && "required".equals(dependency.get("dependency_type").getAsString())) {
                    required.add(dependency.get("project_id").getAsString());
                }
            }
            result.put(entry.getKey(), new Identified(version.get("project_id").getAsString(), Set.copyOf(required)));
        }
        return result;
    }

    private CompletableFuture<Map<String, Identified>> fromDatabase(Set<String> hashes) {
        Map<String, Identified> found = new HashMap<>();
        Set<String> notInMemory = new HashSet<>();
        for (String hash : hashes) {
            Identified cached = memory.get(hash);
            if (cached != null) found.put(hash, cached);
            else notInMemory.add(hash);
        }
        if (notInMemory.isEmpty()) return CompletableFuture.completedFuture(found);
        return database.submit(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT project_id, dependencies FROM modrinth_cache WHERE sha512 = ?")) {
                for (String hash : notInMemory) {
                    statement.setString(1, hash);
                    try (ResultSet row = statement.executeQuery()) {
                        if (row.next()) {
                            Set<String> deps = new HashSet<>();
                            for (String dep : row.getString("dependencies").split(",")) if (!dep.isBlank()) deps.add(dep);
                            Identified identified = new Identified(row.getString("project_id"), Set.copyOf(deps));
                            memory.put(hash, identified);
                            found.put(hash, identified);
                        }
                    }
                }
            }
            return found;
        });
    }

    private CompletableFuture<Void> save(Map<String, Identified> identified) {
        if (identified.isEmpty()) return CompletableFuture.completedFuture(null);
        memory.putAll(identified);
        return database.submit(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                    "INSERT OR REPLACE INTO modrinth_cache (sha512, project_id, dependencies, checked_at) VALUES (?, ?, ?, ?)")) {
                for (Map.Entry<String, Identified> entry : identified.entrySet()) {
                    statement.setString(1, entry.getKey());
                    statement.setString(2, entry.getValue().projectId());
                    statement.setString(3, String.join(",", entry.getValue().requiredDependencies()));
                    statement.setLong(4, System.currentTimeMillis());
                    statement.addBatch();
                }
                statement.executeBatch();
            }
            return null;
        });
    }
}
