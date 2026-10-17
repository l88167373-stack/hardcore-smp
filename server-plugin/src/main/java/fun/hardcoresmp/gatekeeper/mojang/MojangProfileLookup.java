package fun.hardcoresmp.gatekeeper.mojang;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Recherche par pseudo via l'API officielle de Mojang (asynchrone, jamais sur le thread principal).
 * Deux adresses sont essayées l'une après l'autre en cas de panne.
 */
public final class MojangProfileLookup implements ProfileLookup {

    private static final List<String> ENDPOINTS = List.of(
            "https://api.minecraftservices.com/minecraft/profile/lookup/name/",
            "https://api.mojang.com/users/profiles/minecraft/");

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();
    private final String userAgent;

    public MojangProfileLookup(String userAgent) {
        this.userAgent = userAgent;
    }

    @Override
    public CompletableFuture<Optional<Profile>> byName(String name) {
        return attempt(name, 0);
    }

    private CompletableFuture<Optional<Profile>> attempt(String name, int index) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(ENDPOINTS.get(index) + URLEncoder.encode(name, StandardCharsets.UTF_8)))
                .timeout(Duration.ofSeconds(10))
                .header("User-Agent", userAgent)
                .header("Accept", "application/json")
                .GET()
                .build();
        return http.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .<CompletableFuture<Optional<Profile>>>handle((response, error) -> {
                    if (error == null && (response.statusCode() == 404 || response.statusCode() == 204)) {
                        return CompletableFuture.completedFuture(Optional.empty());
                    }
                    if (error == null && response.statusCode() == 200) {
                        return CompletableFuture.completedFuture(Optional.of(parse(response.body())));
                    }
                    String reason = error != null ? error.getMessage() : "HTTP " + response.statusCode();
                    if (index + 1 < ENDPOINTS.size()) return attempt(name, index + 1);
                    return CompletableFuture.failedFuture(new LookupException("API Mojang injoignable : " + reason, error));
                })
                .thenCompose(future -> future);
    }

    static Profile parse(String body) {
        JsonObject json = JsonParser.parseString(body).getAsJsonObject();
        return new Profile(dashed(json.get("id").getAsString()), json.get("name").getAsString());
    }

    /** « 069a79f444e94726a5befca90e38aaf5 » → UUID. */
    static UUID dashed(String id) {
        String hex = id.replace("-", "");
        return UUID.fromString(hex.replaceFirst("(\\w{8})(\\w{4})(\\w{4})(\\w{4})(\\w{12})", "$1-$2-$3-$4-$5"));
    }
}
