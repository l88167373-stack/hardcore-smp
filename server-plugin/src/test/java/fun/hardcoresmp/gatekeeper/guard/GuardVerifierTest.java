package fun.hardcoresmp.gatekeeper.guard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import fun.hardcoresmp.gatekeeper.guard.GuardVerifier.Verdict;
import fun.hardcoresmp.gatekeeper.guard.ModrinthResolver.Identified;
import fun.hardcoresmp.gatekeeper.publicconfig.PublicConfig;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.zip.GZIPOutputStream;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Réponses du Guard fabriquées à la main, vérifiées comme sur le vrai serveur. */
class GuardVerifierTest {

    static final byte[] KEY = "cle-de-test-du-guard-32-octets!!".getBytes(StandardCharsets.UTF_8);
    static final byte[] OLD_KEY = "ancienne-cle-du-guard-32-octets!".getBytes(StandardCharsets.UTF_8);
    static final String SODIUM = "a".repeat(128);
    static final String PLACEHOLDER_API = "b".repeat(128);
    static final String FREECAM = "c".repeat(128);
    static final String UNKNOWN = "d".repeat(128);
    static final String FAITHFUL = "e".repeat(128);

    final byte[] nonce = new byte[32];
    final long issuedAt = 1_000_000L;
    final GuardVerifier.Challenge challenge = new GuardVerifier.Challenge(nonce, issuedAt);
    final PublicConfig config = new PublicConfig("0.1.0", "1.0.0", 1, null, null, Set.of("P7dR8mSH"),
            Set.of("P7dR8mSH", "AANobbMI", "mOgUt4GM"), Set.of("w0TnApzs"), Set.of("HVnmMxH1"));
    final Map<String, Identified> modrinth = new HashMap<>();
    boolean modrinthDown;
    JsonObject body;

    final ModrinthResolver resolver = hashes -> {
        if (modrinthDown) return CompletableFuture.failedFuture(new IllegalStateException("Modrinth : HTTP 503"));
        Map<String, Identified> found = new HashMap<>();
        for (String hash : hashes) if (modrinth.containsKey(hash)) found.put(hash, modrinth.get(hash));
        return CompletableFuture.completedFuture(found);
    };

    @BeforeEach
    void setUp() {
        nonce[0] = 42;
        modrinth.put(SODIUM, new Identified("AANobbMI", Set.of()));
        modrinth.put("f".repeat(128), new Identified("mOgUt4GM", Set.of("P7dR8mSH", "eXts2L7r")));
        modrinth.put(PLACEHOLDER_API, new Identified("eXts2L7r", Set.of()));
        modrinth.put(FREECAM, new Identified("XeEZ3fK2", Set.of()));
        modrinth.put(FAITHFUL, new Identified("w0TnApzs", Set.of()));
        body = new JsonObject();
        body.addProperty("v", 1);
        body.addProperty("nonce", Base64.getEncoder().encodeToString(nonce));
        body.addProperty("issuedAt", issuedAt);
        body.addProperty("guard", "1.0.0");
        body.addProperty("launcher", "0.1.0");
        body.addProperty("launchToken", "jeton");
        body.addProperty("rules", 1);
        JsonArray mods = new JsonArray();
        mods.add(mod("hsmp-guard", "hsmp-guard-1.0.0.jar", "0".repeat(128)));
        mods.add(mod("sodium", "sodium.jar", SODIUM));
        body.add("mods", mods);
        body.add("nested", new JsonArray());
        body.add("external", new JsonArray());
        body.add("resourcepacks", new JsonArray());
        body.add("shader", JsonNull.INSTANCE);
    }

    static JsonObject mod(String id, String file, String sha) {
        JsonObject mod = new JsonObject();
        mod.addProperty("id", id);
        mod.addProperty("version", "1.0.0");
        mod.addProperty("file", file);
        mod.addProperty("sha512", sha);
        return mod;
    }

    byte[] response(byte[] key) throws Exception {
        String text = body.toString();
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        JsonObject envelope = new JsonObject();
        envelope.addProperty("body", text);
        envelope.addProperty("sig", Base64.getEncoder().encodeToString(mac.doFinal(text.getBytes(StandardCharsets.UTF_8))));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (GZIPOutputStream zip = new GZIPOutputStream(out)) {
            zip.write(envelope.toString().getBytes(StandardCharsets.UTF_8));
        }
        return out.toByteArray();
    }

