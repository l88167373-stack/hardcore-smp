package fun.hardcoresmp.gatekeeper.publicconfig;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.HashSet;
import java.util.Set;

/**
 * Ce dont le serveur a besoin dans config/ (le même dossier que le launcher) :
 * versions minimales, version du règlement, version et empreinte du Guard publié, projets Modrinth autorisés.
 */
public record PublicConfig(
        String minLauncherVersion,
        String minGuardVersion,
        int rulesVersion,
        // Version du Guard publié (ex. 1.1.0) et SHA-512 de son jar ; null tant qu'il n'est pas publié (TODO).
        String guardVersion,
        String guardSha512,
        Set<String> requiredMods,
        Set<String> allowedMods,
        Set<String> allowedResourcePacks,
        Set<String> allowedShaders) {

    /** Lit launcher.json + allowlist.json. Lève IllegalArgumentException si un champ indispensable manque. */
    public static PublicConfig parse(String launcherJson, String allowlistJson) {
        try {
            JsonObject launcher = JsonParser.parseString(launcherJson).getAsJsonObject();
            JsonObject allowlist = JsonParser.parseString(allowlistJson).getAsJsonObject();
            JsonObject guard = launcher.getAsJsonObject("guard");
            String guardSha = guard.get("sha512").getAsString();
            boolean published = guardSha.matches("[0-9a-f]{128}");
            Set<String> required = strings(launcher.getAsJsonArray("requiredMods"));
            Set<String> mods = projectIds(allowlist.getAsJsonArray("mods"));
            mods.addAll(required);
            return new PublicConfig(
                    text(launcher, "minLauncherVersion"),
                    text(launcher, "minGuardVersion"),
                    launcher.get("rulesVersion").getAsInt(),
                    published ? text(guard, "version") : null,
                    published ? guardSha : null,
                    Set.copyOf(required),
                    Set.copyOf(mods),
                    Set.copyOf(projectIds(allowlist.getAsJsonArray("resourcepacks"))),
                    Set.copyOf(projectIds(allowlist.getAsJsonArray("shaders"))));
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("config publique invalide : " + e.getMessage(), e);
        }
    }

    private static String text(JsonObject json, String key) {
        String value = json.get(key).getAsString();
        if (!value.matches("\\d+\\.\\d+\\.\\d+.*")) throw new IllegalArgumentException(key + " doit être au format X.Y.Z");
        return value;
    }

    private static Set<String> strings(JsonArray array) {
        Set<String> result = new HashSet<>();
        for (JsonElement element : array) result.add(element.getAsString());
        return result;
    }

    private static Set<String> projectIds(JsonArray array) {
        Set<String> result = new HashSet<>();
        if (array == null) return result;
        for (JsonElement element : array) result.add(element.getAsJsonObject().get("projectId").getAsString());
        return result;
    }
}
