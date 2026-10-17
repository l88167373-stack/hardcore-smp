package fun.hardcoresmp.gatekeeper.guard;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import fun.hardcoresmp.gatekeeper.guard.ModrinthResolver.Identified;
import fun.hardcoresmp.gatekeeper.publicconfig.PublicConfig;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.zip.GZIPInputStream;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Vérification de la réponse du HSMP Guard, dans l'ordre :
 * signature + nonce (anti-rejeu) → version du Guard → launcher officiel → règlement → mods, packs, shader.
 * Indépendant de Bukkit : testable avec de fausses réponses.
 */
public final class GuardVerifier {

    public static final int PROTOCOL = 1;
    /** Taille maximale après décompression (protège contre une « bombe » gzip). */
    static final int MAX_DECOMPRESSED = 1024 * 1024;

    public sealed interface Verdict {
        /** Joueur accepté : version du règlement qu'il a acceptée (à enregistrer comme preuve). */
        record Accepted(int rulesVersion, String summary) implements Verdict {}

        /** Refus : clé du message à afficher (config.yml), ses variables, et la raison pour les logs. */
        record Refused(String messageKey, Map<String, String> variables, String logReason) implements Verdict {}
    }

    /** Le défi envoyé à ce joueur. */
    public record Challenge(byte[] nonce, long issuedAt) {}

    private final ModrinthResolver modrinth;

    public GuardVerifier(ModrinthResolver modrinth) {
        this.modrinth = modrinth;
    }

    public CompletableFuture<Verdict> verify(byte[] response, Challenge challenge, long nowMillis, Duration timeout,
                                             List<byte[]> keys, PublicConfig config, boolean failClosed) {
        JsonObject body;
        try {
            JsonObject envelope = JsonParser.parseString(gunzip(response)).getAsJsonObject();
            String bodyText = envelope.get("body").getAsString();
            byte[] signature = Base64.getDecoder().decode(envelope.get("sig").getAsString());
            if (!signatureMatches(bodyText, signature, keys)) return refused("guard-invalid", Map.of(), "signature invalide (Guard modifié ou ancienne clé)");
            body = JsonParser.parseString(bodyText).getAsJsonObject();
        } catch (RuntimeException | IOException e) {
            return refused("guard-invalid", Map.of(), "réponse illisible : " + e.getMessage());
        }

        // Anti-rejeu : la réponse doit contenir le nonce de CE défi, et arriver à temps.
        if (body.get("v").getAsInt() != PROTOCOL) return refused("guard-outdated", Map.of(), "protocole " + body.get("v"));
        byte[] nonce = Base64.getDecoder().decode(body.get("nonce").getAsString());
        if (!MessageDigest.isEqual(nonce, challenge.nonce()) || body.get("issuedAt").getAsLong() != challenge.issuedAt()) {
            return refused("guard-invalid", Map.of(), "nonce différent (réponse rejouée)");
        }
        if (nowMillis - challenge.issuedAt() > timeout.toMillis() + 2_000) {
            return refused("guard-missing", Map.of(), "réponse trop tardive");
        }

        String guardVersion = body.get("guard").getAsString();
        if (!Versions.atLeast(guardVersion, config.minGuardVersion())) {
            return refused("guard-outdated", Map.of(), "Guard " + guardVersion + " < " + config.minGuardVersion());
        }
        if (body.get("launchToken").getAsString().isBlank()) {
            return refused("guard-missing", Map.of(), "jeu lancé sans le launcher officiel");
        }
        String launcherVersion = body.get("launcher").getAsString();
        if (!Versions.atLeast(launcherVersion, config.minLauncherVersion())) {
            return refused("guard-outdated", Map.of(), "launcher " + launcherVersion + " < " + config.minLauncherVersion());
        }
        int rules = body.get("rules").getAsInt();
        if (rules < config.rulesVersion()) {
            return refused("rules-outdated", Map.of(), "règlement v" + rules + " < v" + config.rulesVersion());
        }

        JsonArray external = body.getAsJsonArray("external");
        if (external != null && !external.isEmpty()) {
            String name = external.get(0).getAsJsonObject().get("id").getAsString();
            return refused("mod-not-allowed", Map.of("mod", name), "mod chargé hors du dossier mods : " + name);
        }

        // Fichiers à identifier sur Modrinth.
        List<FileEntry> files = new ArrayList<>();
        boolean guardFound = false;
        for (JsonElement element : body.getAsJsonArray("mods")) {
            JsonObject mod = element.getAsJsonObject();
            String id = mod.get("id").getAsString();
            String sha = mod.get("sha512").getAsString();
            if ("hsmp-guard".equals(id)) {
                guardFound = true;
                // On ne connaît que l'empreinte de la version publiée : une version plus ancienne (mise à jour en cours)
                // reste acceptée tant que sa clé est dans guard.keys et qu'elle respecte minGuardVersion.
                if (config.guardSha512() != null && guardVersion.equals(config.guardVersion()) && !config.guardSha512().equals(sha)) {
                    return refused("guard-invalid", Map.of(), "jar du Guard " + guardVersion + " différent de la version publiée");
                }
                continue;
            }
            files.add(new FileEntry(Kind.MOD, mod.get("file").getAsString(), sha));
        }
        if (!guardFound) return refused("guard-invalid", Map.of(), "le Guard ne se déclare pas dans la liste des mods");

        JsonArray packs = body.getAsJsonArray("resourcepacks");
        if (packs != null) {
            for (JsonElement element : packs) {
                JsonObject pack = element.getAsJsonObject();
                String name = pack.get("name").getAsString();
                if (pack.get("sha512").isJsonNull()) return refused("pack-not-allowed", Map.of("pack", name), "pack en dossier : " + name);
                files.add(new FileEntry(Kind.PACK, name, pack.get("sha512").getAsString()));
            }
        }
        if (body.has("shader") && body.get("shader").isJsonObject()) {
            JsonObject shader = body.getAsJsonObject("shader");
            String name = shader.get("name").getAsString();
            if (shader.get("sha512").isJsonNull()) return refused("shader-not-allowed", Map.of("shader", name), "shader en dossier : " + name);
            files.add(new FileEntry(Kind.SHADER, name, shader.get("sha512").getAsString()));
        }

        String summary = count(files, Kind.MOD) + " mod(s), " + count(files, Kind.PACK) + " pack(s), shader "
                + files.stream().filter(f -> f.kind() == Kind.SHADER).map(FileEntry::name).findFirst().orElse("aucun")
                + ", Guard " + guardVersion + ", launcher " + launcherVersion + ", règlement v" + rules;
        if (files.isEmpty()) return CompletableFuture.completedFuture(new Verdict.Accepted(rules, summary));

        return modrinth.identify(files.stream().map(FileEntry::sha512).toList()).handle((identified, error) -> {
            if (error != null) {
                if (failClosed) return new Verdict.Refused("verification-unavailable", Map.of(), "Modrinth injoignable : " + error.getMessage());
                return new Verdict.Accepted(rules, summary + " (NON vérifiés : Modrinth injoignable, fail-closed=false)");
            }
            return checkAllowed(files, identified, config, rules, summary);
        });
    }

