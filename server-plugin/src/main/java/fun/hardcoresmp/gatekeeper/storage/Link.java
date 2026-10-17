package fun.hardcoresmp.gatekeeper.storage;

import java.time.Instant;
import java.util.UUID;

/**
 * Lien entre un compte Discord et un compte Minecraft.
 * L'UUID est la clé : un changement de pseudo ne casse rien.
 *
 * @param linkedBy « self » si le joueur s'est whitelisté lui-même, sinon l'identifiant Discord du staff
 */
public record Link(UUID uuid, String discordId, String name, Instant linkedAt, String linkedBy) {

    public static final String SELF = "self";
}