    Verdict verify(byte[] response) {
        return verify(response, issuedAt + 500, true);
    }

    Verdict verify(byte[] response, long now, boolean failClosed) {
        return new GuardVerifier(resolver).verify(response, challenge, now, Duration.ofSeconds(5), List.of(KEY, OLD_KEY), config, failClosed).join();
    }

    void assertRefused(Verdict verdict, String key) {
        Verdict.Refused refused = assertInstanceOf(Verdict.Refused.class, verdict);
        assertEquals(key, refused.messageKey(), refused.logReason());
    }

    @Test
    void clientOfficielAvecModsAutorisesAccepte() throws Exception {
        Verdict.Accepted accepted = assertInstanceOf(Verdict.Accepted.class, verify(response(KEY)));
        assertEquals(1, accepted.rulesVersion());
    }

    @Test
    void lAncienneCleResteAccepteePendantUneMiseAJour() throws Exception {
        assertInstanceOf(Verdict.Accepted.class, verify(response(OLD_KEY)));
    }

    @Test
    void signatureInvalideOuReponseModifieeRefusee() throws Exception {
        assertRefused(verify(response("une-autre-cle-de-32-octets-xxxxx".getBytes(StandardCharsets.UTF_8))), "guard-invalid");
        assertRefused(verify("pas du gzip".getBytes(StandardCharsets.UTF_8)), "guard-invalid");
    }

    @Test
    void reponseRejoueeRefusee() throws Exception {
        byte[] old = response(KEY);
        nonce[0] = 7; // nouveau défi
        assertRefused(verify(old), "guard-invalid");
    }

    @Test
    void reponseTropTardiveRefusee() throws Exception {
        assertRefused(verify(response(KEY), issuedAt + 60_000, true), "guard-missing");
    }

    @Test
    void jeuLanceSansLeLauncherRefuse() throws Exception {
        body.addProperty("launchToken", "");
        assertRefused(verify(response(KEY)), "guard-missing");
    }

    @Test
    void guardOuLauncherTropAnciensRefuses() throws Exception {
        body.addProperty("guard", "0.9.0");
        assertRefused(verify(response(KEY)), "guard-outdated");
        setUp();
        body.addProperty("launcher", "0.0.9");
        assertRefused(verify(response(KEY)), "guard-outdated");
    }

    @Test
    void reglementPasAJourRefuse() throws Exception {
        body.addProperty("rules", 0);
        assertRefused(verify(response(KEY)), "rules-outdated");
    }

    @Test
    void modNonAutoriseRefuseAvecSonNom() throws Exception {
        body.getAsJsonArray("mods").add(mod("freecam", "freecam-1.5.0.jar", FREECAM));
        Verdict.Refused refused = assertInstanceOf(Verdict.Refused.class, verify(response(KEY)));
        assertEquals("mod-not-allowed", refused.messageKey());
        assertEquals("freecam-1.5.0.jar", refused.variables().get("mod"));
    }

    @Test
    void fichierInconnuDeModrinthRefuse() throws Exception {
        body.getAsJsonArray("mods").add(mod("xray", "xray.jar", UNKNOWN));
        assertRefused(verify(response(KEY)), "mod-not-allowed");
    }

    @Test
    void laDependanceObligatoireDUnModAutoriseEstAcceptee() throws Exception {
        // Mod Menu (autorisé) a besoin de Placeholder API (pas dans l'allowlist) : installé par le launcher, accepté.
        body.getAsJsonArray("mods").add(mod("modmenu", "modmenu.jar", "f".repeat(128)));
        body.getAsJsonArray("mods").add(mod("placeholder-api", "placeholder-api.jar", PLACEHOLDER_API));
        assertInstanceOf(Verdict.Accepted.class, verify(response(KEY)));
    }

    @Test
    void modChargeHorsDuDossierModsRefuse() throws Exception {
        JsonObject external = new JsonObject();
        external.addProperty("id", "meteor-client");
        external.addProperty("file", "meteor.jar");
        body.getAsJsonArray("external").add(external);
        assertRefused(verify(response(KEY)), "mod-not-allowed");
    }

    @Test
    void guardAbsentDeLaListeDesModsRefuse() throws Exception {
        body.getAsJsonArray("mods").remove(0);
        assertRefused(verify(response(KEY)), "guard-invalid");
    }