    private enum Kind { MOD, PACK, SHADER }

    private record FileEntry(Kind kind, String name, String sha512) {}

    private static Verdict checkAllowed(List<FileEntry> files, Map<String, Identified> identified, PublicConfig config,
                                        int rules, String summary) {
        // Les dépendances obligatoires des mods autorisés sont autorisées aussi (installées par le launcher).
        Set<String> allowedMods = new HashSet<>(config.allowedMods());
        for (FileEntry file : files) {
            Identified id = identified.get(file.sha512());
            if (file.kind() == Kind.MOD && id != null && config.allowedMods().contains(id.projectId())) {
                allowedMods.addAll(id.requiredDependencies());
            }
        }
        for (FileEntry file : files) {
            Identified id = identified.get(file.sha512());
            Set<String> allowed = switch (file.kind()) {
                case MOD -> allowedMods;
                case PACK -> config.allowedResourcePacks();
                case SHADER -> config.allowedShaders();
            };
            if (id == null || !allowed.contains(id.projectId())) {
                String reason = id == null ? "fichier inconnu de Modrinth" : "projet " + id.projectId() + " absent de l'allowlist";
                return switch (file.kind()) {
                    case MOD -> new Verdict.Refused("mod-not-allowed", Map.of("mod", file.name()), "mod " + file.name() + " : " + reason);
                    case PACK -> new Verdict.Refused("pack-not-allowed", Map.of("pack", file.name()), "pack " + file.name() + " : " + reason);
                    case SHADER -> new Verdict.Refused("shader-not-allowed", Map.of("shader", file.name()), "shader " + file.name() + " : " + reason);
                };
            }
        }
        return new Verdict.Accepted(rules, summary);
    }

    static boolean signatureMatches(String bodyText, byte[] signature, List<byte[]> keys) {
        for (byte[] key : keys) {
            try {
                Mac mac = Mac.getInstance("HmacSHA256");
                mac.init(new SecretKeySpec(key, "HmacSHA256"));
                if (MessageDigest.isEqual(mac.doFinal(bodyText.getBytes(StandardCharsets.UTF_8)), signature)) return true;
            } catch (GeneralSecurityException e) {
                return false;
            }
        }
        return false;
    }

    static String gunzip(byte[] data) throws IOException {
        try (InputStream in = new GZIPInputStream(new ByteArrayInputStream(data))) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int read; (read = in.read(buffer)) != -1; ) {
                out.write(buffer, 0, read);
                if (out.size() > MAX_DECOMPRESSED) throw new IOException("réponse trop grande");
            }
            return out.toString(StandardCharsets.UTF_8);
        }
    }

    private static long count(List<FileEntry> files, Kind kind) {
        return files.stream().filter(f -> f.kind() == kind).count();
    }

    private static CompletableFuture<Verdict> refused(String key, Map<String, String> variables, String reason) {
        return CompletableFuture.completedFuture(new Verdict.Refused(key, variables, reason));
    }
}
