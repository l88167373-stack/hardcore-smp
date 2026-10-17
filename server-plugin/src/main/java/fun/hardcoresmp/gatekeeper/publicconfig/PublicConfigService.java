package fun.hardcoresmp.gatekeeper.publicconfig;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.function.Supplier;
import java.util.logging.Logger;

/**
 * Configuration publique (config/ sur GitHub), avec repli hors ligne :
 * 1. en ligne (raw GitHub), 2. dernière copie enregistrée, 3. copie embarquée dans le plugin.
 */
public final class PublicConfigService {

    private final Path cacheDir;
    private final Supplier<String> baseUrl;
    private final Logger log;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8))
            .followRedirects(HttpClient.Redirect.NORMAL).build();
    private volatile PublicConfig current;
    private volatile String source = "copie embarquée";

    public PublicConfigService(Path cacheDir, Supplier<String> baseUrl, Logger log) {
        this.cacheDir = cacheDir;
        this.baseUrl = baseUrl;
        this.log = log;
        this.current = loadCachedOrBundled();
    }

    public PublicConfig current() {
        return current;
    }

    public String source() {
        return source;
    }

    /** Relit la config en ligne (à appeler hors du thread principal). Garde l'ancienne en cas d'échec. */
    public void refresh() {
        String url = baseUrl.get();
        if (url == null) return;
        try {
            String launcher = fetch(url + "launcher.json");
            String allowlist = fetch(url + "allowlist.json");
            PublicConfig parsed = PublicConfig.parse(launcher, allowlist);
            Files.createDirectories(cacheDir);
            Files.writeString(cacheDir.resolve("launcher.json"), launcher, StandardCharsets.UTF_8);
            Files.writeString(cacheDir.resolve("allowlist.json"), allowlist, StandardCharsets.UTF_8);
            if (!parsed.equals(current)) log.info("Configuration publique mise à jour depuis GitHub");
            current = parsed;
            source = "en ligne (" + url + ")";
        } catch (IOException | IllegalArgumentException e) {
            log.warning("Configuration publique en ligne indisponible (" + e.getMessage() + ") : " + source + " conservée");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private String fetch(String url) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(10))
                .header("User-Agent", "HSMPGatekeeper").GET().build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() != 200) throw new IOException(url + " : HTTP " + response.statusCode());
        return response.body();
    }

    private PublicConfig loadCachedOrBundled() {
        try {
            Path launcher = cacheDir.resolve("launcher.json");
            Path allowlist = cacheDir.resolve("allowlist.json");
            if (Files.isRegularFile(launcher) && Files.isRegularFile(allowlist)) {
                PublicConfig cached = PublicConfig.parse(Files.readString(launcher), Files.readString(allowlist));
                source = "dernière copie téléchargée";
                return cached;
            }
        } catch (IOException | IllegalArgumentException e) {
            log.warning("Copie locale de la configuration publique illisible : " + e.getMessage());
        }
        source = "copie embarquée";
        return PublicConfig.parse(bundled("launcher.json"), bundled("allowlist.json"));
    }

    private static String bundled(String name) {
        try (InputStream in = PublicConfigService.class.getClassLoader().getResourceAsStream("public-config/" + name)) {
            if (in == null) throw new IllegalStateException("public-config/" + name + " absent du plugin");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