    @Test
    void packsEtShadersVerifiesAussi() throws Exception {
        JsonObject pack = new JsonObject();
        pack.addProperty("name", "Faithful 32x.zip");
        pack.addProperty("sha512", FAITHFUL);
        body.getAsJsonArray("resourcepacks").add(pack);
        assertInstanceOf(Verdict.Accepted.class, verify(response(KEY)));

        JsonObject xray = new JsonObject();
        xray.addProperty("name", "Xray Ultimate.zip");
        xray.addProperty("sha512", UNKNOWN);
        body.getAsJsonArray("resourcepacks").add(xray);
        Verdict.Refused refused = assertInstanceOf(Verdict.Refused.class, verify(response(KEY)));
        assertEquals("pack-not-allowed", refused.messageKey());
        assertEquals("Xray Ultimate.zip", refused.variables().get("pack"));
    }

    @Test
    void shaderEnDossierRefuse() throws Exception {
        JsonObject shader = new JsonObject();
        shader.addProperty("name", "MonShader");
        shader.add("sha512", JsonNull.INSTANCE);
        body.add("shader", shader);
        assertRefused(verify(response(KEY)), "shader-not-allowed");
    }

    @Test
    void modrinthInjoignableRefusParDefautOuAccepteSiFailClosedDesactive() throws Exception {
        modrinthDown = true;
        assertRefused(verify(response(KEY)), "verification-unavailable");
        assertInstanceOf(Verdict.Accepted.class, verify(response(KEY), issuedAt + 500, false));
    }

    Verdict verifyPublished(String publishedVersion) throws Exception {
        PublicConfig published = new PublicConfig("0.1.0", "1.0.0", 1, publishedVersion, "9".repeat(128), config.requiredMods(),
                config.allowedMods(), config.allowedResourcePacks(), config.allowedShaders());
        return new GuardVerifier(resolver).verify(response(KEY), challenge, issuedAt + 500, Duration.ofSeconds(5),
                List.of(KEY), published, true).join();
    }

    @Test
    void guardModifieRefuseQuandLEmpreintePublieeEstConnue() throws Exception {
        assertRefused(verifyPublished("1.0.0"), "guard-invalid");
    }

    @Test
    void ancienneVersionDuGuardAccepteePendantUneMiseAJour() throws Exception {
        // Le Guard 1.1.0 vient d'être publié ; ce joueur a lancé le jeu juste avant avec le 1.0.0 (toujours ≥ minGuardVersion).
        assertInstanceOf(Verdict.Accepted.class, verifyPublished("1.1.0"));
    }

    @Test
    void bombeGzipRefusee() throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (GZIPOutputStream zip = new GZIPOutputStream(out)) {
            zip.write(new byte[GuardVerifier.MAX_DECOMPRESSED + 10]);
        }
        assertRefused(verify(out.toByteArray()), "guard-invalid");
    }

    @Test
    void formatDuDefiIdentiqueAuMod() {
        byte[] bytes = GuardCheck.challenge(nonce, issuedAt);
        ByteBuffer buffer = ByteBuffer.wrap(bytes);
        assertEquals(1, buffer.get());
        byte[] read = new byte[32];
        buffer.get(read);
        assertEquals(42, read[0]);
        assertEquals(issuedAt, buffer.getLong());
        assertEquals(41, bytes.length);
    }

    @Test
    void comparaisonDeVersions() {
        assertTrue(Versions.atLeast("1.10.0", "1.9.0"));
        assertTrue(Versions.atLeast("1.0.0", "1.0.0"));
        assertTrue(!Versions.atLeast("1.0.0-beta.1", "1.0.0"));
        assertTrue(!Versions.atLeast("n'importe quoi", "1.0.0"));
    }

    @Test
    void reponseModrinthLue() {
        String json = """
                {"%s": {"project_id": "mOgUt4GM", "dependencies": [
                  {"project_id": "P7dR8mSH", "version_id": null, "dependency_type": "required"},
                  {"project_id": "eXts2L7r", "version_id": null, "dependency_type": "required"},
                  {"project_id": "optionnel", "version_id": null, "dependency_type": "optional"}
                ]}}""".formatted(SODIUM);
        Identified identified = CachedModrinthResolver.parse(json).get(SODIUM);
        assertEquals("mOgUt4GM", identified.projectId());
        assertEquals(Set.of("P7dR8mSH", "eXts2L7r"), identified.requiredDependencies());
    }
}
