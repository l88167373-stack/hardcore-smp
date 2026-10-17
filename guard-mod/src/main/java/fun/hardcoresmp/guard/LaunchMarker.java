package fun.hardcoresmp.guard;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Marqueur écrit par le launcher officiel à chaque lancement : hsmp/launch.json (version du launcher,
 * version du règlement acceptée, jeton) + le même jeton passé dans -Dhsmp.launchToken.
 */
record LaunchMarker(boolean present, String launcherVersion, int acceptedRulesVersion, String token) {

    static final LaunchMarker ABSENT = new LaunchMarker(false, "", 0, "");

    static LaunchMarker read(Path gameDirectory) {
        String token = System.getProperty("hsmp.launchToken", "");
        Path file = gameDirectory.resolve("hsmp").resolve("launch.json");
        if (token.isBlank() || !Files.isRegularFile(file)) return ABSENT;
        try {
            JsonObject json = JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject();
            // Le jeton du fichier doit être celui de CE lancement (pas un ancien fichier copié).
            if (!token.equals(json.get("token").getAsString())) return ABSENT;
            return new LaunchMarker(true,
                    json.has("launcherVersion") ? json.get("launcherVersion").getAsString() : "",
                    json.has("acceptedRulesVersion") ? json.get("acceptedRulesVersion").getAsInt() : 0,
                    token);
        } catch (Exception e) {
            return ABSENT;
        }
    }
}
