package fun.hardcoresmp.guard;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.util.Base64;
import java.util.List;
import java.util.zip.GZIPOutputStream;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Réponse au défi du serveur : inventaire + nonce, signé en HMAC-SHA256 (le nonce empêche de rejouer
 * une ancienne réponse), puis compressé pour tenir dans un message Minecraft.
 */
final class GuardResponse {

    static final int PROTOCOL = 1;

    private GuardResponse() {}

    static byte[] build(GuardPayloads.Challenge challenge, Path gameDirectory, LaunchMarker marker,
                        String guardVersion, List<String> selectedResourcePacks) {
        JsonObject body = new JsonObject();
        body.addProperty("v", PROTOCOL);
        body.addProperty("nonce", Base64.getEncoder().encodeToString(challenge.nonce()));
        body.addProperty("issuedAt", challenge.issuedAt());
        body.addProperty("guard", guardVersion);
        body.addProperty("launcher", marker.launcherVersion());
        body.addProperty("launchToken", marker.token());
        body.addProperty("rules", marker.acceptedRulesVersion());
        JsonArray nested = new JsonArray();
        JsonArray external = new JsonArray();
        body.add("mods", Inventory.mods(gameDirectory, nested, external));
        body.add("nested", nested);
        body.add("external", external);
        body.add("resourcepacks", Inventory.resourcePacks(gameDirectory, selectedResourcePacks));
        body.add("shader", Inventory.shader(gameDirectory));

        String bodyText = body.toString();
        JsonObject envelope = new JsonObject();
        envelope.addProperty("body", bodyText);
        envelope.addProperty("sig", sign(bodyText));
        return gzip(envelope.toString().getBytes(StandardCharsets.UTF_8));
    }

    static String sign(String bodyText) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(GuardBuild.key(), "HmacSHA256"));
            return Base64.getEncoder().encodeToString(mac.doFinal(bodyText.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HMAC indisponible", e);
        }
    }

    private static byte[] gzip(byte[] data) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (GZIPOutputStream zip = new GZIPOutputStream(out)) {
            zip.write(data);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return out.toByteArray();
    }
}
