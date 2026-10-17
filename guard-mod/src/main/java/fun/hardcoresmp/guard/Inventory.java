package fun.hardcoresmp.guard;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.fabricmc.loader.api.metadata.ModOrigin;

/**
 * Ce que le Guard envoie au serveur — et RIEN d'autre :
 * les mods chargés, les packs de ressources actifs et le shader actif (nom + empreinte SHA-512),
 * uniquement depuis le dossier du jeu. Aucune liste de programmes, aucun fichier personnel.
 */
final class Inventory {

    /** Empreintes déjà calculées (chemin + taille + date) : on ne relit pas les fichiers à chaque connexion. */
    private static final Map<String, String> HASH_CACHE = new ConcurrentHashMap<>();

    private Inventory() {}

    static JsonArray mods(Path gameDirectory, JsonArray nested, JsonArray external) {
        Path modsDir = gameDirectory.resolve("mods").toAbsolutePath().normalize();
        Path librariesDir = gameDirectory.resolve("libraries").toAbsolutePath().normalize();
        JsonArray mods = new JsonArray();
        for (ModContainer mod : FabricLoader.getInstance().getAllMods()) {
            String id = mod.getMetadata().getId();
            // Minecraft et Java sont fournis par le launcher (vérifiés par lui).
            if ("builtin".equals(mod.getMetadata().getType())) continue;
            ModOrigin origin = mod.getOrigin();
            if (origin.getKind() == ModOrigin.Kind.NESTED) {
                nested.add(id);
                continue;
            }
            if (origin.getKind() != ModOrigin.Kind.PATH) continue;
            for (Path path : origin.getPaths()) {
                Path file = path.toAbsolutePath().normalize();
                // Fabric Loader est une bibliothèque installée et vérifiée (empreinte) par le launcher à chaque lancement.
                if ("fabricloader".equals(id) && file.startsWith(librariesDir)) continue;
                if (file.startsWith(modsDir) && Files.isRegularFile(file)) {
                    JsonObject entry = new JsonObject();
                    entry.addProperty("id", id);
                    entry.addProperty("version", mod.getMetadata().getVersion().getFriendlyString());
                    entry.addProperty("file", file.getFileName().toString());
                    entry.addProperty("sha512", sha512(file));
                    mods.add(entry);
                } else {
                    // Mod chargé hors du dossier mods/ (classpath, -Dfabric.addMods…) : le serveur refuse.
                    JsonObject entry = new JsonObject();
                    entry.addProperty("id", id);
                    entry.addProperty("file", file.getFileName().toString());
                    external.add(entry);
                }
            }
        }
        return mods;
    }

    /** Packs de ressources sélectionnés provenant du dossier resourcepacks/ (« file/… »). */
    static JsonArray resourcePacks(Path gameDirectory, List<String> selected) {
        JsonArray packs = new JsonArray();
        Path dir = gameDirectory.resolve("resourcepacks");
        for (String id : selected) {
            if (!id.startsWith("file/")) continue;
            String name = id.substring("file/".length());
            Path file = dir.resolve(name).normalize();
            JsonObject entry = new JsonObject();
            entry.addProperty("name", name);
            if (file.startsWith(dir) && Files.isRegularFile(file)) {
                entry.addProperty("sha512", sha512(file));
            } else {
                // Pack en dossier (non zippé) : impossible à identifier, le serveur refuse.
                entry.add("sha512", JsonNull.INSTANCE);
            }
            packs.add(entry);
        }
        return packs;
    }

    /** Shader actif d'Iris (config/iris.properties), ou null si aucun. */
    static JsonObject shader(Path gameDirectory) {
        Path config = gameDirectory.resolve("config").resolve("iris.properties");
        if (!Files.isRegularFile(config)) return null;
        Properties properties = new Properties();
        try (InputStream in = Files.newInputStream(config)) {
            properties.load(in);
        } catch (IOException e) {
            return null;
        }
        String pack = properties.getProperty("shaderPack", "").trim();
        if (!"true".equalsIgnoreCase(properties.getProperty("enableShaders", "false")) || pack.isEmpty()) return null;
        Path dir = gameDirectory.resolve("shaderpacks");
        Path file = dir.resolve(pack).normalize();
        JsonObject entry = new JsonObject();
        entry.addProperty("name", pack);
        if (file.startsWith(dir) && Files.isRegularFile(file)) {
            entry.addProperty("sha512", sha512(file));
        } else {
            entry.add("sha512", JsonNull.INSTANCE);
        }
        return entry;
    }

    static String sha512(Path file) {
        try {
            String key = file + "|" + Files.size(file) + "|" + Files.getLastModifiedTime(file).toMillis();
            return HASH_CACHE.computeIfAbsent(key, ignored -> compute(file));
        } catch (IOException e) {
            return "";
        }
    }

    private static String compute(Path file) {
        try (InputStream in = Files.newInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-512");
            byte[] buffer = new byte[64 * 1024];
            for (int read; (read = in.read(buffer)) != -1; ) digest.update(buffer, 0, read);
            return HexFormat.of().formatHex(digest.digest());
        } catch (IOException | NoSuchAlgorithmException e) {
            return "";
        }
    }
}
